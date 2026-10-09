import { supabase } from './supabase'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { trySync, pendingDeleteIds } from './syncQueue'
import { withTitleCasedNames, titleCaseLog } from './exerciseNames'
import { taskGoalSecs, blankRunStep, stepImageUnlocked, subStepImageUnlocked, runWithAdjustedStart } from './runSteps'

// Re-exported so screens can keep importing these from storage alongside
// everything else they need.
export { taskGoalSecs, blankRunStep, stepImageUnlocked, subStepImageUnlocked, runWithAdjustedStart }

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
// The deletes are queued if they fail, and the device mirrors go immediately so
// a merge-on-read can't resurrect the alt from a local copy in the meantime.
export async function wipeAltRoutine(userId, name) {
  const alt = altRoutineName(name)
  await AsyncStorage.multiRemove([TEMPLATE_KEY(userId, alt), RUN_KEY(userId, alt)]).catch(() => {})
  await Promise.all([
    trySync('routine_templates', 'delete', null, { user_id: userId, routine_name: alt }),
    trySync('routine_runs', 'delete', null, { user_id: userId, routine_name: alt, date: today() }),
  ])
}

// ── Routine templates ──────────────────────────────────────────────────────

// Local-first: saves write the device mirror first and queue the cloud write,
// and reads fall back to the mirror when the fetch fails. Templates used to be
// cloud-only, so a flaky fetch silently presented the stock ROUTINE_DEFAULTS
// over a routine the user had edited — and saving anything from that defaulted
// view made the reset permanent. A save made offline was simply lost.
const TEMPLATE_KEY = (uid, name) => `@routine_template_${uid}_${name}`

export async function getRoutineTemplate(userId, name) {
  const local = await readLocalJson(TEMPLATE_KEY(userId, name))
  let cloud = null, cloudOk = false
  try {
    const { data, error } = await supabase
      .from('routine_templates')
      .select('tasks')
      .eq('user_id', userId)
      .eq('routine_name', name)
      .maybeSingle()
    if (!error) { cloudOk = true; cloud = data?.tasks ?? null }
  } catch {}

  if (cloud !== null) {
    await AsyncStorage.setItem(TEMPLATE_KEY(userId, name), JSON.stringify(cloud)).catch(() => {})
    return cloud
  }
  if (local !== null) {
    // The account row is missing but this device has a copy — keep the user's
    // version and queue it back up rather than showing defaults. Unless the
    // row is missing because its delete is still queued: re-uploading then
    // would resurrect a template the user already removed.
    if (cloudOk) {
      const deleted = await pendingDeleteIds('routine_templates')
      if (!deleted.has(name)) {
        await trySync('routine_templates', 'upsert', { user_id: userId, routine_name: name, tasks: local })
      }
    }
    return local
  }
  return ROUTINE_DEFAULTS[name] ?? []
}

export async function saveRoutineTemplate(userId, name, tasks) {
  await AsyncStorage.setItem(TEMPLATE_KEY(userId, name), JSON.stringify(tasks)).catch(() => {})
  await trySync('routine_templates', 'upsert', { user_id: userId, routine_name: name, tasks })
  await syncTodayRunToTemplate(userId, name, tasks)
}

// Every template the home screen needs in ONE query instead of one per
// routine. Same semantics as getRoutineTemplate, applied per name: a cloud
// row wins and refreshes the mirror, a mirror survives a missing row (and is
// queued back up unless its delete is pending), defaults are the last resort.
// Returns { [name]: tasks }.
export async function getRoutineTemplates(userId, names) {
  const out = {}
  if (!names?.length) return out

  const locals = new Map()
  try {
    const pairs = await AsyncStorage.multiGet(names.map(n => TEMPLATE_KEY(userId, n)))
    pairs.forEach(([, raw], i) => {
      try { if (raw != null) locals.set(names[i], JSON.parse(raw)) } catch {}
    })
  } catch {}

  let cloudOk = false
  const cloud = new Map()
  try {
    const { data, error } = await supabase
      .from('routine_templates')
      .select('routine_name, tasks')
      .eq('user_id', userId)
      .in('routine_name', names)
    if (!error) {
      cloudOk = true
      for (const r of data ?? []) if (r.tasks != null) cloud.set(r.routine_name, r.tasks)
    }
  } catch {}

  const deleted = cloudOk ? await pendingDeleteIds('routine_templates') : new Set()
  const toCache = []
  for (const name of names) {
    const c = cloud.get(name) ?? null
    const local = locals.get(name) ?? null
    if (c !== null) {
      toCache.push([TEMPLATE_KEY(userId, name), JSON.stringify(c)])
      out[name] = c
      continue
    }
    if (local !== null) {
      if (cloudOk && !deleted.has(name)) {
        await trySync('routine_templates', 'upsert', { user_id: userId, routine_name: name, tasks: local })
      }
      out[name] = local
      continue
    }
    out[name] = ROUTINE_DEFAULTS[name] ?? []
  }
  if (toCache.length) await AsyncStorage.multiSet(toCache).catch(() => {})
  return out
}

/**
 * Fold template edits into today's run so a routine can be edited while it is
 * underway.
 *
 * A run snapshots the template when it starts, so without this an edit made
 * mid-routine wouldn't show up until the next day. Progress is matched by task
 * id: surviving tasks keep their timings and ticked sub-tasks, new tasks come
 * in fresh, deleted ones drop out, and order follows the new template.
 *
 * A finished timed run is left alone — it is the record of what actually
 * happened, and the UI offers those edits as "tomorrow's routine" instead.
 */
