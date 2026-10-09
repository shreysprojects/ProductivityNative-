import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { trySync } from './syncQueue'

// Clubs and societies the user belongs to. There is no clubs table: the list
// rides in user_settings under key 'clubs' as { clubs: [...] }, the same
// per-account key/value store the time-log settings and weight history use,
// with a device mirror for speed and offline use.
//
// Meetings are NOT stored here. A weekly meeting is an ordinary schedule item
// tagged meta.clubId (see components/ClubsSection.js), so the calendar, class
// reminders and attendance prompts treat it exactly like a class.
//
// Each club: { id, name, emoji, role, createdAt, at, deleted }. `at` stamps
// every write and merge-on-read is per-id last-writer-wins, so a club removed
// on one device stays removed (its tombstone outranks the older live copy)
// instead of being resurrected by a plain union.

const KEY = uid => `@clubs_${uid}`

function merge(local, cloud) {
  const byId = new Map()
  for (const c of local ?? []) if (c?.id) byId.set(c.id, c)
  for (const c of cloud ?? []) {
    if (!c?.id) continue
    const l = byId.get(c.id)
    if (!l || (c.at ?? 0) > (l.at ?? 0)) byId.set(c.id, c)
  }
  return [...byId.values()]
}

async function readLocal(userId) {
  try {
    const raw = await AsyncStorage.getItem(KEY(userId))
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

function writeLocal(userId, list) {
  return AsyncStorage.setItem(KEY(userId), JSON.stringify(list)).catch(() => {})
}

function push(userId, list) {
  return trySync('user_settings', 'upsert', {
    user_id: userId, key: 'clubs', data: { clubs: list },
    updated_at: new Date().toISOString(),
  })
}

// Everything, tombstones included. Merges the account copy into the mirror
// and pushes the union back up when either side was missing something.
async function readAll(userId) {
  const local = await readLocal(userId)
  let cloud = null
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('data')
      .eq('user_id', userId)
      .eq('key', 'clubs')
      .maybeSingle()
    if (!error) cloud = data?.data?.clubs ?? []
  } catch {}
  if (cloud === null) return local
  const merged = merge(local, cloud)
  if (JSON.stringify(merged) !== JSON.stringify(local)) await writeLocal(userId, merged)
  if (JSON.stringify(merged) !== JSON.stringify(cloud)) await push(userId, merged)
  return merged
}

export async function getClubs(userId) {
  return (await readAll(userId))
    .filter(c => !c.deleted)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
}

export async function saveClub(userId, club) {
  const all = await readAll(userId)
  const at = Date.now()
  const idx = all.findIndex(c => c.id === club.id)
  const next = { ...(idx >= 0 ? all[idx] : { createdAt: at }), ...club, deleted: false, at }
  if (idx >= 0) all[idx] = next
  else all.push(next)
  await writeLocal(userId, all)
  await push(userId, all)
  return next
}

export async function deleteClub(userId, id) {
  const all = await readAll(userId)
  const at = Date.now()
  const next = all.map(c => (c.id === id ? { ...c, deleted: true, at } : c))
  await writeLocal(userId, next)
  await push(userId, next)
}
