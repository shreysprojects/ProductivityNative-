import { supabase } from './supabase'
import AsyncStorage from '@react-native-async-storage/async-storage'

// ── Utilities ──────────────────────────────────────────────────────────────

function _localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

export function today() {
  return _localDate()
}

export const ROUTINE_DEFAULTS = {
  Morning: [
    { id: 1, text: 'Clean home', subTasks: [] },
    { id: 2, text: 'Get ready', subTasks: [] },
    { id: 3, text: 'Breakfast', subTasks: [] },
    { id: 4, text: 'Morning walk / sun', subTasks: [] },
    { id: 5, text: 'Meditate', subTasks: [] },
  ],
  Fitness: [
    { id: 1, text: 'Warm up', subTasks: [] },
    { id: 2, text: 'Main workout', subTasks: [] },
    { id: 3, text: 'Cool down', subTasks: [] },
    { id: 4, text: 'Stretch', subTasks: [] },
    { id: 5, text: 'Hydrate', subTasks: [] },
  ],
  Night: [
    { id: 1, text: 'Wind down', subTasks: [] },
    { id: 2, text: 'Skincare', subTasks: [] },
    { id: 3, text: 'Read for 20 mins', subTasks: [] },
    { id: 4, text: 'Plan tomorrow', subTasks: [] },
    { id: 5, text: 'Lights out', subTasks: [] },
  ],
}

// ── Routine variants (Main / Alternative) ──────────────────────────────────
// Every routine can have an "alternative" version — a lighter fallback for days
// the user can't do the main one. It lives in the same tables under the name
// `<name>::alt` (the suffix can't collide with user names since :: is allowed
// nowhere else). History and streaks are always recorded under the BASE name,
// so finishing either variant counts as doing the routine that day.

export const ALT_SUFFIX = '::alt'

export function altRoutineName(name) {
  return name + ALT_SUFFIX
}

export function isAltRoutine(name) {
  return typeof name === 'string' && name.endsWith(ALT_SUFFIX)
}

export function baseRoutineName(name) {
  return isAltRoutine(name) ? name.slice(0, -ALT_SUFFIX.length) : name
}

// Remove a routine's alternative version: its template and today's run.
// Past runs and history stay — days completed via the alternative remain completed.
export async function wipeAltRoutine(userId, name) {
  const alt = altRoutineName(name)
  await Promise.all([
    supabase.from('routine_templates').delete().eq('user_id', userId).eq('routine_name', alt),
    supabase.from('routine_runs').delete().eq('user_id', userId).eq('routine_name', alt).eq('date', today()),
  ])
}

// ── Routine templates ──────────────────────────────────────────────────────

export async function getRoutineTemplate(userId, name) {
  const { data } = await supabase
    .from('routine_templates')
    .select('tasks')
    .eq('user_id', userId)
    .eq('routine_name', name)
    .single()
  return data?.tasks ?? ROUTINE_DEFAULTS[name] ?? []
}

export async function saveRoutineTemplate(userId, name, tasks) {
  await supabase
    .from('routine_templates')
    .upsert({ user_id: userId, routine_name: name, tasks })
}

// ── Routine list ───────────────────────────────────────────────────────────

export async function getRoutineNames(userId) {
  const { data } = await supabase
    .from('routine_names')
    .select('names')
    .eq('user_id', userId)
    .single()
  const base = data?.names ?? ['Morning', 'Fitness', 'Night']
  // Migration: remove Looks (now a sub-section of Morning, not a standalone routine)
  if (base.includes('Looks')) {
    const updated = base.filter(n => n !== 'Looks')
    await supabase.from('routine_names').upsert({ user_id: userId, names: updated })
    return updated
  }
  return base
}

export async function addRoutine(userId, name) {
  const names = await getRoutineNames(userId)
  if (names.includes(name)) return
  await supabase
    .from('routine_names')
    .upsert({ user_id: userId, names: [...names, name] })
}

export async function deleteRoutine(userId, name) {
  const names = await getRoutineNames(userId)
  await supabase
    .from('routine_names')
    .upsert({ user_id: userId, names: names.filter(n => n !== name) })
  await Promise.all([
    supabase.from('routine_templates').delete().eq('user_id', userId).in('routine_name', [name, altRoutineName(name)]),
    supabase.from('routine_runs').delete().eq('user_id', userId).in('routine_name', [name, altRoutineName(name)]),
    supabase.from('history').delete().eq('user_id', userId).eq('routine_name', name),
  ])
  const groupMap = await getRoutineGroupMap(userId)
  if (groupMap[name]) {
    delete groupMap[name]
    await saveRoutineGroupMap(userId, groupMap)
  }
}

// The three built-in routines are hardcoded throughout the app (special sections,
// themes, default schedules) so their names are reserved and cannot be reused/renamed.
export const RESERVED_ROUTINES = ['Morning', 'Fitness', 'Night']

// Persist a new display order for the routine list (drag-to-reorder).
export async function saveRoutineOrder(userId, orderedNames) {
  await supabase.from('routine_names').upsert({ user_id: userId, names: orderedNames })
}

