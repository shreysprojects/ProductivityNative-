export const MUSCLE_GROUPS = [
  'Rest', 'Push', 'Pull', 'Legs', 'Upper', 'Lower',
  'Chest', 'Back', 'Shoulders', 'Arms', 'Quads', 'Hamstrings',
  'Glutes', 'Calves', 'Core', 'Full Body', 'Cardio',
]

// Days: index 0 = Sunday … 6 = Saturday (matches JS Date.getDay())
export const SPLIT_PRESETS = {
  PPL: {
    label: 'PPL (Push Pull Legs)',
    emoji: '🔄',
    days: [['Rest'], ['Push'], ['Pull'], ['Legs'], ['Push'], ['Pull'], ['Legs']],
  },
  'Arnold Split': {
    label: 'Arnold Split',
    emoji: '💪',
    days: [['Rest'], ['Chest', 'Back'], ['Shoulders', 'Arms'], ['Legs'], ['Chest', 'Back'], ['Shoulders', 'Arms'], ['Legs']],
  },
  'Upper/Lower': {
    label: 'Upper / Lower',
    emoji: '⬆️',
    days: [['Rest'], ['Upper'], ['Lower'], ['Upper'], ['Lower'], ['Upper'], ['Rest']],
  },
  'Bro Split': {
    label: 'Bro Split',
    emoji: '🦾',
    days: [['Rest'], ['Chest'], ['Back'], ['Shoulders'], ['Arms'], ['Legs'], ['Rest']],
  },
  'Full Body': {
    label: 'Full Body (3x)',
    emoji: '🏋️',
    days: [['Rest'], ['Full Body'], ['Rest'], ['Full Body'], ['Rest'], ['Full Body'], ['Rest']],
  },
  Custom: {
    label: 'Custom',
    emoji: '✏️',
    days: [['Rest'], ['Rest'], ['Rest'], ['Rest'], ['Rest'], ['Rest'], ['Rest']],
  },
}

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Returns today's split day index (0=Sun … 6=Sat)
export function todaySplitIndex() {
  return new Date().getDay()
}

// Normalize a stored day value (string or array) → array
export function normalizeDay(v) {
  if (!v) return ['Rest']
  if (Array.isArray(v)) return v.length > 0 ? v : ['Rest']
  return [v]
}

// Display label for a day's muscle array
export function dayLabel(v) {
  const arr = normalizeDay(v)
  return arr.join(' + ')
}

// Color per muscle group label (uses first muscle if array)
export function muscleColor(labelOrArr) {
  const label = Array.isArray(labelOrArr) ? labelOrArr[0] : labelOrArr
  const map = {
    Rest: '#e5e7eb',
    Push: '#fde68a',
    Pull: '#bfdbfe',
    Legs: '#bbf7d0',
    Upper: '#c7d2fe',
    Lower: '#fecaca',
    Chest: '#fed7aa',
    Back: '#a5f3fc',
    Shoulders: '#ddd6fe',
    Arms: '#fbcfe8',
    Quads: '#d9f99d',
    Hamstrings: '#fef08a',
    Glutes: '#fca5a5',
    Calves: '#6ee7b7',
    Core: '#f9a8d4',
    'Full Body': '#e9d5ff',
    Cardio: '#fdba74',
  }
  return map[label] ?? '#e5e7eb'
}

export function muscleTextColor(labelOrArr) {
  const label = Array.isArray(labelOrArr) ? labelOrArr[0] : labelOrArr
  const map = {
    Rest: '#9ca3af',
    Push: '#92400e',
    Pull: '#1e40af',
    Legs: '#065f46',
    Upper: '#3730a3',
    Lower: '#991b1b',
    Chest: '#9a3412',
    Back: '#164e63',
    Shoulders: '#4c1d95',
    Arms: '#831843',
    Quads: '#3f6212',
    Hamstrings: '#713f12',
    Glutes: '#7f1d1d',
    Calves: '#064e3b',
    Core: '#831843',
    'Full Body': '#6d28d9',
    Cardio: '#7c2d12',
  }
  return map[label] ?? '#374151'
}