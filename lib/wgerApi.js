import { supabase } from './supabase'
import { titleCaseExercise } from './exerciseNames'

export const WGER_CATEGORIES = [
  { id: 'chest',      name: 'Chest' },
  { id: 'back',       name: 'Back' },
  { id: 'shoulders',  name: 'Shoulders' },
  { id: 'upper arms', name: 'Arms' },
  { id: 'upper legs', name: 'Legs' },
  { id: 'lower legs', name: 'Calves' },
  { id: 'waist',      name: 'Core' },
  { id: 'cardio',     name: 'Cardio' },
  { id: 'lower arms', name: 'Forearms' },
  { id: 'neck',       name: 'Neck' },
]

const TIMED_NAME_FRAGMENTS = ['plank', 'wall sit', 'dead hang', 'hollow', 'l-sit', 'isometric', 'treadmill', 'bike', 'elliptical', 'rowing', 'jump rope']

function normalizeRow(row) {
  const muscles          = row.target ? [{ id: 'primary', name: row.target }] : []
  const musclesSecondary = (row.secondary_muscles || []).map((name, i) => ({ id: i, name }))
  const instructions     = Array.isArray(row.instructions) ? row.instructions : []
  const isCardio         = (row.body_part || '').toLowerCase() === 'cardio'
  const nameLower        = (row.name || '').toLowerCase()
  const isTimedName      = TIMED_NAME_FRAGMENTS.some(t => nameLower.includes(t))
  return {
    id:               row.id,
    name:             titleCaseExercise(row.name),
    category:         row.body_part || '',
    description:      row.description || '',
    muscles,
    musclesSecondary,
    instructions,
    gifUrl:           row.gif_url || null,
    equipment:        row.equipment || '',
    difficulty:       row.difficulty || '',
    inputType:        row.input_type ?? (isCardio || isTimedName ? 'time' : 'reps'),
  }
}

export async function fetchExercisesByCategory(bodyPart, offset = 0, limit = 20) {
  const { data, count } = await supabase
    .from('exercises')
    .select('*', { count: 'exact' })
    .ilike('body_part', bodyPart)
    .order('name')
    .range(offset, offset + limit - 1)
  return {
    results: (data || []).map(normalizeRow),
    count: count ?? 0,
  }
}

export async function fetchExerciseInfo(id) {
  const { data } = await supabase
    .from('exercises')
    .select('*')
    .eq('id', id)
    .single()
  return data ? normalizeRow(data) : null
}

// Every search word must match the name OR the tagged muscle / body part /
// equipment — so "tricep cable pushdown" finds "Cable Pushdown" (target:
// triceps) even though "tricep" isn't in the exercise name.
export async function searchExercises(query, limit = 20) {
  const words = (query || '')
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[%_,().]/g, ''))
    .filter(w => w.length >= 2)
    .slice(0, 6)
  if (!words.length) return []

  let q = supabase.from('exercises').select('*')
  for (const w of words) {
    q = q.or(`name.ilike.%${w}%,target.ilike.%${w}%,body_part.ilike.%${w}%,equipment.ilike.%${w}%`)
  }
  const { data } = await q.order('name').limit(limit)
  const rows = (data || []).map(normalizeRow)

  // Most-relevant first: exercises whose NAME contains more of the words.
  const inName = row => words.filter(w => row.name.toLowerCase().includes(w)).length
  return rows.sort((a, b) => inName(b) - inName(a))
}
