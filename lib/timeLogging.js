import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import { supabase } from './supabase'
import { trySync, pendingDeleteIds } from './syncQueue'

// Log what you were doing in fixed slots through the day (30 minutes by
// default). Local-first like the rest of storage: AsyncStorage is the source
// of truth the UI reads, Supabase is a background copy that also lets a second
// device catch up.
//
// Settings stay on the device on purpose — the slot grid drives local
// notifications, which each phone schedules for itself.

const SETTINGS_KEY  = uid => `@time_log_settings_${uid}`
const LOGS_KEY      = uid => `@time_logs_${uid}`
// The newest time_logs.updated_at this device has seen come back from the
// server — the high-water mark that lets getAllTimeLogs ask only for what
// changed since, instead of re-downloading the whole history.
const SYNCED_AT_KEY = uid => `@time_logs_synced_at_${uid}`
// Slots deleted on this device: { 'day|slotStart': deletedAt }. See deleteTimeLog.
const DELETED_KEY   = uid => `@time_logs_deleted_${uid}`
const NOTIF_PREFIX  = 'tlog-'

export const DEFAULT_LOG_SETTINGS = {
  enabled: true,      // show the Time log tab at all
  // Off by default on purpose: turning this on schedules a notification every
  // slot, all day. That should be a deliberate choice, not something an app
  // update starts doing to you.
  remind: false,
  interval: 30,       // minutes per slot: 15 | 30 | 60
  activeStart: 480,   // 8:00 AM
  activeEnd: 1320,    // 10:00 PM
}

export const LOG_INTERVALS = [15, 30, 60]

// ── Time helpers ───────────────────────────────────────────────────────────

export function slotStarts({ interval, activeStart, activeEnd }) {
  const out = []
  if (!interval || activeEnd <= activeStart) return out
  for (let t = activeStart; t < activeEnd; t += interval) out.push(t)
  return out
}

