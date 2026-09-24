import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { trySync } from './syncQueue'

// Goals object shape:
// { weightKg, heightCm, age, sex, fitnessGoal, activityLevel,
//   workoutDaysPerWeek, gymSplit, calories, protein, carbs, fat,
//   isCustom, onboardingDone }

function _fromDB(row) {
  return {
    weightKg:          row.weight_kg,
    heightCm:          row.height_cm,
    age:               row.age,
    sex:               row.sex,
    fitnessGoal:       row.fitness_goal,
    activityLevel:     row.activity_level,
    workoutDaysPerWeek:row.workout_days,
    gymSplit:          row.gym_split,
    calories:          row.calories,
    protein:           row.protein,
    carbs:             row.carbs,
    fat:               row.fat,
    isCustom:          row.is_custom,
    onboardingDone:    row.onboarding_done,
    targetWeightKg:    row.target_weight ?? null,
  }
}

export async function getUserGoals(userId) {
  const key = `@user_goals_${userId}`
  try {
    const raw = await AsyncStorage.getItem(key)
    if (raw) return JSON.parse(raw)
  } catch {}
  try {
    const { data } = await supabase
      .from('user_goals')
      .select('*')
      .eq('user_id', userId)
      .single()
    if (data?.onboarding_done) {
      const goals = _fromDB(data)
      await AsyncStorage.setItem(key, JSON.stringify(goals)).catch(() => {})
      return goals
    }
  } catch {}
  return null
}

/** Pull the authoritative row from Supabase and overwrite the local copy. */
export async function refreshFromCloud(userId) {
  const key = `@user_goals_${userId}`
  try {
    const { data } = await supabase
      .from('user_goals')
      .select('*')
      .eq('user_id', userId)
      .single()
    if (data) {
      const goals = _fromDB(data)
      await AsyncStorage.setItem(key, JSON.stringify(goals)).catch(() => {})
      return goals
    }
  } catch {}
  return null
}

export async function clearLocalCache(userId) {
  await AsyncStorage.removeItem(`@user_goals_${userId}`).catch(() => {})
}

export async function saveUserGoals(userId, goals) {
  const key = `@user_goals_${userId}`
  await AsyncStorage.setItem(key, JSON.stringify(goals)).catch(() => {})
  await trySync('user_goals', 'upsert', {
    user_id:        userId,
    weight_kg:      goals.weightKg      ?? null,
    height_cm:      goals.heightCm      ?? null,
    age:            goals.age           ?? null,
    sex:            goals.sex           ?? null,
    fitness_goal:   goals.fitnessGoal   ?? 'none',
    activity_level: goals.activityLevel ?? null,
    workout_days:   goals.workoutDaysPerWeek ?? null,
    gym_split:      goals.gymSplit       ?? null,
    calories:       goals.calories       ?? null,
    protein:        goals.protein        ?? null,
    carbs:          goals.carbs          ?? null,
    fat:            goals.fat            ?? null,
    is_custom:      goals.isCustom       ?? false,
    target_weight:  goals.targetWeightKg ?? null,
    onboarding_done: goals.onboardingDone ?? true,
  })
}

// true / false when it is known; null when neither this device nor the
// account can answer (a fresh install that is offline, a failed fetch).
async function onboardingStatus(userId) {
  try {
    const raw = await AsyncStorage.getItem(`@user_goals_${userId}`)
    if (raw) return JSON.parse(raw)?.onboardingDone === true
  } catch {}
  try {
    const { data, error } = await supabase
      .from('user_goals')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) return null
    if (!data?.onboarding_done) return false
    await AsyncStorage.setItem(`@user_goals_${userId}`, JSON.stringify(_fromDB(data))).catch(() => {})
    return true
  } catch {
    return null
  }
}

// Unknown counts as done. A failed fetch used to read as "never onboarded",
// sending an existing user back through onboarding, where Skip saved empty
// goals over their real ones. Like hasUserSetup, the worse mistake is the one
// avoided; the next launch that can reach the account asks again.
export async function hasOnboardingDone(userId) {
  return (await onboardingStatus(userId)) !== false
}
