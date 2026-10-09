// Tests for the "do later" helpers in lib/runSteps.js — skipping a step,
// ticking it off later, and what counts as complete.
//
// Run with:  node tests/runLater.test.js
//
// Same import-free loader as runSteps.test.js: lib/runSteps.js must stay pure.

const fs = require('fs')
const path = require('path')

function loadPure(fileName, exportNames) {
  const file = path.join(__dirname, '..', 'lib', fileName)
  const src = fs.readFileSync(file, 'utf8')
  if (/^\s*import\s/m.test(src)) {
    throw new Error(`lib/${fileName} grew an import — it must stay pure, or this loader must be replaced.`)
  }
  const body = src.replace(/^export /gm, '')
  // eslint-disable-next-line no-new-func
  return new Function(`${body}\nreturn { ${exportNames.join(', ')} }`)()
}

const {
  blankRunStep, laterItems, pendingLater, runFullyDone, runCompletionPct,
  skipRunStep, reopenRunStep, toggleLaterItem, withoutPendingLater,
  nextOpenStep, advanceRunStep, finishRun, checklistTaskMs, timedRunFrom,
} = loadPure('runSteps.js', [
  'blankRunStep', 'laterItems', 'pendingLater', 'runFullyDone', 'runCompletionPct',
  'skipRunStep', 'reopenRunStep', 'toggleLaterItem', 'withoutPendingLater',
  'nextOpenStep', 'advanceRunStep', 'finishRun', 'checklistTaskMs', 'timedRunFrom',
])

let total = 0
const fails = []
const t = (name, fn) => {
  total++
  try { fn() } catch (err) { fails.push(`${name}: ${err.message}`) }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg) }
