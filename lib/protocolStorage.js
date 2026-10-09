import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { trySync, pendingDeleteIds } from './syncQueue'

// Protocols: emergency checklists for hard moments — feeling unmotivated,
// close to a relapse — plus the journal written after completing one.
// Local-first like the rest of the app: AsyncStorage is what the UI reads,
// the account copy is merged in on reads and written behind every save.
//
// Protocol shape:
//   { id, name, emoji, steps: [{ id, text }],
//     tracker: null | { since: epoch-ms },   // "days since" counter
//     createdAt, updatedAt }
//
// Journal entry shape:
//   { id, date: 'YYYY-MM-DD', protocolId, protocolName, text, at: epoch-ms }

const PROTOCOLS_KEY = uid => `@protocols_${uid}`
const PJOURNALS_KEY = uid => `@protocol_journals_${uid}`

export const genProtocolId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const parseTs = v => {
  if (typeof v === 'number') return v
  const t = Date.parse(v ?? '')
  return Number.isNaN(t) ? 0 : t
}

async function readLocal(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key)
    if (raw !== null) return JSON.parse(raw)
  } catch {}
  return fallback
}

// ── Protocols ──────────────────────────────────────────────────────────────

/** All protocols, merged with the account copy (newest per id wins). */
export async function getProtocols(userId) {
  const local = (await readLocal(PROTOCOLS_KEY(userId), [])) ?? []
  let cloud = null
  try {
    const { data, error } = await supabase
      .from('protocols')
      .select('id, data, updated_at')
      .eq('user_id', userId)
    if (!error && data) {
      cloud = data.map(r => ({ ...(r.data ?? {}), id: r.id, updatedAt: parseTs(r.updated_at) }))
    }
  } catch {}
  if (cloud === null) return local

  // A protocol deleted while offline still exists in the cloud until the
  // queued delete flushes. Merging that cloud copy back would resurrect it —
  // and re-uploading it below would fight the delete forever — so ids on
  // death row sit this merge out entirely.
  const doomed = await pendingDeleteIds('protocols')

  const byId = new Map(local.map(p => [p.id, p]))
  for (const c of cloud) {
    if (doomed.has(c.id)) continue
    const l = byId.get(c.id)
    if (!l || parseTs(c.updatedAt) > parseTs(l.updatedAt)) byId.set(c.id, c)
  }
  const merged = [...byId.values()].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  await AsyncStorage.setItem(PROTOCOLS_KEY(userId), JSON.stringify(merged)).catch(() => {})

  const cloudById = new Map(cloud.map(c => [c.id, c]))
  for (const p of merged) {
    if (cloudById.get(p.id) === p || doomed.has(p.id)) continue
    await trySync('protocols', 'upsert', _protocolRow(userId, p))
  }
  return merged
}

function _protocolRow(userId, p) {
  const { id, updatedAt, ...data } = p
  return {
    user_id: userId, id, data,
    updated_at: new Date(parseTs(updatedAt) || Date.now()).toISOString(),
  }
}

// Safety net: before a protocol's content is overwritten (manual edit, AI
// replace) or the protocol is deleted, the previous copy is stashed on the
// device (most recent 20). Not surfaced in any UI — it exists so a bad save
// or a mis-tapped delete is never truly unrecoverable.
const PBACKUP_KEY = uid => `@protocols_backup_${uid}`

async function stashProtocolCopy(userId, protocol) {
  if (!protocol) return
  try {
    const list = (await readLocal(PBACKUP_KEY(userId), [])) ?? []
    list.unshift({ ...protocol, stashedAt: Date.now() })
    await AsyncStorage.setItem(PBACKUP_KEY(userId), JSON.stringify(list.slice(0, 20)))
  } catch {}
}

export async function saveProtocol(userId, protocol) {
  const stamped = { ...protocol, updatedAt: Date.now() }
  const all = (await readLocal(PROTOCOLS_KEY(userId), [])) ?? []
  const idx = all.findIndex(p => p.id === stamped.id)
  if (idx >= 0) {
    // Run/tracker updates ride saveProtocol constantly — only stash when the
    // authored content (name, steps, note) actually changes.
    const prev = all[idx]
    const sig = p => JSON.stringify({ n: p.name, s: p.steps, o: p.note ?? null })
    if (sig(prev) !== sig(stamped)) await stashProtocolCopy(userId, prev)
    all[idx] = stamped
  } else {
    all.push(stamped)
  }
  await AsyncStorage.setItem(PROTOCOLS_KEY(userId), JSON.stringify(all)).catch(() => {})
  await trySync('protocols', 'upsert', _protocolRow(userId, stamped))
  return stamped
}

