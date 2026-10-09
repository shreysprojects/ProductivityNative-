// Exercise names come from the library in lowercase ("cable one arm curl
// (with rope)") and older workout plans and logs stored them that way. They
// are title-cased at the data boundary, so every screen shows
// "Cable One Arm Curl (With Rope)" without touching each renderer.

// Every word starts with a capital, including after a hyphen, slash or an
// opening bracket: "ez-bar" → "Ez-Bar", "l-sit" → "L-Sit", "v. 2" → "V. 2".
// Plans and logs can come from other people's accounts, so a name that is
// not text comes back as text (a number) or null, never as an object a
// screen would crash rendering.
export function titleCaseExercise(name) {
  if (typeof name === 'number') name = String(name)
  if (typeof name !== 'string') return null
  return name.replace(/(^|[\s\-\/(\[])([a-z])/g, (_, before, ch) => before + ch.toUpperCase())
}

// Entries that are not objects are dropped: every reader takes fields off each one.
export function withTitleCasedNames(list) {
  if (!Array.isArray(list)) return list
  return list
    .filter(ex => ex && typeof ex === 'object')
    .map(ex => ({ ...ex, name: titleCaseExercise(ex.name) }))
}

// A workout log: { exercises: [{ name, ... }], ... }
export function titleCaseLog(log) {
  if (!log || !Array.isArray(log.exercises)) return log
  return { ...log, exercises: withTitleCasedNames(log.exercises) }
}
