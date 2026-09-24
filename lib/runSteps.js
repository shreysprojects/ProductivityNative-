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
  // Yesterday is one calendar day back, not 24 hours: on a daylight-saving
  // day those differ by an hour.
  const lastOccurrence = hour => {
    const d = new Date(now)
    d.setHours(hour, min, 0, 0)
    if (d.getTime() > now) {
      d.setDate(d.getDate() - 1)
      d.setHours(hour, min, 0, 0)
    }
    return d.getTime()
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

// Finished is not enough on its own: a run finished with a task never done
// (older versions could get there by skipping around) still isn't complete.
export function runFullyDone(run) {
  return !!run?.finished && (run.steps ?? []).every(s => !!s.completedAt) && pendingLater(run) === 0
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

// Where the run goes after step `from`: the next task still open, wrapping
// around to an earlier one left open. -1 when every task is handled. Tasks
// already done are never landed on, so they are never re-stamped.
export function nextOpenStep(steps, from) {
  const list = steps ?? []
  const after = list.findIndex((s, i) => i > from && !s.completedAt)
  return after >= 0 ? after : list.findIndex(s => !s.completedAt)
}

// Start step `i`'s timer now, carrying on from any time it already has (a
// task gone back to picks up where it stopped instead of restarting at 0:00).
function startStepTimer(steps, i, now) {
  return steps.map((s, k) => (k === i ? { ...s, startedAt: now - (s.elapsedMs || 0) } : s))
}

// Skip step `idx`: it is stamped handled-and-skipped, joins the later list
// (once; a step skipped twice keeps its pending entry) and the run moves on.
// Skipping the task in hand goes to the next task still open and starts its
// timer; skipping one out of order (checklist) leaves the run on the first
// task still open, so it never jumps past earlier tasks nobody has done.
// Skipping the last open step finishes the run.
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
  } else if (idx === run.currentStep) {
    currentStep = nextOpenStep(steps, idx)
    steps = startStepTimer(steps, currentStep, now)
  } else {
    currentStep = steps.findIndex(s => !s.completedAt)
    if (!steps[currentStep].startedAt) steps = startStepTimer(steps, currentStep, now)
  }
  return {
    ...run,
    steps,
    later: nextLater,
    currentStep,
    ...(allDone ? { finished: true, completedAt: now } : {}),
  }
}

// Done on the task in hand: it is stamped with its time and the run moves on
// to the next task still open, starting its timer. A task that is already
// done keeps its record. With nothing left open the run stays where it is and
// the Finish button takes it from there.
export function advanceRunStep(run, now, elapsedMs = 0) {
  const idx = run?.currentStep
  if (!run?.steps?.[idx]) return run
  let steps = run.steps.map((s, i) =>
    (i === idx && !s.completedAt ? { ...s, completedAt: now, elapsedMs: Math.max(0, elapsedMs) } : s))
  const next = nextOpenStep(steps, idx)
  if (next < 0) return { ...run, steps }
  steps = startStepTimer(steps, next, now)
  return { ...run, steps, currentStep: next }
}

// Finish the run. The task in hand is stamped only if it is still open.
export function finishRun(run, now, elapsedMs = 0) {
  if (!run?.steps) return run
  return {
    ...run,
    finished: true,
    completedAt: now,
    steps: run.steps.map((s, i) =>
      (i === run.currentStep && !s.completedAt ? { ...s, completedAt: now, elapsedMs: Math.max(0, elapsedMs) } : s)),
  }
}

// Go back to step `idx` and do it now: it is open again, its skip mark is
// cleared, its pending later entry (if any) is dropped, and the run is open
// again at that step. Time already recorded for it is kept and its timer
// carries on from there; the task being left keeps the time it has run so
// far, for when the run comes back to it. Going back to the task already in
// hand changes nothing.
export function reopenRunStep(run, idx, now) {
  const step = run?.steps?.[idx]
  if (!step) return run
  if (idx === run.currentStep && !step.completedAt) return run
  return {
    ...withoutPendingLater(run, step.id),
    currentStep: idx,
    finished: false,
    completedAt: null,
    steps: run.steps.map((s, i) => {
      if (i === idx) return { ...s, completedAt: null, startedAt: now - (s.elapsedMs || 0), skipped: false }
      if (i === run.currentStep && !s.completedAt && s.startedAt) return { ...s, elapsedMs: Math.max(0, now - s.startedAt) }
      return s
    }),
  }
}

// How long a task took when ticked off in checklist mode: the time since the
// task ticked before it (or since the routine started, for the first), not
// the time since the routine started.
export function checklistTaskMs(run, now) {
  let from = run?.startedAt ?? now
  for (const s of run?.steps ?? []) {
    if (s.completedAt && s.completedAt > from && s.completedAt <= now) from = s.completedAt
  }
  return Math.max(0, now - from)
}

// Start the timer on a routine partly ticked off without it: those ticks
// carry over as they are (done at the time they were ticked) and the run
// starts on the first task still open. With no ticks it is a plain start.
export function timedRunFrom(tasks, quickRun, now, date) {
  const ticked = new Map((quickRun?.steps ?? []).filter(s => s.completedAt).map(s => [s.id, s.completedAt]))
  let steps = (tasks ?? []).map(t => {
    const step = blankRunStep(t)
    return ticked.has(t.id) ? { ...step, completedAt: ticked.get(t.id) } : step
  })
  const first = steps.findIndex(s => !s.completedAt)
  if (first >= 0) steps = startStepTimer(steps, first, now)
  return {
    date,
    startedAt: now,
    completedAt: null,
    currentStep: first >= 0 ? first : Math.max(0, steps.length - 1),
    steps,
    finished: false,
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
