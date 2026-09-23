// Pure helpers for the Plan tab on the Meals page: the shape of the weekly
// plan and the weekday it applies to. No imports on purpose:
// tests/mealPlan.test.js loads this file with the same import-free loader as
// runSteps.js.
//
// The plan is ONE week that repeats, like the class schedule:
//   { days: { Mon: [meal], ..., Sun: [meal] }, notes }
// A planned meal is a logged meal plus prep details:
//   { id, section, name, contents, macros, prepMinutes, prepNote, source }
// where source is 'ai' or 'user'.

export const PLAN_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const DAY_NAMES = {
  Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday',
  Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday',
}
export const PLAN_SECTIONS = ['morning', 'lunch', 'dinner', 'snacks']

const SECTION_ALIASES = {
  morning: 'morning', breakfast: 'morning', brunch: 'morning',
  lunch: 'lunch', midday: 'lunch',
  dinner: 'dinner', supper: 'dinner', evening: 'dinner',
  snacks: 'snacks', snack: 'snacks', dessert: 'snacks',
}

const DAY_ALIASES = {
  mon: 'Mon', monday: 'Mon', tue: 'Tue', tues: 'Tue', tuesday: 'Tue',
  wed: 'Wed', wednesday: 'Wed', thu: 'Thu', thur: 'Thu', thurs: 'Thu', thursday: 'Thu',
  fri: 'Fri', friday: 'Fri', sat: 'Sat', saturday: 'Sat', sun: 'Sun', sunday: 'Sun',
}

// 'Mon'..'Sun' for an ISO date. Noon avoids DST edge cases.
export function dayKeyOf(dateStr) {
  return PLAN_DAYS[(new Date(dateStr + 'T12:00:00').getDay() + 6) % 7]
}

export function emptyDays() {
  const days = {}
  PLAN_DAYS.forEach(d => { days[d] = [] })
  return days
}

// A stored plan may be missing days or carry junk keys; this makes it whole.
export function normalizeDays(raw) {
  const days = emptyDays()
  if (raw && typeof raw === 'object') {
    for (const key of PLAN_DAYS) {
      if (Array.isArray(raw[key])) days[key] = raw[key].filter(m => m && typeof m === 'object' && m.id)
    }
  }
  return days
}

export function newPlanMealId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function planMealCount(days) {
  return PLAN_DAYS.reduce((n, d) => n + (days?.[d]?.length ?? 0), 0)
}

export function sumPlanMacros(meals) {
  const t = {}
  ;(meals ?? []).forEach(m => Object.entries(m.macros || {}).forEach(([k, v]) => {
    const n = Number(v)
    if (Number.isFinite(n)) t[k] = (t[k] || 0) + n
  }))
  return t
}

// Turns the planner's reply into a stored plan. The model describes each
// distinct meal once and lists ids per day (repeats are expected when time is
// tight), so every placement gets its own copy with a fresh id. Unknown ids,
// sections and days are dropped rather than trusted.
export function expandAiPlan(result, idFactory = newPlanMealId) {
  const byId = new Map()
  for (const raw of Array.isArray(result?.meals) ? result.meals : []) {
    if (!raw || typeof raw !== 'object') continue
    const id = String(raw.id ?? '').trim()
    const name = String(raw.name ?? '').trim()
    const section = SECTION_ALIASES[String(raw.section ?? '').trim().toLowerCase()]
    if (!id || !name || !section) continue
    const macros = {}
    for (const [k, v] of Object.entries(raw.macros ?? {})) {
      const n = Number(v)
      if (Number.isFinite(n) && n >= 0) macros[k] = k === 'calories' ? Math.round(n) : Math.round(n * 10) / 10
    }
    const prepMinutes = Math.max(0, Math.min(240, Math.round(Number(raw.prepMinutes) || 0)))
    byId.set(id, {
      section, name,
      contents: String(raw.contents ?? '').trim(),
      prepMinutes,
      prepNote: String(raw.prepNote ?? '').trim(),
      macros,
      source: 'ai',
    })
  }

  const days = emptyDays()
  for (const entry of Array.isArray(result?.days) ? result.days : []) {
    const key = DAY_ALIASES[String(entry?.day ?? '').trim().toLowerCase()]
    if (!key) continue
    const ids = Array.isArray(entry.mealIds) ? entry.mealIds : []
    for (const id of ids) {
      const meal = byId.get(String(id ?? '').trim())
      if (meal) days[key].push({ id: idFactory(), ...meal })
    }
    // Keep each day in section order so the list reads morning to night.
    days[key].sort((a, b) => PLAN_SECTIONS.indexOf(a.section) - PLAN_SECTIONS.indexOf(b.section))
  }

  const strList = (v, max, len) => (Array.isArray(v) ? v : [])
    .map(x => String(x ?? '').trim()).filter(Boolean).slice(0, max).map(x => x.slice(0, len))
  const grocery = (Array.isArray(result?.grocery) ? result.grocery : [])
    .map(g => ({ item: String(g?.item ?? '').trim().slice(0, 60), amount: String(g?.amount ?? '').trim().slice(0, 40) }))
    .filter(g => g.item)
    .slice(0, 80)

  const notes = {
    summary: String(result?.summary ?? '').trim().slice(0, 600),
    nutrition: strList(result?.nutritionNotes, 8, 400),
    prep: strList(result?.prepPlan, 10, 300),
    grocery,
    generatedAt: new Date().toISOString(),
  }
  return { days, notes }
}

// The compact shape sent back to the planner when the user asks for changes:
// distinct meals once, then which ids each day uses. Two placements of an
// identical AI meal collapse to one id so the model sees the repeats it made.
export function compactPlan(week) {
  const meals = []
  const keyToId = new Map()
  const days = PLAN_DAYS.map(day => {
    const mealIds = (week?.days?.[day] ?? []).map(m => {
      const key = `${m.section}|${m.name}|${m.contents}`
      let id = keyToId.get(key)
      if (!id) {
        id = `m${meals.length + 1}`
        keyToId.set(key, id)
        meals.push({
          id, section: m.section, name: m.name, contents: m.contents ?? '',
          prepMinutes: m.prepMinutes ?? 0, prepNote: m.prepNote ?? '', macros: m.macros ?? {},
        })
      }
      return id
    })
    return { day, mealIds }
  })
  return {
    meals, days,
    summary: week?.notes?.summary ?? '',
    prepPlan: week?.notes?.prep ?? [],
    nutritionNotes: week?.notes?.nutrition ?? [],
    grocery: week?.notes?.grocery ?? [],
  }
}
