// Tests for lib/foodSearch.js — how the food search ranks USDA's generic
// foods, tidies branded names and merges products from two sources.
//
// Run with:  node tests/foodSearch.test.js
//
// Same import-free loader as runSteps.test.js: lib/foodSearch.js must stay pure.

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

const { queryTokens, rankCommonFoods, unshout, dedupeProducts, interleave } = loadPure('foodSearch.js', [
  'queryTokens', 'rankCommonFoods', 'unshout', 'dedupeProducts', 'interleave',
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

const names = list => list.map(f => f.product_name)
const foods = (...list) => list.map(product_name => ({ product_name }))

// These are the real orders USDA returned in testing, before re-ranking.

t('tokens drop short words and punctuation', () => {
  eq(queryTokens('a cup of Greek-yogurt!'), ['cup', 'greek', 'yogurt'], 'tokens')
})

t('plain chicken breast outranks lunchmeat and breaded tenders', () => {
  const ranked = rankCommonFoods('chicken breast', foods(
    'Lunchmeat, chicken breast, sliced',
    'Chicken breast tenders, breaded, uncooked',
    'Chicken breast, roll, oven-roasted',
    'Chicken, breast, boneless, skinless, raw',
    'Chicken breast, grilled, skin not eaten',
  ))
  eq(names(ranked)[0], 'Chicken breast, grilled, skin not eaten', 'as-eaten entry first')
  eq(names(ranked)[1], 'Chicken, breast, boneless, skinless, raw', 'raw breast second')
  eq(names(ranked)[4], 'Lunchmeat, chicken breast, sliced', 'lunchmeat last')
})

t('raw banana beats banana powder, and banana chips sink to the bottom', () => {
  const ranked = rankCommonFoods('banana', foods(
    'Bananas, dehydrated, or banana powder',
    'Bananas, raw',
    'Melon, banana (Navajo)',
    'Snacks, banana chips',
  ))
  eq(names(ranked)[0], 'Bananas, raw', 'raw first')
  eq(names(ranked)[1], 'Bananas, dehydrated, or banana powder', 'powder second')
  eq(names(ranked)[3], 'Snacks, banana chips', 'chips last')
})

t('a processed word the user typed is not penalised', () => {
  const ranked = rankCommonFoods('dried apricots', foods(
    'Apricots, raw',
    'Apricots, dried, sulfured, uncooked',
  ))
  eq(names(ranked)[0], 'Apricots, dried, sulfured, uncooked', 'dried first')
})

t('plain greek yogurt beats the flavoured and branded entries', () => {
  const ranked = rankCommonFoods('greek yogurt', foods(
    'Yogurt, Greek, Blueberry, CHOBANI',
    'Yogurt, Greek, strawberry, lowfat',
    'Yogurt, Greek, plain, nonfat',
  ))
  eq(names(ranked)[0], 'Yogurt, Greek, plain, nonfat', 'plain first')
})

t('cooked oatmeal beats oatmeal bread and cookies', () => {
  const ranked = rankCommonFoods('oatmeal', foods(
    'Bread, oatmeal',
    'Cookies, oatmeal, with raisins',
    'Oatmeal, cooked, regular, fat not added in cooking',
  ))
  eq(names(ranked)[0], 'Oatmeal, cooked, regular, fat not added in cooking', 'oatmeal first')
})

t('an empty query leaves the order alone', () => {
  const list = foods('B', 'A')
  eq(names(rankCommonFoods('', list)), ['B', 'A'], 'unchanged')
})

t('unshout title-cases all-caps names only', () => {
  eq(unshout('GREEK YOGURT'), 'Greek Yogurt', 'caps')
  eq(unshout("TRADER JOE'S"), "Trader Joe's", 'apostrophe')
  eq(unshout('Chobani Greek Yogurt'), 'Chobani Greek Yogurt', 'mixed case untouched')
  eq(unshout('H-E-B (ORGANIC)'), 'H-E-B (Organic)', 'hyphens and parens')
  eq(unshout(''), '', 'empty')
})

t('dedupeProducts keeps the first of a name+brand pair and drops nameless rows', () => {
  const out = dedupeProducts([
    { product_name: 'Greek Yogurt', brands: 'Chobani', source: 'USDA' },
    { product_name: 'greek yogurt ', brands: 'chobani', source: 'OFF' },
    { product_name: 'Greek Yogurt', brands: 'Fage' },
    { product_name: '', brands: 'Nobody' },
  ])
  eq(out.map(p => p.source ?? p.brands), ['USDA', 'Fage'], 'kept')
})

t('interleave alternates and tolerates uneven lists', () => {
  eq(interleave([1, 2, 3], ['a']), [1, 'a', 2, 3], 'uneven')
  eq(interleave([], ['a', 'b']), ['a', 'b'], 'one empty')
})

if (fails.length) {
  console.error(`✗ foodSearch: ${fails.length} of ${total} checks failed`)
  fails.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`✓ foodSearch: ${total} checks passed`)