export async function deleteProtocol(userId, id) {
  const all = (await readLocal(PROTOCOLS_KEY(userId), [])) ?? []
  await stashProtocolCopy(userId, all.find(p => p.id === id))
  await AsyncStorage.setItem(
    PROTOCOLS_KEY(userId), JSON.stringify(all.filter(p => p.id !== id))
  ).catch(() => {})
  await trySync('protocols', 'delete', null, { user_id: userId, id })
}

/**
 * Erase one reset record from a protocol's history — the calendar's "forget
 * that day". Only the record goes: the live counter keeps ticking from
 * wherever tracker.since already is.
 */
export async function deleteProtocolReset(userId, protocolId, resetId) {
  const all = (await readLocal(PROTOCOLS_KEY(userId), [])) ?? []
  const p = all.find(x => x.id === protocolId)
  if (!p) return null
  return saveProtocol(userId, {
    ...p,
    resets: (p.resets ?? []).filter(r => r.id !== resetId),
  })
}

/** Whole days since the tracker was last reset (0 on the reset day itself). */
export function trackerDays(protocol) {
  const since = protocol?.tracker?.since
  if (!since) return null
  return Math.max(0, Math.floor((Date.now() - since) / 86400000))
}

// ── Protocol journals ──────────────────────────────────────────────────────
// Entries are append-mostly and individually addressed by id, so device and
// account merge by union with per-id newest-wins — nothing is ever dropped.

/** All entries as { [date]: [entry, …] }, each day newest first. */
export async function getProtocolJournals(userId) {
  const local = (await readLocal(PJOURNALS_KEY(userId), {})) ?? {}
  let cloud = null
  try {
    const { data, error } = await supabase
      .from('protocol_journals')
      .select('id, day, data, updated_at')
      .eq('user_id', userId)
    if (!error && data) {
      cloud = data.map(r => ({
        ...(r.data ?? {}), id: r.id, date: r.day, updatedAt: parseTs(r.updated_at),
      }))
    }
  } catch {}

  // Same death-row rule as protocols: an entry whose delete is still queued
  // must not ride back in from the cloud, nor be re-uploaded below.
  const doomed = cloud !== null ? await pendingDeleteIds('protocol_journals') : new Set()

  const byId = new Map()
  for (const list of Object.values(local)) {
    for (const e of list ?? []) byId.set(e.id, e)
  }
  if (cloud !== null) {
    for (const c of cloud) {
      if (doomed.has(c.id)) continue
      const l = byId.get(c.id)
      if (!l || parseTs(c.updatedAt) > parseTs(l.updatedAt)) byId.set(c.id, c)
    }
  }

  const merged = {}
  for (const e of byId.values()) {
    if (!e?.date) continue
    ;(merged[e.date] ??= []).push(e)
  }
  for (const list of Object.values(merged)) list.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))

  if (cloud !== null) {
    await AsyncStorage.setItem(PJOURNALS_KEY(userId), JSON.stringify(merged)).catch(() => {})
    const cloudIds = new Set(cloud.map(c => c.id))
    for (const e of byId.values()) {
      if (cloudIds.has(e.id) || doomed.has(e.id)) continue
      await trySync('protocol_journals', 'upsert', _journalRow(userId, e))
    }
  }
  return merged
}

function _journalRow(userId, e) {
  const { id, date, updatedAt, ...data } = e
  return {
    user_id: userId, id, day: date, data,
    updated_at: new Date(parseTs(updatedAt) || Date.now()).toISOString(),
  }
}

export async function saveProtocolJournal(userId, entry) {
  const stamped = { ...entry, updatedAt: Date.now() }
  const all = (await readLocal(PJOURNALS_KEY(userId), {})) ?? {}
  const list = (all[stamped.date] ??= [])
  const idx = list.findIndex(e => e.id === stamped.id)
  if (idx >= 0) list[idx] = stamped
  else list.unshift(stamped)
  await AsyncStorage.setItem(PJOURNALS_KEY(userId), JSON.stringify(all)).catch(() => {})
  await trySync('protocol_journals', 'upsert', _journalRow(userId, stamped))
  return stamped
}

export async function deleteProtocolJournal(userId, id, date) {
  const all = (await readLocal(PJOURNALS_KEY(userId), {})) ?? {}
  if (all[date]) {
    all[date] = all[date].filter(e => e.id !== id)
    if (all[date].length === 0) delete all[date]
    await AsyncStorage.setItem(PJOURNALS_KEY(userId), JSON.stringify(all)).catch(() => {})
  }
  await trySync('protocol_journals', 'delete', null, { user_id: userId, id })
}
