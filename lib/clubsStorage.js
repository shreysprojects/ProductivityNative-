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

// The same clubs in the same versions, whatever the key or list order. JSONB
// hands objects back with its own key order, so comparing JSON.stringify
// output saw a change on every read and uploaded the whole list again.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter(k => v[k] !== undefined).sort()
      .map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

function sameClubs(a, b) {
  const byId = list => [...(list ?? [])].sort((x, y) => String(x?.id).localeCompare(String(y?.id)))
  return canonical(byId(a)) === canonical(byId(b))
}

// Everything, tombstones included. Merges the account copy into the mirror
// and pushes the union back up when either side was missing something.
// `cloudOk` is false when the account copy could not be read.
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
  if (cloud === null) return { all: local, cloudOk: false }
  const merged = merge(local, cloud)
  if (!sameClubs(merged, local)) await writeLocal(userId, merged)
  if (!sameClubs(merged, cloud)) await push(userId, merged)
  return { all: merged, cloudOk: true }
}

// The list is one row, so every upload replaces it whole. A list built
// without the account's copy (offline) stays on this device instead of being
// queued: replayed later, it would drop clubs added on another device in the
// meantime. The next read that reaches the account merges it in and uploads.
async function store(userId, list, cloudOk) {
  await writeLocal(userId, list)
  if (cloudOk) await push(userId, list)
}

export async function getClubs(userId) {
  return (await readAll(userId)).all
    .filter(c => !c.deleted)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
}

export async function saveClub(userId, club) {
  const { all, cloudOk } = await readAll(userId)
  const at = Date.now()
  const idx = all.findIndex(c => c.id === club.id)
  const next = { ...(idx >= 0 ? all[idx] : { createdAt: at }), ...club, deleted: false, at }
  if (idx >= 0) all[idx] = next
  else all.push(next)
  await store(userId, all, cloudOk)
  return next
}

export async function deleteClub(userId, id) {
  const { all, cloudOk } = await readAll(userId)
  const at = Date.now()
  const next = all.map(c => (c.id === id ? { ...c, deleted: true, at } : c))
  await store(userId, next, cloudOk)
}
