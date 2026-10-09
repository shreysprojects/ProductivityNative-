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
    user_id: userId, key: 'custom_exercises', data: { exercises: list },
    updated_at: new Date().toISOString(),
  })
}

async function readAll(userId) {
  const local = await readLocal(userId)
  let cloud = null
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('data')
      .eq('user_id', userId)
      .eq('key', 'custom_exercises')
      .maybeSingle()
    if (!error) cloud = data?.data?.exercises ?? []
  } catch {}
  if (cloud === null) return local
  const merged = merge(local, cloud)
  if (JSON.stringify(merged) !== JSON.stringify(local)) await writeLocal(userId, merged)
  if (JSON.stringify(merged) !== JSON.stringify(cloud)) await push(userId, merged)
  return merged
}

export async function getCustomExercises(userId) {
  return (await readAll(userId))
    .filter(c => !c.deleted)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
}

export async function saveCustomExercise(userId, ex) {
  const all = await readAll(userId)
  const at = Date.now()
  const idx = all.findIndex(c => c.id === ex.id)
  const next = { ...(idx >= 0 ? all[idx] : { createdAt: at }), ...ex, deleted: false, at }
  if (idx >= 0) all[idx] = next
  else all.push(next)
  await writeLocal(userId, all)
  await push(userId, all)
  return next
}

export async function deleteCustomExercise(userId, id) {
  const all = await readAll(userId)
  const at = Date.now()
  const next = all.map(c => (c.id === id ? { ...c, deleted: true, at } : c))
  await writeLocal(userId, next)
  await push(userId, next)
}

// The library's exercise shape (see lib/wgerApi.js normalizeRow), so a custom
// exercise drops into the builder, plan, preview and run screen unchanged.
export function toLibraryExercise(c) {
  const primary = Array.isArray(c.primary) ? c.primary : []
  const secondary = Array.isArray(c.secondary) ? c.secondary : []
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
    videoId: c.video?.id ?? null,
    videoTitle: c.video?.title ?? null,
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
