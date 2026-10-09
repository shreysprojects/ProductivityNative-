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
} = loadPure('runSteps.js', [
  'blankRunStep', 'laterItems', 'pendingLater', 'runFullyDone', 'runCompletionPct',
  'skipRunStep', 'reopenRunStep', 'toggleLaterItem', 'withoutPendingLater',
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

// ── Report ───────────────────────────────────────────────────────────────────

if (fails.length) {
  console.error(`✗ runLater: ${fails.length} of ${total} checks failed`)
  fails.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`✓ runLater: ${total} checks passed`)
