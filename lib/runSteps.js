// Pure helpers for turning routine template tasks into the steps of a run.
//
// This module deliberately has no imports so tests/runSteps.test.js can load it
// in plain Node without Metro, Supabase or AsyncStorage. Keep it that way: add
// anything that needs a React Native module to storage.js instead.

// Time goals were stored in minutes before they were stored in seconds, and
// both shapes still exist in saved templates.
export function taskGoalSecs(t) {
  return t?.timeGoalSecs ?? (t?.timeGoalMins ?? 0) * 60
}

// The runtime snapshot of a template task, before any progress is made.
// Every field the run screens read has to originate here — a task picture that
// this forgets to copy is gone for the whole day, because the run, not the
// template, is what the run screens render.
export function blankRunStep(t) {
  return {
    id: t.id,
    text: t.text,
    image: t.image ?? null,
    startedAt: null,
    completedAt: null,
    elapsedMs: 0,
    timeGoalSecs: taskGoalSecs(t),
    subTasks: (t.subTasks || []).map(st => ({ ...st, done: false })),
  }
}

// A task picture is a reveal, not a spoiler: it stays hidden until every task
// ahead of it has been checked off. The first task's picture is visible from
// the start, since nothing comes before it.
//
// `steps` is in routine order. Entries may be undefined — the preview list
// looks each template task up in a run that may not exist yet, and a task with
// no run step behind it counts as not done.
export function stepImageUnlocked(steps, index) {
  for (let i = 0; i < index; i++) {
    if (!steps?.[i]?.completedAt) return false
  }
  return true
}

// Same rule one level down, for the steps inside a task. These record progress
// as `done` rather than a `completedAt` timestamp, which is the only reason
// this isn't the function above.
export function subStepImageUnlocked(subTasks, index) {
  for (let i = 0; i < index; i++) {
    if (!subTasks?.[i]?.done) return false
  }
  return true
}

// "6:45", "6:45 pm", "18:45" → epoch ms of the most recent moment a clock
// showed that time, never in the future. An ambiguous 12-hour reading picks
// whichever of am/pm happened last, which is what "I started at 6:45" means —
// and it also covers routines that cross midnight ("11:50" typed at 12:10am
// is yesterday night). Returns null for anything that isn't a time.
export function parseStartTimeInput(text, now) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(?:(a|p)\.?m?\.?)?\s*$/i.exec(text || '')
  if (!m) return null
  const h = parseInt(m[1], 10)
  const min = m[2] ? parseInt(m[2], 10) : 0
  if (h > 23 || min > 59) return null
  const suffix = m[3]?.toLowerCase() ?? null
  if (suffix && (h < 1 || h > 12)) return null
  const lastOccurrence = hour => {
    const d = new Date(now)
    d.setHours(hour, min, 0, 0)
    const t = d.getTime()
    return t > now ? t - 24 * 60 * 60 * 1000 : t
  }
  if (suffix === 'a') return lastOccurrence(h % 12)
  if (suffix === 'p') return lastOccurrence((h % 12) + 12)
  if (h === 0 || h > 12) return lastOccurrence(h)
  return Math.max(lastOccurrence(h % 12), lastOccurrence((h % 12) + 12))
}

// The run after the user says the current task really began at `startedAt`.
// The routine's own start follows along so the total time and the time log
// stay truthful: the first task dictates it outright, a later task can only
// pull it earlier. A start in the future is clamped to now.
export function runWithAdjustedStart(run, startedAt, now) {
  const t = Math.min(startedAt, now)
  return {
    ...run,
    startedAt: run.currentStep === 0 ? t : Math.min(run.startedAt ?? t, t),
    steps: run.steps.map((s, i) => (i === run.currentStep ? { ...s, startedAt: t } : s)),
  }
}

// ── Skipped steps: the "do later" list ──────────────────────────────────────
// A step the user skips is marked handled for the flow (so the routine can
// move on and reach its summary) and lands on run.later, where it can be
// ticked off at any time that day, with the time it was ticked kept beside
// it. The routine counts as fully complete only once every later item is
// ticked; until then the history row stays under 100 and the streak waits.