// Rename a CUSTOM routine. The name is the key across templates/runs/history, the
// order array, and the AsyncStorage settings entry — move them all together.
export async function renameRoutine(userId, oldName, newName) {
  const clean = (newName || '').trim()
  if (!clean) throw new Error('Enter a routine name')
  if (clean === oldName) return
  if (RESERVED_ROUTINES.includes(oldName)) throw new Error('Built-in routines can’t be renamed')
  if (RESERVED_ROUTINES.includes(clean)) throw new Error('That name is reserved')
  const names = await getRoutineNames(userId)
  if (names.includes(clean)) throw new Error('A routine with that name already exists')

  await supabase.from('routine_names').upsert({
    user_id: userId,
    names: names.map(n => (n === oldName ? clean : n)),
  })
  await Promise.all([
    supabase.from('routine_templates').update({ routine_name: clean }).eq('user_id', userId).eq('routine_name', oldName),
    supabase.from('routine_runs').update({ routine_name: clean }).eq('user_id', userId).eq('routine_name', oldName),
    supabase.from('history').update({ routine_name: clean }).eq('user_id', userId).eq('routine_name', oldName),
    supabase.from('routine_templates').update({ routine_name: altRoutineName(clean) }).eq('user_id', userId).eq('routine_name', altRoutineName(oldName)),
    supabase.from('routine_runs').update({ routine_name: altRoutineName(clean) }).eq('user_id', userId).eq('routine_name', altRoutineName(oldName)),
  ])

  const raw = await AsyncStorage.getItem(`@rsettings_${userId}_${oldName}`)
  if (raw != null) {
    await AsyncStorage.setItem(`@rsettings_${userId}_${clean}`, raw)
    await AsyncStorage.removeItem(`@rsettings_${userId}_${oldName}`)
  }

  const groupMap = await getRoutineGroupMap(userId)
  if (groupMap[oldName]) {
    groupMap[clean] = groupMap[oldName]
    delete groupMap[oldName]
    await saveRoutineGroupMap(userId, groupMap)
  }
}

// Push every routine that comes AFTER `afterName` in the list by `deltaMinutes`,
// so adding a timed task to one routine doesn't make later ones overlap.
// Returns how many routines were shifted.
export async function shiftRoutinesAfter(userId, afterName, deltaMinutes) {
  if (!deltaMinutes) return 0
  const names = await getRoutineNames(userId)
  const idx = names.indexOf(afterName)
  if (idx < 0) return 0
  const later = names.slice(idx + 1)
  const wrap = v => (((v + deltaMinutes) % 1440) + 1440) % 1440
  for (const n of later) {
    const prev = await getRoutineSettings(userId, n)
    await saveRoutineSettings(userId, n, {
      ...prev,
      startTimeMinutes: wrap(prev.startTimeMinutes),
      dayTimes: (prev.dayTimes ?? []).map(wrap),
    })
  }
  return later.length
}

// Tick a routine task off WITHOUT running the timer. Stores a "quick" run in
// routine_runs recording each task's completedAt timestamp (no elapsed time),
// and keeps history.completion in sync so the calendar reflects it.
export async function quickCheckToggle(userId, name, template, taskId) {
  let run = await getTodayRun(userId, name)
  const blankStep = t => ({
    id: t.id, text: t.text, startedAt: null, completedAt: null, elapsedMs: 0,
    timeGoalSecs: t.timeGoalSecs ?? (t.timeGoalMins ?? 0) * 60,
    subTasks: (t.subTasks || []).map(st => ({ ...st, done: false })),
  })
  if (!run) {
    run = {
      date: today(), quick: true, startedAt: null, completedAt: null,
      currentStep: 0, finished: false,
      steps: template.map(blankStep),
    }
  } else {
    // Reconcile with the template so tasks added/removed mid-day (AI apply,
    // Looks/workout integration) are toggleable without resetting the run.
    const byId = new Map(run.steps.map(s => [s.id, s]))
    run.steps = template.map(t => byId.get(t.id) ?? blankStep(t))
  }
  run.quick = true
  const steps = run.steps.map(s =>
    s.id === taskId ? { ...s, completedAt: s.completedAt ? null : Date.now(), elapsedMs: 0 } : s
  )
  const doneCount = steps.filter(s => s.completedAt).length
  const finished = steps.length > 0 && doneCount === steps.length
  const updated = { ...run, steps, finished, completedAt: finished ? Date.now() : null }
  await supabase
    .from('routine_runs')
    .upsert({ user_id: userId, routine_name: name, date: today(), data: updated })
  await supabase
    .from('history')
    .upsert({ user_id: userId, date: today(), routine_name: baseRoutineName(name), completion: Math.round((doneCount / (steps.length || 1)) * 100) })
  if (finished) await _updateStreak(userId, today())
  return updated
}

// ── Routine groups (Every day / Whenever) ──────────────────────────────────
// Which dashboard section a routine lives in: 'everyday' — priority routines
// to do daily — or 'whenever' — routines for when you feel like it.
// Map: { [routineName]: 'everyday' | 'whenever' }. Unlisted → 'everyday'.

export const ROUTINE_GROUPS = ['everyday', 'whenever']

export async function getRoutineGroupMap(userId) {
  try {
    const raw = await AsyncStorage.getItem(`@routine_group_map_${userId}`)
    if (raw !== null) return JSON.parse(raw)
  } catch {}
  return {}
}

export async function saveRoutineGroupMap(userId, map) {
  await AsyncStorage.setItem(`@routine_group_map_${userId}`, JSON.stringify(map)).catch(() => {})
}

