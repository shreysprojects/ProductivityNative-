import { useState, useEffect } from 'react'
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator } from 'react-native'
import { useLocalSearchParams, router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '../lib/AuthContext'
import { useTheme } from '../lib/ThemeContext'
import {
  getHistoryForDate, getRoutineRunsForDate,
  getWorkoutLog, getMeals, getCalendarEvents,
  getTasks, getJournalEntries,
} from '../lib/storage'
import MuscleMap from '../components/MuscleMap'

// ── Constants ──────────────────────────────────────────────────────────────

const MOODS = [
  { key: 'great',   emoji: '😄', label: 'Great'   },
  { key: 'good',    emoji: '😊', label: 'Good'    },
  { key: 'okay',    emoji: '😐', label: 'Okay'    },
  { key: 'down',    emoji: '😔', label: 'Down'    },
  { key: 'bad',     emoji: '😢', label: 'Bad'     },
  { key: 'excited', emoji: '🥳', label: 'Excited' },
]

const EVENT_TYPES = [
  { id: 'assignment', label: 'Assignment', emoji: '📚', color: '#ef4444' },
  { id: 'meeting',    label: 'Meeting',    emoji: '📅', color: '#3b82f6' },
  { id: 'reminder',   label: 'Reminder',   emoji: '🔔', color: '#8b5cf6' },
  { id: 'other',      label: 'Other',      emoji: '📌', color: '#6b7280' },
]

const PRIORITY = {
  high:   { color: '#ef4444' },
  medium: { color: '#f59e0b' },
  low:    { color: '#22c55e' },
  none:   { color: '#94a3b8' },
}

// Expand split-day labels (Push/Pull/Legs etc.) → MuscleMap-compatible names
const SPLIT_EXPAND = {
  push:       ['Chest', 'Shoulders', 'Triceps'],
  pull:       ['Back', 'Biceps', 'Lats'],
  legs:       ['Legs', 'Glutes', 'Calves'],
  leg:        ['Legs', 'Glutes', 'Calves'],
  upper:      ['Chest', 'Back', 'Shoulders', 'Arms'],
  lower:      ['Legs', 'Glutes', 'Calves'],
  chest:      ['Chest'],
  back:       ['Back', 'Lats'],
  shoulders:  ['Shoulders'],
  shoulder:   ['Shoulders'],
  arms:       ['Arms'],
  biceps:     ['Biceps'],
  triceps:    ['Triceps'],
  quads:      ['Quadriceps'],
  quadriceps: ['Quadriceps'],
  hamstrings: ['Hamstrings'],
  glutes:     ['Glutes'],
  calves:     ['Calves'],
  core:       ['Core'],
  abs:        ['Abdominals'],
  'full body':['Chest', 'Back', 'Shoulders', 'Arms', 'Core', 'Legs'],
  cardio:     ['Legs', 'Core'],
}

function musclesFromGroup(group) {
  if (!group) return []
  const result = new Set()
  group.split(/[+/]/).forEach(part => {
    const lower = part.trim().toLowerCase()
    if (SPLIT_EXPAND[lower]) {
      SPLIT_EXPAND[lower].forEach(m => result.add(m))
      return
    }
    let matched = false
    lower.split(/\s+/).forEach(word => {
      if (SPLIT_EXPAND[word]) {
        SPLIT_EXPAND[word].forEach(m => result.add(m))
        matched = true
      }
    })
    if (!matched) result.add(lower.charAt(0).toUpperCase() + lower.slice(1))
  })
  return [...result]
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDateFull(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}

function fmtTime(t) {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function fmtMs(ms) {
  if (!ms || ms <= 0) return null
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

function pctColor(p) {
  if (p >= 100) return '#10b981'
  if (p >= 50)  return '#f59e0b'
  return '#ef4444'
}

// ── Screen ─────────────────────────────────────────────────────────────────

export default function DayDetailScreen() {
  const { date } = useLocalSearchParams()
  const { user } = useAuth()
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()

  const [loading, setLoading] = useState(true)
  const [history, setHistory] = useState([])
  const [runs,    setRuns]    = useState([])
  const [workout, setWorkout] = useState(null)
  const [meals,   setMeals]   = useState([])
  const [events,  setEvents]  = useState([])
  const [tasks,   setTasks]   = useState([])
  const [journal, setJournal] = useState(null)

  useEffect(() => {
    if (!user || !date) { setLoading(false); return }
    async function load() {
      const [hist, runData, wlog, mealList, allEvents, allTasks, journalMap] = await Promise.all([
        getHistoryForDate(user.id, date),
        getRoutineRunsForDate(user.id, date),
        getWorkoutLog(user.id, date),
        getMeals(user.id, date),
        getCalendarEvents(user.id),
        getTasks(user.id),
        getJournalEntries(user.id),
      ])
      setHistory(hist)
      setRuns(runData)
      setWorkout(wlog)
      setMeals(mealList)
      setEvents(
        allEvents
          .filter(e => e.date === date)
          .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
      )
      setTasks(allTasks.filter(t => t.dueDate === date))
      setJournal(journalMap[date] ?? null)
      setLoading(false)
    }
    load()
  }, [user, date])

  const isActive  = history.length > 0 || !!workout
  const doneTasks = tasks.filter(t => t.done)
  const totalCal  = meals.reduce((s, m) => s + (Number(m.macros?.calories) || 0), 0)
  const totalProt = meals.reduce((s, m) => s + (Number(m.macros?.protein)  || 0), 0)

  const isEmpty =
    !isActive && meals.length === 0 &&
    events.length === 0 && tasks.length === 0 && !journal

  return (
    <View style={[s.page, { backgroundColor: theme.bg }]}>

      {/* Header */}
      <View style={[s.header, { backgroundColor: theme.card, borderBottomColor: theme.divider, paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={12}>
          <Text style={[s.backArrow, { color: theme.accent }]}>‹</Text>
        </Pressable>
        <Text style={[s.headerTitle, { color: theme.text }]} numberOfLines={2}>
          {date ? formatDateFull(date) : '—'}
        </Text>
        {!loading && (
          <View style={[s.statusBadge, { backgroundColor: isActive ? '#10b98118' : (theme.isDark ? '#ffffff0d' : '#0000000a') }]}>
            <Text style={{ fontSize: 13 }}>{isActive ? '🔥' : '😴'}</Text>
            <Text style={[s.statusText, { color: isActive ? '#10b981' : theme.muted }]}>
              {isActive ? 'Active' : 'Rest day'}
            </Text>
          </View>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={theme.accent} style={{ marginTop: 48 }} />
      ) : (
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

          {/* Empty state */}
          {isEmpty && (
            <View style={[s.card, { backgroundColor: theme.card, borderColor: theme.cardBorder, alignItems: 'center', paddingVertical: 36 }]}>
              <Text style={{ fontSize: 44, marginBottom: 14 }}>📅</Text>
              <Text style={[s.emptyTitle, { color: theme.text }]}>Nothing recorded</Text>
              <Text style={[s.emptySubtitle, { color: theme.muted }]}>
                No activity was saved for this day.
              </Text>
            </View>
          )}

          {/* ── Routines ───────────────────────────────────────────────────── */}
          {history.length > 0 && (
            <View style={[s.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <View style={s.cardHeader}>
                <Text style={s.secEmoji}>📋</Text>
                <Text style={[s.secTitle, { color: theme.text }]}>Routines</Text>
                <View style={[s.badge, { backgroundColor: theme.accent + '20' }]}>
                  <Text style={[s.badgeText, { color: theme.accent }]}>
                    {history.filter(h => h.completion >= 100).length}/{history.length} done
                  </Text>
                </View>
              </View>

              {history.map((h, hi) => {
                // A day's progress may live on the main run or the alternative
                // (routine_name "<name>::alt") — show whichever got further.
                const doneSteps = r => (r?.data?.steps ?? []).filter(st => st.completedAt).length
                const run = runs
                  .filter(r => r.routine_name === h.routine || r.routine_name === h.routine + '::alt')
                  .sort((a, b) => doneSteps(b) - doneSteps(a))[0]
                const steps = run?.data?.steps ?? []
                return (
                  <View
                    key={h.routine}
                    style={[s.section, hi < history.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.divider }]}
                  >
                    <View style={s.rowBetween}>
                      <Text style={[s.itemTitle, { color: theme.text }]}>{h.routine}</Text>
                      <Text style={[s.pctText, { color: pctColor(h.completion) }]}>{h.completion}%</Text>
                    </View>
                    <View style={[s.bar, { backgroundColor: theme.isDark ? '#ffffff15' : '#0000000c' }]}>
                      <View style={[s.barFill, { width: `${Math.min(h.completion, 100)}%`, backgroundColor: pctColor(h.completion) }]} />
                    </View>
                    {steps.length > 0 && (
                      <View style={s.stepList}>
                        {steps.map((step, si) => (
                          <View key={si} style={s.stepRow}>
                            <Text style={[s.stepDot, { color: step.completedAt ? '#10b981' : theme.muted }]}>
                              {step.completedAt ? '●' : '○'}
                            </Text>
                            <Text style={[s.stepText, { color: step.completedAt ? theme.text : theme.muted }]}>
                              {step.text}
                            </Text>
                            {step.completedAt ? (
                              <Text style={[s.stepDur, { color: theme.muted }]}>
                                {fmtMs(step.elapsedMs)
                                  ? fmtMs(step.elapsedMs)
                                  : new Date(step.completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                              </Text>
                            ) : null}
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                )
              })}
            </View>
          )}

          {/* ── Workout ────────────────────────────────────────────────────── */}
          {workout && (
            <View style={[s.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <View style={s.cardHeader}>
                <Text style={s.secEmoji}>💪</Text>
                <Text style={[s.secTitle, { color: theme.text }]}>Workout</Text>
                {workout.muscleGroup ? (
                  <View style={[s.badge, { backgroundColor: '#f9731620' }]}>
                    <Text style={[s.badgeText, { color: '#f97316' }]}>{workout.muscleGroup}</Text>
                  </View>
                ) : null}
                {workout.startedAt && workout.completedAt ? (
                  <Text style={[s.secMeta, { color: theme.muted }]}>
                    {fmtMs(workout.completedAt - workout.startedAt)}
                  </Text>
                ) : null}
              </View>

              {workout.muscleGroup && (
                <View style={s.muscleMapWrap}>
                  <MuscleMap muscles={musclesFromGroup(workout.muscleGroup)} size={240} />
                </View>
              )}

              {(workout.exercises ?? []).length > 0
                ? (workout.exercises).map((ex, ei) => {
                    if (ex.skipped) return null
                    const exSets = ex.sets ?? []
                    return (
                      <View
                        key={ei}
                        style={[s.section, ei < workout.exercises.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.divider }]}
                      >
                        <Text style={[s.itemTitle, { color: theme.text, marginBottom: exSets.length ? 8 : 0 }]}>
                          {ex.name ?? 'Exercise'}
                        </Text>
                        {exSets.length > 0 && (
                          <View style={s.setsRow}>
                            {exSets.map((set, si) => (
                              <View key={si} style={[s.setChip, { backgroundColor: theme.isDark ? '#ffffff12' : '#0000000a' }]}>
                                <Text style={[s.setChipText, { color: theme.subtext }]}>
                                  {ex.inputType === 'time'
                                    ? fmtMs((Number(set.time) || 0) * 1000) ?? '—'
                                    : `${set.reps ?? '—'} × ${set.weight ?? '—'}${set.unit ?? 'lb'}`}
                                </Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    )
                  })
                : <Text style={[s.emptySubtitle, { color: theme.muted }]}>Session logged</Text>
              }
            </View>
          )}

          {/* ── Nutrition ──────────────────────────────────────────────────── */}
          {meals.length > 0 && (
            <View style={[s.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <View style={s.cardHeader}>
                <Text style={s.secEmoji}>🍽️</Text>
                <Text style={[s.secTitle, { color: theme.text }]}>Nutrition</Text>
                {totalCal > 0 && (
                  <View style={[s.badge, { backgroundColor: '#22c55e20' }]}>
                    <Text style={[s.badgeText, { color: '#22c55e' }]}>{totalCal} kcal</Text>
                  </View>
                )}
              </View>

              {meals.map((meal, mi) => (
                <View
                  key={mi}
                  style={[s.section, mi < meals.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.divider }]}
                >
                  <Text style={[s.itemTitle, { color: theme.text }]}>{meal.name}</Text>
                  <View style={s.macroRow}>
                    {meal.macros?.calories != null && <Text style={[s.macroChip, { color: theme.subtext }]}>{meal.macros.calories} kcal</Text>}
                    {meal.macros?.protein  != null && <Text style={[s.macroChip, { color: '#3b82f6' }]}>P {meal.macros.protein}g</Text>}
                    {meal.macros?.carbs    != null && <Text style={[s.macroChip, { color: '#f97316' }]}>C {meal.macros.carbs}g</Text>}
                    {meal.macros?.fat      != null && <Text style={[s.macroChip, { color: '#eab308' }]}>F {meal.macros.fat}g</Text>}
                  </View>
                </View>
              ))}

              {(totalCal > 0 || totalProt > 0) && (
                <View style={[s.totalsRow, { borderTopColor: theme.divider }]}>
                  {totalCal  > 0 && <Text style={[s.totalText, { color: theme.subtext }]}>{totalCal} kcal total</Text>}
                  {totalProt > 0 && <Text style={[s.totalText, { color: '#3b82f6' }]}>{totalProt}g protein</Text>}
                </View>
              )}
            </View>
          )}

          {/* ── Tasks ──────────────────────────────────────────────────────── */}
          {tasks.length > 0 && (
            <View style={[s.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <View style={s.cardHeader}>
                <Text style={s.secEmoji}>✅</Text>
                <Text style={[s.secTitle, { color: theme.text }]}>Tasks</Text>
                <View style={[s.badge, {
                  backgroundColor: doneTasks.length === tasks.length ? '#10b98120' : '#f59e0b20',
                }]}>
                  <Text style={[s.badgeText, {
                    color: doneTasks.length === tasks.length ? '#10b981' : '#f59e0b',
                  }]}>
                    {doneTasks.length}/{tasks.length} done
                  </Text>
                </View>
              </View>

              {tasks.map((task, ti) => {
                const pri = PRIORITY[task.priority] ?? PRIORITY.none
                return (
                  <View
                    key={task.id}
                    style={[
                      s.taskRow,
                      ti < tasks.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.divider },
                      !task.done && { opacity: 0.55 },
                    ]}
                  >
                    <View style={[s.taskCheck, { borderColor: task.done ? pri.color : theme.cardBorder, backgroundColor: task.done ? pri.color : 'transparent' }]}>
                      {task.done && <Text style={s.taskMark}>✓</Text>}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.taskTitle, { color: theme.text }, task.done && { textDecorationLine: 'line-through' }]}>
                        {task.title}
                      </Text>
                      {task.description ? (
                        <Text style={[s.taskDesc, { color: theme.subtext }]} numberOfLines={1}>{task.description}</Text>
                      ) : null}
                    </View>
                    <View style={[s.priorityDot, { backgroundColor: pri.color }]} />
                  </View>
                )
              })}
            </View>
          )}

          {/* ── Journal ────────────────────────────────────────────────────── */}
          {journal && (
            <View style={[s.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <View style={s.cardHeader}>
                <Text style={s.secEmoji}>📝</Text>
                <Text style={[s.secTitle, { color: theme.text }]}>Journal</Text>
                {journal.mood ? (
                  <Text style={{ fontSize: 22 }}>{MOODS.find(m => m.key === journal.mood)?.emoji}</Text>
                ) : null}
              </View>

              {journal.mood ? (
                <View style={[s.moodChip, { backgroundColor: '#0ea5e918' }]}>
                  <Text style={{ fontSize: 16 }}>{MOODS.find(m => m.key === journal.mood)?.emoji}</Text>
                  <Text style={[s.moodLabel, { color: '#0ea5e9' }]}>
                    {MOODS.find(m => m.key === journal.mood)?.label}
                  </Text>
                </View>
              ) : null}

              {journal.text ? (
                <Text style={[s.journalText, { color: theme.text }]}>{journal.text}</Text>
              ) : (
                <Text style={[s.journalText, { color: theme.muted, fontStyle: 'italic' }]}>(mood only)</Text>
              )}
            </View>
          )}

          {/* ── Calendar Events ────────────────────────────────────────────── */}
          {events.length > 0 && (
            <View style={[s.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <View style={s.cardHeader}>
                <Text style={s.secEmoji}>📆</Text>
                <Text style={[s.secTitle, { color: theme.text }]}>Events</Text>
              </View>

              {events.map((ev, ei) => {
                const et = EVENT_TYPES.find(t => t.id === ev.type) ?? EVENT_TYPES[3]
                return (
                  <View
                    key={ev.id}
                    style={[s.evRow, ei < events.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.divider }]}
                  >
                    <View style={[s.evIcon, { backgroundColor: et.color + '20' }]}>
                      <Text style={{ fontSize: 16 }}>{et.emoji}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.itemTitle, { color: theme.text }]}>{ev.title}</Text>
                      <Text style={[s.evMeta, { color: theme.subtext }]}>
                        {fmtTime(ev.time) ?? 'All day'} · {et.label}
                      </Text>
                    </View>
                  </View>
                )
              })}
            </View>
          )}

        </ScrollView>
      )}
    </View>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1,
  },
  backBtn: { width: 28, alignItems: 'center' },
  backArrow: { fontSize: 32, fontWeight: '300', lineHeight: 36 },
  headerTitle: { flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 19 },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16,
  },
  statusText: { fontSize: 11, fontWeight: '700' },

  content: { padding: 16, paddingBottom: 40 },

  card: { borderRadius: 20, borderWidth: 1, padding: 16, marginBottom: 14 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  secEmoji: { fontSize: 18 },
  secTitle: { flex: 1, fontSize: 16, fontWeight: '700' },
  secMeta: { fontSize: 12 },
  badge: { borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: '700' },

  section: { paddingVertical: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  itemTitle: { fontSize: 14, fontWeight: '600', flex: 1, marginRight: 6 },
  pctText: { fontSize: 14, fontWeight: '700' },

  bar: { height: 5, borderRadius: 3, overflow: 'hidden', marginBottom: 8 },
  barFill: { height: 5, borderRadius: 3 },

  stepList: { gap: 5, marginTop: 2 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepDot: { fontSize: 9, width: 14 },
  stepText: { flex: 1, fontSize: 12 },
  stepDur: { fontSize: 11 },

  muscleMapWrap: { alignItems: 'center', marginBottom: 14 },

  setsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  setChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  setChipText: { fontSize: 12 },

  macroRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginTop: 4 },
  macroChip: { fontSize: 12 },
  totalsRow: { flexDirection: 'row', gap: 14, borderTopWidth: 1, paddingTop: 10, marginTop: 4 },
  totalText: { fontSize: 12, fontWeight: '600' },

  taskRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  taskCheck: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  taskMark: { color: '#fff', fontSize: 12, fontWeight: '800' },
  taskTitle: { fontSize: 14, fontWeight: '600' },
  taskDesc: { fontSize: 12, marginTop: 2 },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },

  moodChip: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 12 },
  moodLabel: { fontSize: 14, fontWeight: '700' },
  journalText: { fontSize: 14, lineHeight: 22 },

  evRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  evIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  evMeta: { fontSize: 12, marginTop: 2 },

  emptyTitle: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  emptySubtitle: { fontSize: 13 },
})
