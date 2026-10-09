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

// Failures with no reply to read: the request never got through, it ran
// past its time limit, or the reply was cut off part way (the meal planner
// streams keep-alive spaces before its week, so a dropped connection leaves
// only those, which used to surface as a raw "JSON Parse error").
const NO_CONNECTION = 'Could not reach the AI. Check your connection and try again.'
const TIMED_OUT = 'The AI took too long to answer. Please try again.'
const CUT_OFF = 'The answer was cut off. Please try again.'

// Long enough for a photo estimate; the meal planner passes its own.
const DEFAULT_TIMEOUT_MS = 90000

// Cancelled on purpose: the caller has moved on and ignores the result.
function cancelled() {
  const e = new Error('Cancelled')
  e.name = 'AbortError'
  return e
}

// Shared by every AI helper that talks to the proxy. `signal` cancels the
// request (the screen that asked has closed); `timeout` gives up on one
// that never answers.
export async function invokeProxy(body, { signal, timeout = DEFAULT_TIMEOUT_MS } = {}) {
  // Checked up front too: with a timeout set, the client does not notice a
  // signal that was already aborted and would send the request anyway.
  if (signal?.aborted) throw cancelled()
  const { data, error } = await supabase.functions.invoke('openai-proxy', { body, signal, timeout })
  if (error) {
    if (signal?.aborted) throw cancelled()
    if (error.name !== 'FunctionsHttpError' && error.name !== 'FunctionsRelayError') {
      throw new Error(error.context?.name === 'AbortError' ? TIMED_OUT
        : error.name === 'FunctionsFetchError' ? NO_CONNECTION : CUT_OFF)
    }
    // Non-2xx replies carry the proxy's own wording in the body.
    let detail = null
    try { detail = await error.context?.json() } catch {}
    const code = detail?.error
    throw new Error(detail?.reason ?? FRIENDLY[code] ?? detail?.message ?? code ?? error.message ?? 'Request failed')
  }
  if (data?.error) throw new Error(data.reason ?? FRIENDLY[data.error] ?? data.error)
  return data
}

// `details` is optional and comes from the "Describe to AI" meal logger:
// { ingredients, servings, notes }, each a free-text string. Empty fields are
// left out so a plain food search query goes over exactly as before.
function detailFields(details) {
  const out = {}
  for (const k of ['ingredients', 'servings', 'notes']) {
    const v = String(details?.[k] ?? '').trim()
    if (v) out[k] = v
  }
  return out
}

// Ask what else is needed before estimating. Resolves to { questions: [{ id, text, hint }] };
// an empty list means the description already pins down type and amount.
export function clarifyFood(query, details) {
  return invokeProxy({ action: 'food_clarify', query, ...detailFields(details) })
}

// Read a photo of a meal: what it is, what is on the plate and the portion
// seen, plus only the questions the photo cannot answer. Resolves to
// { name, contents, portion, confidence, questions: [{ id, text, hint }] }.
export function scanFood({ base64, note }) {
  const n = String(note ?? '').trim()
  return invokeProxy({ action: 'food_scan', base64, ...(n ? { note: n } : {}) })
}

// Estimate every tracked nutrient for the portion described. `answers` is
// [{ q, a }]; `base64` is an optional JPEG of the food.
// Resolves to { estimateId, name, portion, contents, confidence, notes, macros }.
export function estimateFood({ query, answers, base64, details }) {
  return invokeProxy({
    action: 'food_estimate',
    query,
    answers: answers ?? [],
    ...detailFields(details),
    ...(base64 ? { base64 } : {}),
  })
}
