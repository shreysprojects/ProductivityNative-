import { supabase } from './supabase'

// The "Ask AI" food estimator. Both calls go through the openai-proxy edge
// function, which also records every estimate server-side so estimated foods
// can be curated into a real food list later without re-running the model.

const FRIENDLY = {
  inappropriate: 'That request could not be processed.',
  flagged: 'That text or photo could not be processed.',
  image_too_large: 'That photo is too large. Please try a smaller one.',
  missing_query: 'Type the food you want to log first.',
  internal_error: 'Something went wrong on our side. Please try again.',
}

async function invoke(body) {
  const { data, error } = await supabase.functions.invoke('openai-proxy', { body })
  if (error) {
    // Non-2xx replies carry the proxy's own wording in the body.
    let detail = null
    try { detail = await error.context?.json() } catch {}
    const code = detail?.error
    throw new Error(detail?.reason ?? FRIENDLY[code] ?? detail?.message ?? code ?? error.message ?? 'Request failed')
  }
  if (data?.error) throw new Error(data.reason ?? FRIENDLY[data.error] ?? data.error)
  return data
}

// Ask what else is needed before estimating. Resolves to { questions: [{ id, text, hint }] };
// an empty list means the description already pins down type and amount.
export function clarifyFood(query) {
  return invoke({ action: 'food_clarify', query })
}

// Estimate every tracked nutrient for the portion described. `answers` is
// [{ q, a }]; `base64` is an optional JPEG of the food.
// Resolves to { estimateId, name, portion, contents, confidence, notes, macros }.
export function estimateFood({ query, answers, base64 }) {
  return invoke({
    action: 'food_estimate',
    query,
    answers: answers ?? [],
    ...(base64 ? { base64 } : {}),
  })
}