export async function getHiddenDefaults(userId) {
  const raw = await AsyncStorage.getItem(`@hidden_defaults_${userId}`)
  return raw ? JSON.parse(raw) : []
}

export async function setHiddenDefaults(userId, names) {
  await AsyncStorage.setItem(`@hidden_defaults_${userId}`, JSON.stringify([...names]))
}

// ── Routine settings (schedule, days) ─────────────────────────────────────

const _DEFAULT_START = { Morning: 540, Fitness: 720, Night: 1260 }

export async function getRoutineSettings(userId, name) {
  const raw = await AsyncStorage.getItem(`@rsettings_${userId}_${name}`)
  const saved = raw ? JSON.parse(raw) : {}
  const defaultStart = _DEFAULT_START[name] ?? 540
  return {
    activeDays: saved.activeDays ?? [true, true, true, true, true, true, true],
    startTimeMinutes: saved.startTimeMinutes ?? defaultStart,
    perDayMode: saved.perDayMode ?? false,
    dayTimes: saved.dayTimes ?? Array(7).fill(saved.startTimeMinutes ?? defaultStart),
    description: saved.description ?? '',
  }
}

export async function saveRoutineSettings(userId, name, settings) {
  await AsyncStorage.setItem(`@rsettings_${userId}_${name}`, JSON.stringify(settings))
}

// ── Daily runs ─────────────────────────────────────────────────────────────

export async function getTodayRun(userId, name) {
  const { data } = await supabase
    .from('routine_runs')
    .select('data')
    .eq('user_id', userId)
    .eq('routine_name', name)
    .eq('date', today())
    .single()
  return data?.data ?? null
}

// Today's run for a routine counting BOTH variants — the home cards only care
// whether the routine got done, so prefer a finished run, then main over alt.
export async function getTodayRunEither(userId, name) {
  const { data } = await supabase
    .from('routine_runs')
    .select('routine_name, data')
    .eq('user_id', userId)
    .in('routine_name', [name, altRoutineName(name)])
    .eq('date', today())
  const rows = data ?? []
  const pick =
    rows.find(r => r.data?.finished) ??
    rows.find(r => r.routine_name === name) ??
    rows[0]
  return pick?.data ?? null
}

export async function startRun(userId, name) {
  const template = await getRoutineTemplate(userId, name)
  const now = Date.now()
  const run = {
    date: today(),
    startedAt: now,
    completedAt: null,
    currentStep: 0,
    steps: template.map(t => ({
      id: t.id, text: t.text, startedAt: null, completedAt: null, elapsedMs: 0,
      timeGoalSecs: t.timeGoalSecs ?? (t.timeGoalMins ?? 0) * 60,
      subTasks: (t.subTasks || []).map(st => ({ ...st, done: false })),
    })),
    finished: false,
  }
  if (run.steps.length > 0) run.steps[0].startedAt = now
  await supabase
    .from('routine_runs')
    .upsert({ user_id: userId, routine_name: name, date: today(), data: run })
  return run
}

export async function advanceRun(userId, name, run, elapsedMs) {
  const now = Date.now()
  const updated = {
    ...run,
    currentStep: run.currentStep + 1,
    steps: run.steps.map((s, i) => {
      if (i === run.currentStep) return { ...s, completedAt: now, elapsedMs }
      if (i === run.currentStep + 1) return { ...s, startedAt: now }
      return s
    }),
  }
  await supabase
    .from('routine_runs')
    .upsert({ user_id: userId, routine_name: name, date: run.date, data: updated })
  return updated
}

export async function completeRun(userId, name, run, elapsedMs) {
  const now = Date.now()
  const updated = {
    ...run,
    finished: true,
    completedAt: now,
    steps: run.steps.map((s, i) =>
      i === run.currentStep ? { ...s, completedAt: now, elapsedMs } : s
    ),
  }
  await supabase
    .from('routine_runs')
    .upsert({ user_id: userId, routine_name: name, date: run.date, data: updated })
  await _updateStreak(userId, today())
  await supabase
    .from('history')
    .upsert({ user_id: userId, date: today(), routine_name: baseRoutineName(name), completion: 100 })
  return updated
}

export async function saveRun(userId, name, run) {
  await supabase
    .from('routine_runs')
    .upsert({ user_id: userId, routine_name: name, date: run.date, data: run })
}

export async function resetTodayRun(userId, name) {
  await supabase
    .from('routine_runs')
    .delete()
    .eq('user_id', userId)
    .eq('routine_name', name)
    .eq('date', today())
  await supabase
    .from('history')
    .delete()
    .eq('user_id', userId)
    .eq('date', today())
    .eq('routine_name', baseRoutineName(name))
}

// ── Gym split ──────────────────────────────────────────────────────────────

export async function getGymSplit(userId) {
  const { data } = await supabase
    .from('gym_splits')
    .select('preset, days')
    .eq('user_id', userId)
    .single()
  if (data) {
    if (data.days) data.days = data.days.map(d => Array.isArray(d) ? d : [d])
    return data
  }
  return {
    preset: 'PPL',
    days: [['Rest'], ['Push'], ['Pull'], ['Legs'], ['Push'], ['Pull'], ['Legs']],
  }
}

export async function saveGymSplit(userId, split) {
  await supabase
    .from('gym_splits')
    .upsert({ user_id: userId, preset: split.preset, days: split.days })
}

// ── Stretch routine ────────────────────────────────────────────────────────