export function laterItems(run) {
  return Array.isArray(run?.later) ? run.later : []
}

export function pendingLater(run) {
  return laterItems(run).filter(l => !l.doneAt).length
}

export function runFullyDone(run) {
  return !!run?.finished && pendingLater(run) === 0
}

// Share of the routine actually done: steps completed for real plus later
// items ticked off, out of every step. A skipped step still on the list
// counts as not done.
export function runCompletionPct(run) {
  const steps = run?.steps ?? []
  if (steps.length === 0) return 0
  const doneSteps = steps.filter(s => s.completedAt && !s.skipped).length
  const doneLater = laterItems(run).filter(l => l.doneAt).length
  return Math.round((Math.min(steps.length, doneSteps + doneLater) / steps.length) * 100)
}

// Skip step `idx`: it is stamped handled-and-skipped, joins the later list
// (once; a step skipped twice keeps its pending entry) and the run moves to
// the next unhandled step, which starts its timer if the skipped step was
// the current one. Skipping the last open step finishes the run.
export function skipRunStep(run, idx, now, elapsedMs = 0) {
  const step = run?.steps?.[idx]
  if (!step || step.completedAt) return run
  let steps = run.steps.map((s, i) => (i === idx ? { ...s, completedAt: now, elapsedMs: Math.max(0, elapsedMs), skipped: true } : s))
  const later = laterItems(run)
  const nextLater = later.some(l => l.stepId === step.id && !l.doneAt)
    ? later
    : [...later, { id: `later-${step.id}-${now}`, stepId: step.id, text: step.text, skippedAt: now, doneAt: null }]
  const allDone = steps.every(s => !!s.completedAt)
  let currentStep
  if (allDone) {
    currentStep = steps.length - 1
  } else {
    const after = steps.findIndex((s, i) => i > idx && !s.completedAt)
    currentStep = after >= 0 ? after : steps.findIndex(s => !s.completedAt)
    if (idx === run.currentStep || !steps[currentStep].startedAt) {
      steps = steps.map((s, i) => (i === currentStep ? { ...s, startedAt: now } : s))
    }
  }
  return {
    ...run,
    steps,
    later: nextLater,
    currentStep,
    ...(allDone ? { finished: true, completedAt: now } : {}),
  }
}

// Go back to step `idx` and do it now: its progress and skip mark are
// cleared, its pending later entry (if any) is dropped, and the run is open
// again at that step.
export function reopenRunStep(run, idx, now) {
  const step = run?.steps?.[idx]
  if (!step) return run
  return {
    ...withoutPendingLater(run, step.id),
    currentStep: idx,
    finished: false,
    completedAt: null,
    steps: run.steps.map((s, i) => (i === idx ? { ...s, completedAt: null, elapsedMs: 0, startedAt: now, skipped: false } : s)),
  }
}

// Tick a later item off (or untick it). The tick time is what the list shows.
export function toggleLaterItem(run, id, now) {
  const later = laterItems(run)
  if (!later.some(l => l.id === id)) return run
  return { ...run, later: later.map(l => (l.id === id ? { ...l, doneAt: l.doneAt ? null : now } : l)) }
}

// Drop a step's pending later entry (a ticked one is history and stays).
export function withoutPendingLater(run, stepId) {
  return { ...run, later: laterItems(run).filter(l => !(l.stepId === stepId && !l.doneAt)) }
}

// Boot-time guard. The two rules above are invisible in the UI when they break
// (a missing picture looks exactly like a task that has no picture), so assert
// them once on load in development rather than waiting for someone to notice.
if (typeof __DEV__ !== 'undefined' && __DEV__) {
  const probe = blankRunStep({ id: 1, text: 't', image: 'file://x.jpg', subTasks: [{ id: 2, text: 's' }] })
  if (probe.image !== 'file://x.jpg') {
    console.error('[runSteps] blankRunStep dropped the task picture — run images will not appear.')
  }
  if (stepImageUnlocked([{ completedAt: null }], 1) || !stepImageUnlocked([{ completedAt: 1 }], 1)) {
    console.error('[runSteps] stepImageUnlocked is not gating on the previous step.')
  }
}
