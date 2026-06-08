// ── BMR (Mifflin-St Jeor) ────────────────────────────────────────────────────

export function calculateBMR(weightKg, heightCm, age, sex) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  return sex === 'male' ? base + 5 : base - 161
}

// ── TDEE ─────────────────────────────────────────────────────────────────────

const ACTIVITY_MULT = { low: 1.375, moderate: 1.55, high: 1.725 }

export function calculateTDEE(bmr, activityLevel) {
  return bmr * (ACTIVITY_MULT[activityLevel] ?? 1.55)
}

// ── Calorie goal ──────────────────────────────────────────────────────────────

const CAL_FLOOR = { male: 1500, female: 1200 }

export function calculateCalorieGoal(tdee, fitnessGoal, sex) {
  const raw = fitnessGoal === 'lose' ? tdee - 400
    : fitnessGoal === 'gain' ? tdee + 300 : tdee
  return Math.max(Math.round(raw), CAL_FLOOR[sex] ?? 1200)
}

// ── Macros ────────────────────────────────────────────────────────────────────
// Protein targets use body weight in lbs (standard fitness-app convention)

const PROTEIN_MULT_LB  = { lose: 1.0, maintain: 0.8, gain: 0.9 }
const PROTEIN_FLOOR_LB = { lose: 0.9, gain: 0.85 }

export function calculateMacros(calories, weightKg, fitnessGoal) {
  const weightLb = weightKg * 2.20462
  const goal     = fitnessGoal === 'none' ? 'maintain' : fitnessGoal
  const mult     = PROTEIN_MULT_LB[goal] ?? 0.8
  const floor    = PROTEIN_FLOOR_LB[goal] ?? 0
  const protein  = Math.max(Math.round(weightLb * mult), Math.round(weightLb * floor))
  const fat      = Math.round(calories * 0.25 / 9)
  const carbs    = Math.round(Math.max(calories - protein * 4 - fat * 9, 0) / 4)
  return { protein, fat, carbs }
}

// ── Combined calculator ───────────────────────────────────────────────────────

export function calculateGoals(weightKg, heightCm, age, sex, fitnessGoal, activityLevel, targetWeightKg = null) {
  const goal      = fitnessGoal === 'none' ? 'maintain' : fitnessGoal
  const calcWeight = (targetWeightKg && (goal === 'lose' || goal === 'gain')) ? targetWeightKg : weightKg
  const bmr      = calculateBMR(calcWeight, heightCm, age, sex)
  const tdee     = calculateTDEE(bmr, activityLevel)
  const calories = calculateCalorieGoal(tdee, goal, sex)
  const macros   = calculateMacros(calories, calcWeight, goal)
  return { calories, ...macros }
}

// ── Gym splits ────────────────────────────────────────────────────────────────
// days[0]=Sun … days[6]=Sat, each slot is string[]

const SPLIT_OPTIONS = {
  2: [
    { preset: 'Full Body 2x', days: [['Full Body'],['Rest'],['Rest'],['Full Body'],['Rest'],['Rest'],['Rest']] },
  ],
  3: [
    { preset: 'Full Body 3x',         days: [['Rest'],['Full Body'],['Rest'],['Full Body'],['Rest'],['Full Body'],['Rest']] },
    { preset: 'PPL',                   days: [['Rest'],['Push'],['Pull'],['Legs'],['Rest'],['Rest'],['Rest']] },
    { preset: 'Upper/Lower/Full Body', days: [['Rest'],['Upper'],['Lower'],['Rest'],['Full Body'],['Rest'],['Rest']] },
  ],
  4: [
    { preset: 'Upper/Lower 4x',  days: [['Rest'],['Upper'],['Lower'],['Rest'],['Upper'],['Lower'],['Rest']] },
    { preset: 'PPL + Full Body', days: [['Rest'],['Push'],['Pull'],['Legs'],['Full Body'],['Rest'],['Rest']] },
    { preset: 'Body Part 4x',    days: [['Chest'],['Back'],['Rest'],['Legs'],['Shoulders'],['Rest'],['Rest']] },
  ],
  5: [
    { preset: 'PPL + Upper/Lower', days: [['Rest'],['Push'],['Pull'],['Legs'],['Upper'],['Lower'],['Rest']] },
    { preset: 'Body Part 5x',      days: [['Chest'],['Back'],['Legs'],['Shoulders'],['Arms'],['Rest'],['Rest']] },
    { preset: 'Upper/Lower/PPL',   days: [['Upper'],['Lower'],['Push'],['Pull'],['Legs'],['Rest'],['Rest']] },
  ],
  6: [
    { preset: 'PPL x2',         days: [['Push'],['Pull'],['Legs'],['Push'],['Pull'],['Legs'],['Rest']] },
    { preset: '6-Day Split',    days: [['Chest'],['Back'],['Legs'],['Shoulders'],['Arms'],['Core'],['Rest']] },
    { preset: 'Upper/Lower x3', days: [['Upper'],['Lower'],['Upper'],['Lower'],['Upper'],['Lower'],['Rest']] },
  ],
}

export function generateGymSplit(daysPerWeek) {
  const options = SPLIT_OPTIONS[daysPerWeek] ?? SPLIT_OPTIONS[3]
  const pick = options[Math.floor(Math.random() * options.length)]
  return { preset: pick.preset, days: pick.days.map(d => [...d]) }
}

// ── Display labels ────────────────────────────────────────────────────────────

export const ACTIVITY_LABELS = {
  low:      { short: 'Low',      long: '2–3 workouts per week' },
  moderate: { short: 'Moderate', long: '4 workouts per week' },
  high:     { short: 'High',     long: '5–6 workouts per week' },
}

export const GOAL_LABELS = {
  lose:     { emoji: '🔥', label: 'Lose Weight' },
  gain:     { emoji: '💪', label: 'Gain Weight' },
  maintain: { emoji: '⚖️',  label: 'Maintain Weight' },
  none:     { emoji: '➡️',  label: 'No goal / Skip' },
}