export async function getStretchRoutine(userId) {
  const { data } = await supabase
    .from('stretch_routines')
    .select('exercises')
    .eq('user_id', userId)
    .single()
  const exercises = data?.exercises ?? []
  if (exercises.length > 0 && typeof exercises[0] === 'string') return []
  return exercises
}

export async function saveStretchRoutine(userId, exercises) {
  await supabase
    .from('stretch_routines')
    .upsert({ user_id: userId, exercises })
}

// ── Workout plan (per muscle group) ───────────────────────────────────────

export async function getWorkoutPlan(userId, muscleGroup) {
  const { data } = await supabase
    .from('workout_plans')
    .select('exercises')
    .eq('user_id', userId)
    .eq('muscle_group', muscleGroup)
    .single()
  return data?.exercises ?? []
}

export async function saveWorkoutPlan(userId, muscleGroup, exercises) {
  await supabase
    .from('workout_plans')
    .upsert({ user_id: userId, muscle_group: muscleGroup, exercises })
}

const _CAT_MAP = {
  chest: 'Chest', back: 'Back', shoulders: 'Shoulders',
  'upper arms': 'Arms', 'lower arms': 'Arms',
  'upper legs': 'Legs', 'lower legs': 'Legs',
  waist: 'Core', cardio: 'Cardio',
}

export async function getWorkoutRoutineList(userId) {
  const { data } = await supabase
    .from('workout_plans')
    .select('muscle_group, exercises')
    .eq('user_id', userId)
    .order('muscle_group')
  return (data ?? []).map(row => {
    const exercises = row.exercises ?? []
    const catSet = new Set()
    exercises.forEach(ex => {
      const mapped = _CAT_MAP[ex.category?.toLowerCase()]
      if (mapped) catSet.add(mapped)
    })
    return {
      name: row.muscle_group,
      count: exercises.length,
      muscles: [...catSet],
    }
  })
}

export async function deleteWorkoutPlan(userId, name) {
  await supabase
    .from('workout_plans')
    .delete()
    .eq('user_id', userId)
    .eq('muscle_group', name)
}

// Rename a workout. The name is the key in workout_plans, and past workout
// logs reference it (data.muscleGroup) — move both so history and "last
// workout" prefills stay linked.
export async function renameWorkoutPlan(userId, oldName, newName) {
  const clean = (newName || '').trim()
  if (!clean) throw new Error('Enter a workout name')
  if (clean === oldName) return
  const { data: existing } = await supabase
    .from('workout_plans')
    .select('muscle_group')
    .eq('user_id', userId)
    .eq('muscle_group', clean)
    .maybeSingle()
  if (existing) throw new Error('A workout with that name already exists')
  const { error } = await supabase
    .from('workout_plans')
    .update({ muscle_group: clean })
    .eq('user_id', userId)
    .eq('muscle_group', oldName)
  if (error) throw error
  const { data: logs } = await supabase
    .from('workout_logs')
    .select('date, data')
    .eq('user_id', userId)
  await Promise.all((logs ?? [])
    .filter(row => row.data?.muscleGroup === oldName)
    .map(row => supabase
      .from('workout_logs')
      .update({ data: { ...row.data, muscleGroup: clean } })
      .eq('user_id', userId)
      .eq('date', row.date)))
}

// ── Workout log (per day) ──────────────────────────────────────────────────

export async function getLastWorkoutLog(userId, routineName) {
  const { data } = await supabase
    .from('workout_logs')
    .select('date, data')
    .eq('user_id', userId)
    .lt('date', today())
    .order('date', { ascending: false })
    .limit(60)
  const match = (data ?? []).find(row => row.data?.muscleGroup === routineName)
  return match?.data ?? null
}

export async function getWorkoutLog(userId, date) {
  const { data } = await supabase
    .from('workout_logs')
    .select('data')
    .eq('user_id', userId)
    .eq('date', date)
    .single()
  return data?.data ?? null
}

export async function saveWorkoutLog(userId, date, log) {
  await supabase
    .from('workout_logs')
    .upsert({ user_id: userId, date, data: log })
}

export async function getAllWorkoutLogs(userId) {
  const { data } = await supabase
    .from('workout_logs')
    .select('date, data')
    .eq('user_id', userId)
    .order('date', { ascending: false })
  const map = {}
  for (const row of data ?? []) {
    map[row.date] = { ...row.data, date: row.date }
  }
  return map
}

// ── First-time setup ───────────────────────────────────────────────────────

export async function hasUserSetup(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('has_setup')
    .eq('id', userId)
    .single()
  return data?.has_setup ?? false
}

export async function markSetupDone(userId) {
  const { error } = await supabase
    .from('profiles')
    .update({ has_setup: true })
    .eq('id', userId)
  if (error) throw error
}

// ── History & streaks ──────────────────────────────────────────────────────

function _computeStreak(sortedDatesDesc) {
  const today     = _localDate()
  const yd = new Date(); yd.setDate(yd.getDate() - 1)
  const yesterday = _localDate(yd)
  if (!sortedDatesDesc.length) return 0
  if (sortedDatesDesc[0] !== today && sortedDatesDesc[0] !== yesterday) return 0
  let streak = 0
  let prev = null
  for (const date of sortedDatesDesc) {
    if (!prev) { streak = 1; prev = date; continue }
    const expected = new Date(prev + 'T12:00:00')
    expected.setDate(expected.getDate() - 1)
    if (date === _localDate(expected)) { streak++; prev = date }
    else break
  }
  return streak
}

