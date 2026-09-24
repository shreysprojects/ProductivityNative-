import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { trySync } from './syncQueue'
import { invokeProxy } from './aiFood'
import { titleCaseExercise } from './exerciseNames'

// Exercises the user made up themselves: a name, an optional description and
// the muscles it trains. They ride in user_settings under 'custom_exercises'
// with a device mirror (per-id last-writer-wins, tombstones on delete), and
// are turned into the same shape the exercise library uses so the workout
// builder, muscle map, preview and run screen treat them like any other.
//
// Stored shape: { id, name, description, primary: [...], secondary: [...],
//                 createdAt, at, deleted }

// The muscle names the picker offers. Every one is a key the muscle map
// understands, so a custom exercise highlights the body outline correctly.
export const MUSCLE_OPTIONS = [
  'Chest', 'Upper Back', 'Lats', 'Lower Back', 'Traps', 'Shoulders',
  'Biceps', 'Triceps', 'Forearms',
  'Abs', 'Obliques', 'Core',
  'Hip Flexors', 'Adductors', 'Glutes', 'Quads', 'Hamstrings', 'Calves', 'Neck',
]

// Library body-part category for each muscle, so a custom exercise files
// under the right split category (Chest/Back/Arms/Legs/Core) everywhere the
// library's own exercises do.
const BODY_PART = {
  'Chest': 'chest',
  'Upper Back': 'back', 'Lats': 'back', 'Lower Back': 'back', 'Traps': 'back',
  'Shoulders': 'shoulders',
  'Biceps': 'upper arms', 'Triceps': 'upper arms',
  'Forearms': 'lower arms',
  'Abs': 'waist', 'Obliques': 'waist', 'Core': 'waist',
  'Hip Flexors': 'upper legs', 'Adductors': 'upper legs', 'Glutes': 'upper legs',
  'Quads': 'upper legs', 'Hamstrings': 'upper legs',
  'Calves': 'lower legs',
  'Neck': 'neck',
}

const KEY = uid => `@custom_exercises_${uid}`

export const isCustomExerciseId = id => typeof id === 'string' && id.startsWith('custom_')

// A YouTube video id is exactly 11 of these characters. Anything else (a
// path like "../../redirect?q=…") would send the player somewhere else.
export const isYouTubeId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id)

// Local edits and the merge that writes the cloud copy back run one at a
// time, so an exercise saved while a merge is between its read and its write
// is not overwritten by it. Only device reads and writes run in here, never
// the network.
let chain = Promise.resolve()
function serial(fn) {
  const run = chain.then(fn, fn)
  chain = run.then(() => {}, () => {})
  return run
}

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
    const list = raw ? JSON.parse(raw) : null
    if (Array.isArray(list)) return list
  } catch {}
  return []
}

// Throws when the device refuses the write: a save now returns as soon as it
// is on the device, so it must not report one that isn't.
function writeLocal(userId, list) {
  return AsyncStorage.setItem(KEY(userId), JSON.stringify(list))
}

function push(userId, list) {
  return trySync('user_settings', 'upsert', {
    user_id: userId, key: 'custom_exercises', data: { exercises: list },
    updated_at: new Date().toISOString(),
  })
}

// Two copies hold the same exercises when every id carries the same edit
// time. Comparing JSON text never matched, because jsonb hands the keys back
// in its own order, so every read pushed the whole list again.
function sameList(a, b) {
  if (a.length !== b.length) return false
  const at = new Map(a.map(c => [c.id, c.at ?? 0]))
  return b.every(c => at.has(c?.id) && at.get(c.id) === (c.at ?? 0))
}

// Merges the cloud copy into the device's and pushes the result. Nothing is
// pushed, or queued, unless the cloud copy was actually read: a list built
// without it would replace exercises made on another device.
async function readAll(userId) {
  let cloud = null
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('data')
      .eq('user_id', userId)
      .eq('key', 'custom_exercises')
      .maybeSingle()
    if (!error) cloud = Array.isArray(data?.data?.exercises) ? data.data.exercises : []
  } catch {}
  return serial(async () => {
    // Read after the network, so an edit saved meanwhile is part of the merge.
    const local = await readLocal(userId)
    if (cloud === null) return local
    const merged = merge(local, cloud)
    if (!sameList(merged, local)) await writeLocal(userId, merged).catch(() => {})
    if (!sameList(merged, cloud)) push(userId, merged).catch(() => {})
    return merged
  })
}

export async function getCustomExercises(userId) {
  return (await readAll(userId))
    .filter(c => !c.deleted)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
}

// Saves and deletes land on the device and return straight away; the cloud
// merge and push follow in the background. Waiting on two round trips first
// left a new exercise missing long enough that people made it twice.
export async function saveCustomExercise(userId, ex) {
  const next = await serial(async () => {
    const all = await readLocal(userId)
    const at = Date.now()
    const idx = all.findIndex(c => c.id === ex.id)
    const saved = { ...(idx >= 0 ? all[idx] : { createdAt: at }), ...ex, deleted: false, at }
    if (idx >= 0) all[idx] = saved
    else all.push(saved)
    await writeLocal(userId, all)
    return saved
  })
  readAll(userId).catch(() => {})
  return next
}

export async function deleteCustomExercise(userId, id) {
  await serial(async () => {
    const at = Date.now()
    const all = await readLocal(userId)
    // Not on this device yet: a bare tombstone still carries the delete up.
    const next = all.some(c => c.id === id)
      ? all.map(c => (c.id === id ? { ...c, deleted: true, at } : c))
      : [...all, { id, deleted: true, at }]
    await writeLocal(userId, next)
  })
  readAll(userId).catch(() => {})
}

// The library's exercise shape (see lib/wgerApi.js normalizeRow), so a custom
// exercise drops into the builder, plan, preview and run screen unchanged.
export function toLibraryExercise(c) {
  const primary = Array.isArray(c.primary) ? c.primary : []
  const secondary = Array.isArray(c.secondary) ? c.secondary : []
  const video = isYouTubeId(c.video?.id) ? c.video : null
  return {
    id: `custom_${c.id}`,
    customId: c.id,
    custom: true,
    name: titleCaseExercise(c.name),
    category: BODY_PART[primary[0]] ?? BODY_PART[secondary[0]] ?? '',
    equipment: 'Your exercise',
    description: c.description ?? '',
    muscles: primary.map(name => ({ id: 'primary', name })),
    musclesSecondary: secondary.map((name, i) => ({ id: i, name })),
    instructions: c.description ? [c.description] : [],
    gifUrl: null,
    // A YouTube demo found when the AI confirmed the exercise (see the
    // exercise_muscles proxy action); shown wherever a GIF would be.
    videoId: video?.id ?? null,
    videoTitle: typeof video?.title === 'string' ? video.title : null,
    inputType: 'reps',
    _custom: c,
  }
}

// Ask the AI which muscles an exercise trains. Resolves to
// { primary: [...], secondary: [...], note, video } using MUSCLE_OPTIONS
// spellings; `video` is { id, title } for a YouTube demo when the exercise
// was recognised, else null.
export function suggestMuscles({ name, description }) {
  return invokeProxy({ action: 'exercise_muscles', name, description: description ?? '' })
}
