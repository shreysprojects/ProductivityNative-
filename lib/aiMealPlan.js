import { invokeProxy } from './aiFood'

// The AI meal planner. Both calls go through the openai-proxy edge function,
// which holds the prompts, moderates the survey answers and enforces the
// daily planner cap. Each resolves to the planner's reply:
//   { summary, meals: [{ id, section, name, contents, prepMinutes, prepNote, macros }],
//     days: [{ day: 'Mon', mealIds: [...] }], prepPlan: [], nutritionNotes: [], grocery: [{ item, amount }] }
// which lib/mealPlan.js expandAiPlan() turns into the stored weekly plan.

// A week usually takes 30 to 90 seconds; past five minutes it is not coming.
const PLAN_TIMEOUT_MS = 300000

// `goals` is the user's goals object (calories, protein, carbs, fat, plus the
// body stats they were computed from); `answers` is [{ q, a }] from the survey.
// `signal` (optional) cancels the request.
export function generateMealPlan({ goals, answers }, { signal } = {}) {
  return invokeProxy({ action: 'meal_plan_generate', goals, answers }, { signal, timeout: PLAN_TIMEOUT_MS })
}

// `plan` is the compact form of the current plan (lib/mealPlan.js compactPlan)
// and `request` is what the user wants changed, in their own words.
export function reviseMealPlan({ goals, answers, plan, request }, { signal } = {}) {
  return invokeProxy({ action: 'meal_plan_revise', goals, answers, plan, request }, { signal, timeout: PLAN_TIMEOUT_MS })
}

// The meal coach chat. `messages` is the conversation so far as
// [{ role: 'user' | 'assistant', content }], ending with the user's new
// message; `plan` is compactPlan() of the weekly plan (or null), `today` is
// { date, meals } from the log, `week` is the last seven days of totals and
// `recent` is [{ date, meals }] for the earlier days of the week, per food.
// `today` is null when the day's log could not be read. `signal` (optional)
// cancels the request. Resolves to { reply }.
export function askMealCoach({ goals, plan, today, week, recent, messages }, { signal } = {}) {
  return invokeProxy({ action: 'meal_coach', goals, plan, today, week, recent, messages }, { signal })
}