export async function getRoutineStreaks(userId) {
  const { data } = await supabase
    .from('history')
    .select('date, routine_name')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(500)
  if (!data?.length) return {}
  const byRoutine = {}
  for (const row of data) {
    if (!byRoutine[row.routine_name]) byRoutine[row.routine_name] = new Set()
    byRoutine[row.routine_name].add(row.date)
  }
  const result = {}
  for (const [name, dateSet] of Object.entries(byRoutine)) {
    result[name] = _computeStreak([...dateSet].sort((a, b) => b.localeCompare(a)))
  }
  return result
}

export async function getHistory(userId) {
  const { data } = await supabase
    .from('history')
    .select('date, routine_name, completion')
    .eq('user_id', userId)
    .order('date', { ascending: false })
  return (data || []).map(row => ({
    date: row.date,
    routine: row.routine_name,
    completion: row.completion,
  }))
}

export async function getStreak(userId) {
  const { data } = await supabase
    .from('streaks')
    .select('current, longest, last_date')
    .eq('user_id', userId)
    .single()
  return data
    ? { current: data.current, longest: data.longest, lastDate: data.last_date }
    : { current: 0, longest: 0, lastDate: null }
}

// ── Saved meal templates ───────────────────────────────────────────────────

export async function getSavedMeals(userId) {
  const { data } = await supabase
    .from('saved_meals')
    .select('meals')
    .eq('user_id', userId)
    .single()
  return data?.meals ?? []
}

export async function upsertSavedMeal(userId, meal) {
  const meals = await getSavedMeals(userId)
  const idx = meals.findIndex(m => m.id === meal.id)
  if (idx >= 0) meals[idx] = meal
  else meals.push(meal)
  await supabase.from('saved_meals').upsert({ user_id: userId, meals })
}

export async function deleteSavedMeal(userId, id) {
  const meals = await getSavedMeals(userId)
  await supabase
    .from('saved_meals')
    .upsert({ user_id: userId, meals: meals.filter(m => m.id !== id) })
}

// ── Meals ──────────────────────────────────────────────────────────────────

export async function getMeals(userId, date) {
  // maybeSingle(): a date with no meals is the normal case, not an error.
  const { data } = await supabase
    .from('meals')
    .select('meals')
    .eq('user_id', userId)
    .eq('date', date)
    .maybeSingle()
  return data?.meals ?? []
}

export async function saveMeal(userId, date, meal) {
  const meals = await getMeals(userId, date)
  const idx = meals.findIndex(m => m.id === meal.id)
  if (idx >= 0) meals[idx] = meal
  else meals.push(meal)
  // Surface write failures instead of silently dropping the meal.
  const { error } = await supabase.from('meals').upsert({ user_id: userId, date, meals })
  if (error) throw error
  return meals
}

export async function deleteMeal(userId, date, mealId) {
  const meals = await getMeals(userId, date)
  const next = meals.filter(m => m.id !== mealId)
  const { error } = await supabase.from('meals').upsert({ user_id: userId, date, meals: next })
  if (error) throw error
  return next
}