const eq = (actual, expected, msg) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${msg} — expected ${e}, got ${a}`)
}

const T0 = 1_700_000_000_000
function freshRun() {
  const steps = [
    { id: 'a', text: 'Stretch' }, { id: 'b', text: 'Shower' }, { id: 'c', text: 'Breakfast' },
  ].map(blankRunStep)
  steps[0].startedAt = T0
  return { date: '2026-09-23', startedAt: T0, completedAt: null, currentStep: 0, steps, finished: false }
}

// ── Reading the list ────────────────────────────────────────────────────────

t('a run without a list has nothing pending and is not fully done', () => {
  const run = freshRun()
  eq(laterItems(run), [], 'empty list')
  eq(pendingLater(run), 0, 'none pending')
  eq(runFullyDone(run), false, 'not finished')
  eq(runFullyDone(null), false, 'null run')
})

// ── Skipping ────────────────────────────────────────────────────────────────

t('skipping the current step marks it, lists it and starts the next step', () => {
  const run = skipRunStep(freshRun(), 0, T0 + 5000, 5000)
  eq(run.steps[0].skipped, true, 'skipped flag')
  eq(run.steps[0].completedAt, T0 + 5000, 'handled at skip time')
  eq(run.steps[0].elapsedMs, 5000, 'elapsed kept')
  eq(run.currentStep, 1, 'moved on')
  eq(run.steps[1].startedAt, T0 + 5000, 'next step timer started')
  eq(run.finished, false, 'still running')
  eq(laterItems(run).length, 1, 'one later item')
  eq(laterItems(run)[0].stepId, 'a', 'for the skipped step')
  eq(laterItems(run)[0].text, 'Stretch', 'with its text')
  eq(laterItems(run)[0].skippedAt, T0 + 5000, 'skip time kept')
  eq(laterItems(run)[0].doneAt, null, 'not done yet')
  eq(pendingLater(run), 1, 'pending')
})
t('skipping a step out of order (checklist) leaves the current step alone', () => {
  const run = skipRunStep(freshRun(), 2, T0 + 1000)
  eq(run.currentStep, 0, 'still on the first step')
  eq(run.steps[2].skipped, true, 'third step skipped')
  eq(run.finished, false, 'not finished')
})
t('skipping the last open step finishes the run but not fully', () => {
  let run = freshRun()
  run = skipRunStep(run, 0, T0 + 1)
  run = skipRunStep(run, 1, T0 + 2)
  run = skipRunStep(run, 2, T0 + 3)
  eq(run.finished, true, 'finished')
  eq(run.completedAt, T0 + 3, 'completed at last skip')
  eq(run.currentStep, 2, 'rests on the last step')
  eq(pendingLater(run), 3, 'three to do later')
  eq(runFullyDone(run), false, 'not fully done')
  eq(runCompletionPct(run), 0, 'nothing really done')
})
t('a handled step cannot be skipped and a repeat skip does not duplicate', () => {
  let run = skipRunStep(freshRun(), 0, T0 + 1)
  const again = skipRunStep(run, 0, T0 + 2)
  eq(again, run, 'unchanged')
  run = reopenRunStep(run, 0, T0 + 3)
  run = skipRunStep(run, 0, T0 + 4)
  eq(laterItems(run).length, 1, 'still one entry after reopen + skip')
})

// ── Reopening ───────────────────────────────────────────────────────────────

t('reopening a skipped step clears it and drops its pending entry', () => {
  let run = skipRunStep(freshRun(), 0, T0 + 1)
  run = reopenRunStep(run, 0, T0 + 9)
  eq(run.currentStep, 0, 'back on it')
  eq(run.steps[0].skipped, false, 'no longer skipped')
  eq(run.steps[0].completedAt, null, 'open again')
  eq(run.steps[0].startedAt, T0 + 9, 'timer restarted')
  eq(laterItems(run), [], 'list emptied')
})
t('reopening keeps a later entry that was already ticked', () => {
  let run = skipRunStep(freshRun(), 0, T0 + 1)
  run = toggleLaterItem(run, laterItems(run)[0].id, T0 + 2)
  run = reopenRunStep(run, 0, T0 + 3)
  eq(laterItems(run).length, 1, 'ticked entry stays as history')
  eq(withoutPendingLater(run, 'a').later.length, 1, 'withoutPendingLater also leaves it')
})

// ── Ticking off ─────────────────────────────────────────────────────────────

t('ticking a later item stamps the time; ticking again clears it', () => {
  let run = skipRunStep(freshRun(), 0, T0 + 1)
  const id = laterItems(run)[0].id
  run = toggleLaterItem(run, id, T0 + 50)
  eq(laterItems(run)[0].doneAt, T0 + 50, 'done time')
  eq(pendingLater(run), 0, 'nothing pending')
  run = toggleLaterItem(run, id, T0 + 60)
  eq(laterItems(run)[0].doneAt, null, 'unticked')
  eq(toggleLaterItem(run, 'nope', T0), run, 'unknown id is a no-op')
})
t('the routine is fully done only when the list is cleared', () => {
  let run = freshRun()
  run = { ...run, steps: run.steps.map((s, i) => (i < 2 ? { ...s, completedAt: T0 + i } : s)), currentStep: 2 }
  run = skipRunStep(run, 2, T0 + 5)
  eq(run.finished, true, 'finished')
  eq(runFullyDone(run), false, 'one to do later')
  eq(runCompletionPct(run), 67, 'two of three done')
  run = toggleLaterItem(run, laterItems(run)[0].id, T0 + 99)
  eq(runFullyDone(run), true, 'fully done once ticked')
  eq(runCompletionPct(run), 100, 'all counted')
})

// ── Skipping out of order ───────────────────────────────────────────────────

t('skipping a middle task out of order never passes the open tasks before it', () => {
  // This used to land on the task after the skipped one, leaving the tasks
  // before it behind as if done — the summary then showed them ticked, "0s".
  const run0 = freshRun()
  const four = { ...run0, steps: [...run0.steps, blankRunStep({ id: 'd', text: 'Journal' })] }
  const run = skipRunStep(four, 2, T0 + 1000)
  eq(run.currentStep, 0, 'still on the first open task')
  eq(nextOpenStep(run.steps, 0), 1, 'the second task is next, not the fourth')
})
t('skipping the task in hand moves on to the next task still open', () => {
  let run = advanceRunStep(freshRun(), T0 + 1000, 1000)
  run = skipRunStep(run, 1, T0 + 2000, 1000)
  eq(run.currentStep, 2, 'on to the third task')
  eq(run.steps[2].startedAt, T0 + 2000, 'its timer started')
})
t('a finished run with a task never done is not fully done', () => {
  const run = freshRun()
  const finished = {
    ...run, finished: true, completedAt: T0 + 9,
    steps: run.steps.map((s, i) => (i === 1 ? s : { ...s, completedAt: T0 + i })),
  }
  eq(runFullyDone(finished), false, 'an open task keeps it short of done')
  eq(runCompletionPct(finished), 67, 'two of three')
})

// ── Moving on and going back ────────────────────────────────────────────────

t('Done moves on to the next open task and never re-stamps a finished one', () => {
  let run = advanceRunStep(freshRun(), T0 + 60000, 60000)   // Stretch, 1m
  run = advanceRunStep(run, T0 + 180000, 120000)            // Shower, 2m
  run = reopenRunStep(run, 0, T0 + 200000)                  // back to Stretch
  eq(run.currentStep, 0, 'back on the first task')
  run = advanceRunStep(run, T0 + 230000, 90000)
  eq(run.currentStep, 2, 'straight on to the third, past the second')
  eq(run.steps[1].completedAt, T0 + 180000, 'the second keeps its completion')
  eq(run.steps[1].elapsedMs, 120000, 'and its time')
  eq(run.steps[0].elapsedMs, 90000, 'the first has its old time plus the new')
})
t('going back keeps the recorded time and the timer carries on from it', () => {
  let run = advanceRunStep(freshRun(), T0 + 60000, 60000)
  run = reopenRunStep(run, 0, T0 + 100000)
  eq(run.steps[0].completedAt, null, 'open again')
  eq(run.steps[0].elapsedMs, 60000, 'recorded time kept')
  eq(run.steps[0].startedAt, T0 + 40000, 'timer resumes at 1:00')
})
t('the task being left keeps the time it has run, and resumes from it', () => {
  let run = advanceRunStep(freshRun(), T0 + 60000, 60000)   // second task starts
  run = reopenRunStep(run, 0, T0 + 90000)                   // left after 30s
  eq(run.steps[1].elapsedMs, 30000, 'paused at 0:30')
  run = advanceRunStep(run, T0 + 100000, 70000)
  eq(run.currentStep, 1, 'back to the second task')
  eq(run.steps[1].startedAt, T0 + 70000, 'carrying on from 0:30')
})
t('going back to the task in hand changes nothing', () => {
  const run = advanceRunStep(freshRun(), T0 + 60000, 60000)
  eq(reopenRunStep(run, 1, T0 + 90000), run, 'same run, timer untouched')
})
t('with nothing else open, Done stays put and Finish never re-stamps', () => {
  let run = freshRun()
  run = { ...run, steps: run.steps.map((s, i) => (i > 0 ? { ...s, completedAt: T0 + i, elapsedMs: 5 } : s)) }
  run = advanceRunStep(run, T0 + 50, 50)
  eq(run.currentStep, 0, 'stays on the last open task')
  eq(run.steps[0].completedAt, T0 + 50, 'which is now done')
  run = finishRun(run, T0 + 99, 999)
  eq(run.finished, true, 'finished')
  eq(run.steps[0].completedAt, T0 + 50, 'not re-stamped')
  eq(run.steps[0].elapsedMs, 50, 'time kept')
  eq(runFullyDone(run), true, 'every task done')
})

// ── Checklist task times ────────────────────────────────────────────────────

t('a checklist tick is timed from the tick before it', () => {
  const run = freshRun()
  eq(checklistTaskMs(run, T0 + 30000), 30000, 'first task: since the routine started')
  const ticked = { ...run, steps: run.steps.map((s, i) => (i === 0 ? { ...s, completedAt: T0 + 30000 } : s)) }
  eq(checklistTaskMs(ticked, T0 + 50000), 20000, 'next task: since the previous tick')
})

// ── Starting the timer after quick ticks ────────────────────────────────────

t('starting the timer keeps what was ticked and starts on the first open task', () => {
  const tasks = [{ id: 'a', text: 'Stretch' }, { id: 'b', text: 'Shower' }, { id: 'c', text: 'Breakfast' }]
  const quick = {
    quick: true, finished: false,
    steps: tasks.map(blankRunStep).map((s, i) => (i === 0 ? { ...s, completedAt: T0 - 5000 } : s)),
  }
  const run = timedRunFrom(tasks, quick, T0, '2026-09-23')
  assert(!run.quick, 'a timed run')
  eq(run.steps[0].completedAt, T0 - 5000, 'tick kept at its time')
  eq(run.currentStep, 1, 'starts on the first unticked task')
  eq(run.steps[1].startedAt, T0, 'whose timer starts now')
  eq(run.startedAt, T0, 'routine timer starts now')
  eq(run.finished, false, 'not finished')
})
t('starting with nothing ticked is a plain start', () => {
  const tasks = [{ id: 'a', text: 'Stretch' }, { id: 'b', text: 'Shower' }]
  const run = timedRunFrom(tasks, null, T0, '2026-09-23')
  eq(run.currentStep, 0, 'first task')
  eq(run.steps[0].startedAt, T0, 'timer running')
  eq(run.steps.every(s => !s.completedAt), true, 'nothing done')
})

// ── Report ───────────────────────────────────────────────────────────────────

if (fails.length) {
  console.error(`✗ runLater: ${fails.length} of ${total} checks failed`)
  fails.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`✓ runLater: ${total} checks passed`)
