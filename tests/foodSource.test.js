// Tests for lib/foodSource.js — which foods count as AI estimates, including
// entries saved before the source flag existed.
//
// Run with:  node tests/foodSource.test.js
//
// Same import-free loader as mealPlan.test.js: lib/foodSource.js must stay pure.

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

const { isAiFood, derivedSource } = loadPure('foodSource.js', ['isAiFood', 'derivedSource'])

let total = 0
const fails = []
const t = (name, fn) => {
  total++
  try { fn() } catch (err) { fails.push(`${name}: ${err.message}`) }
}
const eq = (actual, expected, msg) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${msg} — expected ${e}, got ${a}`)
}

// ── The flag itself ─────────────────────────────────────────────────────────

t('source ai is an AI food', () => {
  eq(isAiFood({ name: 'Oats', source: 'ai' }), true, 'flagged')
})
t('a plain user entry is not', () => {
  eq(isAiFood({ name: 'Oats', source: 'user', contents: '1 cup' }), false, 'user')
  eq(isAiFood({ name: 'Oats' }), false, 'no source, no traces')
})
t('junk input is not', () => {
  eq(isAiFood(null), false, 'null')
  eq(isAiFood(undefined), false, 'undefined')
  eq(isAiFood('Oats'), false, 'string')
})

// ── Older entries, saved before the flag ────────────────────────────────────

t('an estimate id marks an old entry', () => {
  eq(isAiFood({ name: 'Bowl', aiEstimateId: 'abc' }), true, 'id')
  eq(isAiFood({ name: 'Bowl', aiEstimateId: null }), false, 'null id')
})
t('the estimator note in the contents marks an old entry', () => {
  eq(isAiFood({ name: 'Bowl', contents: '1 cup (170 g) · rice and beans · AI estimate' }), true, 'contents')
  eq(isAiFood({ name: 'Bowl', contents: 'rice and beans · ai estimate' }), true, 'case-insensitive')
  eq(isAiFood({ name: 'Bowl', contents: 'my AI estimated guess' }), false, 'different phrase')
})
t('a saved-meal ingredient keeps the note as info', () => {
  eq(isAiFood({ name: 'Rice', info: '1 cup · AI estimate' }), true, 'info')
})
t('the old Plan-tab user stamp does not veto the traces', () => {
  eq(isAiFood({ name: 'Bowl', source: 'user', aiEstimateId: 'abc' }), true, 'user + id')
  eq(isAiFood({ name: 'Bowl', source: 'user', contents: 'x · AI estimate' }), true, 'user + note')
})

// ── Saved-meal templates ────────────────────────────────────────────────────

t('a template counts when any ingredient does', () => {
  const tmpl = { name: 'Lunch', ingredients: [{ name: 'Bread' }, { name: 'Soup', info: 'bowl · AI estimate' }] }
  eq(isAiFood(tmpl), true, 'one AI ingredient')
  eq(isAiFood({ name: 'Lunch', ingredients: [{ name: 'Bread' }] }), false, 'none')
  eq(isAiFood({ name: 'Lunch', ingredients: [] }), false, 'empty')
})

// ── The source stamped on a copy ────────────────────────────────────────────

t('derivedSource keeps ai and derives it from traces', () => {
  eq(derivedSource({ source: 'ai' }), 'ai', 'kept')
  eq(derivedSource({ aiEstimateId: 'abc' }), 'ai', 'from id')
  eq(derivedSource({ contents: 'x · AI estimate', source: 'user' }), 'ai', 'traces beat the user stamp')
})
t('derivedSource passes other sources through', () => {
  eq(derivedSource({ source: 'user' }), 'user', 'user')
  eq(derivedSource({ name: 'Oats' }), null, 'none')
  eq(derivedSource(null), null, 'null item')
})

// ── Report ───────────────────────────────────────────────────────────────────

if (fails.length) {
  console.error(`✗ foodSource: ${fails.length} of ${total} checks failed`)
  fails.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`✓ foodSource: ${total} checks passed`)
