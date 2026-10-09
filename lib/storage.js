import { supabase } from './supabase'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { trySync } from './syncQueue'

// ── Utilities ──────────────────────────────────────────────────────────────

function _localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

export function today() {
  return _localDate()
}

// Several records here are stored as one whole blob per row, so a write has to
// be built from the state the previous write left behind. Calls that share a
// key run strictly one after another instead of racing.
const _chains = new Map()

function _serialize(key, fn) {
  const prev = _chains.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.then(() => {}, () => {})
  _chains.set(key, tail)
  tail.then(() => { if (_chains.get(key) === tail) _chains.delete(key) })
  return run
}

// Time goals were stored in minutes before they were stored in seconds, and
// both shapes still exist in saved templates.
export function taskGoalSecs(t) {
  return t?.timeGoalSecs ?? (t?.timeGoalMins ?? 0) * 60
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

// Copy a row under the new key, then drop the old one. The delete only runs
// once the copy is known to have reached the server, so a write that had to be
// queued can never leave the row deleted and not yet re-created.
async function _moveRow(table, payload, match) {
  const ok = await trySync(table, 'upsert', payload)
  if (ok) await trySync(table, 'delete', null, match)
}

// Move every row that keys off a routine's name onto the new name.
async function _moveRoutineRows(userId, oldName, newName) {
  const both = [oldName, altRoutineName(oldName)]
  const renamed = n => (isAltRoutine(n) ? altRoutineName(newName) : newName)
  const [templates, runs, history] = await Promise.all([
    supabase.from('routine_templates').select('routine_name, tasks').eq('user_id', userId).in('routine_name', both),
    supabase.from('routine_runs').select('routine_name, date, data').eq('user_id', userId).in('routine_name', both),
    supabase.from('history').select('date, completion').eq('user_id', userId).eq('routine_name', oldName),
  ])
  await Promise.all([
    ...(templates.data ?? []).map(r => _moveRow(
      'routine_templates',
      { user_id: userId, routine_name: renamed(r.routine_name), tasks: r.tasks },
      { user_id: userId, routine_name: r.routine_name },
    )),
    ...(runs.data ?? []).map(r => _moveRow(
      'routine_runs',
      { user_id: userId, routine_name: renamed(r.routine_name), date: r.date, data: r.data },
      { user_id: userId, routine_name: r.routine_name, date: r.date },
    )),
    ...(history.data ?? []).map(r => _moveRow(
      'history',
      { user_id: userId, date: r.date, routine_name: newName, completion: r.completion },
      { user_id: userId, date: r.date, routine_name: oldName },
    )),
  ])
}

// Rename a CUSTOM routine. The name is the key across templates/runs/history, the
// order array, and the AsyncStorage settings entry — move them all together.
// The name list is written last: until it changes the routine still shows under
// its old name, so a write that has to be retried never detaches its history.
export async function renameRoutine(userId, oldName, newName) {
  const clean = (newName || '').trim()
  if (!clean) throw new Error('Enter a routine name')
  if (clean === oldName) return
  if (RESERVED_ROUTINES.includes(oldName)) throw new Error('Built-in routines can’t be renamed')
  if (RESERVED_ROUTINES.includes(clean)) throw new Error('That name is reserved')
  const names = await getRoutineNames(userId)
  if (names.includes(clean)) throw new Error('A routine with that name already exists')

  await _moveRoutineRows(userId, oldName, clean)

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

  await trySync('routine_names', 'upsert', {
    user_id: userId,
    names: names.map(n => (n === oldName ? clean : n)),
  })
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
// The whole run is one row, so taps on the same routine are queued behind each
// other and each one re-reads the run it is about to change.
export function quickCheckToggle(userId, name, template, taskId) {
  return _serialize(`run:${userId}|${name}`, async () => {
    const { ok, run: existing } = await _readTodayRun(userId, name)
    // Without a trustworthy read this would build a blank run from the
    // template, and the queued upsert would later replay it over the real one.
    if (!ok) throw new Error('Could not reach your routine. Check your connection and try again.')
    let run = existing
    const blankStep = t => ({
      id: t.id, text: t.text, startedAt: null, completedAt: null, elapsedMs: 0,
      timeGoalSecs: taskGoalSecs(t),
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
    await trySync('routine_runs', 'upsert', { user_id: userId, routine_name: name, date: today(), data: updated })
    await trySync('history', 'upsert', {
      user_id: userId, date: today(), routine_name: baseRoutineName(name),
      completion: Math.round((doneCount / (steps.length || 1)) * 100),
    })
    if (finished) await _updateStreak(userId, today())
    return updated
  })
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
  try {
    const raw = await AsyncStorage.getItem(`@hidden_defaults_${userId}`)
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

export async function setHiddenDefaults(userId, names) {
  await AsyncStorage.setItem(`@hidden_defaults_${userId}`, JSON.stringify([...names]))
}

// ── Routine settings (schedule, days) ─────────────────────────────────────

const _DEFAULT_START = { Morning: 540, Fitness: 720, Night: 1260 }

export async function getRoutineSettings(userId, name) {
  let saved = {}
  try {
    const raw = await AsyncStorage.getItem(`@rsettings_${userId}_${name}`)
    if (raw) saved = JSON.parse(raw) ?? {}
  } catch {}
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

// `ok` is false when the row could not be read at all, as opposed to there
// being no run yet. Callers that persist a derived value must check it —
// treating an unreadable run as "no run" would queue a blank run that later
// replays over real progress.
async function _readTodayRun(userId, name) {
  const { data, error } = await supabase
    .from('routine_runs')
    .select('data')
    .eq('user_id', userId)
    .eq('routine_name', name)
    .eq('date', today())
    .single()
  if (error && error.code !== 'PGRST116') return { ok: false, run: null }
  return { ok: true, run: data?.data ?? null }
}

export async function getTodayRun(userId, name) {
  const { run } = await _readTodayRun(userId, name)
  return run
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
      timeGoalSecs: taskGoalSecs(t),
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
// workout" prefills stay linked. The logs move first and the plan itself last,
// so a write that has to be retried leaves the plan under its old name rather
// than a renamed plan with no history behind it.
export async function renameWorkoutPlan(userId, oldName, newName) {
  const clean = (newName || '').trim()
  if (!clean) throw new Error('Enter a workout name')
  if (clean === oldName) return
  // Every read here has to succeed before anything is queued: a rename built
  // on an unreadable plan would replay as a second, empty workout alongside
  // the original, and the duplicate-name check would pass vacuously.
  const offline = () => new Error('Could not reach your workouts. Check your connection and try again.')

  const { data: existing, error: existingErr } = await supabase
    .from('workout_plans')
    .select('muscle_group')
    .eq('user_id', userId)
    .eq('muscle_group', clean)
    .maybeSingle()
  if (existingErr) throw offline()
  if (existing) throw new Error('A workout with that name already exists')

  const { data: logs, error: logsErr } = await supabase
    .from('workout_logs')
    .select('date, data')
    .eq('user_id', userId)
  if (logsErr) throw offline()
  await Promise.all((logs ?? [])
    .filter(row => row.data?.muscleGroup === oldName)
    .map(row => trySync('workout_logs', 'upsert', {
      user_id: userId, date: row.date, data: { ...row.data, muscleGroup: clean },
    })))

  const { data: plan, error: planErr } = await supabase
    .from('workout_plans')
    .select('exercises')
    .eq('user_id', userId)
    .eq('muscle_group', oldName)
    .maybeSingle()
  if (planErr) throw offline()
  await _moveRow(
    'workout_plans',
    { user_id: userId, muscle_group: clean, exercises: plan?.exercises ?? [] },
    { user_id: userId, muscle_group: oldName },
  )
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
  const { data, error } = await supabase
    .from('streaks')
    .select('current, longest, last_date')
    .eq('user_id', userId)
    .single()
  // PGRST116 is "no row", which genuinely means a zero streak. Any other
  // error means we don't know the streak, and callers must not guess.
  if (error && error.code !== 'PGRST116') return null
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

// Every saved meal lives in one row, so edits are queued behind each other and
// each one re-reads the list it is about to rewrite.
export function upsertSavedMeal(userId, meal) {
  return _serialize(`saved_meals:${userId}`, async () => {
    const meals = await getSavedMeals(userId)
    const idx = meals.findIndex(m => m.id === meal.id)
    if (idx >= 0) meals[idx] = meal
    else meals.push(meal)
    await supabase.from('saved_meals').upsert({ user_id: userId, meals })
  })
}

export function deleteSavedMeal(userId, id) {
  return _serialize(`saved_meals:${userId}`, async () => {
    const meals = await getSavedMeals(userId)
    await supabase
      .from('saved_meals')
      .upsert({ user_id: userId, meals: meals.filter(m => m.id !== id) })
  })
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

// A day's meals are one row, so edits to the same day are queued behind each
// other and each one re-reads the list it is about to rewrite.
export function saveMeal(userId, date, meal) {
  return _serialize(`meals:${userId}|${date}`, async () => {
    const meals = await getMeals(userId, date)
    const idx = meals.findIndex(m => m.id === meal.id)
    if (idx >= 0) meals[idx] = meal
    else meals.push(meal)
    // Surface write failures instead of silently dropping the meal.
    const { error } = await supabase.from('meals').upsert({ user_id: userId, date, meals })
    if (error) throw error
    return meals
  })
}

export function deleteMeal(userId, date, mealId) {
  return _serialize(`meals:${userId}|${date}`, async () => {
    const meals = await getMeals(userId, date)
    const next = meals.filter(m => m.id !== mealId)
    const { error } = await supabase.from('meals').upsert({ user_id: userId, date, meals: next })
    if (error) throw error
    return next
  })
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
  // Background sync to Supabase; a failed write is queued and replayed later.
  await trySync('day_todos', 'upsert', { user_id: userId, date, todos })
}

// ── Daily rules ────────────────────────────────────────────────────────────
// Numbered rules to follow each day ("No phone before 9", …). Not date-keyed:
// they persist until the user edits them. Stored as [{ id, text }].
// AsyncStorage is primary; Supabase syncs in background when the table exists.

// ── Cloud merge helpers ────────────────────────────────────────────────────
// Reads that back these stores merge local + cloud on load, so data created
// on one device (or before cloud sync existed) shows up everywhere. Local
// data is never dropped: records the cloud is missing upload, records the
// device is missing download.

async function readLocalJson(key) {
  try {
    const raw = await AsyncStorage.getItem(key)
    if (raw !== null) return JSON.parse(raw)
  } catch {}
  return null
}

// updatedAt values are epoch-ms numbers locally and ISO strings in Postgres.
const parseTs = v => {
  if (typeof v === 'number') return v
  const t = Date.parse(v ?? '')
  return Number.isNaN(t) ? 0 : t
}

export async function getDayRules(userId) {
  const key = `@day_rules_${userId}`
  const atKey = `@day_rules_at_${userId}`
  const local = await readLocalJson(key)
  let cloud = null, cloudAt = null, cloudOk = false
  try {
    const { data, error } = await supabase
      .from('day_rules').select('rules, updated_at')
      .eq('user_id', userId).maybeSingle()
    if (!error) { cloudOk = true; cloud = data?.rules ?? null; cloudAt = data?.updated_at ?? null }
  } catch {}
  if (!cloudOk) return local ?? []
  if (local === null && cloud === null) return []
  if (local === null) {
    await AsyncStorage.setItem(key, JSON.stringify(cloud)).catch(() => {})
    if (cloudAt) await AsyncStorage.setItem(atKey, JSON.stringify(cloudAt)).catch(() => {})
    return cloud
  }
  if (cloud === null) { await saveDayRules(userId, local); return local }
  if (JSON.stringify(cloud) === JSON.stringify(local)) return local
  // Both exist and differ: non-empty beats empty, otherwise newer save wins.
  const localAt = await readLocalJson(atKey)
  let cloudWins
  if (!local.length) cloudWins = true
  else if (!cloud.length) cloudWins = false
  else cloudWins = parseTs(cloudAt) > parseTs(localAt)
  if (cloudWins) {
    await AsyncStorage.setItem(key, JSON.stringify(cloud)).catch(() => {})
    if (cloudAt) await AsyncStorage.setItem(atKey, JSON.stringify(cloudAt)).catch(() => {})
    return cloud
  }
  await saveDayRules(userId, local)
  return local
}

export async function saveDayRules(userId, rules) {
  const at = new Date().toISOString()
  await AsyncStorage.setItem(`@day_rules_${userId}`, JSON.stringify(rules)).catch(() => {})
  await AsyncStorage.setItem(`@day_rules_at_${userId}`, JSON.stringify(at)).catch(() => {})
  await trySync('day_rules', 'upsert', { user_id: userId, rules, updated_at: at })
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
  await trySync('tasks', 'upsert', {
    id: task.id, user_id: userId, title: task.title,
    description: task.description ?? null, due_date: task.dueDate ?? null,
    priority: task.priority, done: task.done, created_at: task.createdAt,
  })
}

export async function deleteTask(userId, taskId) {
  const key = `@tasks_${userId}`
  const tasks = await getTasks(userId)
  await AsyncStorage.setItem(key, JSON.stringify(tasks.filter(t => t.id !== taskId))).catch(() => {})
  await trySync('tasks', 'delete', null, { id: taskId, user_id: userId })
}

// ── Journal ────────────────────────────────────────────────────────────────
// Stored as { [YYYY-MM-DD]: { mood, text, updatedAt } } under one key.

export async function getJournalEntries(userId) {
  const key = `@journals_${userId}`
  const local = (await readLocalJson(key)) ?? {}
  let cloud = null
  try {
    const { data, error } = await supabase
      .from('journal_entries')
      .select('date, mood, text, updated_at')
      .eq('user_id', userId)
    if (!error && data) {
      cloud = {}
      for (const r of data) cloud[r.date] = { mood: r.mood, text: r.text, updatedAt: r.updated_at }
    }
  } catch {}
  if (cloud === null) return local
  // Merge: keep every date from both sides; on conflict newer wins,
  // ties go to the entry with more text.
  const merged = { ...local }
  for (const [date, c] of Object.entries(cloud)) {
    const l = merged[date]
    if (!l) { merged[date] = c; continue }
    const lt = parseTs(l.updatedAt), ct = parseTs(c.updatedAt)
    if (ct > lt || (ct === lt && (c.text ?? '').length > (l.text ?? '').length)) merged[date] = c
  }
  await AsyncStorage.setItem(key, JSON.stringify(merged)).catch(() => {})
  // Upload entries the cloud is missing or has a losing copy of.
  for (const [date, m] of Object.entries(merged)) {
    const c = cloud[date]
    if (c && c.text === m.text && (c.mood ?? null) === (m.mood ?? null)) continue
    await trySync('journal_entries', 'upsert', {
      user_id: userId, date, mood: m.mood ?? null, text: m.text ?? '',
      updated_at: m.updatedAt ? new Date(parseTs(m.updatedAt)).toISOString() : null,
    })
  }
  return merged
}

export async function saveJournalEntry(userId, date, entry) {
  const key = `@journals_${userId}`
  const all = (await readLocalJson(key)) ?? {}
  const stamped = { ...entry, updatedAt: entry.updatedAt ?? Date.now() }
  all[date] = stamped
  await AsyncStorage.setItem(key, JSON.stringify(all)).catch(() => {})
  // Postgres needs an ISO timestamp — a raw epoch number fails the upsert.
  await trySync('journal_entries', 'upsert', {
    user_id: userId, date, mood: stamped.mood ?? null, text: stamped.text,
    updated_at: new Date(parseTs(stamped.updatedAt)).toISOString(),
  })
}

export async function deleteJournalEntry(userId, date) {
  const key = `@journals_${userId}`
  const all = (await readLocalJson(key)) ?? {}
  delete all[date]
  await AsyncStorage.setItem(key, JSON.stringify(all)).catch(() => {})
  await trySync('journal_entries', 'delete', null, { user_id: userId, date })
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
  await trySync('schedule_items', 'upsert', {
    id: item.id, user_id: userId, title: item.title,
    location: item.location ?? null, days: item.days,
    start_time: item.startTime, end_time: item.endTime,
    color: item.color, semester_start: item.semesterStart ?? null,
    semester_end: item.semesterEnd ?? null,
  })
}

export async function deleteScheduleItem(userId, id) {
  const key = `@schedule_${userId}`
  const items = await getScheduleItems(userId)
  await AsyncStorage.setItem(key, JSON.stringify(items.filter(i => i.id !== id))).catch(() => {})
  await trySync('schedule_items', 'delete', null, { user_id: userId, id })
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
  await trySync('calendar_events', 'upsert', {
    id: event.id, user_id: userId, title: event.title,
    date: event.date, time: event.time ?? null, type: event.type,
    notify_mins: event.notifyMins ?? 10, notif_id: event.notifId ?? null,
  })
}

export async function deleteCalendarEvent(userId, eventId) {
  const key = `@cal_events_${userId}`
  const events = await getCalendarEvents(userId)
  await AsyncStorage.setItem(key, JSON.stringify(events.filter(e => e.id !== eventId))).catch(() => {})
  await trySync('calendar_events', 'delete', null, { user_id: userId, id: eventId })
}

// ── Cloud refresh ──────────────────────────────────────────────────────────
// The getters above answer from AsyncStorage the moment it has a copy, which is
// what makes them instant offline but also means a device would never see what
// another device wrote. This pulls the authoritative rows and replaces the
// local copies. Call it on login and on foreground, after pending writes have
// been flushed, so the cloud really is ahead of the cache.

const _LOCAL_CACHE_KEYS = userId => [
  `@tasks_${userId}`,
  `@day_rules_${userId}`,
  `@journals_${userId}`,
  `@schedule_${userId}`,
  `@cal_events_${userId}`,
]

export async function refreshFromCloud(userId) {
  if (!userId) return
  const step = async fn => { try { await fn() } catch {} }

  // An empty server response must never erase a populated local cache. Older
  // builds swallowed failed cloud writes, so "no rows" can simply mean the
  // data was never uploaded — overwriting would destroy the only copy.
  const put = async (key, value) => {
    const empty = Array.isArray(value)
      ? value.length === 0
      : Object.keys(value ?? {}).length === 0
    if (empty) {
      const existing = await AsyncStorage.getItem(key)
      if (existing && existing !== '[]' && existing !== '{}') return
    }
    await AsyncStorage.setItem(key, JSON.stringify(value))
  }

  await Promise.all([
    step(async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, title, description, due_date, priority, done, created_at')
        .eq('user_id', userId)
      if (error || !data) return
      await put(`@tasks_${userId}`, data.map(r => ({
        id: r.id, title: r.title, description: r.description,
        dueDate: r.due_date, priority: r.priority, done: r.done,
        createdAt: r.created_at,
      })))
    }),
    step(async () => {
      const { data, error } = await supabase
        .from('day_todos')
        .select('date, todos')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(120)
      if (error || !data) return
      for (const row of data) await put(`@todos_${userId}_${row.date}`, row.todos ?? [])
    }),
    step(async () => {
      const { data, error } = await supabase
        .from('day_rules')
        .select('rules')
        .eq('user_id', userId)
        .maybeSingle()
      if (error || !data) return
      await put(`@day_rules_${userId}`, data.rules ?? [])
    }),
    step(async () => {
      const { data, error } = await supabase
        .from('journal_entries')
        .select('date, mood, text, updated_at')
        .eq('user_id', userId)
      if (error || !data) return
      const map = {}
      for (const r of data) map[r.date] = { mood: r.mood, text: r.text, updatedAt: r.updated_at }
      await put(`@journals_${userId}`, map)
    }),
    step(async () => {
      const { data, error } = await supabase
        .from('schedule_items')
        .select('id, title, location, days, start_time, end_time, color, semester_start, semester_end')
        .eq('user_id', userId)
      if (error || !data) return
      await put(`@schedule_${userId}`, data.map(r => ({
        id: r.id, title: r.title, location: r.location,
        days: r.days, startTime: r.start_time, endTime: r.end_time,
        color: r.color, semesterStart: r.semester_start, semesterEnd: r.semester_end,
      })))
    }),
    step(async () => {
      const { data, error } = await supabase
        .from('calendar_events')
        .select('id, title, date, time, type, notify_mins, notif_id')
        .eq('user_id', userId)
        .order('date')
      if (error || !data) return
      await put(`@cal_events_${userId}`, data.map(r => ({
        id: r.id, title: r.title, date: r.date, time: r.time,
        type: r.type, notifyMins: r.notify_mins, notifId: r.notif_id,
      })))
    }),
  ])
}

// Drop the cached copies so the next account to sign in reads its own data.
// Every per-user key embeds the user id, so matching on it catches the ones
// this module does not name directly (weekly goals, weight logs, routine
// settings, looks data, group maps).
export async function clearLocalCache(userId) {
  if (!userId) return
  const keys = new Set(_LOCAL_CACHE_KEYS(userId))
  try {
    const all = await AsyncStorage.getAllKeys()
    for (const k of all) if (k.includes(userId)) keys.add(k)
  } catch {}
  try { await AsyncStorage.multiRemove([...keys]) } catch {}
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

// Rough "how much real content is in this copy" measure, used so a merge
// never replaces a routine that has lists/items with an emptier copy of it.
const weeklyContentScore = r => {
  let n = Array.isArray(r?.tasks) ? r.tasks.length : 0
  if (Array.isArray(r?.lists)) for (const l of r.lists) n += 1 + (Array.isArray(l?.items) ? l.items.length : 0)
  return n
}

export async function getWeeklyRoutines(userId) {
  const key = `@weekly_routines_${userId}`
  const atKey = `@weekly_routines_at_${userId}`
  const local = await readLocalJson(key)
  let cloud = null, cloudAt = null, cloudOk = false
  try {
    const { data, error } = await supabase
      .from('weekly_routines').select('routines, updated_at')
      .eq('user_id', userId).maybeSingle()
    if (!error) { cloudOk = true; cloud = data?.routines ?? null; cloudAt = data?.updated_at ?? null }
  } catch {}
  if (!cloudOk) return local ?? WEEKLY_ROUTINE_DEFAULTS
  if (local === null && cloud === null) return WEEKLY_ROUTINE_DEFAULTS
  if (local === null) {
    await AsyncStorage.setItem(key, JSON.stringify(cloud)).catch(() => {})
    if (cloudAt) await AsyncStorage.setItem(atKey, JSON.stringify(cloudAt)).catch(() => {})
    return cloud
  }
  if (cloud === null) { await saveWeeklyRoutines(userId, local); return local }
  if (JSON.stringify(cloud) === JSON.stringify(local)) return local

  // Both exist and differ. Pick a winning side (untouched defaults always
  // lose; otherwise the newer save wins), then union by id so no routine
  // from either device is dropped.
  const isDefault = a => JSON.stringify(a) === JSON.stringify(WEEKLY_ROUTINE_DEFAULTS)
  const localAt = await readLocalJson(atKey)
  let cloudWins
  if (isDefault(local)) cloudWins = true
  else if (isDefault(cloud)) cloudWins = false
  else cloudWins = parseTs(cloudAt) > parseTs(localAt)
  const [win, lose] = cloudWins ? [cloud, local] : [local, cloud]
  const merged = win.map(w => {
    const other = lose.find(r => r.id === w.id)
    return other && weeklyContentScore(other) > weeklyContentScore(w) ? other : w
  })
  for (const r of lose) if (!merged.some(m => m.id === r.id)) merged.push(r)
  await saveWeeklyRoutines(userId, merged)
  return merged
}

export async function saveWeeklyRoutines(userId, routines) {
  const at = new Date().toISOString()
  await AsyncStorage.setItem(`@weekly_routines_${userId}`, JSON.stringify(routines)).catch(() => {})
  await AsyncStorage.setItem(`@weekly_routines_at_${userId}`, JSON.stringify(at)).catch(() => {})
  await trySync('weekly_routines', 'upsert', { user_id: userId, routines, updated_at: at })
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

// Two routines finishing at once would both read the same lastDate and count
// the day twice, so the read and the write are kept together.
function _updateStreak(userId, date) {
  return _serialize(`streak:${userId}`, async () => {
    const streak = await getStreak(userId)
    // Unknown streak: leave it alone. Queuing a write derived from a failed
    // read would later replay "day 1" over the real streak.
    if (!streak) return
    if (streak.lastDate === date) return
    const yd = new Date(); yd.setDate(yd.getDate() - 1)
    const yesterday = _localDate(yd)
    const current = streak.lastDate === yesterday ? streak.current + 1 : 1
    const longest = Math.max(current, streak.longest)
    await trySync('streaks', 'upsert', { user_id: userId, current, longest, last_date: date })
  })
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
