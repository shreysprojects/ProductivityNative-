import { fetchExercisesByCategory } from './wgerApi'
import { loadWorkoutPlan, saveWorkoutPlan } from './storage'

// Seeds beginner-friendly workout plans for each muscle group in the user's
// split, tuned to their fitness goal. Runs once at the end of onboarding —
// never overwrites a plan the user already built.

const GROUP_BODY_PARTS = {
  Push:        ['chest', 'shoulders'],
  Pull:        ['back', 'upper arms'],
  Legs:        ['upper legs', 'lower legs'],
  Upper:       ['chest', 'back', 'shoulders'],
  Lower:       ['upper legs', 'lower legs'],
  Chest:       ['chest'],
  Back:        ['back'],
  Shoulders:   ['shoulders'],
  Arms:        ['upper arms', 'lower arms'],
  Quads:       ['upper legs'],
  Hamstrings:  ['upper legs'],
  Glutes:      ['upper legs'],
  Calves:      ['lower legs'],
  Core:        ['waist'],
  'Full Body': ['chest', 'back', 'upper legs', 'shoulders'],
  Cardio:      ['cardio'],
}

// Proven staple movements, highest priority first — these are matched by
// name so new users start with recognizable, effective exercises.
const PRIORITY_KEYWORDS = [
  'barbell bench press', 'bench press', 'squat', 'deadlift', 'barbell row',
  'lat pulldown', 'pull-up', 'pull up', 'chin-up', 'overhead press',
  'shoulder press', 'leg press', 'romanian', 'lunge', 'hip thrust',
  'incline', 'dumbbell press', 'cable row', 'seated row', 'push-up', 'push up',
  'lateral raise', 'bicep curl', 'biceps curl', 'hammer curl', 'curl',
  'tricep', 'triceps', 'dip', 'pushdown', 'calf raise', 'crunch', 'plank',
  'leg curl', 'leg extension', 'fly', 'face pull', 'shrug', 'row',
]

// Sets/reps/rest tuned per goal: heavy-low for muscle, light-high for fat
// loss, moderate for maintenance.
const GOAL_SCHEMES = {
  gain:     { sets: 4, reps: 6,  restSeconds: 150 },
  lose:     { sets: 3, reps: 15, restSeconds: 60 },
  maintain: { sets: 3, reps: 10, restSeconds: 90 },
}

function scoreExercise(ex) {
  const n = (ex.name ?? '').toLowerCase()
  let score = 0
  const idx = PRIORITY_KEYWORDS.findIndex(k => n.includes(k))
  if (idx >= 0) score += 200 - idx          // earlier keyword = higher score
  if ((ex.difficulty ?? '').toLowerCase().includes('beginner')) score += 20
  if (ex.gifUrl) score += 10                // visual guidance helps new users
  if (ex.equipment) score += 2
  return score
}

async function pickForBodyPart(bodyPart, count) {
  const { results } = await fetchExercisesByCategory(bodyPart, 0, 60)
  return results
    .map(ex => ({ ex, score: scoreExercise(ex) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(s => s.ex)
}

export async function seedStarterWorkouts(userId, split, fitnessGoal) {
  try {
    const groups = [...new Set((split?.days ?? []).flat().filter(m => m && m !== 'Rest'))]
    if (groups.length === 0) return
    const scheme = GOAL_SCHEMES[fitnessGoal] ?? GOAL_SCHEMES.maintain

    for (const group of groups) {
      const parts = GROUP_BODY_PARTS[group]
      if (!parts) continue

      // Never overwrite a plan the user already built. A plan that can't be
      // read might exist, so it is left alone rather than seeded over.
      let existing
      try { existing = await loadWorkoutPlan(userId, group) } catch { continue }
      if (existing.length > 0) continue

      const perPart = parts.length === 1 ? 5 : parts.length === 2 ? 3 : 2
      const picked = []
      for (const part of parts) {
        const exs = await pickForBodyPart(part, perPart).catch(() => [])
        picked.push(...exs)
      }
      if (picked.length === 0) continue

      const plan = picked.slice(0, 6).map(ex => ({ ...ex, ...scheme }))
      await saveWorkoutPlan(userId, group, plan)
    }
  } catch {
    // Seeding is best-effort — the user can always build plans manually
  }
}
