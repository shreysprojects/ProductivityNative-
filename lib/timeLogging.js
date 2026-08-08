import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import { supabase } from './supabase'
import { trySync } from './syncQueue'

// Log what you were doing in fixed slots through the day (30 minutes by
// default). Local-first like the rest of storage: AsyncStorage is the source
// of truth the UI reads, Supabase is a background copy that also lets a second
// device catch up.
//
// Settings stay on the device on purpose — the slot grid drives local
// notifications, which each phone schedules for itself.

const SETTINGS_KEY = uid => `@time_log_settings_${uid}`
const LOGS_KEY     = uid => `@time_logs_${uid}`
const NOTIF_PREFIX = 'tlog-'

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

export async function getLogSettings(userId) {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY(userId))
    if (raw) return { ...DEFAULT_LOG_SETTINGS, ...JSON.parse(raw) }
  } catch {}
  return { ...DEFAULT_LOG_SETTINGS }
}

export async function saveLogSettings(userId, settings) {
  const merged = { ...DEFAULT_LOG_SETTINGS, ...settings }
  await AsyncStorage.setItem(SETTINGS_KEY(userId), JSON.stringify(merged)).catch(() => {})
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

/**
 * Every logged slot, merged with the cloud copy so a second device sees what
 * was logged elsewhere. Newer wins per slot; nothing local is ever dropped,
 * and slots the cloud is missing are queued for upload.
 */
export async function getAllTimeLogs(userId) {
  const local = await readLocal(userId)
  let cloud = null
  try {
    const { data, error } = await supabase
      .from('time_logs')
      .select('day, slot_start, text, kind, updated_at')
      .eq('user_id', userId)
    if (!error && data) {
      cloud = {}
      for (const r of data) {
        ;(cloud[r.day] ??= {})[r.slot_start] = {
          text: r.text ?? '', kind: r.kind ?? 'log', updatedAt: r.updated_at,
        }
      }
    }
  } catch {}
  if (cloud === null) return local

  const merged = {}
  for (const day of new Set([...Object.keys(local), ...Object.keys(cloud)])) {
    const l = local[day] ?? {}, c = cloud[day] ?? {}
    const slots = {}
    for (const slot of new Set([...Object.keys(l), ...Object.keys(c)])) {
      const le = l[slot], ce = c[slot]
      if (!ce) { slots[slot] = le; continue }
      if (!le) { slots[slot] = ce; continue }
      slots[slot] = parseTs(ce.updatedAt) > parseTs(le.updatedAt) ? ce : le
    }
    merged[day] = slots
  }
  await writeLocal(userId, merged)

  // Push anything the cloud is missing or has an older copy of. Deliberately
  // not awaited: on a device with months of logs this is hundreds of writes,
  // and the caller only needs the merged data to render.
  ;(async () => {
    for (const [day, slots] of Object.entries(merged)) {
      for (const [slot, e] of Object.entries(slots)) {
        const c = cloud[day]?.[slot]
        if (c && c.text === e.text && c.kind === e.kind) continue
        await trySync('time_logs', 'upsert', {
          user_id: userId, day, slot_start: Number(slot),
          text: e.text ?? '', kind: e.kind ?? 'log',
          updated_at: new Date(parseTs(e.updatedAt) || Date.now()).toISOString(),
        })
      }
    }
  })().catch(() => {})

  return merged
}

/** Just today's (or any single day's) slots — reads the local copy only. */
export async function getTimeLogsForDay(userId, day) {
  const all = await readLocal(userId)
  return all[day] ?? {}
}

export async function saveTimeLog(userId, day, slotStart, text, kind = 'log') {
  const all = await readLocal(userId)
  const at = Date.now()
  ;(all[day] ??= {})[slotStart] = { text, kind, updatedAt: at }
  await writeLocal(userId, all)
  await trySync('time_logs', 'upsert', {
    user_id: userId, day, slot_start: slotStart, text, kind,
    updated_at: new Date(at).toISOString(),
  })
  return all[day]
}

export async function deleteTimeLog(userId, day, slotStart) {
  const all = await readLocal(userId)
  if (all[day]) {
    delete all[day][slotStart]
    if (Object.keys(all[day]).length === 0) delete all[day]
    await writeLocal(userId, all)
  }
  await trySync('time_logs', 'delete', null, { user_id: userId, day, slot_start: slotStart })
  return all[day] ?? {}
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
 * what you did during it.
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

    if (!settings.enabled || !settings.remind) return 0

    const perm = await Notifications.requestPermissionsAsync()
    const S = Notifications.IosAuthorizationStatus
    const granted = perm.granted ||
      [S.AUTHORIZED, S.PROVISIONAL, S.EPHEMERAL].includes(perm.ios?.status)
    if (!granted) return 0

    // iOS caps pending local notifications at 64 across the whole app, and
    // routines/events need room too — thin out until this fits in 24.
    let starts = slotStarts(settings)
    while (starts.length > 24) starts = starts.filter((_, i) => i % 2 === 0)

    await Promise.all(starts.map(s => {
      const end = s + settings.interval
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
    return starts.length
  } catch {
    return 0
  }
}
