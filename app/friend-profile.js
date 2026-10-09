import { useState, useEffect } from 'react'
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Modal, Alert,
} from 'react-native'
import { Image } from 'expo-image'
import { useLocalSearchParams, router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../lib/ThemeContext'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import {
  ROUTINE_DEFAULTS, addRoutine, saveRoutineTemplate, getRoutineNames,
  saveWorkoutPlan, getWorkoutRoutineList,
} from '../lib/storage'
import MuscleMap from '../components/MuscleMap'

// ── Task icon keyword matcher ─────────────────────────────────────────────────

function taskIcon(text) {
  const t = (text || '').toLowerCase()
  if (/clean|wash|laundry|sweep|mop|tidy|organiz|dishes/.test(t)) return '🏠'
  if (/ready|dress|clothes|outfit|shower|bath|groom/.test(t)) return '👕'
  if (/breakfast|lunch|dinner|meal|food|cook|snack|eat/.test(t)) return '🍳'
  if (/run/.test(t)) return '🏃'
  if (/walk|jog/.test(t)) return '🚶'
  if (/exercise|workout|gym|lift|sport/.test(t)) return '💪'
  if (/meditat|yoga|stretch|breathe|mindful/.test(t)) return '🧘'
  if (/read|book|study|learn/.test(t)) return '📚'
  if (/coffee|tea/.test(t)) return '☕'
  if (/journal|write|diary/.test(t)) return '📝'
  if (/sun|outdoor|outside/.test(t)) return '☀️'
  if (/water|hydrat/.test(t)) return '💧'
  if (/vitamin|medicine|supplement|pill/.test(t)) return '💊'
  if (/gratitude|grateful|prayer/.test(t)) return '🙏'
  if (/sleep|nap/.test(t)) return '😴'
  if (/music|listen/.test(t)) return '🎵'
  if (/plan|schedule/.test(t)) return '📅'
  if (/skin|face|moistur/.test(t)) return '🧴'
  return '✅'
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

// Aggregate primary/secondary muscle names from a saved plan's exercises.
function musclesFromPlan(exercises = []) {
  const primary = new Set(), secondary = new Set()
  exercises.forEach(ex => {
    ex.muscles?.forEach(m => { if (m?.name) primary.add(m.name) })
    ex.musclesSecondary?.forEach(m => { if (m?.name) secondary.add(m.name) })
  })
  return {
    primary: [...primary],
    secondary: [...secondary].filter(m => !primary.has(m)),
  }
}

// ── Date helpers ──────────────────────────────────────────────────────────────

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December']
const DAY_HEADERS = ['S','M','T','W','T','F','S']

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDateFull(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}

function fmtMs(ms) {
  if (!ms || ms <= 0) return null
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

function fmtDur(mins) {
  if (!mins) return null
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60), m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function pctColor(p) {
  if (p >= 100) return '#10b981'
  if (p >= 50)  return '#f59e0b'
  return '#ef4444'
}

function buildSlots(year, month) {
  const dim = new Date(year, month + 1, 0).getDate()
  const fd  = new Date(year, month, 1).getDay()
  const slots = [...Array(fd).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)]
  while (slots.length % 7 !== 0) slots.push(null)
  const rows = []
  for (let i = 0; i < slots.length; i += 7) rows.push(slots.slice(i, i + 7))
  return rows
}

const CAT = {
  routine:  '#6366f1',
  workout:  '#f97316',
  deepWork: '#8b5cf6',
  meals:    '#22c55e',
}

// ── Copy (+) button ───────────────────────────────────────────────────────────

function CopyButton({ copied, onPress, theme }) {
  return (
    <Pressable
      onPress={copied ? undefined : onPress}
      hitSlop={8}
      style={[fp.copyBtn, { backgroundColor: copied ? '#10b981' : theme.accent }]}
    >
      <Text style={fp.copyBtnText}>{copied ? '✓' : '+'}</Text>
    </Pressable>
  )
}

// ── Month calendar ────────────────────────────────────────────────────────────

function MonthCalendar({ year, month, byDate, todayStr, theme, onDayPress, onPrev, onNext, canNext }) {
  const rows = buildSlots(year, month)
  return (
    <View style={[fp.calCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <View style={fp.calNav}>
        <Pressable onPress={onPrev} hitSlop={10} style={fp.calNavBtn}>
          <Text style={[fp.calNavArrow, { color: theme.accent }]}>‹</Text>
        </Pressable>
        <Text style={[fp.calMonthLabel, { color: theme.text }]}>{MONTHS[month]} {year}</Text>
        <Pressable onPress={canNext ? onNext : undefined} hitSlop={10} style={fp.calNavBtn}>
          <Text style={[fp.calNavArrow, { color: canNext ? theme.accent : theme.muted, opacity: canNext ? 1 : 0.4 }]}>›</Text>
        </Pressable>
      </View>

      <View style={fp.dayHeaderRow}>
        {DAY_HEADERS.map((h, i) => (
          <Text key={i} style={[fp.dayHeader, { color: theme.muted }]}>{h}</Text>
        ))}
      </View>

      {rows.map((row, ri) => (
        <View key={ri} style={fp.weekRow}>
          {row.map((day, ci) => {
            if (day == null) return <View key={ci} style={fp.cell} />
            const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const data = byDate[date]
            const isToday = date === todayStr
            const isFuture = date > todayStr
            const cats = []
            if (data?.routines?.length) cats.push(CAT.routine)
            if (data?.workout) cats.push(CAT.workout)
            if (data?.deepWork?.length) cats.push(CAT.deepWork)
            if (data?.meals?.length) cats.push(CAT.meals)
            const hasData = cats.length > 0
            return (
              <Pressable key={ci} style={fp.cell} disabled={isFuture} onPress={() => onDayPress(date)}>
                <View style={[
                  fp.cellInner,
                  isToday && { borderColor: theme.accent, borderWidth: 1.5 },
                  hasData && !isToday && { backgroundColor: theme.isDark ? '#ffffff0a' : '#0000000a' },
                ]}>
                  <Text style={[
                    fp.cellNum,
                    { color: isFuture ? theme.muted : isToday ? theme.accent : theme.text },
                    isToday && { fontWeight: '800' },
                  ]}>
                    {day}
                  </Text>
                  <View style={fp.dotRow}>
                    {cats.slice(0, 4).map((c, i) => (
                      <View key={i} style={[fp.dot, { backgroundColor: c }]} />
                    ))}
                  </View>
                </View>
              </Pressable>
            )
          })}
        </View>
      ))}

      <View style={fp.legendRow}>
        {[
          ['Routine', CAT.routine],
          ['Workout', CAT.workout],
          ['Deep work', CAT.deepWork],
          ['Food', CAT.meals],
        ].map(([label, color]) => (
          <View key={label} style={fp.legendItem}>
            <View style={[fp.dot, { backgroundColor: color }]} />
            <Text style={[fp.legendText, { color: theme.muted }]}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

// ── Day detail modal ──────────────────────────────────────────────────────────

function DayDetailModal({ date, data, muscleByGroup, theme, onClose }) {
  const insets = useSafeAreaInsets()
  const routines = data?.routines ?? []
  const workout  = data?.workout ?? null
  const deepWork = data?.deepWork ?? []
  const meals    = data?.meals ?? []

  const totalCal  = meals.reduce((s, m) => s + (Number(m.macros?.calories) || 0), 0)
  const totalProt = meals.reduce((s, m) => s + (Number(m.macros?.protein)  || 0), 0)
  const isEmpty = routines.length === 0 && !workout && deepWork.length === 0 && meals.length === 0

  // Primary (dark red) vs secondary (light red) from the saved plan's muscle data.
  const mg = workout?.muscleGroup ? muscleByGroup?.[workout.muscleGroup] : null
  const primaryMuscles   = mg?.primary?.length ? mg.primary : musclesFromGroup(workout?.muscleGroup)
  const secondaryMuscles = mg?.secondary ?? []

  return (
    <Modal visible={!!date} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[fp.page, { backgroundColor: theme.bg }]}>
        <View style={[fp.header, { backgroundColor: theme.header, borderBottomColor: theme.divider, paddingTop: insets.top + 10 }]}>
          <Pressable onPress={onClose} style={fp.backBtn} hitSlop={12}>
            <Text style={[fp.backBtnText, { color: theme.accent }]}>Close</Text>
          </Pressable>
          <Text style={[fp.headerTitle, { color: theme.text }]} numberOfLines={1}>
            {date ? formatDateFull(date) : ''}
          </Text>
          <View style={fp.headerRight} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }} showsVerticalScrollIndicator={false}>

          {isEmpty && (
            <View style={[fp.dCard, { backgroundColor: theme.card, borderColor: theme.cardBorder, alignItems: 'center', paddingVertical: 36 }]}>
              <Text style={{ fontSize: 44, marginBottom: 14 }}>😴</Text>
              <Text style={[fp.dEmptyTitle, { color: theme.text }]}>Rest day</Text>
              <Text style={[fp.dEmptySub, { color: theme.muted }]}>Nothing was recorded this day.</Text>
            </View>
          )}

          {/* Routines */}
          {routines.length > 0 && (
            <View style={[fp.dCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <View style={fp.dCardHeader}>
                <Text style={fp.dSecEmoji}>📋</Text>
                <Text style={[fp.dSecTitle, { color: theme.text }]}>Routines</Text>
                <View style={[fp.dBadge, { backgroundColor: theme.accent + '20' }]}>
                  <Text style={[fp.dBadgeText, { color: theme.accent }]}>
                    {routines.filter(r => r.completion >= 100).length}/{routines.length} done
                  </Text>
                </View>
              </View>
              {routines.map((r, ri) => (
                <View key={r.name} style={[fp.dSection, ri < routines.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.divider }]}>
                  <View style={fp.dRowBetween}>
                    <Text style={[fp.dItemTitle, { color: theme.text }]}>{r.name}</Text>
                    <Text style={[fp.dPct, { color: pctColor(r.completion) }]}>{r.completion}%</Text>
                  </View>
                  <View style={[fp.dBar, { backgroundColor: theme.isDark ? '#ffffff15' : '#0000000c' }]}>
                    <View style={[fp.dBarFill, { width: `${Math.min(r.completion, 100)}%`, backgroundColor: pctColor(r.completion) }]} />
                  </View>
                  {r.steps?.length > 0 && (
                    <View style={fp.dStepList}>
                      {r.steps.map((step, si) => (
                        <View key={si} style={fp.dStepRow}>
                          <Text style={[fp.dStepDot, { color: step.completedAt ? '#10b981' : theme.muted }]}>
                            {step.completedAt ? '●' : '○'}
                          </Text>
                          <Text style={[fp.dStepText, { color: step.completedAt ? theme.text : theme.muted }]}>{step.text}</Text>
                          {step.completedAt && fmtMs(step.elapsedMs) ? (
                            <Text style={[fp.dStepDur, { color: theme.muted }]}>{fmtMs(step.elapsedMs)}</Text>
                          ) : null}
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* Workout */}
          {workout && (
            <View style={[fp.dCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <View style={fp.dCardHeader}>
                <Text style={fp.dSecEmoji}>💪</Text>
                <Text style={[fp.dSecTitle, { color: theme.text }]}>Workout</Text>
                {workout.muscleGroup ? (
                  <View style={[fp.dBadge, { backgroundColor: '#f9731620' }]}>
                    <Text style={[fp.dBadgeText, { color: '#f97316' }]}>{workout.muscleGroup}</Text>
                  </View>
                ) : null}
              </View>

              {(primaryMuscles.length > 0 || secondaryMuscles.length > 0) && (
                <View style={fp.dMuscleWrap}>
                  <MuscleMap muscles={primaryMuscles} secondaryMuscles={secondaryMuscles} size={220} interactive={false} />
                </View>
              )}

              {(workout.exercises ?? []).length > 0
                ? workout.exercises.map((ex, ei) => {
                    if (ex.skipped) return null
                    const exSets = ex.sets ?? []
                    return (
                      <View key={ei} style={[fp.dSection, ei < workout.exercises.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.divider }]}>
                        <Text style={[fp.dItemTitle, { color: theme.text, marginBottom: exSets.length ? 8 : 0 }]}>
                          {ex.name ?? 'Exercise'}
                        </Text>
                        {exSets.length > 0 && (
                          <View style={fp.dSetsRow}>
                            {exSets.map((set, si) => (
                              <View key={si} style={[fp.dSetChip, { backgroundColor: theme.isDark ? '#ffffff12' : '#0000000a' }]}>
                                <Text style={[fp.dSetChipText, { color: theme.subtext }]}>
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
                : <Text style={[fp.dEmptySub, { color: theme.muted }]}>Session logged</Text>
              }
            </View>
          )}

          {/* Deep work */}
          {deepWork.length > 0 && (
            <View style={[fp.dCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <View style={fp.dCardHeader}>
                <Text style={fp.dSecEmoji}>⚡</Text>
                <Text style={[fp.dSecTitle, { color: theme.text }]}>Deep Work</Text>
                <View style={[fp.dBadge, { backgroundColor: '#8b5cf620' }]}>
                  <Text style={[fp.dBadgeText, { color: '#8b5cf6' }]}>
                    {fmtDur(deepWork.reduce((s, d) => s + (d.actualMins ?? 0), 0)) ?? '—'}
                  </Text>
                </View>
              </View>
              {deepWork.map((d, di) => (
                <View key={d.id ?? di} style={[fp.dSection, di < deepWork.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.divider }]}>
                  <View style={fp.dRowBetween}>
                    <Text style={[fp.dItemTitle, { color: theme.text }]}>{d.taskDesc || 'Focus session'}</Text>
                    {d.actualMins ? <Text style={[fp.dPct, { color: '#8b5cf6' }]}>{fmtDur(d.actualMins)}</Text> : null}
                  </View>
                  {(d.goalMins || d.rating) ? (
                    <Text style={[fp.dMeta, { color: theme.muted }]}>
                      {d.goalMins ? `Goal ${fmtDur(d.goalMins)}` : ''}
                      {d.goalMins && d.rating ? '  ·  ' : ''}
                      {d.rating ? `${'★'.repeat(Math.max(0, Math.min(5, d.rating)))}` : ''}
                    </Text>
                  ) : null}
                  {d.notes ? <Text style={[fp.dNotes, { color: theme.subtext }]}>{d.notes}</Text> : null}
                </View>
              ))}
            </View>
          )}

          {/* Nutrition */}
          {meals.length > 0 && (
            <View style={[fp.dCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <View style={fp.dCardHeader}>
                <Text style={fp.dSecEmoji}>🍽️</Text>
                <Text style={[fp.dSecTitle, { color: theme.text }]}>Nutrition</Text>
                {totalCal > 0 && (
                  <View style={[fp.dBadge, { backgroundColor: '#22c55e20' }]}>
                    <Text style={[fp.dBadgeText, { color: '#22c55e' }]}>{totalCal} kcal</Text>
                  </View>
                )}
              </View>
              {meals.map((meal, mi) => (
                <View key={mi} style={[fp.dSection, mi < meals.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.divider }]}>
                  <Text style={[fp.dItemTitle, { color: theme.text }]}>{meal.name}</Text>
                  <View style={fp.dMacroRow}>
                    {meal.macros?.calories != null && <Text style={[fp.dMacroChip, { color: theme.subtext }]}>{meal.macros.calories} kcal</Text>}
                    {meal.macros?.protein  != null && <Text style={[fp.dMacroChip, { color: '#3b82f6' }]}>P {meal.macros.protein}g</Text>}
                    {meal.macros?.carbs    != null && <Text style={[fp.dMacroChip, { color: '#f97316' }]}>C {meal.macros.carbs}g</Text>}
                    {meal.macros?.fat      != null && <Text style={[fp.dMacroChip, { color: '#eab308' }]}>F {meal.macros.fat}g</Text>}
                  </View>
                </View>
              ))}
              {(totalCal > 0 || totalProt > 0) && (
                <View style={[fp.dTotalsRow, { borderTopColor: theme.divider }]}>
                  {totalCal  > 0 && <Text style={[fp.dTotalText, { color: theme.subtext }]}>{totalCal} kcal total</Text>}
                  {totalProt > 0 && <Text style={[fp.dTotalText, { color: '#3b82f6' }]}>{totalProt}g protein</Text>}
                </View>
              )}
            </View>
          )}

        </ScrollView>
      </View>
    </Modal>
  )
}

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function FriendProfileScreen() {
  const { userId, username } = useLocalSearchParams()
  const { theme } = useTheme()
  const { user } = useAuth()
  const insets = useSafeAreaInsets()
  const viewerId = user?.id
  const now = new Date()
  const todayStr = localDateStr(now)

  const [profile, setProfile] = useState(null)
  const [streak, setStreak] = useState(null)
  const [routineNames, setRoutineNames] = useState([])
  const [routineTasks, setRoutineTasks] = useState({})
  const [workoutPlans, setWorkoutPlans] = useState([])
  const [muscleByGroup, setMuscleByGroup] = useState({})
  const [byDate, setByDate] = useState({})
  const [canView, setCanView] = useState(true)
  const [loading, setLoading] = useState(true)

  const [calYear, setCalYear]   = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth())
  const [selectedDate, setSelectedDate] = useState(null)

  const [copiedRoutines, setCopiedRoutines] = useState({})
  const [copiedWorkouts, setCopiedWorkouts] = useState({})

  useEffect(() => {
    if (userId) load()
  }, [userId])

  async function load() {
    setLoading(true)
    const isSelf = viewerId === userId
    const cutoffDate = new Date(); cutoffDate.setDate(cutoffDate.getDate() - 180)
    const cutoff = localDateStr(cutoffDate)

    // Profile + friendship are needed first to decide what to fetch.
    const [profRes, friendRes] = await Promise.all([
      supabase.from('public_profiles').select('*').eq('id', userId).single(),
      isSelf
        ? Promise.resolve({ data: null })
        : supabase.from('friendships')
            .select('id')
            .or(`and(requester_id.eq.${viewerId},addressee_id.eq.${userId}),and(requester_id.eq.${userId},addressee_id.eq.${viewerId})`)
            .eq('status', 'accepted')
            .maybeSingle(),
    ])

    setProfile(profRes.data ?? null)
    const vis = profRes.data?.visibility ?? 'friends'
    const isFriend = !!friendRes.data
    const allowed = isSelf || vis === 'everyone' || (vis === 'friends' && isFriend)
    setCanView(allowed)

    if (!allowed) {
      setLoading(false)
      return
    }

    const [streakRes, routineRes, templatesRes, plansRes, histRes, runsRes, wlRes, prodRes, mealsRes] = await Promise.all([
      supabase.from('streaks').select('current, longest').eq('user_id', userId).single(),
      supabase.from('routine_names').select('names').eq('user_id', userId).single(),
      supabase.from('routine_templates').select('routine_name, tasks').eq('user_id', userId),
      supabase.from('workout_plans').select('muscle_group, exercises').eq('user_id', userId).order('muscle_group'),
      supabase.from('history').select('date, completion, routine_name').eq('user_id', userId).gte('date', cutoff).gt('completion', 0),
      supabase.from('routine_runs').select('routine_name, date, data').eq('user_id', userId).gte('date', cutoff),
      supabase.from('workout_logs').select('date, data').eq('user_id', userId).gte('date', cutoff),
      supabase.from('productivity_sessions').select('*').eq('user_id', userId).gte('date', cutoff),
      supabase.from('meals').select('date, meals').eq('user_id', userId).gte('date', cutoff),
    ])

    setStreak(streakRes.data ?? null)

    const names = routineRes.data?.names ?? []
    setRoutineNames(names)
    const taskMap = {}
    ;(templatesRes.data ?? []).forEach(row => {
      if (Array.isArray(row.tasks)) taskMap[row.routine_name] = row.tasks
    })
    names.forEach(n => {
      if (!taskMap[n] && ROUTINE_DEFAULTS[n]) taskMap[n] = ROUTINE_DEFAULTS[n]
    })
    setRoutineTasks(taskMap)

    // Saved workouts + muscle map per group (drives primary/secondary highlighting)
    const plans = plansRes.data ?? []
    setWorkoutPlans(plans)
    const groupMap = {}
    plans.forEach(p => { groupMap[p.muscle_group] = musclesFromPlan(p.exercises ?? []) })
    setMuscleByGroup(groupMap)

    // Index logged activity by date. Runs may be stored under the routine's
    // alternative variant ("<name>::alt") — key by base name and keep whichever
    // variant completed more steps, since history is recorded per base name.
    const runsByKey = {}
    ;(runsRes.data ?? []).forEach(r => {
      const key = `${r.routine_name.replace(/::alt$/, '')}__${r.date}`
      const steps = r.data?.steps ?? []
      const done = list => list.filter(st => st.completedAt).length
      if (!runsByKey[key] || done(steps) > done(runsByKey[key])) runsByKey[key] = steps
    })

    const map = {}
    const ensure = d => (map[d] ??= { routines: [], workout: null, deepWork: [], meals: [] })

    ;(histRes.data ?? []).forEach(h => {
      ensure(h.date).routines.push({
        name: h.routine_name,
        completion: h.completion,
        steps: runsByKey[`${h.routine_name}__${h.date}`] ?? [],
      })
    })
    ;(wlRes.data ?? []).forEach(row => {
      const exercises = (row.data?.exercises ?? []).filter(e => !e.skipped && (e.sets ?? []).length > 0)
      const muscleGroup = row.data?.muscleGroup
      if (!exercises.length && !muscleGroup) return
      ensure(row.date).workout = { muscleGroup, exercises }
    })
    ;(prodRes.data ?? []).forEach(r => {
      if (!r.date) return
      ensure(r.date).deepWork.push({
        id: r.id, taskDesc: r.task_desc, goalMins: r.goal_mins,
        actualMins: r.actual_mins, rating: r.rating, notes: r.notes ?? '',
      })
    })
    ;(mealsRes.data ?? []).forEach(row => {
      if (Array.isArray(row.meals) && row.meals.length) ensure(row.date).meals = row.meals
    })

    setByDate(map)
    setLoading(false)
  }

  async function copyRoutine(name) {
    if (!viewerId) return
    try {
      const existing = await getRoutineNames(viewerId)
      let newName = name
      let i = 2
      while (existing.includes(newName)) { newName = `${name} (${i})`; i++ }
      await addRoutine(viewerId, newName)
      await saveRoutineTemplate(viewerId, newName, routineTasks[name] ?? [])
      setCopiedRoutines(prev => ({ ...prev, [name]: true }))
      Alert.alert('Saved', `"${newName}" was added to your routines.`)
    } catch (e) {
      Alert.alert('Error', e.message ?? 'Could not copy routine.')
    }
  }

  async function copyWorkout(plan) {
    if (!viewerId) return
    try {
      const list = await getWorkoutRoutineList(viewerId)
      const existing = list.map(w => w.name)
      let newName = plan.muscle_group
      let i = 2
      while (existing.includes(newName)) { newName = `${plan.muscle_group} (${i})`; i++ }
      await saveWorkoutPlan(viewerId, newName, plan.exercises ?? [])
      setCopiedWorkouts(prev => ({ ...prev, [plan.muscle_group]: true }))
      Alert.alert('Saved', `"${newName}" was added to your workouts.`)
    } catch (e) {
      Alert.alert('Error', e.message ?? 'Could not copy workout.')
    }
  }

  const handle = profile?.username ?? username ?? 'User'
  const displayName = profile?.name?.trim() || handle
  const initials = (displayName?.[0] ?? '?').toUpperCase()
  const isSelf = viewerId === userId
  const activeDayCount = Object.values(byDate).filter(d => d.routines.length || d.workout).length

  function goPrev() {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1) }
    else setCalMonth(m => m - 1)
  }
  function goNext() {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1) }
    else setCalMonth(m => m + 1)
  }
  const canNext = calYear < now.getFullYear() || (calYear === now.getFullYear() && calMonth < now.getMonth())

  function Header() {
    return (
      <View style={[fp.header, { backgroundColor: theme.header, borderBottomColor: theme.divider, paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} style={fp.backBtn} hitSlop={12}>
          <Text style={[fp.backBtnText, { color: '#6366f1' }]}>← Back</Text>
        </Pressable>
        <Text style={[fp.headerTitle, { color: theme.text }]} numberOfLines={1}>{displayName}</Text>
        <View style={fp.headerRight} />
      </View>
    )
  }

  if (loading) {
    return (
      <View style={[fp.page, { backgroundColor: theme.bg }]}>
        <Header />
        <ActivityIndicator size="large" color="#6366f1" style={{ marginTop: 80 }} />
      </View>
    )
  }

  return (
    <View style={[fp.page, { backgroundColor: theme.bg }]}>
      <Header />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={fp.content} showsVerticalScrollIndicator={false}>
        {/* Profile card */}
        <View style={[fp.profileCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          {profile?.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={fp.bigAvatar} contentFit="cover" />
          ) : (
            <View style={[fp.bigAvatar, fp.bigAvatarFallback, { backgroundColor: theme.isDark ? '#1e1e38' : '#eef2ff' }]}>
              <Text style={fp.bigAvatarInitial}>{initials}</Text>
            </View>
          )}
          <Text style={[fp.profileName, { color: theme.text }]}>{displayName}</Text>
          {profile?.name?.trim() ? (
            <Text style={[fp.profileHandle, { color: theme.muted }]}>@{handle}</Text>
          ) : null}
          {!!profile?.bio && <Text style={[fp.profileBio, { color: theme.subtext }]}>{profile.bio}</Text>}

          {canView && (
            <View style={fp.statsRow}>
              {streak?.current != null && (
                <View style={fp.statChip}>
                  <Text style={[fp.statValue, { color: theme.text }]}>{streak.current}</Text>
                  <Text style={[fp.statLabel, { color: theme.muted }]}>streak</Text>
                </View>
              )}
              {streak?.longest != null && streak.longest > 0 && (
                <View style={fp.statChip}>
                  <Text style={[fp.statValue, { color: theme.text }]}>{streak.longest}</Text>
                  <Text style={[fp.statLabel, { color: theme.muted }]}>best</Text>
                </View>
              )}
              {routineNames.length > 0 && (
                <View style={fp.statChip}>
                  <Text style={[fp.statValue, { color: theme.text }]}>{routineNames.length}</Text>
                  <Text style={[fp.statLabel, { color: theme.muted }]}>routine{routineNames.length !== 1 ? 's' : ''}</Text>
                </View>
              )}
              {activeDayCount > 0 && (
                <View style={fp.statChip}>
                  <Text style={[fp.statValue, { color: theme.text }]}>{activeDayCount}</Text>
                  <Text style={[fp.statLabel, { color: theme.muted }]}>active days</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {!canView ? (
          <View style={[fp.privateCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🔒</Text>
            <Text style={[fp.privateTitle, { color: theme.text }]}>This profile is private</Text>
            <Text style={[fp.privateSub, { color: theme.muted }]}>
              {(profile?.visibility ?? 'friends') === 'friends'
                ? 'Only friends can see their activity, routines, and workouts.'
                : 'This user has hidden their activity from everyone.'}
            </Text>
          </View>
        ) : (
          <>
            {/* Calendar */}
            <Text style={[fp.sectionLabel, { color: theme.subtext }]}>ACTIVITY CALENDAR</Text>
            <MonthCalendar
              year={calYear}
              month={calMonth}
              byDate={byDate}
              todayStr={todayStr}
              theme={theme}
              onDayPress={setSelectedDate}
              onPrev={goPrev}
              onNext={goNext}
              canNext={canNext}
            />
            <Text style={[fp.calTapHint, { color: theme.muted }]}>Tap any day to see what they did.</Text>

            {/* Saved routines */}
            {routineNames.length > 0 && (
              <>
                <Text style={[fp.sectionLabel, { color: theme.subtext }]}>SAVED ROUTINES</Text>
                {routineNames.map(name => {
                  const tasks = routineTasks[name] ?? []
                  return (
                    <View key={name} style={[fp.routineCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
                      <View style={fp.routineHeader}>
                        <Text style={{ fontSize: 16 }}>📋</Text>
                        <Text style={[fp.routineTitle, { color: theme.text }]}>{name}</Text>
                        {tasks.length > 0 && (
                          <Text style={[fp.routineCount, { color: theme.muted }]}>
                            {tasks.length} task{tasks.length !== 1 ? 's' : ''}
                          </Text>
                        )}
                        {!isSelf && <CopyButton copied={!!copiedRoutines[name]} onPress={() => copyRoutine(name)} theme={theme} />}
                      </View>
                      {tasks.map((task, i) => (
                        <View key={task.id ?? i} style={[fp.taskRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider }]}>
                          <Text style={{ fontSize: 16 }}>{task.emoji || taskIcon(task.text)}</Text>
                          <Text style={[fp.taskText, { color: theme.text }]} numberOfLines={2}>{task.text}</Text>
                        </View>
                      ))}
                    </View>
                  )
                })}
              </>
            )}

            {/* Saved workouts */}
            {workoutPlans.length > 0 && (
              <>
                <Text style={[fp.sectionLabel, { color: theme.subtext }]}>SAVED WORKOUTS</Text>
                {workoutPlans.map(plan => {
                  const exercises = plan.exercises ?? []
                  const mg = muscleByGroup[plan.muscle_group]
                  return (
                    <View key={plan.muscle_group} style={[fp.routineCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
                      <View style={fp.routineHeader}>
                        <Text style={{ fontSize: 16 }}>💪</Text>
                        <Text style={[fp.routineTitle, { color: theme.text }]}>{plan.muscle_group}</Text>
                        <Text style={[fp.routineCount, { color: theme.muted }]}>
                          {exercises.length} exercise{exercises.length !== 1 ? 's' : ''}
                        </Text>
                        {!isSelf && <CopyButton copied={!!copiedWorkouts[plan.muscle_group]} onPress={() => copyWorkout(plan)} theme={theme} />}
                      </View>

                      {(mg?.primary?.length > 0 || mg?.secondary?.length > 0) && (
                        <View style={fp.planMuscleWrap}>
                          <MuscleMap muscles={mg.primary} secondaryMuscles={mg.secondary} size={170} interactive={false} />
                        </View>
                      )}

                      {exercises.map((ex, i) => (
                        <View key={ex.id ?? i} style={[fp.taskRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider }]}>
                          <Text style={{ fontSize: 14 }}>•</Text>
                          <Text style={[fp.taskText, { color: theme.text }]} numberOfLines={2}>{ex.name ?? 'Exercise'}</Text>
                          {ex.sets ? <Text style={[fp.routineCount, { color: theme.muted }]}>{ex.sets} sets</Text> : null}
                        </View>
                      ))}
                    </View>
                  )
                })}
              </>
            )}
          </>
        )}
      </ScrollView>

      <DayDetailModal
        date={selectedDate}
        data={selectedDate ? byDate[selectedDate] : null}
        muscleByGroup={muscleByGroup}
        theme={theme}
        onClose={() => setSelectedDate(null)}
      />
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const fp = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: 16, paddingBottom: 60 },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { minWidth: 70 },
  backBtnText: { fontSize: 16, fontWeight: '600' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700' },
  headerRight: { minWidth: 70 },

  profileCard: {
    borderRadius: 20, borderWidth: 1, padding: 20, alignItems: 'center', marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
  },
  bigAvatar: { width: 80, height: 80, borderRadius: 40, marginBottom: 12 },
  bigAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  bigAvatarInitial: { fontSize: 32, fontWeight: '800', color: '#6366f1' },
  profileName: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  profileHandle: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  profileBio: { fontSize: 13, fontWeight: '400', marginTop: 6, textAlign: 'center', lineHeight: 18 },

  statsRow: { flexDirection: 'row', gap: 20, marginTop: 16 },
  statChip: { alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 11, fontWeight: '600', marginTop: 2 },

  privateCard: { borderRadius: 20, borderWidth: 1, padding: 28, alignItems: 'center' },
  privateTitle: { fontSize: 17, fontWeight: '800', marginBottom: 6 },
  privateSub: { fontSize: 13, textAlign: 'center', lineHeight: 19 },

  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 10, marginTop: 4 },

  // Calendar
  calCard: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 8 },
  calNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  calNavBtn: { width: 40, alignItems: 'center' },
  calNavArrow: { fontSize: 30, fontWeight: '300', lineHeight: 32 },
  calMonthLabel: { fontSize: 16, fontWeight: '800' },
  dayHeaderRow: { flexDirection: 'row', marginBottom: 6 },
  dayHeader: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700' },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  cell: { flex: 1, aspectRatio: 1, padding: 2 },
  cellInner: { flex: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 3 },
  cellNum: { fontSize: 14, fontWeight: '600' },
  dotRow: { flexDirection: 'row', gap: 2, height: 5, alignItems: 'center' },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center', marginTop: 10, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#80808033' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendText: { fontSize: 11, fontWeight: '600' },
  calTapHint: { fontSize: 12, fontWeight: '500', textAlign: 'center', marginBottom: 20 },

  // Routine / workout cards
  routineCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden', marginBottom: 12 },
  routineHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  routineTitle: { fontSize: 16, fontWeight: '700', flex: 1 },
  routineCount: { fontSize: 12, fontWeight: '600' },
  taskRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11, gap: 12 },
  taskText: { fontSize: 14, fontWeight: '500', flex: 1 },
  planMuscleWrap: { alignItems: 'center', paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#80808022' },

  copyBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  copyBtnText: { color: '#fff', fontSize: 18, fontWeight: '800', lineHeight: 20 },

  // Day detail modal
  dCard: { borderRadius: 20, borderWidth: 1, padding: 16, marginBottom: 14 },
  dCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  dSecEmoji: { fontSize: 18 },
  dSecTitle: { flex: 1, fontSize: 16, fontWeight: '700' },
  dBadge: { borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4 },
  dBadgeText: { fontSize: 12, fontWeight: '700' },
  dSection: { paddingVertical: 12 },
  dRowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  dItemTitle: { fontSize: 14, fontWeight: '600', flex: 1, marginRight: 6 },
  dPct: { fontSize: 14, fontWeight: '700' },
  dBar: { height: 5, borderRadius: 3, overflow: 'hidden', marginBottom: 8 },
  dBarFill: { height: 5, borderRadius: 3 },
  dStepList: { gap: 5, marginTop: 2 },
  dStepRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dStepDot: { fontSize: 9, width: 14 },
  dStepText: { flex: 1, fontSize: 12 },
  dStepDur: { fontSize: 11 },
  dMuscleWrap: { alignItems: 'center', marginBottom: 14 },
  dSetsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dSetChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  dSetChipText: { fontSize: 12 },
  dMeta: { fontSize: 12, marginTop: 2 },
  dNotes: { fontSize: 13, marginTop: 6, lineHeight: 18 },
  dMacroRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginTop: 4 },
  dMacroChip: { fontSize: 12 },
  dTotalsRow: { flexDirection: 'row', gap: 14, borderTopWidth: 1, paddingTop: 10, marginTop: 4 },
  dTotalText: { fontSize: 12, fontWeight: '600' },
  dEmptyTitle: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  dEmptySub: { fontSize: 13 },
})
