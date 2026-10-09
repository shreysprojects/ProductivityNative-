import AsyncStorage from '@react-native-async-storage/async-storage'

// Device-local preferences for how routines are shown and run.
//   runMode:      'steps'     — one task at a time with a per-task timer (the original)
//                 'checklist' — every task listed at once, tick them in any order
//   hideWorkouts: true hides the workout features on the Fitness routine
//                 (My Workouts, the week calendar and the gym-split banner)

const key = uid => `@routine_prefs_${uid}`

export const RUN_MODES = ['steps', 'checklist']

export const DEFAULT_ROUTINE_PREFS = { runMode: 'steps', hideWorkouts: false }

function normalize(saved) {
  return {
    ...DEFAULT_ROUTINE_PREFS,
    ...saved,
    runMode: RUN_MODES.includes(saved?.runMode) ? saved.runMode : DEFAULT_ROUTINE_PREFS.runMode,
    hideWorkouts: !!saved?.hideWorkouts,
  }
}

export async function getRoutinePrefs(userId) {
  try {
    const raw = await AsyncStorage.getItem(key(userId))
    if (!raw) return { ...DEFAULT_ROUTINE_PREFS }
    return normalize(JSON.parse(raw) ?? {})
  } catch {
    return { ...DEFAULT_ROUTINE_PREFS }
  }
}

// Merges the patch into what's stored instead of replacing it: the Fitness
// screen writes hideWorkouts and Settings writes runMode, each from its own
// snapshot, so a wholesale write from one would silently undo the other.
export async function saveRoutinePrefs(userId, patch) {
  const merged = normalize({ ...(await getRoutinePrefs(userId)), ...patch })
  await AsyncStorage.setItem(key(userId), JSON.stringify(merged)).catch(() => {})
  return merged
}