export function syncTodayRunToTemplate(userId, name, tasks) {
  // Shares the run's lock with quickCheckToggle, so a checkbox tapped at the
  // same moment can't be built from — or overwritten by — a stale copy.
  return _serialize(`run:${userId}|${name}`, () => _syncRunToTemplate(userId, name, tasks))
}

async function _syncRunToTemplate(userId, name, tasks) {
  const { ok, run } = await _readTodayRun(userId, name)
  if (!ok || !run) return null
  if (run.finished && !run.quick) return null

  const prevById = new Map((run.steps ?? []).map(s => [s.id, s]))
  const steps = tasks.map(t => {
    const prev = prevById.get(t.id)
    const subTasks = (t.subTasks || []).map(st => {
      const prevSub = prev?.subTasks?.find(p => p.id === st.id)
      return { ...st, done: prevSub?.done ?? false }
    })
    if (!prev) return { ...blankRunStep(t), subTasks }
    // Keep whatever progress this task already had; take everything the user
    // just edited (wording, time goal, sub-task list, picture) from the new
    // template.
    return { ...prev, text: t.text, image: t.image ?? null, timeGoalSecs: taskGoalSecs(t), subTasks }
  })

  if (steps.length === 0) {
    // Every task was deleted mid-run — nothing left to do today.
    await resetTodayRun(userId, name)
    return null
  }

  const doneCount = steps.filter(s => s.completedAt).length
  const allDone = doneCount === steps.length
  const currentStep = allDone ? steps.length - 1 : steps.findIndex(s => !s.completedAt)

  // The step the run is now sitting on has to be ticking, or its timer shows
  // nothing. An all-done timed run keeps finished=false on purpose: the user
  // taps Finish, which is what records the streak and history.
  if (!run.quick && !allDone && !steps[currentStep].startedAt) {
    steps[currentStep] = { ...steps[currentStep], startedAt: Date.now() }
  }

  const updated = { ...run, steps, currentStep }
  if (run.quick) {
    // Quick runs have no timer and finish purely by every box being ticked,
    // so adding a task can legitimately un-finish one.
    updated.finished = allDone
    updated.completedAt = allDone ? (run.completedAt ?? Date.now()) : null
  }

  await _persistRun(userId, name, updated)
  // Quick runs drive the calendar's completion ring off step counts, so a
  // changed task count has to be reflected there too.
  if (run.quick) {
    await trySync('history', 'upsert', {
      user_id: userId, date: today(), routine_name: baseRoutineName(name),
      completion: Math.round((doneCount / steps.length) * 100),
    })
  }
  return updated
}

// ── Routine list ───────────────────────────────────────────────────────────

// `ok` is false when the row could not be read at all, as opposed to there
// being no row yet (a fresh account). The whole list lives in one array, so a
// writer that proceeds from a failed read replaces the user's every custom
// routine with the stock three — writers must refuse instead.
async function _readRoutineNames(userId) {
  const { data, error } = await supabase
    .from('routine_names')
    .select('names')
    .eq('user_id', userId)
    .single()
  if (error && error.code !== 'PGRST116') return { ok: false, names: null }
  return { ok: true, names: data?.names ?? null }
}

export async function getRoutineNames(userId) {
  const { ok, names } = await _readRoutineNames(userId)
  const base = names ?? ['Morning', 'Fitness', 'Night']
  // Migration: remove Looks (now a sub-section of Morning, not a standalone routine)
  if (base.includes('Looks')) {
    const updated = base.filter(n => n !== 'Looks')
    // Only persist the migration off a read we trust — and queued, so it
    // isn't silently lost offline.
    if (ok) await trySync('routine_names', 'upsert', { user_id: userId, names: updated })
    return updated
  }
  return base
}

const _namesOffline = () =>
  new Error('Could not reach your routines. Check your connection and try again.')

export async function addRoutine(userId, name) {
  const { ok, names: stored } = await _readRoutineNames(userId)
  if (!ok) throw _namesOffline()
  const names = (stored ?? ['Morning', 'Fitness', 'Night']).filter(n => n !== 'Looks')
  if (names.includes(name)) return
  await trySync('routine_names', 'upsert', { user_id: userId, names: [...names, name] })
}

export async function deleteRoutine(userId, name) {
  const { ok, names: stored } = await _readRoutineNames(userId)
  if (!ok) throw _namesOffline()
  const names = (stored ?? ['Morning', 'Fitness', 'Night']).filter(n => n !== 'Looks')
  const alt = altRoutineName(name)
  await trySync('routine_names', 'upsert', { user_id: userId, names: names.filter(n => n !== name) })
  // The cascade goes through the queue too — a delete that failed silently
  // used to leave the rows behind to resurrect on the next merge-on-read.
  // (trySync deletes match by equality only, so the old `.in(...)` pair
  // becomes one op per variant.)
  await Promise.all([
    trySync('routine_templates', 'delete', null, { user_id: userId, routine_name: name }),
    trySync('routine_templates', 'delete', null, { user_id: userId, routine_name: alt }),
    trySync('routine_runs', 'delete', null, { user_id: userId, routine_name: name }),
    trySync('routine_runs', 'delete', null, { user_id: userId, routine_name: alt }),
    trySync('history', 'delete', null, { user_id: userId, routine_name: name }),
  ])
  // Drop the device mirrors so a read can't re-upload the dead routine.
  await AsyncStorage.multiRemove([
    TEMPLATE_KEY(userId, name), TEMPLATE_KEY(userId, alt),
    RUN_KEY(userId, name), RUN_KEY(userId, alt),
  ]).catch(() => {})
  const groupMap = await getRoutineGroupMap(userId)
  if (groupMap[name]) {
    delete groupMap[name]
    await saveRoutineGroupMap(userId, groupMap)
  }
}

