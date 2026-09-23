// Pure helpers for the food search (components/FoodSearch.js): ranking USDA's
// generic foods, tidying branded names and de-duplicating products. No
// imports on purpose: tests/foodSearch.test.js loads this file with the same
// import-free loader as runSteps.js.

const MIN_TOKEN = 3

export function queryTokens(query) {
  return String(query ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= MIN_TOKEN)
}

// Does a name segment contain the token, allowing plurals either way
// ("bananas" matches "banana", "oat" matches "oats")?
function segmentHas(segment, tok) {
  return segment.split(/[^a-z0-9]+/).some(w => w.length >= MIN_TOKEN && (w.startsWith(tok) || tok.startsWith(w)))
}

// Qualifiers that mark the plain food as eaten, and ones that mark a
// processed form of it. A word the user typed is never penalised ("dried
// apricots" wants the dried ones).
const PLAIN_WORDS = ['raw', 'cooked', 'plain', 'fresh', 'grilled', 'boiled', 'baked', 'roasted', 'steamed', 'broiled', 'regular', 'whole']
const PROCESSED_WORDS = [
  'roll', 'sliced', 'breaded', 'battered', 'powder', 'chips', 'dehydrated', 'dried', 'canned', 'lunchmeat', 'deli',
  'fried', 'nuggets', 'tenders', 'patty', 'sausage', 'bar', 'cookies', 'cookie', 'bread', 'cake', 'pie', 'mix',
  'flavored', 'sweetened', 'juice', 'sauce', 'soup', 'baby',
]

// USDA returns its own relevance order, which for a generic query puts
// lunchmeat, breaded tenders or banana chips ahead of the plain food. USDA
// names go from the food to its qualifiers ("Bananas, raw"; "Yogurt, Greek,
// plain, nonfat"), so a name scores by how much of the query sits in its
// first segments and how few extras it carries, with a nudge for plain
// preparations over processed forms. Ties go to the shorter name, then
// USDA's own order.
export function rankCommonFoods(query, foods) {
  const toks = queryTokens(query)
  if (!toks.length) return foods
  const scored = foods.map((f, i) => {
    const name = String(f.product_name ?? '')
    const segs = name.toLowerCase().split(',').map(s => s.trim()).filter(Boolean)
    const first = segs[0] ?? ''
    const firstTwo = segs.slice(0, 2).join(', ')
    const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    let score = 0
    if (toks.some(t => segmentHas(first, t))) score += 4          // the lead food is what was asked for
    if (toks.every(t => segmentHas(firstTwo, t))) score += 3      // the whole query, up front
    score += toks.filter(t => segs.some(s => segmentHas(s, t))).length
    score -= Math.max(0, first.split(/\s+/).length - toks.length) * 0.5   // "chicken breast tenders"
    score -= Math.max(0, segs.length - 2) * 0.2                            // long qualifier chains
    if (words.some(w => PLAIN_WORDS.includes(w))) score += 0.3
    if (words.some(w => PROCESSED_WORDS.includes(w) && !toks.some(t => w.startsWith(t) || t.startsWith(w)))) score -= 0.5
    return { f, i, score, len: name.length }
  })
  scored.sort((a, b) => b.score - a.score || a.len - b.len || a.i - b.i)
  return scored.map(x => x.f)
}

// Branded USDA entries arrive as "GREEK YOGURT" / "TRADER JOE'S"; only
// all-caps strings are changed, so mixed-case names keep their casing.
export function unshout(s) {
  const str = String(s ?? '')
  if (!/[A-Za-z]/.test(str) || str !== str.toUpperCase()) return str
  return str.toLowerCase().replace(/(^|[\s(\/-])([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase())
}

// The same product often comes back from both USDA Branded and Open Food
// Facts; the first occurrence (by name and brand) wins.
export function dedupeProducts(products) {
  const seen = new Set()
  const out = []
  for (const p of products) {
    const key = `${String(p.product_name ?? '').trim().toLowerCase()}|${String(p.brands ?? '').trim().toLowerCase()}`
    if (!p.product_name || seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

// Products from two sources, side by side, so neither buries the other.
export function interleave(a, b) {
  const out = []
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (i < a.length) out.push(a[i])
    if (i < b.length) out.push(b[i])
  }
  return out
}
