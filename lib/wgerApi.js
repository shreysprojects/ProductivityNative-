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

// A failed read throws: offline used to come back as "no exercises", which
// the library showed as an empty category and the screenshot import as
// "not found" for every exercise. Pages are ordered by id after name, since
// names repeat and an unstable order can show a row on two pages.
export async function fetchExercisesByCategory(bodyPart, offset = 0, limit = 20) {
  const { data, count, error } = await supabase
    .from('exercises')
    .select('*', { count: 'exact' })
    .ilike('body_part', bodyPart)
    .order('name')
    .order('id')
    .range(offset, offset + limit - 1)
  if (error) throw error
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
//
// Paged like the categories, with the total: a common word matches far more
// than one page ("press" matches 167), and the first 20 alphabetically
// looked like every result. { results, count }; throws when it can't search.
export async function searchExercises(query, limit = 20, offset = 0) {
  const words = (query || '')
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[%_,().]/g, ''))
    .filter(w => w.length >= 2)
    .slice(0, 6)
  if (!words.length) return { results: [], count: 0 }

  let q = supabase.from('exercises').select('*', { count: 'exact' })
  for (const w of words) {
    q = q.or(`name.ilike.%${w}%,target.ilike.%${w}%,body_part.ilike.%${w}%,equipment.ilike.%${w}%`)
  }
  const { data, count, error } = await q.order('name').order('id').range(offset, offset + limit - 1)
  if (error) throw error
  const rows = (data || []).map(normalizeRow)

  // Most-relevant first within the page: exercises whose NAME contains more
  // of the words.
  const inName = row => words.filter(w => String(row.name ?? '').toLowerCase().includes(w)).length
  return { results: rows.sort((a, b) => inName(b) - inName(a)), count: count ?? rows.length }
}