// The three built-in routines are hardcoded throughout the app (special sections,
// themes, default schedules) so their names are reserved and cannot be reused/renamed.
export const RESERVED_ROUTINES = ['Morning', 'Fitness', 'Night']

// Persist a new display order for the routine list (drag-to-reorder). The
// caller hands us the full array it is displaying, so there is no read here
// to guard — but the write is queued rather than silently dropped.
export async function saveRoutineOrder(userId, orderedNames) {
  await trySync('routine_names', 'upsert', { user_id: userId, names: orderedNames })
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
  // Same guarded read as addRoutine/deleteRoutine: proceeding from a failed
  // read would pass the duplicate check vacuously and write a list rebuilt
  // from the stock defaults over the user's own.
  const { ok, names: stored } = await _readRoutineNames(userId)
  if (!ok) throw _namesOffline()
  const names = (stored ?? ['Morning', 'Fitness', 'Night']).filter(n => n !== 'Looks')
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
    if (!run) {
      run = {
        date: today(), quick: true, startedAt: null, completedAt: null,
        currentStep: 0, finished: false,
        steps: template.map(blankRunStep),
      }
    } else {
      // Reconcile with the template so tasks added/removed mid-day (AI apply,
      // Looks/workout integration) are toggleable without resetting the run.
      // A picture added to a task or one of its steps after the run began
      // arrives through here; progress already made is kept.
      const byId = new Map(run.steps.map(s => [s.id, s]))
      run.steps = template.map(t => {
        const prev = byId.get(t.id)
        if (!prev) return blankRunStep(t)
        const subTasks = (t.subTasks || []).map(st => {
          const prevSub = prev.subTasks?.find(p => p.id === st.id)
          return { ...st, done: prevSub?.done ?? false }
        })
        return { ...prev, text: t.text, image: t.image ?? null, subTasks }
      })
    }
    run.quick = true
    const steps = run.steps.map(s =>
      s.id === taskId ? { ...s, completedAt: s.completedAt ? null : Date.now(), elapsedMs: 0 } : s
    )
    const doneCount = steps.filter(s => s.completedAt).length
    const finished = steps.length > 0 && doneCount === steps.length
    const updated = { ...run, steps, finished, completedAt: finished ? Date.now() : null }
    await _persistRun(userId, name, updated)
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
// Runs are mirrored to the device on every write and every trustworthy read.
// They used to be cloud-only with the upsert's error discarded, so a routine
// completed offline vanished entirely — run, history row and streak. One key
// per routine (the run's own date travels inside it), so mirrors never
// accumulate across days: a new day's run simply overwrites yesterday's.

const RUN_KEY = (uid, name) => `@run_${uid}_${name}`

// How fresh a copy of a run is: the write-time stamp _persistRun adds, or —
// for copies written before stamping existed — the latest timestamp anywhere
// in its content. Content alone isn't enough: un-ticking a quick-run task
// CLEARS its completedAt, so the newest copy can carry the OLDEST content
// stamp, and a content-only compare would resurrect the tick.
function _runStamp(run) {
  if (!run) return 0
  let t = Math.max(run.updatedAt ?? 0, run.startedAt ?? 0, run.completedAt ?? 0)
  for (const s of run.steps ?? []) t = Math.max(t, s.startedAt ?? 0, s.completedAt ?? 0)
  return t
}

async function _readRunMirror(userId, name, date) {
  const run = await readLocalJson(RUN_KEY(userId, name))
  return run && run.date === date ? run : null
}

function _writeRunMirror(userId, name, run) {
  return AsyncStorage.setItem(RUN_KEY(userId, name), JSON.stringify(run)).catch(() => {})
}

function _clearRunMirror(userId, name) {
  return AsyncStorage.removeItem(RUN_KEY(userId, name)).catch(() => {})
}

// Every run write lands on the device first, then goes to the cloud through
// the queue — the same shape the queue replays: { user_id, routine_name,
// date, data }. The copy is stamped with its write time so _runStamp can
// order copies even when an edit removes content timestamps.
async function _persistRun(userId, name, run) {
  const stamped = { ...run, updatedAt: Date.now() }
  await _writeRunMirror(userId, name, stamped)
  await trySync('routine_runs', 'upsert', {
    user_id: userId, routine_name: name, date: stamped.date, data: stamped,
  })
}

// Does this run have a delete still waiting in the queue? Covers both a
// dated reset ("name|date") and deleteRoutine's undated cascade ("name|").
const _runDeletePending = (deleted, name, date) =>
  deleted.has(`${name}|${date}`) || deleted.has(`${name}|`)

// `ok` is false when the run could not be read from ANYWHERE — the cloud row
// was unreachable and this device holds no mirror — as opposed to there being
// no run yet. Callers that persist a derived value must check it: treating an
// unreadable run as "no run" would queue a blank run that later replays over
// real progress.
//
// Merge rule (whole-run LWW): the cloud copy and the mirror are compared by
// _runStamp — the write-time stamp _persistRun adds, falling back to the
// latest timestamp anywhere in the run's content — and the fresher blob wins
// outright. Steps are never spliced between copies, because a stitched run's
// currentStep/finished could disagree with its steps. Ties go to the cloud
// copy, since it is the one that provably reached the server (identical
// copies tie, so the synced steady state never re-uploads). A mirror that is
// ahead (an offline write still in the queue) or that survives a missing
// cloud row is kept and queued back up, keeping its own stamp — unless a
// delete of the run is still pending, which means the row is gone on
// purpose, not missing.
async function _readTodayRun(userId, name) {
  const date = today()
  const [{ cloudOk, cloud }, local, deleted] = await Promise.all([
    (async () => {
      try {
        const { data, error } = await supabase
          .from('routine_runs')
          .select('data')
          .eq('user_id', userId)
          .eq('routine_name', name)
          .eq('date', date)
          .single()
        if (!error || error.code === 'PGRST116') return { cloudOk: true, cloud: data?.data ?? null }
      } catch {}
      return { cloudOk: false, cloud: null }
    })(),
    _readRunMirror(userId, name, date),
    pendingDeleteIds('routine_runs'),
  ])

  if (_runDeletePending(deleted, name, date)) {
    // The run was reset/removed on this device and the delete hasn't replayed
    // yet. Whatever the cloud still shows is the dead copy.
    await _clearRunMirror(userId, name)
    return { ok: true, run: null }
  }
  if (!cloudOk) {
    // Can't see the server. The mirror is this device's own last write —
    // trustworthy to build further progress on. With no mirror either, we
    // genuinely don't know.
    return local ? { ok: true, run: local } : { ok: false, run: null }
  }
  if (cloud !== null && _runStamp(cloud) >= _runStamp(local)) {
    await _writeRunMirror(userId, name, cloud)
    return { ok: true, run: cloud }
  }
  if (local !== null) {
    // Mirror ahead of (or instead of) the cloud row: keep the local progress
    // and push it back up. Usually the queued op is already there; re-queuing
    // is harmless since ops to the same record collapse newest-wins.
    await trySync('routine_runs', 'upsert', {
      user_id: userId, routine_name: name, date, data: local,
    })
    return { ok: true, run: local }
  }
  return { ok: true, run: null }
}

export async function getTodayRun(userId, name) {
  const { run } = await _readTodayRun(userId, name)
  return run
}

// Today's runs for several routines counting BOTH variants, in one query.
// The same cloud-vs-mirror recency rule as _readTodayRun decides each
// variant's copy (without the queue-back-up step — this is a display read),
// then per base name: prefer a finished run, then main over alt.
async function _todayRunsEither(userId, names) {
  const date = today()
  const allNames = names.flatMap(n => [n, altRoutineName(n)])

  let cloudRows = new Map()
  try {
    const { data, error } = await supabase
      .from('routine_runs')
      .select('routine_name, data')
      .eq('user_id', userId)
      .in('routine_name', allNames)
      .eq('date', date)
    if (!error) cloudRows = new Map((data ?? []).map(r => [r.routine_name, r.data ?? null]))
  } catch {}

  const mirrors = new Map()
  try {
    const pairs = await AsyncStorage.multiGet(allNames.map(n => RUN_KEY(userId, n)))
    pairs.forEach(([, raw], i) => {
      try {
        const run = raw != null ? JSON.parse(raw) : null
        if (run && run.date === date) mirrors.set(allNames[i], run)
      } catch {}
    })
  } catch {}

  const deleted = await pendingDeleteIds('routine_runs')
  const toCache = []
  const runFor = variant => {
    if (_runDeletePending(deleted, variant, date)) return null
    const cloud = cloudRows.get(variant) ?? null
    const local = mirrors.get(variant) ?? null
    if (cloud !== null && _runStamp(cloud) >= _runStamp(local)) {
      // Keep the mirror warm so the routine screen works offline even if it
      // was never opened while online today. Skip when nothing is newer.
      if (_runStamp(cloud) > _runStamp(local) || local === null) {
        toCache.push([RUN_KEY(userId, variant), JSON.stringify(cloud)])
      }
      return cloud
    }
    return local
  }

  const out = {}
  for (const name of names) {
    const candidates = [
      { variant: name, run: runFor(name) },
      { variant: altRoutineName(name), run: runFor(altRoutineName(name)) },
    ].filter(c => c.run)
    const pick =
      candidates.find(c => c.run.finished) ??
      candidates.find(c => c.variant === name) ??
      candidates[0]
    out[name] = pick?.run ?? null
  }
  if (toCache.length) await AsyncStorage.multiSet(toCache).catch(() => {})
  return out
}

export async function getTodayRunEither(userId, name) {
  const runs = await _todayRunsEither(userId, [name])
  return runs[name] ?? null
}

// Batched form for the home screen: one query for every routine and its alt
// variant instead of one per card. Returns { [name]: run | null }.
export function getTodayRunsEither(userId, names) {
  return _todayRunsEither(userId, names ?? [])
}

export async function startRun(userId, name) {
  const template = await getRoutineTemplate(userId, name)
  const now = Date.now()
  const run = {
    date: today(),
    startedAt: now,
    completedAt: null,
    currentStep: 0,
    steps: template.map(blankRunStep),
    finished: false,
  }
  if (run.steps.length > 0) run.steps[0].startedAt = now
  await _persistRun(userId, name, run)
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
  await _persistRun(userId, name, updated)
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
  await _persistRun(userId, name, updated)
  await _updateStreak(userId, today())
  await trySync('history', 'upsert', {
    user_id: userId, date: today(), routine_name: baseRoutineName(name), completion: 100,
  })
  return updated
}

export async function saveRun(userId, name, run) {
  await _persistRun(userId, name, run)
}

export async function resetTodayRun(userId, name) {
  // The mirror goes first so a concurrent read can't queue it back up while
  // the deletes are in flight.
  await _clearRunMirror(userId, name)
  await trySync('routine_runs', 'delete', null, {
    user_id: userId, routine_name: name, date: today(),
  })
  await trySync('history', 'delete', null, {
    user_id: userId, date: today(), routine_name: baseRoutineName(name),
  })
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
  await trySync('gym_splits', 'upsert', { user_id: userId, preset: split.preset, days: split.days })
}

// ── Workout plan (per muscle group) ───────────────────────────────────────

export async function getWorkoutPlan(userId, muscleGroup) {
  const { data } = await supabase
    .from('workout_plans')
    .select('exercises')
    .eq('user_id', userId)
    .eq('muscle_group', muscleGroup)
    .single()
  // Older plans stored library names in lowercase.
  return withTitleCasedNames(data?.exercises ?? [])
}

export async function saveWorkoutPlan(userId, muscleGroup, exercises) {
  await trySync('workout_plans', 'upsert', { user_id: userId, muscle_group: muscleGroup, exercises })
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
  // Queued like the other writes: a delete that failed silently left the
  // plan to reappear on the next visit.
  await trySync('workout_plans', 'delete', null, { user_id: userId, muscle_group: name })
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
  return titleCaseLog(data?.data ?? null)
}

export async function saveWorkoutLog(userId, date, log) {
  await trySync('workout_logs', 'upsert', { user_id: userId, date, data: log })
}

export async function getAllWorkoutLogs(userId) {
  const { data } = await supabase
    .from('workout_logs')
    .select('date, data')
    .eq('user_id', userId)
    .order('date', { ascending: false })
  const map = {}
  for (const row of data ?? []) {
    map[row.date] = { ...titleCaseLog(row.data), date: row.date }
  }
  return map
}

// The logs for one date window in a single query — the Fitness week calendar
// used to fire fourteen getWorkoutLog calls for this. Same { date → log }
// shape as getAllWorkoutLogs; both bounds inclusive.
export async function getWorkoutLogsRange(userId, fromDate, toDate) {
  const { data } = await supabase
    .from('workout_logs')
    .select('date, data')
    .eq('user_id', userId)
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: false })
  const map = {}
  for (const row of data ?? []) {
    map[row.date] = { ...titleCaseLog(row.data), date: row.date }
  }
  return map
}