export async function getRecentMealHistory(userId, days = 14) {
  const sd = new Date(); sd.setDate(sd.getDate() - days)
  const since = _localDate(sd)
  const { data } = await supabase
    .from('meals')
    .select('date, meals')
    .eq('user_id', userId)
    .gte('date', since)
    .order('date', { ascending: false })
  const all = (data || []).flatMap(row =>
    (row.meals || []).map(m => ({ ...m, lastEaten: row.date }))
  )
  const seen = new Set()
  return all.filter(m => {
    const key = m.name.toLowerCase().trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── Daily to-do list ──────────────────────────────────────────────────────
// AsyncStorage is the primary store (instant, always works).
// Supabase is secondary — synced in background when table exists.

export async function getDayTodos(userId, date) {
  const key = `@todos_${userId}_${date}`
  try {
    const raw = await AsyncStorage.getItem(key)
    if (raw !== null) return JSON.parse(raw)
  } catch {}
  // Fallback: Supabase (cross-device sync when table exists)
  try {
    const { data } = await supabase
      .from('day_todos').select('todos')
      .eq('user_id', userId).eq('date', date).single()
    if (data?.todos) {
      await AsyncStorage.setItem(key, JSON.stringify(data.todos)).catch(() => {})
      return data.todos
    }
  } catch {}
  return []
}

export async function saveDayTodos(userId, date, todos) {
  const key = `@todos_${userId}_${date}`
  await AsyncStorage.setItem(key, JSON.stringify(todos)).catch(() => {})
  // Background sync to Supabase (ok if it fails — table may not exist yet)
  try { await supabase.from('day_todos').upsert({ user_id: userId, date, todos }) } catch {}
}

// ── Daily rules ────────────────────────────────────────────────────────────
// Numbered rules to follow each day ("No phone before 9", …). Not date-keyed:
// they persist until the user edits them. Stored as [{ id, text }].
// AsyncStorage is primary; Supabase syncs in background when the table exists.

export async function getDayRules(userId) {
  const key = `@day_rules_${userId}`
  try {
    const raw = await AsyncStorage.getItem(key)
    if (raw !== null) return JSON.parse(raw)
  } catch {}
  try {
    const { data } = await supabase
      .from('day_rules').select('rules')
      .eq('user_id', userId).single()
    if (data?.rules) {
      await AsyncStorage.setItem(key, JSON.stringify(data.rules)).catch(() => {})
      return data.rules
    }
  } catch {}
  return []
}

export async function saveDayRules(userId, rules) {
  await AsyncStorage.setItem(`@day_rules_${userId}`, JSON.stringify(rules)).catch(() => {})
  try { await supabase.from('day_rules').upsert({ user_id: userId, rules }) } catch {}
}

// ── Tasks ──────────────────────────────────────────────────────────────────

export async function getTasks(userId) {
  const key = `@tasks_${userId}`
  try {
    const raw = await AsyncStorage.getItem(key)
    if (raw !== null) return JSON.parse(raw)
  } catch {}
  try {
    const { data } = await supabase
      .from('tasks')
      .select('id, title, description, due_date, priority, done, created_at')
      .eq('user_id', userId)
    if (data) {
      const tasks = data.map(r => ({
        id: r.id, title: r.title, description: r.description,
        dueDate: r.due_date, priority: r.priority, done: r.done,
        createdAt: r.created_at,
      }))
      await AsyncStorage.setItem(key, JSON.stringify(tasks)).catch(() => {})
      return tasks
    }
  } catch {}
  return []
}

export async function saveTask(userId, task) {
  const key = `@tasks_${userId}`
  const tasks = await getTasks(userId)
  const idx = tasks.findIndex(t => t.id === task.id)
  if (idx >= 0) tasks[idx] = task
  else tasks.push(task)
  await AsyncStorage.setItem(key, JSON.stringify(tasks)).catch(() => {})
  try {
    await supabase.from('tasks').upsert({
      id: task.id, user_id: userId, title: task.title,
      description: task.description ?? null, due_date: task.dueDate ?? null,
      priority: task.priority, done: task.done, created_at: task.createdAt,
    })
  } catch {}
}

export async function deleteTask(userId, taskId) {
  const key = `@tasks_${userId}`
  const tasks = await getTasks(userId)
  await AsyncStorage.setItem(key, JSON.stringify(tasks.filter(t => t.id !== taskId))).catch(() => {})
  try { await supabase.from('tasks').delete().eq('id', taskId).eq('user_id', userId) } catch {}
}

// ── Journal ────────────────────────────────────────────────────────────────
// Stored as { [YYYY-MM-DD]: { mood, text, updatedAt } } under one key.

export async function getJournalEntries(userId) {
  const key = `@journals_${userId}`
  try {
    const raw = await AsyncStorage.getItem(key)
    if (raw !== null) return JSON.parse(raw)
  } catch {}
  try {
    const { data } = await supabase
      .from('journal_entries')
      .select('date, mood, text, updated_at')
      .eq('user_id', userId)
    if (data) {
      const map = {}
      for (const r of data) map[r.date] = { mood: r.mood, text: r.text, updatedAt: r.updated_at }
      await AsyncStorage.setItem(key, JSON.stringify(map)).catch(() => {})
      return map
    }
  } catch {}
  return {}
}

export async function saveJournalEntry(userId, date, entry) {
  const key = `@journals_${userId}`
  const all = await getJournalEntries(userId)
  all[date] = entry
  await AsyncStorage.setItem(key, JSON.stringify(all)).catch(() => {})
  try {
    await supabase.from('journal_entries').upsert({
      user_id: userId, date,
      mood: entry.mood ?? null, text: entry.text, updated_at: entry.updatedAt,
    })
  } catch {}
}

export async function deleteJournalEntry(userId, date) {
  const key = `@journals_${userId}`
  const all = await getJournalEntries(userId)
  delete all[date]
  await AsyncStorage.setItem(key, JSON.stringify(all)).catch(() => {})
  try {
    await supabase.from('journal_entries').delete().eq('user_id', userId).eq('date', date)
  } catch {}
}

// ── Class schedule (recurring weekly) ─────────────────────────────────────

export async function getScheduleItems(userId) {
  const key = `@schedule_${userId}`
  try {
    const raw = await AsyncStorage.getItem(key)
    if (raw !== null) return JSON.parse(raw)
  } catch {}
  try {
    const { data } = await supabase
      .from('schedule_items')
      .select('id, title, location, days, start_time, end_time, color, semester_start, semester_end')
      .eq('user_id', userId)
    if (data) {
      const items = data.map(r => ({
        id: r.id, title: r.title, location: r.location,
        days: r.days, startTime: r.start_time, endTime: r.end_time,
        color: r.color, semesterStart: r.semester_start, semesterEnd: r.semester_end,
      }))
      await AsyncStorage.setItem(key, JSON.stringify(items)).catch(() => {})
      return items
    }
  } catch {}
  return []
}

export async function saveScheduleItem(userId, item) {
  const key = `@schedule_${userId}`
  const items = await getScheduleItems(userId)
  const idx = items.findIndex(i => i.id === item.id)
  if (idx >= 0) items[idx] = item
  else items.push(item)
  await AsyncStorage.setItem(key, JSON.stringify(items)).catch(() => {})
  try {
    await supabase.from('schedule_items').upsert({
      id: item.id, user_id: userId, title: item.title,
      location: item.location ?? null, days: item.days,
      start_time: item.startTime, end_time: item.endTime,
      color: item.color, semester_start: item.semesterStart ?? null,
      semester_end: item.semesterEnd ?? null,
    })
  } catch {}
}

export async function deleteScheduleItem(userId, id) {
  const key = `@schedule_${userId}`
  const items = await getScheduleItems(userId)
  await AsyncStorage.setItem(key, JSON.stringify(items.filter(i => i.id !== id))).catch(() => {})
  try {
    await supabase.from('schedule_items').delete().eq('user_id', userId).eq('id', id)
  } catch {}
}

// ── Calendar events ────────────────────────────────────────────────────────
// AsyncStorage is primary (fast, offline). Supabase is secondary background sync.

export async function getCalendarEvents(userId) {
  const key = `@cal_events_${userId}`
  try {
    const raw = await AsyncStorage.getItem(key)
    if (raw !== null) return JSON.parse(raw)
  } catch {}
  try {
    const { data } = await supabase
      .from('calendar_events')
      .select('id, title, date, time, type, notify_mins, notif_id')
      .eq('user_id', userId)
      .order('date')
    if (data) {
      const events = data.map(r => ({
        id: r.id, title: r.title, date: r.date, time: r.time,
        type: r.type, notifyMins: r.notify_mins, notifId: r.notif_id,
      }))
      await AsyncStorage.setItem(key, JSON.stringify(events)).catch(() => {})
      return events
    }
  } catch {}
  return []
}

export async function saveCalendarEvent(userId, event) {
  const key = `@cal_events_${userId}`
  const events = await getCalendarEvents(userId)
  const idx = events.findIndex(e => e.id === event.id)
  if (idx >= 0) events[idx] = event
  else events.push(event)
  await AsyncStorage.setItem(key, JSON.stringify(events)).catch(() => {})
  try {
    await supabase.from('calendar_events').upsert({
      id: event.id, user_id: userId, title: event.title,
      date: event.date, time: event.time ?? null, type: event.type,
      notify_mins: event.notifyMins ?? 10, notif_id: event.notifId ?? null,
    })
  } catch {}
}

export async function deleteCalendarEvent(userId, eventId) {
  const key = `@cal_events_${userId}`
  const events = await getCalendarEvents(userId)
  await AsyncStorage.setItem(key, JSON.stringify(events.filter(e => e.id !== eventId))).catch(() => {})
  try {
    await supabase.from('calendar_events').delete().eq('user_id', userId).eq('id', eventId)
  } catch {}
}

// ── Weekly goals & routines ─────────────────────────────────────────────────

const WEEKLY_ROUTINE_DEFAULTS = [
  {
    id: 'sunday-reset',
    name: 'Sunday Reset Routine',
    tasks: [
      { id: 1, text: 'Clean your room', done: false },
      { id: 2, text: 'Do laundry', done: false },
      { id: 3, text: 'Plan meals for the week', done: false },
      { id: 4, text: 'Review your calendar', done: false },
      { id: 5, text: 'Set goals for the week', done: false },
      { id: 6, text: 'Organize school/work tasks', done: false },
      { id: 7, text: 'Relax for 30 minutes before bed', done: false },
    ],
  },
  {
    id: 'friday-finance',
    name: 'Friday Finance Routine',
    tasks: [
      { id: 1, text: 'Check bank account', done: false },
      { id: 2, text: 'Review spending', done: false },
      { id: 3, text: 'Pay any bills', done: false },
      { id: 4, text: 'Update budget', done: false },
      { id: 5, text: 'Set savings goal for next week', done: false },
    ],
  },
]

export async function getWeeklyGoals(userId) {
  try {
    const raw = await AsyncStorage.getItem(`@weekly_goals_${userId}`)
    if (raw !== null) return JSON.parse(raw)
  } catch {}
  return []
}

export async function saveWeeklyGoals(userId, goals) {
  await AsyncStorage.setItem(`@weekly_goals_${userId}`, JSON.stringify(goals)).catch(() => {})
}

export async function getWeeklyRoutines(userId) {
  try {
    const raw = await AsyncStorage.getItem(`@weekly_routines_${userId}`)
    if (raw !== null) return JSON.parse(raw)
  } catch {}
  return WEEKLY_ROUTINE_DEFAULTS
}

export async function saveWeeklyRoutines(userId, routines) {
  await AsyncStorage.setItem(`@weekly_routines_${userId}`, JSON.stringify(routines)).catch(() => {})
}

export async function getWeeklyGoalsConfig(userId) {
  try {
    const raw = await AsyncStorage.getItem(`@weekly_goals_config_${userId}`)
    if (raw !== null) return JSON.parse(raw)
  } catch {}
  return { resetDayOfWeek: null, lastResetDate: null }
}

export async function saveWeeklyGoalsConfig(userId, config) {
  await AsyncStorage.setItem(`@weekly_goals_config_${userId}`, JSON.stringify(config)).catch(() => {})
}

// ── Weight tracking ────────────────────────────────────────────────────────

export async function getWeightLogs(userId) {
  try {
    const raw = await AsyncStorage.getItem(`@weight_logs_${userId}`)
    if (raw !== null) return JSON.parse(raw)
  } catch {}
  return []
}

export async function saveWeightLog(userId, date, weight) {
  const logs = await getWeightLogs(userId)
  const idx = logs.findIndex(l => l.date === date)
  if (idx >= 0) logs[idx].weight = weight
  else logs.unshift({ date, weight })
  logs.sort((a, b) => b.date.localeCompare(a.date))
  await AsyncStorage.setItem(`@weight_logs_${userId}`, JSON.stringify(logs)).catch(() => {})
}

// ── Morning section settings ────────────────────────────────────────────────

export async function getMorningSettings(userId) {
  try {
    const raw = await AsyncStorage.getItem(`@morning_settings_${userId}`)
    if (raw !== null) return JSON.parse(raw)
  } catch {}
  return { hideTodo: false, hideWeight: false, weightGoal: null, targetWeight: null }
}

export async function saveMorningSettings(userId, settings) {
  await AsyncStorage.setItem(`@morning_settings_${userId}`, JSON.stringify(settings)).catch(() => {})
}

// ── Looks section (Morning sub-section) ────────────────────────────────────

export async function getLooksData(userId) {
  try {
    const raw = await AsyncStorage.getItem(`@looks_data_${userId}`)
    if (raw !== null) return JSON.parse(raw)
  } catch {}
  return { hidden: false, categories: [] }
}

export async function saveLooksData(userId, data) {
  await AsyncStorage.setItem(`@looks_data_${userId}`, JSON.stringify(data)).catch(() => {})
}

// ── Looks → Morning routine integration ────────────────────────────────────
// Looks categories can be mirrored into the Morning template as fromLooks
// tasks — either one task per category ('multi') or a single task holding
// every step ('single'). The Looks card stays the source of truth: sub-steps
// are re-derived on every sync, while user customizations like emoji and time
// goals on the task itself are preserved.

const LOOKS_SINGLE_TASK_ID = 'looks-all'

export function buildLooksTasks(categories, mode = 'multi') {
  const cats = categories ?? []
  const steps = cat => (cat.steps ?? []).map(st => ({
    id: 'lstep-' + st.id,
    text: st.product ? `${st.name} — ${st.product}` : st.name,
  }))
  if (mode === 'single') {
    if (cats.length === 0) return []
    return [{
      id: LOOKS_SINGLE_TASK_ID,
      text: 'Looks routine',
      emoji: '✨',
      fromLooks: true,
      subTasks: cats.flatMap(cat =>
        steps(cat).map(st => cats.length > 1 ? { ...st, text: `${cat.name}: ${st.text}` } : st)
      ),
    }]
  }
  return cats.map(cat => ({
    id: 'looks-' + cat.id,
    text: cat.name,
    emoji: '✨',
    fromLooks: true,
    subTasks: steps(cat),
  }))
}

// Add or remove the Looks block in the Morning template. Returns the new template.
export async function setLooksInRoutine(userId, enabled, mode = 'multi') {
  const [template, looks] = await Promise.all([
    getRoutineTemplate(userId, 'Morning'),
    getLooksData(userId),
  ])
  const kept = template.filter(t => !t.fromLooks)
  const next = enabled ? [...kept, ...buildLooksTasks(looks.categories, mode)] : kept
  await saveRoutineTemplate(userId, 'Morning', next)
  return next
}

// Re-derive the Looks tasks from the Looks card. Called when opening the
// Morning routine; persists only on change.
export async function syncIntegratedTasks(userId, name, template) {
  if (name !== 'Morning' || !template.some(t => t.fromLooks)) return template

  const looks = await getLooksData(userId)
  const mode = template.some(t => t.id === LOOKS_SINGLE_TASK_ID) ? 'single' : 'multi'
  const insertAt = template.findIndex(t => t.fromLooks) // all earlier tasks are non-Looks
  const old = new Map(template.filter(t => t.fromLooks).map(t => [t.id, t]))
  const block = buildLooksTasks(looks.categories, mode).map(t => {
    const prev = old.get(t.id)
    if (!prev) return t
    // The single task's title isn't derived from the card, so keep the user's text.
    return mode === 'single'
      ? { ...prev, subTasks: t.subTasks }
      : { ...prev, text: t.text, subTasks: t.subTasks }
  })
  const kept = template.filter(t => !t.fromLooks)
  const next = [...kept.slice(0, insertAt), ...block, ...kept.slice(insertAt)]

  if (JSON.stringify(next) !== JSON.stringify(template)) {
    await saveRoutineTemplate(userId, name, next)
  }
  return next
}

// ── Internal ───────────────────────────────────────────────────────────────

async function _updateStreak(userId, date) {
  const streak = await getStreak(userId)
  if (streak.lastDate === date) return
  const yd = new Date(); yd.setDate(yd.getDate() - 1)
  const yesterday = _localDate(yd)
  const current = streak.lastDate === yesterday ? streak.current + 1 : 1
  const longest = Math.max(current, streak.longest)
  await supabase
    .from('streaks')
    .upsert({ user_id: userId, current, longest, last_date: date })
}

// ── Day-detail history queries ─────────────────────────────────────────────

export async function getHistoryForDate(userId, date) {
  const { data } = await supabase
    .from('history')
    .select('routine_name, completion')
    .eq('user_id', userId)
    .eq('date', date)
  return (data ?? []).map(row => ({ routine: row.routine_name, completion: row.completion }))
}

export async function getRoutineRunsForDate(userId, date) {
  const { data } = await supabase
    .from('routine_runs')
    .select('routine_name, data')
    .eq('user_id', userId)
    .eq('date', date)
  return data ?? []
}
