import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { normalizeDays } from './mealPlan'

// The weekly meal plan is one row per user in meal_plans: a single week that
// repeats, like the class schedule. Like a day's meals, it is one blob, so
// edits run one after another.

const _chains = new Map()
function _serialize(key, fn) {
  const prev = _chains.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.then(() => {}, () => {})
  _chains.set(key, tail)
  tail.then(() => { if (_chains.get(key) === tail) _chains.delete(key) })
  return run
}

// Throws on a failed read: a plan that cannot be fetched must not render as
// an empty one (and must never be written back over the real one).
export async function getMealPlan(userId) {
  const { data, error } = await supabase
    .from('meal_plans')
    .select('days, notes')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return { days: normalizeDays(data?.days), notes: data?.notes ?? null }
}

async function _write(userId, plan) {
  const { error } = await supabase.from('meal_plans').upsert({
    user_id: userId,
    days: plan.days,
    notes: plan.notes ?? null,
    updated_at: new Date().toISOString(),
  })
  if (error) throw error
  return plan
}

// Replace the whole plan (the AI planner's result, or a cleared plan).
export function replaceMealPlan(userId, plan) {
  return _serialize(`meal_plans:${userId}`, () =>
    _write(userId, { days: normalizeDays(plan.days), notes: plan.notes ?? null }))
}

export function addPlannedMeal(userId, dayKey, meal) {
  return _serialize(`meal_plans:${userId}`, async () => {
    const plan = await getMealPlan(userId)
    const list = plan.days[dayKey]
    const idx = list.findIndex(m => m.id === meal.id)
    if (idx >= 0) list[idx] = meal
    else list.push(meal)
    return _write(userId, plan)
  })
}

// Replace one day's list: a meal dragged into another part of the day, or
// reordered within one.
export function setPlannedDay(userId, dayKey, meals) {
  return _serialize(`meal_plans:${userId}`, async () => {
    const plan = await getMealPlan(userId)
    plan.days[dayKey] = meals
    return _write(userId, plan)
  })
}

export function deletePlannedMeal(userId, dayKey, mealId) {
  return _serialize(`meal_plans:${userId}`, async () => {
    const plan = await getMealPlan(userId)
    plan.days[dayKey] = plan.days[dayKey].filter(m => m.id !== mealId)
    return _write(userId, plan)
  })
}

// The planner's survey answers, remembered on this device so the next plan
// can start from them instead of asking everything again.
const prefsKey = userId => `@meal_plan_prefs_${userId}`

export async function getMealPlanPrefs(userId) {
  try {
    const raw = await AsyncStorage.getItem(prefsKey(userId))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export async function saveMealPlanPrefs(userId, prefs) {
  try { await AsyncStorage.setItem(prefsKey(userId), JSON.stringify(prefs)) } catch {}
}