// ── First-time setup ───────────────────────────────────────────────────────

// Read on every launch to pick the landing screen, so it must not depend on
// the network being up. The answer is cached the first time it is known.
export async function hasUserSetup(userId) {
  const key = `@has_setup_${userId}`
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('has_setup')
      .eq('id', userId)
      .single()
    if (!error) {
      const done = data?.has_setup ?? false
      await AsyncStorage.setItem(key, done ? '1' : '0').catch(() => {})
      return done
    }
  } catch {}
  try {
    const cached = await AsyncStorage.getItem(key)
    if (cached !== null) return cached === '1'
  } catch {}
  // Never seen an answer for this account: assume set up, because sending a
  // returning user back through first-run setup is the worse mistake.
  return true
}

export async function markSetupDone(userId) {
  const { error } = await supabase
    .from('profiles')
    .update({ has_setup: true })
    .eq('id', userId)
  if (error) throw error
  await AsyncStorage.setItem(`@has_setup_${userId}`, '1').catch(() => {})
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

// Bounded to ~13 months by default: this runs on every Home/Calendar focus,
// and fetching every row ever only feeds the month grid's completion rings —
// the calendar can page back further, but any older month's day taps go
// through getHistoryForDate, which stays per-date and unbounded. 400 days
// covers the 13 visible months with margin. Pass { sinceDays: null } for the
// full table (the settings export needs everything).
export async function getHistory(userId, { sinceDays = 400 } = {}) {
  let q = supabase
    .from('history')
    .select('date, routine_name, completion')
    .eq('user_id', userId)
    .order('date', { ascending: false })
  if (sinceDays != null) {
    const sd = new Date(); sd.setDate(sd.getDate() - sinceDays)
    q = q.gte('date', _localDate(sd))
  }
  const { data } = await q
  return (data || []).map(row => ({
    date: row.date,
    routine: row.routine_name,
    completion: row.completion,
  }))
}

const STREAK_KEY = uid => `@streak_${uid}`

export async function getStreak(userId) {
  const { data, error } = await supabase
    .from('streaks')
    .select('current, longest, last_date')
    .eq('user_id', userId)
    .single()
  // PGRST116 is "no row", which genuinely means a zero streak. Any other
  // error means the server couldn't answer — fall back to the device's
  // last-known copy, and only return null (callers must not guess) when
  // there has never been one.
  if (error && error.code !== 'PGRST116') {
    return await readLocalJson(STREAK_KEY(userId))
  }
  const streak = data
    ? { current: data.current, longest: data.longest, lastDate: data.last_date }
    : { current: 0, longest: 0, lastDate: null }
  await AsyncStorage.setItem(STREAK_KEY(userId), JSON.stringify(streak)).catch(() => {})
  return streak
}

// ── Saved meal templates ───────────────────────────────────────────────────

// `ok` is false when the row could not be read at all — every saved meal
// lives in one row, so a write built from a failed read (which looks exactly
// like "no meals yet") would replace the user's whole collection with a
// near-empty one when it replays.
async function _readSavedMeals(userId) {
  const { data, error } = await supabase
    .from('saved_meals')
    .select('meals')
    .eq('user_id', userId)
    .single()
  if (error && error.code !== 'PGRST116') return { ok: false, meals: [] }
  return { ok: true, meals: data?.meals ?? [] }
}

export async function getSavedMeals(userId) {
  return (await _readSavedMeals(userId)).meals
}

const _mealsOffline = () =>
  new Error('Could not reach your saved meals. Check your connection and try again.')

// Every saved meal lives in one row, so edits are queued behind each other and
// each one re-reads the list it is about to rewrite.
export function upsertSavedMeal(userId, meal) {
  return _serialize(`saved_meals:${userId}`, async () => {
    const { ok, meals } = await _readSavedMeals(userId)
    if (!ok) throw _mealsOffline()
    const idx = meals.findIndex(m => m.id === meal.id)
    if (idx >= 0) meals[idx] = meal
    else meals.push(meal)
    await trySync('saved_meals', 'upsert', { user_id: userId, meals })
  })
}

export function deleteSavedMeal(userId, id) {
  return _serialize(`saved_meals:${userId}`, async () => {
    const { ok, meals } = await _readSavedMeals(userId)
    if (!ok) throw _mealsOffline()
    await trySync('saved_meals', 'upsert', { user_id: userId, meals: meals.filter(m => m.id !== id) })
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
      .select('id, title, description, due_date, priority, done, created_at, bucket, deadline')
      .eq('user_id', userId)
    if (data) {
      const tasks = data.map(r => ({
        id: r.id, title: r.title, description: r.description,
        dueDate: r.due_date, priority: r.priority, done: r.done,
        createdAt: r.created_at,
        bucket: r.bucket ?? 'today', deadline: r.deadline ?? null,
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
    bucket: task.bucket ?? 'today', deadline: task.deadline ?? null,
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

// The cloud fetch is bounded to the last 90 days by default — this runs on
// every Home/Calendar focus, and the local map already accumulates every
// entry this device has ever seen (saves land in it, and refreshFromCloud
// pulls the WHOLE table into it on sign-in/foreground). Arbitrary past dates
// therefore still resolve from the returned map; only a device that has
// never completed a refresh is limited to the window. Pass
// { sinceDays: null } to fetch everything.
export async function getJournalEntries(userId, { sinceDays = 90 } = {}) {
  const key = `@journals_${userId}`
  const local = (await readLocalJson(key)) ?? {}
  let cloud = null
  let since = null
  try {
    let q = supabase
      .from('journal_entries')
      .select('date, mood, text, updated_at')
      .eq('user_id', userId)
    if (sinceDays != null) {
      const sd = new Date(); sd.setDate(sd.getDate() - sinceDays)
      since = _localDate(sd)
      q = q.gte('date', since)
    }
    const { data, error } = await q
    if (!error && data) {
      cloud = {}
      for (const r of data) cloud[r.date] = { mood: r.mood, text: r.text, updatedAt: r.updated_at }
    }
  } catch {}
  if (cloud === null) return local
  // Merge: keep every date from both sides; on conflict newer wins, ties go
  // to the entry with more text. A cloud entry whose delete is still queued
  // is dead, not new — merging it back would resurrect it.
  const deleted = await pendingDeleteIds('journal_entries')
  const merged = { ...local }
  for (const [date, c] of Object.entries(cloud)) {
    if (deleted.has(date)) continue
    const l = merged[date]
    if (!l) { merged[date] = c; continue }
    const lt = parseTs(l.updatedAt), ct = parseTs(c.updatedAt)
    if (ct > lt || (ct === lt && (c.text ?? '').length > (l.text ?? '').length)) merged[date] = c
  }
  await AsyncStorage.setItem(key, JSON.stringify(merged)).catch(() => {})
  // Entries the cloud is missing or holds a losing copy of. Only dates inside
  // the fetched window can be judged — an older date absent from `cloud` was
  // simply not fetched, not lost — and pending deletes are skipped for the
  // same reason as above.
  const catchUp = []
  for (const [date, m] of Object.entries(merged)) {
    if (since != null && date < since) continue
    if (deleted.has(date)) continue
    const c = cloud[date]
    if (c && c.text === m.text && (c.mood ?? null) === (m.mood ?? null)) continue
    catchUp.push([date, m])
  }
  if (catchUp.length) {
    // Off the read path: these uploads used to run one by one before the
    // caller got its data back. Still serialized so they can't interleave
    // with each other across overlapping reads.
    _serialize(`journal_catchup:${userId}`, async () => {
      for (const [date, m] of catchUp) {
        await trySync('journal_entries', 'upsert', {
          user_id: userId, date, mood: m.mood ?? null, text: m.text ?? '',
          updated_at: m.updatedAt ? new Date(parseTs(m.updatedAt)).toISOString() : null,
        })
      }
    }).catch(() => {})
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

// Merges the device copy with the account copy on every read, the same way
// journals do. The old behaviour returned local whenever it existed, so the
// cloud row was only ever read on a fresh install — a class edited anywhere
// else never arrived.
export async function getScheduleItems(userId) {
  const key = `@schedule_${userId}`
  const local = (await readLocalJson(key)) ?? []
  let cloud = null
  try {
    const { data, error } = await supabase
      .from('schedule_items')
      .select('id, title, location, days, start_time, end_time, color, semester_start, semester_end, meta, updated_at')
      .eq('user_id', userId)
    if (!error && data) {
      cloud = data.map(r => ({
        id: r.id, title: r.title, location: r.location,
        days: r.days, startTime: r.start_time, endTime: r.end_time,
        color: r.color, semesterStart: r.semester_start, semesterEnd: r.semester_end,
        meta: r.meta ?? null, updatedAt: r.updated_at,
      }))
    }
  } catch {}
  if (cloud === null) return local

  // A cloud row whose delete is still queued was removed on this device while
  // offline — merging or re-uploading it would resurrect the class.
  const deleted = await pendingDeleteIds('schedule_items')
  const byId = new Map(local.filter(i => !deleted.has(String(i.id))).map(i => [i.id, i]))
  for (const c of cloud) {
    if (deleted.has(String(c.id))) continue
    const l = byId.get(c.id)
    // Newer wins; an unstamped local row predates this merge, so the stamped
    // cloud row is the better copy.
    if (!l || parseTs(c.updatedAt) > parseTs(l.updatedAt)) byId.set(c.id, c)
  }
  const merged = [...byId.values()]
  await AsyncStorage.setItem(key, JSON.stringify(merged)).catch(() => {})

  // Push up anything the account is missing or holds an older copy of.
  const cloudById = new Map(cloud.map(c => [c.id, c]))
  for (const m of merged) {
    if (cloudById.get(m.id) === m) continue
    await trySync('schedule_items', 'upsert', _scheduleRow(userId, m))
  }
  return merged
}

function _scheduleRow(userId, item) {
  return {
    id: item.id, user_id: userId, title: item.title,
    location: item.location ?? null, days: item.days,
    start_time: item.startTime, end_time: item.endTime,
    color: item.color, semester_start: item.semesterStart ?? null,
    semester_end: item.semesterEnd ?? null, meta: item.meta ?? null,
    updated_at: new Date(parseTs(item.updatedAt) || Date.now()).toISOString(),
  }
}

export async function saveScheduleItem(userId, item) {
  const key = `@schedule_${userId}`
  const items = await getScheduleItems(userId)
  item = { ...item, updatedAt: Date.now() }
  const idx = items.findIndex(i => i.id === item.id)
  if (idx >= 0) items[idx] = item
  else items.push(item)
  await AsyncStorage.setItem(key, JSON.stringify(items)).catch(() => {})
  await trySync('schedule_items', 'upsert', _scheduleRow(userId, item))
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

// A full refresh is six table scans, and app foregrounding can fire several
// in quick succession (switching apps, notification taps). One finished
// within the last five minutes is fresh enough — except the sign-in pull,
// which must always run so a returning device sees other devices' edits
// immediately. cloudSync calls this identically for both, so "sign-in" is
// detected as the first refresh for an account in this JS process; callers
// can also pass { force: true } to bypass the throttle explicitly.
const REFRESH_STAMP_KEY = uid => `@last_cloud_refresh_${uid}`
const REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000
const _refreshedThisSession = new Set()

export async function refreshFromCloud(userId, { force = false } = {}) {
  if (!userId) return
  if (!force && _refreshedThisSession.has(userId)) {
    try {
      const last = Number(await AsyncStorage.getItem(REFRESH_STAMP_KEY(userId)))
      if (last && Date.now() - last < REFRESH_MIN_INTERVAL_MS) return
    } catch {}
  }

  // The stamp only lands when every table refreshed cleanly, so a refresh
  // attempted offline doesn't suppress the retry after connectivity returns.
  let allOk = true
  const step = async fn => { try { await fn() } catch { allOk = false } }

  // An empty server response must never erase a populated local cache. Older
  // builds swallowed failed cloud writes, so "no rows" can simply mean the
  // data was never uploaded — overwriting would destroy the only copy.
  const putGuard = (value, existing) => {
    const empty = Array.isArray(value)
      ? value.length === 0
      : Object.keys(value ?? {}).length === 0
    if (empty && existing && existing !== '[]' && existing !== '{}') return null
    return JSON.stringify(value)
  }
  const put = async (key, value) => {
    const json = putGuard(value, await AsyncStorage.getItem(key))
    if (json != null) await AsyncStorage.setItem(key, json)
  }

  await Promise.all([
    step(async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, title, description, due_date, priority, done, created_at, bucket, deadline')
        .eq('user_id', userId)
      if (error) throw error
      if (!data) return
      await put(`@tasks_${userId}`, data.map(r => ({
        id: r.id, title: r.title, description: r.description,
        dueDate: r.due_date, priority: r.priority, done: r.done,
        createdAt: r.created_at,
        bucket: r.bucket ?? 'today', deadline: r.deadline ?? null,
      })))
    }),
    step(async () => {
      const { data, error } = await supabase
        .from('day_todos')
        .select('date, todos')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(120)
      if (error) throw error
      if (!data?.length) return
      // One multiGet + one multiSet instead of up to 120 sequential awaits.
      // put()'s empty-guard is preserved per day.
      const keys = data.map(row => `@todos_${userId}_${row.date}`)
      const existing = new Map(await AsyncStorage.multiGet(keys))
      const pairs = []
      for (let i = 0; i < data.length; i++) {
        const json = putGuard(data[i].todos ?? [], existing.get(keys[i]))
        if (json != null) pairs.push([keys[i], json])
      }
      if (pairs.length) await AsyncStorage.multiSet(pairs)
    }),
    step(async () => {
      const { data, error } = await supabase
        .from('day_rules')
        .select('rules')
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      if (!data) return
      await put(`@day_rules_${userId}`, data.rules ?? [])
    }),
    step(async () => {
      const { data, error } = await supabase
        .from('journal_entries')
        .select('date, mood, text, updated_at')
        .eq('user_id', userId)
      if (error) throw error
      if (!data) return
      const map = {}
      for (const r of data) map[r.date] = { mood: r.mood, text: r.text, updatedAt: r.updated_at }
      await put(`@journals_${userId}`, map)
    }),
    step(async () => {
      const { data, error } = await supabase
        .from('schedule_items')
        .select('id, title, location, days, start_time, end_time, color, semester_start, semester_end, meta')
        .eq('user_id', userId)
      if (error) throw error
      if (!data) return
      await put(`@schedule_${userId}`, data.map(r => ({
        id: r.id, title: r.title, location: r.location,
        days: r.days ?? [], startTime: r.start_time, endTime: r.end_time,
        color: r.color, semesterStart: r.semester_start, semesterEnd: r.semester_end,
        meta: r.meta ?? null,
      })))
    }),
    step(async () => {
      const { data, error } = await supabase
        .from('calendar_events')
        .select('id, title, date, time, type, notify_mins, notif_id')
        .eq('user_id', userId)
        .order('date')
      if (error) throw error
      if (!data) return
      await put(`@cal_events_${userId}`, data.map(r => ({
        id: r.id, title: r.title, date: r.date, time: r.time,
        type: r.type, notifyMins: r.notify_mins, notifId: r.notif_id,
      })))
    }),
  ])

  if (allOk) {
    _refreshedThisSession.add(userId)
    await AsyncStorage.setItem(REFRESH_STAMP_KEY(userId), String(Date.now())).catch(() => {})
  }
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
    // Rescue only content the winning side lost ENTIRELY (an empty copy of a
    // routine the other side has filled). "More items" must not beat "newer":
    // the stock 7-task Sunday Reset kept resurrecting over a user's trimmed
    // custom version because it out-scored it.
    return other && weeklyContentScore(w) === 0 && weeklyContentScore(other) > 0 ? other : w
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
// AsyncStorage is still the fast path, but the history now also lives on the
// account — it used to be device-only, so a reinstall lost every entry. There
// is no weight table in the schema, so the list rides in user_settings (the
// per-user key/value store timeLogging already uses) under key
// 'weight_logs', as { logs: [{ date, weight, at }] }.
//
// Merge on read is a per-date union with last-writer-wins on conflict: `at`
// stamps each entry at save time, and an entry from before stamping existed
// counts as 0 — so a stamped copy always beats a legacy one, and on a dead
// tie the local copy (the device in the user's hand) is kept.

const WEIGHT_KEY = uid => `@weight_logs_${uid}`

function _mergeWeightLogs(local, cloud) {
  const byDate = new Map()
  for (const e of local ?? []) if (e?.date) byDate.set(e.date, e)
  for (const e of cloud ?? []) {
    if (!e?.date) continue
    const l = byDate.get(e.date)
    if (!l || (e.at ?? 0) > (l.at ?? 0)) byDate.set(e.date, e)
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date))
}

function _pushWeightLogs(userId, logs) {
  return trySync('user_settings', 'upsert', {
    user_id: userId, key: 'weight_logs', data: { logs },
    updated_at: new Date().toISOString(),
  })
}

export async function getWeightLogs(userId) {
  const local = (await readLocalJson(WEIGHT_KEY(userId))) ?? []
  let cloud = null
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('data')
      .eq('user_id', userId)
      .eq('key', 'weight_logs')
      .maybeSingle()
    if (!error) cloud = data?.data?.logs ?? []
  } catch {}
  if (cloud === null) return local
  const merged = _mergeWeightLogs(local, cloud)
  if (JSON.stringify(merged) !== JSON.stringify(local)) {
    await AsyncStorage.setItem(WEIGHT_KEY(userId), JSON.stringify(merged)).catch(() => {})
  }
  // The account is missing something this device has (or holds losing
  // copies): push the union back up.
  if (JSON.stringify(merged) !== JSON.stringify(_mergeWeightLogs(cloud, []))) {
    await _pushWeightLogs(userId, merged)
  }
  return merged
}

// The whole history is one record, so saves are queued behind each other and
// each one re-reads (and re-merges) the list it is about to rewrite.
export function saveWeightLog(userId, date, weight) {
  return _serialize(`weight:${userId}`, async () => {
    const logs = await getWeightLogs(userId)
    const at = Date.now()
    const idx = logs.findIndex(l => l.date === date)
    if (idx >= 0) logs[idx] = { ...logs[idx], weight, at }
    else logs.unshift({ date, weight, at })
    logs.sort((a, b) => b.date.localeCompare(a.date))
    await AsyncStorage.setItem(WEIGHT_KEY(userId), JSON.stringify(logs)).catch(() => {})
    await _pushWeightLogs(userId, logs)
  })
}

// ── Morning section settings ────────────────────────────────────────────────

const MORNING_DEFAULTS = {
  hideTodo: false, hideWeight: false, hideLooks: false,
  weightGoal: null, targetWeight: null,
}

export async function getMorningSettings(userId) {
  try {
    const raw = await AsyncStorage.getItem(`@morning_settings_${userId}`)
    // Merged, so a key added in a later version reads as its default rather
    // than undefined.
    if (raw !== null) return { ...MORNING_DEFAULTS, ...JSON.parse(raw) }
  } catch {}
  return { ...MORNING_DEFAULTS }
}

// Merges into what's stored instead of replacing it. Each card's Hide button
// writes from the snapshot its render captured, so a wholesale write would
// silently resurrect a card hidden moments earlier (or by another screen)
// whose flag wasn't in that snapshot.
export async function saveMorningSettings(userId, settings) {
  const merged = { ...(await getMorningSettings(userId)), ...settings }
  await AsyncStorage.setItem(`@morning_settings_${userId}`, JSON.stringify(merged)).catch(() => {})
  return merged
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
//
// This is a read-modify-write of a cloud row, which normally must not be
// queued off a failed read. The compromise: getStreak now falls back to the
// device's last-known copy, refreshed on every successful read, so an offline
// completion still counts its day — locally at once, and on the server when
// the queued upsert replays. The mirror can in principle be stale against a
// streak another device advanced meanwhile, but it is re-stamped every time
// any screen shows the streak, and the alternative was losing the day (and
// with it the whole chain) whenever a routine finished offline.
function _updateStreak(userId, date) {
  return _serialize(`streak:${userId}`, async () => {
    const streak = await getStreak(userId)
    // Truly unknown streak — no server answer and no local copy ever: leave
    // it alone. Queuing a write derived from nothing would later replay
    // "day 1" over the real streak.
    if (!streak) return
    if (streak.lastDate === date) return
    const yd = new Date(); yd.setDate(yd.getDate() - 1)
    const yesterday = _localDate(yd)
    const current = streak.lastDate === yesterday ? streak.current + 1 : 1
    const longest = Math.max(current, streak.longest)
    // Local first, so the UI's next read agrees with what was just earned
    // even before the cloud write lands.
    await AsyncStorage.setItem(
      STREAK_KEY(userId),
      JSON.stringify({ current, longest, lastDate: date })
    ).catch(() => {})
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