export function minsToLabel(mins) {
  const h24 = Math.floor(mins / 60) % 24
  const m = mins % 60
  const ampm = h24 >= 12 ? 'PM' : 'AM'
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`
}

export function timeLabel(mins) {
  return mins === 1440 ? 'Midnight' : minsToLabel(mins)
}

export function nowMins() {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

// ── Settings ───────────────────────────────────────────────────────────────

// ── user_settings: per-account key/value for things with no table ──────────
// The slot grid defines what every logged row *means*, so it belongs on the
// account — reinstalling onto default 30-minute slots would re-frame a log
// recorded in 15-minute ones.

async function readCloudSetting(userId, key) {
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('data, updated_at')
      .eq('user_id', userId)
      .eq('key', key)
      .maybeSingle()
    if (!error && data) return { data: data.data ?? {}, updatedAt: data.updated_at }
  } catch {}
  return null
}

function writeCloudSetting(userId, key, data, at) {
  return trySync('user_settings', 'upsert', {
    user_id: userId, key, data,
    updated_at: new Date(at || Date.now()).toISOString(),
  })
}

async function readLocalSettings(userId) {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY(userId))
    if (raw) return { ...DEFAULT_LOG_SETTINGS, ...JSON.parse(raw) }
  } catch {}
  return { ...DEFAULT_LOG_SETTINGS }
}

export async function getLogSettings(userId) {
  const local = await readLocalSettings(userId)
  const cloud = await readCloudSetting(userId, 'time_log_settings')
  if (!cloud) return upgradeReminders(local)
  // Newer wins. A local copy that predates syncing has no stamp, so the
  // account copy takes it.
  if (parseTs(cloud.updatedAt) > parseTs(local.updatedAt)) {
    const merged = { ...DEFAULT_LOG_SETTINGS, ...cloud.data, updatedAt: cloud.updatedAt }
    await AsyncStorage.setItem(SETTINGS_KEY(userId), JSON.stringify(merged)).catch(() => {})
    syncLogReminders(merged).catch(() => {})
    return merged
  }
  if (parseTs(local.updatedAt) > parseTs(cloud.updatedAt)) {
    writeCloudSetting(userId, 'time_log_settings', local, parseTs(local.updatedAt))
  }
  return upgradeReminders(local)
}

// Reminders are only rescheduled when the settings change, so a phone still
// holding ones from an older layout (see syncLogReminders) redoes them once
// here instead of waiting for that.
const REMINDER_LAYOUT_KEY = '@time_log_reminder_layout'
const REMINDER_LAYOUT = 'grouped'

function upgradeReminders(settings) {
  AsyncStorage.getItem(REMINDER_LAYOUT_KEY)
    .then(v => { if (v !== REMINDER_LAYOUT) return syncLogReminders(settings) })
    .catch(() => {})
  return settings
}

export async function saveLogSettings(userId, settings) {
  const at = Date.now()
  const merged = { ...DEFAULT_LOG_SETTINGS, ...settings, updatedAt: at }
  await AsyncStorage.setItem(SETTINGS_KEY(userId), JSON.stringify(merged)).catch(() => {})
  writeCloudSetting(userId, 'time_log_settings', merged, at)
  syncLogReminders(merged).catch(() => {})
  return merged
}

// ── Logs ───────────────────────────────────────────────────────────────────
// Shape: { [day]: { [slotStart]: { text, kind, updatedAt } } }

const parseTs = v => {
  if (typeof v === 'number') return v
  const t = Date.parse(v ?? '')
  return Number.isNaN(t) ? 0 : t
}

async function readLocal(userId) {
  try {
    const raw = await AsyncStorage.getItem(LOGS_KEY(userId))
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

function writeLocal(userId, all) {
  return AsyncStorage.setItem(LOGS_KEY(userId), JSON.stringify(all)).catch(() => {})
}

async function readDeleted(userId) {
  try {
    const raw = await AsyncStorage.getItem(DELETED_KEY(userId))
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

function writeDeleted(userId, deleted) {
  return AsyncStorage.setItem(DELETED_KEY(userId), JSON.stringify(deleted)).catch(() => {})
}

// The whole log lives in one blob under one key, so every write has to be
// built from the state the previous write left behind. Calls that share a
// chain run strictly one after another instead of racing — the same idiom as
// lib/storage.js. Two chains here: the log blob, and the auto-log marker
// blob further down.
const _chains = new Map()

function _serialize(key, fn) {
  const prev = _chains.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.then(() => {}, () => {})
  _chains.set(key, tail)
  tail.then(() => { if (_chains.get(key) === tail) _chains.delete(key) })
  return run
}

const LOGS_CHAIN = uid => `logs:${uid}`
const AUTO_CHAIN = uid => `auto:${uid}`

// How far behind the newest stamp the delta fetch still reaches back.
// updated_at is stamped by whichever device wrote the row, and a device that
// was offline replays its queued writes with their original stamps — so rows
// can land on the server "in the past". A week of overlap is a few hundred
// tiny rows at most, and it absorbs queue replays and device clock skew
// without ever approaching the cost of the full history.
const SYNC_LAP_MS = 7 * 24 * 60 * 60 * 1000

// Rows per request. PostgREST cuts every response off at the project's
// max_rows (1000 on Supabase), so one unpaged request quietly stopped at the
// first thousand rows of a full download.
const PAGE_ROWS = 1000

// When the newest fetch merged so far set out, per user. Fetches run outside
// the chain, so a slow one can come back after a newer one has merged.
const _mergedFrom = new Map()

/**
 * Every logged slot, merged with the cloud copy so a second device sees what
 * was logged elsewhere. Newer wins per slot; nothing local is ever dropped,
 * and a slot deleted here is not brought back (see deleteTimeLog).
 *
 * Only rows stamped since the last sync (minus the overlap above) are
 * fetched: the full history runs to thousands of rows and almost none of
 * them can have changed since the last look. The first call ever — no sync
 * marker yet, or no local cache left for a marker to be ahead of — still
 * downloads everything and queues anything the cloud is missing for upload.
 * The marker records the newest updated_at the server has shown us, never
 * this device's clock, so a skewed local clock can't make the window skip
 * rows.
 */
export async function getAllTimeLogs(userId) {
  let marker = null
  try { marker = await AsyncStorage.getItem(SYNCED_AT_KEY(userId)) } catch {}
  const localBefore = await readLocal(userId)
  // No marker means no sync has ever completed; an empty blob means the cache
  // was wiped out from under its marker. Either way only a full download can
  // be trusted to rebuild the history.
  const full = !marker || Object.keys(localBefore).length === 0

  const startedAt = Date.now()
  let cloud = null
  let fetched = 0
  let maxSeen = marker
  try {
    // Page by page until a short page, in a stable order so pages neither
    // overlap nor skip rows. A page that fails fails the whole fetch: half a
    // snapshot would make the rest of the history look missing from the cloud.
    const rows = []
    for (let from = 0; ; from += PAGE_ROWS) {
      let query = supabase
        .from('time_logs')
        .select('day, slot_start, text, kind, updated_at')
        .eq('user_id', userId)
      if (!full) {
        query = query.gt('updated_at', new Date(parseTs(marker) - SYNC_LAP_MS).toISOString())
      }
      const { data, error } = await query
        .order('day')
        .order('slot_start')
        .range(from, from + PAGE_ROWS - 1)
      if (error || !data) throw error ?? new Error('time_logs: no data')
      rows.push(...data)
      if (data.length < PAGE_ROWS) break
    }
    cloud = {}
    for (const r of rows) {
      ;(cloud[r.day] ??= {})[r.slot_start] = {
        text: r.text ?? '', kind: r.kind ?? 'log', updatedAt: r.updated_at,
      }
      if (parseTs(r.updated_at) > parseTs(maxSeen)) maxSeen = r.updated_at
      fetched++
    }
  } catch {}
  if (cloud === null) return localBefore
  // The usual focus: the window came back empty because nothing changed
  // anywhere. Skip the merge, the blob rewrite and the catch-up scan — this
  // call cost one small query and nothing else.
  if (!full && fetched === 0) return localBefore

  // The merge reads and rewrites the blob, so it takes its turn on the log
  // chain — a slot tapped while the fetch was in flight lands first and gets
  // merged, not overwritten.
  return _serialize(LOGS_CHAIN(userId), async () => {
    // An older snapshot than one already merged has nothing newer to offer,
    // and can still hold a slot deleted in between — drop it.
    if (startedAt < (_mergedFrom.get(userId) ?? 0)) return readLocal(userId)
    _mergedFrom.set(userId, startedAt)

    const local = await readLocal(userId)
    // A cloud row for a slot deleted here is dead, not new: its delete may be
    // queued (offline), or have landed after this fetch read the row. Merging
    // it back used to resurrect the slot.
    const pending = await pendingDeleteIds('time_logs')
    const deleted = await readDeleted(userId)
    const dead = (id, ce) =>
      pending.has(id) || (deleted[id] != null && parseTs(ce.updatedAt) <= deleted[id])

    const merged = {}
    let changed = false
    for (const day of new Set([...Object.keys(local), ...Object.keys(cloud)])) {
      const l = local[day] ?? {}, c = cloud[day] ?? {}
      const slots = {}
      for (const slot of new Set([...Object.keys(l), ...Object.keys(c)])) {
        const le = l[slot], ce = c[slot]
        if (!ce) { slots[slot] = le; continue }
        if (!le && dead(`${day}|${slot}`, ce)) continue
        if (!le || parseTs(ce.updatedAt) > parseTs(le.updatedAt)) {
          slots[slot] = ce
          changed = true
          continue
        }
        slots[slot] = le
      }
      if (Object.keys(slots).length > 0) merged[day] = slots
    }

    // A delete is remembered until a fetch that set out after it comes back
    // without the row (the cloud copy is gone) or with a newer one (the slot
    // was logged again elsewhere).
    let prunedDeleted = false
    for (const [id, at] of Object.entries(deleted)) {
      const [day, slot] = id.split('|')
      const ce = cloud[day]?.[slot]
      if (ce ? parseTs(ce.updatedAt) > at : startedAt > at) {
        delete deleted[id]
        prunedDeleted = true
      }
    }
    if (prunedDeleted) await writeDeleted(userId, deleted)

    // Collect anything the fetch showed the cloud is missing or holds a
    // losing copy of. A delta fetch says nothing about rows it didn't
    // return, so outside a full download only slots the fetch actually
    // covered are candidates — everything else was pushed when it was
    // written, or is already sitting in the durable queue.
    const toPush = []
    for (const [day, slots] of Object.entries(merged)) {
      for (const [slot, e] of Object.entries(slots)) {
        const c = cloud[day]?.[slot]
        if (!c && !full) continue
        if (c && c.text === e.text && c.kind === e.kind) continue
        toPush.push({
          user_id: userId, day, slot_start: Number(slot),
          text: e.text ?? '', kind: e.kind ?? 'log',
          updated_at: new Date(parseTs(e.updatedAt) || Date.now()).toISOString(),
        })
      }
    }

    // Rewrite the blob only when the cloud actually contributed something.
    // Not writeLocal here: its swallowed error would let the marker advance
    // past rows that never reached the disk, and the delta window would never
    // offer them again.
    let stored = !(full || changed)
    if (!stored) {
      try {
        await AsyncStorage.setItem(LOGS_KEY(userId), JSON.stringify(merged))
        stored = true
      } catch {}
    }
    if (stored && maxSeen && maxSeen !== marker) {
      await AsyncStorage.setItem(SYNCED_AT_KEY(userId), maxSeen).catch(() => {})
    }

    // Deliberately not awaited: after a device migration this is hundreds of
    // writes, and the caller only needs the merged data to render. On a
    // routine focus the list is empty and nothing runs at all.
    if (toPush.length > 0) {
      ;(async () => {
        for (const row of toPush) await trySync('time_logs', 'upsert', row)
      })().catch(() => {})
    }

    return merged
  })
}

/** Just today's (or any single day's) slots — reads the local copy only. */
export async function getTimeLogsForDay(userId, day) {
  const all = await readLocal(userId)
  return all[day] ?? {}
}

// A single tap still costs a stringify of the whole blob — the map lives
// under one key, so AsyncStorage offers no way to write one day without
// rewriting the rest. What the chain removes is the real hazard: two taps
// reading the same base copy, with the second write erasing the first's slot.
export function saveTimeLog(userId, day, slotStart, text, kind = 'log') {
  return _serialize(LOGS_CHAIN(userId), async () => {
    const all = await readLocal(userId)
    const at = Date.now()
    ;(all[day] ??= {})[slotStart] = { text, kind, updatedAt: at }
    await writeLocal(userId, all)
    await trySync('time_logs', 'upsert', {
      user_id: userId, day, slot_start: slotStart, text, kind,
      updated_at: new Date(at).toISOString(),
    })
    return all[day]
  })
}

// The delete is also written down on the device, stamped: a fetch already in
// flight can still hand the row back, and until the cloud copy is seen to be
// gone, getAllTimeLogs treats any copy no newer than the delete as dead.
export function deleteTimeLog(userId, day, slotStart) {
  return _serialize(LOGS_CHAIN(userId), async () => {
    const all = await readLocal(userId)
    if (all[day]) {
      delete all[day][slotStart]
      if (Object.keys(all[day]).length === 0) delete all[day]
      await writeLocal(userId, all)
    }
    const deleted = await readDeleted(userId)
    deleted[`${day}|${slotStart}`] = Date.now()
    await writeDeleted(userId, deleted)
    await trySync('time_logs', 'delete', null, { user_id: userId, day, slot_start: slotStart })
    return all[day] ?? {}
  })
}

/**
 * Import a backup copied from the standalone TimeLog app
 * ({ app: 'timelog-backup', entries: [{ day, slot_start, text, kind }] }) —
 * both apps key entries by day + minutes-from-midnight, so entries map 1:1.
 * Slots already logged here are kept: importing never overwrites. The cloud
 * upload runs in the background, like getAllTimeLogs' catch-up push.
 * Returns { imported, skipped, offGrid, days }, or null if the text isn't a
 * TimeLog backup.
 */
export async function importTimeLogBackup(userId, raw) {
  let data = null
  try { data = JSON.parse(String(raw ?? '')) } catch {}
  if (!data || data.app !== 'timelog-backup' || !Array.isArray(data.entries)) return null

  // The import is one more read-modify-write of the blob, so it takes its
  // turn on the chain rather than clobbering a tap in flight.
  return _serialize(LOGS_CHAIN(userId), async () => {
    const all = await readLocal(userId)
    const settings = await readLocalSettings(userId)
    const grid = new Set(slotStarts(settings))
    const at = Date.now()
    const days = new Set()
    const writes = []
    let skipped = 0, offGrid = 0

    for (const e of data.entries) {
      if (!e?.day || typeof e.slot_start !== 'number') continue
      const text = String(e.text ?? '').trim()
      // TimeLog's kinds: 'break' renders specially here too; anything else
      // (including future unknowns) lands as a plain log entry.
      const kind = e.kind === 'break' ? 'break' : 'log'
      if (!text && kind !== 'break') continue
      if (all[e.day]?.[e.slot_start]) { skipped++; continue }
      ;(all[e.day] ??= {})[e.slot_start] = { text, kind, updatedAt: at }
      if (!grid.has(e.slot_start)) offGrid++
      days.add(e.day)
      writes.push({ day: e.day, slot: e.slot_start, text, kind })
    }

    if (writes.length > 0) {
      await writeLocal(userId, all)
      ;(async () => {
        for (const w of writes) {
          await trySync('time_logs', 'upsert', {
            user_id: userId, day: w.day, slot_start: w.slot, text: w.text, kind: w.kind,
            updated_at: new Date(at).toISOString(),
          })
        }
      })().catch(() => {})
    }
    return { imported: writes.length, skipped, offGrid, days: days.size }
  })
}

// ── Auto-logging (finished routines, attended classes) ─────────────────────
// Things you've already done elsewhere in the app can write themselves onto
// the grid. Each one is remembered by a marker so it is only ever written
// once — deleting an auto-logged block has to stick, and a screen that
// re-renders (or an app that restarts) must not put it back.

const AUTOLOG_KEY = uid => `@time_log_auto_${uid}`

async function readLocalMarkers(userId) {
  try {
    const raw = await AsyncStorage.getItem(AUTOLOG_KEY(userId))
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

// A marker only guards the day it names — today's after-class prompt, today's
// routine — so two weeks of them is plenty. Older ones are dropped here
// rather than carried, and re-uploaded, forever.
const AUTOLOG_KEEP_MS = 14 * 24 * 60 * 60 * 1000

function pruneMarkers(markers) {
  const cutoff = Date.now() - AUTOLOG_KEEP_MS
  const out = {}
  for (const [k, at] of Object.entries(markers ?? {})) {
    if (!(typeof at === 'number' && at < cutoff)) out[k] = at
  }
  return out
}

// Same markers, whatever order the keys come back in (JSONB reorders them).
const sameMarkers = (a, b) =>
  JSON.stringify(Object.keys(a ?? {}).sort()) === JSON.stringify(Object.keys(b ?? {}).sort())

// Markers are only ever added (and aged out), never removed, so device and
// account merge by plain union — no conflict to resolve. Kept on the account
// so a reinstall doesn't re-ask about every class you already answered for.
async function _readAutoLogged(userId) {
  const local = await readLocalMarkers(userId)
  const cloud = await readCloudSetting(userId, 'time_log_auto')
  const merged = pruneMarkers(cloud ? { ...cloud.data, ...local } : local)
  if (!sameMarkers(merged, local)) {
    await AsyncStorage.setItem(AUTOLOG_KEY(userId), JSON.stringify(merged)).catch(() => {})
  }
  if (cloud && !sameMarkers(merged, cloud.data)) {
    writeCloudSetting(userId, 'time_log_auto', merged, Date.now())
  }
  return merged
}

// The markers share one blob of their own, so the merge-back above and the
// claims below queue on their own chain — two claims racing must not build
// from the same base copy and drop each other. addMarker calls the bare read
// rather than this wrapper: from inside its own turn on the chain, waiting
// for another turn would wait forever.
function readAutoLogged(userId) {
  return _serialize(AUTO_CHAIN(userId), () => _readAutoLogged(userId))
}

function addMarker(userId, marker) {
  return _serialize(AUTO_CHAIN(userId), async () => {
    const seen = await _readAutoLogged(userId)
    if (seen[marker]) return false
    seen[marker] = Date.now()
    await AsyncStorage.setItem(AUTOLOG_KEY(userId), JSON.stringify(seen)).catch(() => {})
    writeCloudSetting(userId, 'time_log_auto', seen, Date.now())
    return true
  })
}

/** 'HH:MM' → minutes from midnight. */
export function timeToMins(t) {
  const [h, m] = String(t ?? '').split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

/** Of the given markers, the ones that have never been logged or dismissed. */
export async function unloggedMarkers(userId, markers) {
  const seen = await readAutoLogged(userId)
  return markers.filter(m => !seen[m])
}

/** Remember a marker without writing anything — "no, I didn't attend". */
export function dismissAutoLog(userId, marker) {
  return addMarker(userId, marker)
}

/**
 * Write a real-world span onto the slot grid, at most once per marker.
 *
 * The start snaps to the NEAREST slot boundary and the span always covers at
 * least one whole slot, so a 5-minute routine begun at 8:40 reads as a single
 * 8:30–9:00 block. Slots that already hold an entry are left alone: an
 * auto-log never overwrites something you wrote yourself.
 *
 * Returns the number of slots written.
 */
export function autoLogSpan(userId, marker, { day, startMins, durationMins = 0, text, kind = 'log' }) {
  if (!userId || !day || !Number.isFinite(startMins)) return Promise.resolve(0)
  // The span write and the marker claim ride the log chain as one step, so a
  // slot tap can't slip in between them, and two callers racing (screen focus
  // + a finish handler) run one after the other — the loser sees the winner's
  // marker and bails.
  return _serialize(LOGS_CHAIN(userId), async () => {
    const seen = await readAutoLogged(userId)
    if (seen[marker]) return 0

    // Local read: the grid to snap onto is the one this device is showing.
    const settings = await readLocalSettings(userId)
    // A run that decides there is nothing to write still claims its marker on
    // the way out, exactly as before — logging that's turned off, a span
    // outside the day, or slots already filled by hand must not come back to
    // ask again. Claiming here is safe: with no log to lose, there is no gap
    // for an app kill to fall into.
    const bail = async () => { await addMarker(userId, marker); return 0 }
    if (!settings.enabled) return bail()
    const slots = slotStarts(settings)
    if (slots.length === 0) return bail()

    const snapped = slots.reduce((best, s) =>
      Math.abs(s - startMins) < Math.abs(best - startMins) ? s : best, slots[0])
    // Happened outside the logged part of the day — nothing sensible to write.
    if (Math.abs(snapped - startMins) > settings.interval) return bail()

    const span = Math.max(1, Math.ceil(Math.max(0, durationMins) / settings.interval))
    const startIdx = slots.indexOf(snapped)

    const all = await readLocal(userId)
    const dayLogs = (all[day] ??= {})
    const at = Date.now()
    const written = []
    for (let i = 0; i < span && startIdx + i < slots.length; i++) {
      const slot = slots[startIdx + i]
      if (dayLogs[slot]) continue
      dayLogs[slot] = { text, kind, updatedAt: at }
      written.push(slot)
    }
    if (written.length === 0) return bail()

    await writeLocal(userId, all)
    for (const slot of written) {
      await trySync('time_logs', 'upsert', {
        user_id: userId, day, slot_start: slot, text, kind,
        updated_at: new Date(at).toISOString(),
      })
    }
    // Only now is the marker claimed: the log is on disk and its uploads are
    // at worst in the durable queue. The old order claimed first, and an app
    // kill between claim and write lost the span for good — the marker syncs
    // to the account, so even a reinstall never offered it again. If the app
    // dies right here instead, the next run finds its own slots already
    // written, writes nothing, and claims through the bail above.
    await addMarker(userId, marker)
    return written.length
  })
}

/**
 * How much of each day got logged, as { [day]: loggedSlotCount }.
 * The denominator depends on the current settings, so the caller pairs this
 * with slotStarts(settings).length.
 */
export function loggedCountsByDay(allLogs) {
  const out = {}
  for (const [day, slots] of Object.entries(allLogs)) {
    out[day] = Object.keys(slots).length
  }
  return out
}

// ── Reminders ──────────────────────────────────────────────────────────────

/**
 * One repeating daily notification per slot, fired at the slot's END asking
 * what you did during it — or, when there are too many slots to fit, one per
 * group of neighbouring slots, asking about the whole group.
 *
 * Only `tlog-` notifications are touched — routine reminders and event alarms
 * are scheduled by other parts of the app and must survive this.
 */
export async function syncLogReminders(settings) {
  try {
    const existing = await Notifications.getAllScheduledNotificationsAsync()
    await Promise.all(existing
      .filter(r => r.identifier?.startsWith(NOTIF_PREFIX))
      .map(r => Notifications.cancelScheduledNotificationAsync(r.identifier)))
    // Whatever happens below, no old-layout reminder is left on this phone.
    await AsyncStorage.setItem(REMINDER_LAYOUT_KEY, REMINDER_LAYOUT).catch(() => {})

    if (!settings.enabled || !settings.remind) return 0

    const perm = await Notifications.requestPermissionsAsync()
    const S = Notifications.IosAuthorizationStatus
    const granted = perm.granted ||
      [S.AUTHORIZED, S.PROVISIONAL, S.EPHEMERAL].includes(perm.ios?.status)
    if (!granted) return 0

    // iOS caps pending local notifications at 64 across the whole app, and
    // routines/events need room too — so past 24 slots, neighbouring slots
    // share a reminder (two, then four...). It fires at the end of its group
    // and asks about all of it: asking about just the first slot left the rest
    // of every group without a prompt.
    const slots = slotStarts(settings)
    let per = 1
    while (Math.ceil(slots.length / per) > 24) per *= 2
    const groups = []
    for (let i = 0; i < slots.length; i += per) groups.push(slots.slice(i, i + per))

    await Promise.all(groups.map(group => {
      const s = group[0]
      const end = group[group.length - 1] + settings.interval
      const fireAt = end % 1440
      return Notifications.scheduleNotificationAsync({
        identifier: `${NOTIF_PREFIX}${s}`,
        content: {
          title: 'Log your time',
          body: `What did you do from ${minsToLabel(s)} to ${minsToLabel(end)}?`,
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: Math.floor(fireAt / 60),
          minute: fireAt % 60,
        },
      })
    }))
    return groups.length
  } catch {
    return 0
  }
}
