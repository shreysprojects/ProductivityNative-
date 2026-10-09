// Exercise names come from the library in lowercase ("cable one arm curl
// (with rope)") and older workout plans and logs stored them that way. They
// are title-cased at the data boundary, so every screen shows
// "Cable One Arm Curl (With Rope)" without touching each renderer.

// Every word starts with a capital, including after a hyphen, slash or an
// opening bracket: "ez-bar" → "Ez-Bar", "l-sit" → "L-Sit", "v. 2" → "V. 2".
export function titleCaseExercise(name) {
  if (typeof name !== 'string') return name
  return name.replace(/(^|[\s\-\/(\[])([a-z])/g, (_, before, ch) => before + ch.toUpperCase())
}

export function withTitleCasedNames(list) {
  if (!Array.isArray(list)) return list
  return list.map(ex => (ex && typeof ex === 'object' ? { ...ex, name: titleCaseExercise(ex.name) } : ex))
}

// A workout log: { exercises: [{ name, ... }], ... }
export function titleCaseLog(log) {
  if (!log || !Array.isArray(log.exercises)) return log
  return { ...log, exercises: withTitleCasedNames(log.exercises) }
}
