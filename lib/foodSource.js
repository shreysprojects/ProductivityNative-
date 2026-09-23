// Where a food's numbers came from. Pure: no imports, so tests can load it.

// Whether a food, meal, snack or saved-meal template is an AI estimate.
// Entries made after 2026-09-19 carry `source: 'ai'`. Older ones were saved
// without it, so two traces the estimator always left stand in: the estimate
// id on the entry, and the "AI estimate" note it appends to the contents
// line (kept as `info` on a saved-meal ingredient). A template counts when
// any of its ingredients does, since its totals are then partly estimated.
// `source: 'user'` does not veto: the Plan tab used to stamp that on every
// add, AI estimates included.
export function isAiFood(item) {
  if (!item || typeof item !== 'object') return false
  if (item.source === 'ai') return true
  if (item.aiEstimateId) return true
  const text = String(item.contents ?? item.info ?? '')
  if (/\bAI estimate\b/i.test(text)) return true
  return Array.isArray(item.ingredients) && item.ingredients.some(isAiFood)
}

// The source to stamp on a copy of `item` (a log entry made from a saved
// meal, say): the flag it has, or 'ai' when the traces say so.
export function derivedSource(item) {
  if (item?.source === 'ai') return 'ai'
  return isAiFood(item) ? 'ai' : (item?.source ?? null)
}
