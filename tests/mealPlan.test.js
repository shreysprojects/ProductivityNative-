// Tests for lib/mealPlan.js — the weekday a date falls on, the shape of the
// weekly plan, and the expansion of the AI planner's reply into it.
//
// Run with:  node tests/mealPlan.test.js
//
// Same import-free loader as runSteps.test.js: lib/mealPlan.js must stay pure.

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
  PLAN_DAYS, DAY_NAMES, PLAN_SECTIONS, dayKeyOf,
  emptyDays, normalizeDays, planMealCount, sumPlanMacros,
  expandAiPlan, compactPlan,
} = loadPure('mealPlan.js', [
  'PLAN_DAYS', 'DAY_NAMES', 'PLAN_SECTIONS', 'dayKeyOf',
  'emptyDays', 'normalizeDays', 'planMealCount', 'sumPlanMacros',
  'expandAiPlan', 'compactPlan',
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

// ── Weekdays ────────────────────────────────────────────────────────────────

t('day keys follow Date#getDay, Monday first', () => {
  eq(dayKeyOf('2026-09-07'), 'Mon', 'Mon')
  eq(dayKeyOf('2026-09-12'), 'Sat', 'Sat')
  eq(dayKeyOf('2026-09-13'), 'Sun', 'Sun')
})
t('a day key survives a year end', () => {
  eq(dayKeyOf('2027-01-01'), 'Fri', 'New Year 2027 is a Friday')
})
t('every day key has a full name', () => {
  eq(PLAN_DAYS.map(d => DAY_NAMES[d]), ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], 'names')
})

// ── Stored shape ─────────────────────────────────────────────────────────────

t('an empty week has every day and nothing in it', () => {
  const d = emptyDays()
  eq(Object.keys(d), PLAN_DAYS, 'keys')
  eq(planMealCount(d), 0, 'count')
})
t('normalizeDays fills missing days and drops junk', () => {
  const d = normalizeDays({ Mon: [{ id: 'a', name: 'x' }, null, { name: 'no id' }], Funday: [{ id: 'z' }] })
  eq(d.Mon.length, 1, 'only the real meal stays')
  eq(d.Tue, [], 'missing day filled')
  assert(!('Funday' in d), 'unknown day dropped')
})
t('normalizeDays tolerates a missing blob', () => {
  eq(planMealCount(normalizeDays(null)), 0, 'null')
  eq(planMealCount(normalizeDays(undefined)), 0, 'undefined')
})
t('sumPlanMacros adds numeric values and ignores junk', () => {
  const totals = sumPlanMacros([
    { macros: { calories: 400, protein: 30.5 } },
    { macros: { calories: 600, protein: 'lots', fiber: 8 } },
  ])
  eq(totals, { calories: 1000, protein: 30.5, fiber: 8 }, 'totals')
})

// ── The planner's reply ─────────────────────────────────────────────────────

const REPLY = {
  summary: 'A vegetarian week built around yogurt, rice and beans.',
  meals: [
    { id: 'm1', section: 'breakfast', name: 'Greek yogurt bowl', contents: '200 g Greek yogurt, 40 g granola, 1 banana', prepMinutes: 5, prepNote: '', macros: { calories: 420, protein: 24.26, carbs: 60, fat: 9 } },
    { id: 'm2', section: 'lunch', name: 'Rice and beans', contents: '1 cup rice, 1 cup black beans', prepMinutes: 25, prepNote: 'Batch cook Sunday, keeps 4 days', macros: { calories: 610, protein: 22, carbs: 110, fat: 6 } },
    { id: 'm3', section: 'dinner', name: 'Paneer stir fry', contents: '150 g paneer, veg, 1 tsp oil', prepMinutes: 20, prepNote: '', macros: { calories: 560, protein: 34, carbs: 30, fat: 32, vitaminB12: 1.2 } },
    { id: 'm4', section: 'snack', name: 'Apple and peanut butter', contents: '1 apple, 2 tbsp peanut butter', prepMinutes: 2, prepNote: '', macros: { calories: 280, protein: 8, carbs: 30, fat: 16 } },
    { id: 'bad', section: 'brunchtime', name: 'Unknown section', macros: {} },
    { id: '', section: 'lunch', name: 'No id', macros: {} },
  ],
  days: [
    { day: 'Mon', mealIds: ['m3', 'm1', 'm2', 'm4'] },   // out of section order on purpose
    { day: 'Tuesday', mealIds: ['m1', 'm2', 'm3', 'ghost'] },
    { day: 'Funday', mealIds: ['m1'] },
    { day: 'Sun', mealIds: ['m1', 'm1'] },
  ],
  prepPlan: ['Sunday: cook 3 cups dry rice', '', 'Sunday: soak and cook beans'],
  nutritionNotes: ['Vitamin B12 comes mostly from the dairy; consider a supplement and speak to a doctor or dietitian.'],
  grocery: [{ item: 'Greek yogurt', amount: '1 kg' }, { item: '', amount: '2' }],
}

t('expandAiPlan maps section aliases and drops meals it cannot place', () => {
  const week = expandAiPlan(REPLY, () => 'id')
  eq(week.days.Mon.map(m => m.section), ['morning', 'lunch', 'dinner', 'snacks'], 'sorted by section')
  eq(week.days.Mon[0].name, 'Greek yogurt bowl', 'breakfast became morning')
  eq(week.days.Mon[3].section, 'snacks', 'snack became snacks')
})
t('expandAiPlan ignores unknown meal ids and unknown days', () => {
  const week = expandAiPlan(REPLY, () => 'id')
  eq(week.days.Tue.length, 3, 'ghost id dropped')
  eq(week.days.Wed, [], 'unlisted day empty')
  eq(planMealCount(week.days), 4 + 3 + 2, 'total placements')
})
t('expandAiPlan accepts full weekday names', () => {
  const week = expandAiPlan(REPLY, () => 'id')
  eq(week.days.Tue.map(m => m.name), ['Greek yogurt bowl', 'Rice and beans', 'Paneer stir fry'], 'Tuesday')
})
t('every placement is its own copy with a fresh id', () => {
  let n = 0
  const week = expandAiPlan(REPLY, () => `p${++n}`)
  const ids = PLAN_DAYS.flatMap(d => week.days[d].map(m => m.id))
  eq(new Set(ids).size, ids.length, 'ids unique')
  assert(week.days.Sun[0] !== week.days.Sun[1], 'repeats are separate objects')
  eq(week.days.Sun[0].name, week.days.Sun[1].name, 'but the same meal')
})
t('expandAiPlan rounds macros and marks meals as AI', () => {
  const week = expandAiPlan(REPLY, () => 'id')
  eq(week.days.Mon[0].macros.protein, 24.3, 'one decimal')
  eq(week.days.Mon[0].macros.calories, 420, 'whole kcal')
  eq(week.days.Mon[0].source, 'ai', 'source')
  eq(week.days.Mon[2].macros.vitaminB12, 1.2, 'micros kept')
})
t('expandAiPlan keeps the notes and drops empty entries', () => {
  const { notes } = expandAiPlan(REPLY, () => 'id')
  eq(notes.summary, REPLY.summary, 'summary')
  eq(notes.prep.length, 2, 'blank prep step dropped')
  eq(notes.nutrition.length, 1, 'nutrition')
  eq(notes.grocery, [{ item: 'Greek yogurt', amount: '1 kg' }], 'blank grocery item dropped')
  assert(typeof notes.generatedAt === 'string', 'stamped')
})
t('expandAiPlan survives a reply with nothing usable', () => {
  const week = expandAiPlan({ meals: 'nope', days: null })
  eq(planMealCount(week.days), 0, 'empty')
  eq(week.notes.prep, [], 'no prep')
})

// ── Round trip for revisions ─────────────────────────────────────────────────

t('compactPlan describes each distinct meal once and references it per day', () => {
  const week = expandAiPlan(REPLY, () => 'id')
  const compact = compactPlan(week)
  eq(compact.meals.length, 4, 'four distinct meals')
  eq(compact.days.length, 7, 'seven days')
  eq(compact.days[0].day, 'Mon', 'Monday first')
  eq(compact.days[0].mealIds.length, 4, 'Monday has four')
  eq(compact.days[6].mealIds, [compact.days[6].mealIds[0], compact.days[6].mealIds[0]], 'Sunday repeats one id')
  eq(compact.days[2].mealIds, [], 'Wednesday empty')
  eq(compact.nutritionNotes, REPLY.nutritionNotes, 'notes carried')
})
t('compactPlan then expandAiPlan reproduces the week', () => {
  const week = expandAiPlan(REPLY, () => 'id')
  const again = expandAiPlan(compactPlan(week), () => 'id')
  const names = w => PLAN_DAYS.map(d => w.days[d].map(m => m.name))
  eq(names(again), names(week), 'same meals on the same days')
})
t('the section order constant matches the sections the Meals page shows', () => {
  eq(PLAN_SECTIONS, ['morning', 'lunch', 'dinner', 'snacks'], 'sections')
})

// ── Report ───────────────────────────────────────────────────────────────────

if (fails.length) {
  console.error(`✗ mealPlan: ${fails.length} of ${total} checks failed`)
  fails.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`✓ mealPlan: ${total} checks passed`)
