import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { trySync } from './syncQueue'

// Which classes were ticked off on the calendar, per day. Keyed
// `${scheduleItemId}|${YYYY-MM-DD}` → { on, at }. The map rides in
// user_settings under 'class_checks' (the per-account key/value store) with a
// device mirror. Merge is per-key last-writer-wins, so an untick on one device
// beats an older tick from another. Entries older than ~4 months are dropped
// on write so the blob stays small.

const KEY = uid => `@class_checks_${uid}`
const KEEP_DAYS = 120

export const classCheckKey = (scheduleId, day) => `${scheduleId}|${day}`

function merge(local, cloud) {
  const out = { ...(local ?? {}) }
  for (const [k, v] of Object.entries(cloud ?? {})) {
    const l = out[k]
    if (!l || (v?.at ?? 0) > (l.at ?? 0)) out[k] = v
  }
  return out
}

function prune(checks) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - KEEP_DAYS)
  const min = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`
  const out = {}
  for (const [k, v] of Object.entries(checks)) {
    const day = k.slice(k.lastIndexOf('|') + 1)
    if (day >= min) out[k] = v
  }
  return out
}

// The account copy is JSONB, which hands the map back with its keys
// reordered — comparing stringified copies found a difference on nearly
// every read and re-uploaded the whole map each time. Compare entries.
function sameChecks(a, b) {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every(k => !!b[k] && !!b[k].on === !!a[k]?.on && (b[k].at ?? 0) === (a[k]?.at ?? 0))
}

async function readLocal(userId) {
  try {
    const raw = await AsyncStorage.getItem(KEY(userId))
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

function writeLocal(userId, checks) {
  return AsyncStorage.setItem(KEY(userId), JSON.stringify(checks)).catch(() => {})
}

function push(userId, checks) {
  return trySync('user_settings', 'upsert', {
    user_id: userId, key: 'class_checks', data: { checks },
    updated_at: new Date().toISOString(),
  })
}

// Reads merge and write back, and writes rewrite the whole map, so every
// call for a user takes its turn on one chain — two quick taps used to build
// from the same copy, and the second erased the first. The same idiom as
// lib/storage.js.
const _chains = new Map()

function _serialize(key, fn) {
  const prev = _chains.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.then(() => {}, () => {})
  _chains.set(key, tail)
  tail.then(() => { if (_chains.get(key) === tail) _chains.delete(key) })
  return run
}

async function readAll(userId) {
  const local = await readLocal(userId)
  let cloud = null
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('data')
      .eq('user_id', userId)
      .eq('key', 'class_checks')
      .maybeSingle()
    if (!error) cloud = data?.data?.checks ?? {}
  } catch {}
  if (cloud === null) return local
  const merged = merge(local, cloud)
  if (!sameChecks(merged, local)) await writeLocal(userId, merged)
  if (!sameChecks(merged, cloud)) await push(userId, merged)
  return merged
}

// { [key]: true } for every class currently ticked.
export function getClassChecks(userId) {
  return _serialize(userId, async () => {
    const all = await readAll(userId)
    const on = {}
    for (const [k, v] of Object.entries(all)) if (v?.on) on[k] = true
    return on
  })
}

export function setClassCheck(userId, key, on) {
  return _serialize(userId, async () => {
    const all = prune(await readAll(userId))
    all[key] = { on: !!on, at: Date.now() }
    await writeLocal(userId, all)
    await push(userId, all)
  })
}
