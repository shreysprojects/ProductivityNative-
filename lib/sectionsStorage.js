import AsyncStorage from '@react-native-async-storage/async-storage'

// Controls which optional sections of the app are visible.
// Existing users default to everything on (no change in behavior);
// new users get defaults from the focus they pick during onboarding.
// tabMeals / tabCalendar / tabExplore control bottom tab visibility.

const key = (uid) => `@app_sections_${uid}`

export const DEFAULT_SECTIONS = {
  weekly: true, habits: true, productivity: true,
  tabMeals: true, tabCalendar: true, tabExplore: true,
}

export const FOCUS_PRESETS = {
  habits:       { weekly: true,  habits: true,  productivity: false },
  fitness:      { weekly: false, habits: false, productivity: false },
  productivity: { weekly: true,  habits: false, productivity: true },
  all:          { weekly: true,  habits: true,  productivity: true },
}

const listeners = new Set()

// Subscribe to section changes (e.g. the tab bar re-reads visibility live).
// Returns an unsubscribe function.
export function onSectionsChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export async function getSections(userId) {
  try {
    const raw = await AsyncStorage.getItem(key(userId))
    if (!raw) return { ...DEFAULT_SECTIONS }
    return { ...DEFAULT_SECTIONS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SECTIONS }
  }
}

export async function saveSections(userId, sections) {
  const merged = { ...DEFAULT_SECTIONS, ...sections }
  await AsyncStorage.setItem(key(userId), JSON.stringify(merged)).catch(() => {})
  listeners.forEach(fn => fn(merged))
}
