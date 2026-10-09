import { useState, useCallback, useLayoutEffect, useEffect, useRef } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  Modal, Switch, Alert, KeyboardAvoidingView, Platform,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Svg, { Circle } from 'react-native-svg'
import { router, useFocusEffect, useNavigation } from 'expo-router'
import { useAuth } from '../../lib/AuthContext'
import { useTheme } from '../../lib/ThemeContext'
import StreakBadge from '../../components/StreakBadge'
import { getRoutineNames, getRoutineTemplates, getTodayRunsEither, getStreak, getGymSplit, getRoutineStreaks, deleteRoutine, getHiddenDefaults, setHiddenDefaults, getRoutineSettings, getWeeklyRoutines, saveWeeklyRoutines, today, getDayTodos, getCalendarEvents, getScheduleItems, getTasks, getJournalEntries, getRoutineGroupMap, getDayRules, saveDayRules } from '../../lib/storage'
import { getSections, DEFAULT_SECTIONS } from '../../lib/sectionsStorage'
import { syncRoutineNotifications } from '../../lib/routineNotifications'
import { routineTheme } from '../../lib/themes'
import { todaySplitIndex, muscleColor, muscleTextColor, normalizeDay } from '../../lib/splitData'

const DEFAULT_ROUTINES = new Set(['Morning', 'Fitness', 'Night'])

// Focus refetch throttle: a tab hop back here within this window keeps
// rendering cached state instead of hitting the network again.
const REFETCH_MS = 30 * 1000

// Section identities for the routine groups (chip + rule tint)
const EVERYDAY_COLOR = '#f59e0b'
const WHENEVER_COLOR = '#06b6d4'

function fmtMs(ms) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

function fmtTime(mins) {
  const total = ((mins % 1440) + 1440) % 1440
  const h = Math.floor(total / 60)
  const m = total % 60
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

// ── Daily Dashboard ───────────────────────────────────────────────────────

const EVT_EMOJI = { assignment: '📚', meeting: '📅', reminder: '🔔', other: '📌' }
const CIRC_R      = 22
const CIRC_STROKE = 5
const CIRC_CIRCUM = 2 * Math.PI * CIRC_R

function fmtEventTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function nextRoutineNudge(visible, doneCount, total) {
  if (total === 0) return 'Add a routine to get started'
  if (doneCount >= total) return 'All done — outstanding!'
  const next = visible.find(r => !r.run?.finished)
  if (!next) return 'Keep it up!'
  return doneCount === 0
    ? `Let's start logging your ${next.name} routine!`
    : `Let's move onto ${next.name} routine!`
}

function DailyDashboard({ user, profile, routines, hiddenSet, routineStreaks, theme }) {
  const [calItems, setCalItems] = useState([])
  const [pendingTodos, setPendingTodos] = useState([])
  const [tasksToday, setTasksToday] = useState([])
  const [todayJournal, setTodayJournal] = useState(null)
  const [collapsed, setCollapsed] = useState(false)
  // Rules for the day — persist until the user changes them
  const [rules, setRules] = useState([])
  const [rulesOpen, setRulesOpen] = useState(false)
  const [draftRules, setDraftRules] = useState([])
  const [newRule, setNewRule] = useState('')
  // Stamped on each successful fetch — focus refetches inside the throttle
  // window keep showing what's already here.
  const lastDashLoadRef = useRef(0)

  useEffect(() => {
    if (!user?.id) return
    AsyncStorage.getItem(`@dash_collapsed_${user.id}`).then(v => {
      if (v === 'true') setCollapsed(true)
    }).catch(() => {})
  }, [user?.id])

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    if (user?.id) AsyncStorage.setItem(`@dash_collapsed_${user.id}`, String(next)).catch(() => {})
  }

  function openRulesEditor() {
    setDraftRules(rules.map(r => ({ ...r })))
    setNewRule('')
    setRulesOpen(true)
  }

  function addDraftRule() {
    const text = newRule.trim()
    if (!text) return
    setDraftRules(prev => [...prev, { id: Date.now(), text }])
    setNewRule('')
  }

  async function saveRules() {
    const cleaned = draftRules
      .map(r => ({ ...r, text: r.text.trim() }))
      .filter(r => r.text)
    // Text typed into the add field but not yet ＋'d still counts.
    const pending = newRule.trim()
    if (pending) cleaned.push({ id: Date.now(), text: pending })
    setRules(cleaned)
    setRulesOpen(false)
    await saveDayRules(user.id, cleaned)
  }

  useFocusEffect(useCallback(() => {
    if (!user?.id) return
    if (Date.now() - lastDashLoadRef.current < REFETCH_MS) return
    const key = today()
    Promise.all([
      getCalendarEvents(user.id),
      getDayTodos(user.id, key),
      getScheduleItems(user.id),
      getTasks(user.id),
      getJournalEntries(user.id),
      getDayRules(user.id),
    ]).then(([events, todos, schedule, allTasks, jEntries, dayRules]) => {
      setRules(dayRules)
      const dow = new Date().getDay()
      const combined = [
        ...events.filter(e => e.date === key),
        ...schedule.filter(s => s.days?.includes(dow)),
      ].sort((a, b) =>
        (a.time || a.startTime || '99:99').localeCompare(b.time || b.startTime || '99:99')
      )
      setCalItems(combined.slice(0, 4))
      setPendingTodos(todos.filter(t => !t.done).slice(0, 2))
      setTasksToday(allTasks.filter(t => !t.done && t.dueDate === key).slice(0, 3))
      setTodayJournal(jEntries[key] ?? null)
      lastDashLoadRef.current = Date.now()
    }).catch(() => {}) // a failed refetch keeps whatever is already on screen
  }, [user?.id]))

  const visible   = routines.filter(r => !hiddenSet.has(r.name))
  const doneCount = visible.filter(r => r.run?.finished).length
  const total     = visible.length
  const pct       = total > 0 ? doneCount / total : 0
  const arcDash   = pct * CIRC_CIRCUM

  const activeStreaks = Object.entries(routineStreaks)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)

  const displayName = (profile?.name?.trim() || user?.name || 'there').split(' ')[0]
  const dateLabel   = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  const allItems = [
    ...calItems,
    ...tasksToday.map(t => ({ ...t, _isTask: true })),
    ...pendingTodos.map(t => ({ ...t, _isTodo: true })),
  ].slice(0, 4)

  return (
    <View style={[db.card, { backgroundColor: theme.card, borderColor: theme.cardBorder, shadowColor: theme.isDark ? 'transparent' : '#0d1b5e' }]}>
      {/* Header: greeting + circle (when expanded) + collapse toggle */}
      <View style={db.headerRow}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={[db.welcome, { color: theme.text }]}>
            Welcome back,{' '}
            <Text style={{ color: theme.accent, fontWeight: '800' }}>{displayName}</Text>
          </Text>
          <Text style={[db.dateStr, { color: theme.subtext }]}>{dateLabel}</Text>
          {!collapsed && (
            <Text style={[db.motivation, { color: theme.muted }]}>
              {nextRoutineNudge(visible, doneCount, total)}
            </Text>
          )}
        </View>
        {!collapsed && (
          <View style={db.circleWrap}>
            <Svg width={60} height={60}>
              <Circle cx={30} cy={30} r={CIRC_R} fill="none"
                stroke={theme.isDark ? '#ffffff12' : '#e5e7eb'} strokeWidth={CIRC_STROKE} />
              {pct > 0 && (
                <Circle cx={30} cy={30} r={CIRC_R} fill="none"
                  stroke={pct >= 1 ? '#10b981' : '#6366f1'}
                  strokeWidth={CIRC_STROKE}
                  strokeDasharray={`${arcDash} ${CIRC_CIRCUM}`}
                  strokeLinecap="round"
                  transform="rotate(-90 30 30)"
                />
              )}
            </Svg>
            <View style={db.circleLabel}>
              <Text style={[db.circleNum, { color: pct >= 1 ? '#10b981' : theme.text }]}>{doneCount}</Text>
              <Text style={[db.circleDen, { color: theme.muted }]}>/{total}</Text>
            </View>
          </View>
        )}
        <Pressable onPress={toggleCollapsed} hitSlop={12} style={db.collapseBtn}>
          <Text style={[db.chevron, { color: theme.muted }]}>{collapsed ? '▼' : '▲'}</Text>
        </Pressable>
      </View>

      {!collapsed && (
        <>
          {/* Active streaks — no limit, wraps naturally */}
          {activeStreaks.length > 0 && (
            <View style={db.streakRow}>
              {activeStreaks.map(([name, count]) => {
                const card = routineTheme(name)
                return (
                  <View key={name} style={[db.streakChip, { backgroundColor: card.color + '18' }]}>
                    <Text style={{ fontSize: 11 }}>🔥</Text>
                    <Text style={[db.streakChipText, { color: card.color }]}>{name} · {count}</Text>
                  </View>
                )
              })}
            </View>
          )}

          {/* Rules for today — persist until the user changes them */}
          <View style={[db.divider, { backgroundColor: theme.divider }]} />
          {rules.length > 0 ? (
            <>
              <View style={db.rulesHeaderRow}>
                <Text style={[db.rulesTitle, { color: theme.text }]}>📜  Rules for today</Text>
                <Pressable onPress={openRulesEditor} hitSlop={8}>
                  <Text style={[db.rulesEdit, { color: theme.accent }]}>Edit</Text>
                </Pressable>
              </View>
              {rules.map((r, i) => (
                <View key={r.id} style={db.ruleRow}>
                  <View style={[db.ruleNum, { backgroundColor: theme.accent + '18' }]}>
                    <Text style={[db.ruleNumText, { color: theme.accent }]}>{i + 1}</Text>
                  </View>
                  <Text style={[db.ruleText, { color: theme.text }]}>{r.text}</Text>
                </View>
              ))}
            </>
          ) : (
            <Pressable style={db.eventRow} onPress={openRulesEditor}>
              <Text style={{ fontSize: 12 }}>📜</Text>
              <Text style={[db.eventTitle, { color: theme.text }]}>Rules for today</Text>
              <Text style={[db.eventTime, { color: theme.muted }]}>Set them →</Text>
            </Pressable>
          )}

          {/* Today's events & todos */}
          {allItems.length > 0 && (
            <>
              <View style={[db.divider, { backgroundColor: theme.divider }]} />
              {allItems.map((item, i) => {
                const isTodo     = !!item._isTodo
                const isTask     = !!item._isTask
                const isSchedule = !isTodo && !isTask && item.startTime !== undefined
                const title = isTodo ? item.text : item.title
                const time  = isSchedule ? item.startTime : item.time
                const emoji = isTodo ? '✅' : isTask ? '🎯' : isSchedule ? '📅' : (EVT_EMOJI[item.type] ?? '📌')
                return (
                  <View key={item.id ?? i} style={db.eventRow}>
                    <Text style={{ fontSize: 12 }}>{emoji}</Text>
                    <Text style={[db.eventTitle, { color: theme.text }]} numberOfLines={1}>{title}</Text>
                    {time ? <Text style={[db.eventTime, { color: theme.muted }]}>{fmtEventTime(time)}</Text> : null}
                  </View>
                )
              })}
            </>
          )}

          {/* Journal status */}
          <View style={[db.divider, { backgroundColor: theme.divider }]} />
          <Pressable style={db.eventRow} onPress={() => router.push('/(tabs)/calendar?openJournal=1')}>
            <Text style={{ fontSize: 12 }}>📔</Text>
            <Text style={[db.eventTitle, { color: theme.text }]}>Journal</Text>
            <Text style={[db.eventTime, { color: todayJournal ? '#10b981' : theme.muted }]}>
              {todayJournal ? '✓ Written' : 'Not yet →'}
            </Text>
          </Pressable>
        </>
      )}

      {/* Rules editor sheet */}
      <Modal
        visible={rulesOpen}
        transparent
        animationType="slide"
        onRequestClose={saveRules}
      >
        <KeyboardAvoidingView style={s.settingsOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={s.settingsBg} onPress={saveRules} />
          <View style={[db.rulesSheet, { backgroundColor: theme.card }]}>
            <View style={[s.settingsHandle, { backgroundColor: theme.divider }]} />
            <Text style={[db.rulesSheetTitle, { color: theme.text }]}>📜  Rules for today</Text>
            <Text style={[db.rulesSheetSub, { color: theme.muted }]}>
              Your ground rules for each day. They stay until you change them.
            </Text>

            {draftRules.map((r, i) => (
              <View key={r.id} style={[db.rulesEditRow, { borderBottomColor: theme.divider }]}>
                <View style={[db.ruleNum, { backgroundColor: theme.accent + '18' }]}>
                  <Text style={[db.ruleNumText, { color: theme.accent }]}>{i + 1}</Text>
                </View>
                <TextInput
                  style={[db.rulesEditInput, { color: theme.text }]}
                  value={r.text}
                  onChangeText={v => setDraftRules(prev => prev.map(x => x.id === r.id ? { ...x, text: v } : x))}
                  placeholder="Rule…"
                  placeholderTextColor={theme.muted}
                  multiline
                  returnKeyType="done"
                />
                <Pressable onPress={() => setDraftRules(prev => prev.filter(x => x.id !== r.id))} hitSlop={8}>
                  <Text style={[db.rulesDelete, { color: theme.muted }]}>✕</Text>
                </Pressable>
              </View>
            ))}

            <View style={db.rulesAddRow}>
              <TextInput
                style={[db.rulesAddInput, { color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder }]}
                placeholder={draftRules.length ? 'Add another rule…' : 'e.g. No phone before 9 AM'}
                placeholderTextColor={theme.muted}
                value={newRule}
                onChangeText={setNewRule}
                onSubmitEditing={addDraftRule}
                returnKeyType="done"
              />
              <Pressable onPress={addDraftRule} style={[db.rulesAddBtn, { backgroundColor: theme.accent }]}>
                <Text style={db.rulesAddBtnText}>+</Text>
              </Pressable>
            </View>

            <Pressable style={[db.rulesDoneBtn, { backgroundColor: theme.accent }]} onPress={saveRules}>
              <Text style={db.rulesDoneBtnText}>Done</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

function RoutineCard({ name, template, run, todayMuscle, routineStreak, settings, isDefault, isHidden, onHide, onUnhide, onDelete, group = 'everyday' }) {
  const { theme } = useTheme()
  const card = routineTheme(name)
  const isRunning = !isHidden && run && !run.finished
  const isDone    = !isHidden && run?.finished

  let statusText = isHidden ? 'Hidden · not counted in streak' : `${template.length} tasks`
  let btnLabel   = 'Start  →'
  let btnColor   = card.color

  if (isDone) {
    statusText = `Done in ${fmtMs(run.completedAt - run.startedAt)}`
    btnLabel   = 'View Summary  →'
    btnColor   = '#10b981'
  } else if (isRunning) {
    statusText = `Task ${run.currentStep + 1} of ${run.steps.length}`
    btnLabel   = 'Continue  →'
    btnColor   = '#f59e0b'
  }

  const todayMuscles = normalizeDay(todayMuscle)
  const showSplit    = name === 'Fitness' && !isHidden && todayMuscles[0] !== 'Rest'

  const totalGoalMins = Math.round(template.reduce((sum, t) => sum + (t.timeGoalSecs ?? (t.timeGoalMins ?? 0) * 60) / 60, 0))
  // Whenever routines aren't scheduled — no time range on their cards.
  const timeRange = settings && group !== 'whenever'
    ? totalGoalMins > 0
      ? `${fmtTime(settings.startTimeMinutes)} – ${fmtTime(settings.startTimeMinutes + totalGoalMins)}`
      : fmtTime(settings.startTimeMinutes)
    : null

  return (
    <Pressable
      style={[s.card, {
        backgroundColor: theme.card,
        borderColor: theme.cardBorder,
        shadowColor: theme.isDark ? 'transparent' : '#0d1b5e',
        opacity: isHidden ? 0.55 : 1,
      }]}
      onPress={isHidden ? undefined : () => router.push('/routine/' + name)}
    >
      <View style={[s.cardStripe, { backgroundColor: card.color }]} />
      <View style={s.cardContent}>
        <View style={s.cardTop}>
          <View style={[s.emojiCircle, { backgroundColor: theme.isDark ? theme.bg : card.bg }]}>
            <Text style={s.emoji}>{card.emoji}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <View style={s.cardNameRow}>
              <Text style={[s.cardName, { color: theme.text }]}>{name}</Text>
              {!isHidden && routineStreak > 0 && (
                <View style={[s.rStreak, { backgroundColor: theme.isDark ? '#2d1a00' : '#fff3e0' }]}>
                  <Text style={s.rStreakText}>🔥 {routineStreak}</Text>
                </View>
              )}
            </View>
            <Text style={[
              s.cardStatus,
              { color: theme.subtext },
              isDone    && { color: '#10b981' },
              isRunning && { color: '#f59e0b' },
              isHidden  && { color: theme.muted, fontStyle: 'italic' },
            ]}>
              {statusText}
            </Text>
            {!isHidden && !!settings?.description && (
              <Text style={[s.cardDesc, { color: theme.muted }]} numberOfLines={2}>
                {settings.description}
              </Text>
            )}
            {!isHidden && timeRange && (
              <Text style={[s.cardTime, { color: theme.muted }]}>🕐 {timeRange}</Text>
            )}
          </View>
          <View style={s.cardTopRight}>
            {isDone && (
              <View style={[s.doneBadge, { backgroundColor: theme.isDark ? '#0d2e21' : '#ecfdf5' }]}>
                <Text style={s.doneBadgeText}>✓</Text>
              </View>
            )}
            {isRunning && (
              <View style={[s.liveBadge, { backgroundColor: theme.isDark ? '#2d1e08' : '#fff7ed' }]}>
                <View style={s.liveDot} />
                <Text style={s.liveText}>Live</Text>
              </View>
            )}
            <Pressable
              style={[s.cardEditBtn, { borderColor: theme.cardBorder }]}
              onPress={() => router.push('/setup-routine?name=' + encodeURIComponent(name))}
              hitSlop={10}
            >
              <Text style={[s.cardEditBtnText, { color: card.color }]}>Edit</Text>
            </Pressable>
            {isDefault ? (
              <Pressable
                style={[s.cardHideBtn, {
                  borderColor: isHidden ? theme.accent : theme.cardBorder,
                  backgroundColor: isHidden ? (theme.isDark ? '#1e1e38' : '#eef2ff') : 'transparent',
                }]}
                onPress={isHidden ? onUnhide : onHide}
                hitSlop={10}
              >
                <Text style={[s.cardHideBtnText, { color: isHidden ? theme.accent : theme.subtext }]}>
                  {isHidden ? 'Show' : 'Hide'}
                </Text>
              </Pressable>
            ) : (
              <Pressable style={s.cardDeleteBtn} onPress={onDelete} hitSlop={10}>
                <Text style={s.cardDeleteBtnIcon}>🗑</Text>
              </Pressable>
            )}
          </View>
        </View>

        {showSplit && (
          <View style={s.splitPillsRow}>
            {todayMuscles.map(m => (
              <View key={m} style={[s.splitPill, { backgroundColor: muscleColor(m) }]}>
                <Text style={[s.splitPillText, { color: muscleTextColor(m) }]}>{m}</Text>
              </View>
            ))}
          </View>
        )}

        {!isHidden && (
          <Pressable
            style={[s.cardBtn, { backgroundColor: btnColor }]}
            onPress={() => router.push('/routine/' + name)}
          >
            <Text style={s.cardBtnText}>{btnLabel}</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  )
}

// ── Weekly helpers ────────────────────────────────────────────────────────

const WEEKLY_PALETTE = [
  { color: '#8b5cf6', bg: '#f5f3ff', emoji: '🌅' },
  { color: '#10b981', bg: '#ecfdf5', emoji: '💰' },
  { color: '#f59e0b', bg: '#fffbeb', emoji: '📋' },
  { color: '#3b82f6', bg: '#eff6ff', emoji: '🎯' },
  { color: '#ec4899', bg: '#fdf2f8', emoji: '⚡' },
  { color: '#06b6d4', bg: '#ecfeff', emoji: '🏆' },
]

function weeklyRoutineTheme(index) {
  const { emoji } = WEEKLY_PALETTE[index % WEEKLY_PALETTE.length]
  return { color: '#8b5cf6', bg: '#f5f3ff', emoji }
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// ── Weekly Routine card (expandable checklist) ───────────────────────────

function WeeklyRoutineCard({ routine, theme, colorIndex, onToggleTask, onDelete, onSaveTask, onUpdate }) {
  const [expanded, setExpanded] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [addingTask, setAddingTask] = useState(false)
  const [newTaskText, setNewTaskText] = useState('')
  const [editName, setEditName] = useState('')
  const [editDays, setEditDays] = useState(Array(7).fill(false))
  const [editAutoReset, setEditAutoReset] = useState(false)
  const [editTasks, setEditTasks] = useState([])
  const { color, bg, emoji } = weeklyRoutineTheme(colorIndex)
  const doneCount = routine.tasks.filter(t => t.done).length
  const allDone = doneCount === routine.tasks.length && routine.tasks.length > 0
  const hasResetDays = routine.autoReset && routine.resetDays?.some(Boolean)

  function openEdit() {
    setEditName(routine.name)
    setEditDays(routine.resetDays ?? Array(7).fill(false))
    setEditAutoReset(routine.autoReset ?? false)
    setEditTasks(routine.tasks.map(t => ({ ...t })))
    setExpanded(true)
    setIsEditing(true)
  }

  function saveEdit() {
    if (!editName.trim()) return
    const validTasks = editTasks.filter(t => t.text.trim())
    if (!validTasks.length) return
    onUpdate(routine.id, { name: editName.trim(), resetDays: editDays, autoReset: editAutoReset, tasks: validTasks })
    setIsEditing(false)
  }

  function confirmAddTask() {
    if (!newTaskText.trim()) { setAddingTask(false); return }
    onSaveTask(routine.id, newTaskText.trim())
    setNewTaskText('')
    setAddingTask(false)
  }

  function promptAddList() {
    Alert.prompt('New list', 'Name this list (e.g. Weekly Goals)', text => {
      const clean = text?.trim()
      if (!clean) return
      onUpdate(routine.id, { lists: [...(routine.lists ?? []), { id: Date.now(), name: clean, items: [] }] })
    }, 'plain-text')
  }

  return (
    <View style={[wk.card, { backgroundColor: theme.card, borderColor: theme.cardBorder, shadowColor: theme.isDark ? 'transparent' : '#0d1b5e' }]}>
      <View style={[wk.cardStripe, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <Pressable style={wk.cardHeader} onPress={() => !isEditing && setExpanded(e => !e)}>
          <View style={[wk.cardIcon, { backgroundColor: theme.isDark ? theme.bg : bg }]}>
            <Text style={wk.cardEmoji}>{emoji}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={[wk.cardName, { color: theme.text }]}>{routine.name}</Text>
            <Text style={[wk.cardStatus, { color: allDone ? '#10b981' : theme.subtext }]}>
              {allDone ? 'All done ✓' : `${doneCount} / ${routine.tasks.length} done`}
              {hasResetDays ? '  ·  ↺' : ''}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: 4 }}>
            <Pressable style={[wk.cardEditIconBtn, { borderColor: color + '55' }]} onPress={openEdit} hitSlop={10}>
              <Text style={[wk.cardEditIconText, { color }]}>Edit</Text>
            </Pressable>
            <Pressable onPress={onDelete} hitSlop={10}>
              <Text style={{ fontSize: 13 }}>🗑</Text>
            </Pressable>
            {!isEditing && (
              <Text style={{ color: theme.muted, fontSize: 12 }}>{expanded ? '▲' : '▼'}</Text>
            )}
          </View>
        </Pressable>

        {/* ── Inline edit section ── */}
        {isEditing && (
          <View style={[wk.editSection, { borderTopColor: theme.divider }]}>
            <Text style={[wk.editLabel, { color: theme.subtext }]}>NAME</Text>
            <TextInput
              style={[wk.editNameInput, { color: theme.text, borderColor: color + '88', backgroundColor: theme.bg }]}
              value={editName}
              onChangeText={setEditName}
              placeholder="Routine name"
              placeholderTextColor={theme.muted}
            />
            <View style={[wk.editToggleRow, { borderColor: theme.cardBorder }]}>
              <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>Auto-reset tasks</Text>
              <Switch
                value={editAutoReset}
                onValueChange={v => { setEditAutoReset(v); if (!v) setEditDays(Array(7).fill(false)) }}
                trackColor={{ false: '#e0e0f0', true: color + 'aa' }}
                thumbColor="#ffffff"
                ios_backgroundColor="#e0e0f0"
              />
            </View>
            {editAutoReset && (
              <>
                <Text style={[wk.editLabel, { color: theme.subtext }]}>RESET ON THESE DAYS:</Text>
                <View style={wk.dayRow}>
                  {DAY_LABELS.map((label, i) => (
                    <Pressable
                      key={i}
                      style={[wk.dayCircle,
                        editDays[i]
                          ? { backgroundColor: color }
                          : { backgroundColor: theme.isDark ? '#2a2a3e' : '#e5e7eb' },
                      ]}
                      onPress={() => setEditDays(d => d.map((v, j) => j === i ? !v : v))}
                    >
                      <Text style={[wk.dayCircleText, { color: editDays[i] ? '#fff' : theme.subtext }]}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
            <Text style={[wk.editLabel, { color: theme.subtext }]}>TASKS</Text>
            {editTasks.map((task, i) => (
              <View key={task.id} style={wk.editTaskRow}>
                <TextInput
                  style={[wk.editTaskInput, { color: theme.text, borderColor: theme.cardBorder, backgroundColor: theme.bg }]}
                  value={task.text}
                  onChangeText={v => setEditTasks(ts => ts.map((t, j) => j === i ? { ...t, text: v } : t))}
                  placeholder={`Task ${i + 1}`}
                  placeholderTextColor={theme.muted}
                />
                <Pressable onPress={() => setEditTasks(ts => ts.filter((_, j) => j !== i))} hitSlop={10} style={{ padding: 8 }}>
                  <Text style={{ color: '#ef4444', fontSize: 14 }}>✕</Text>
                </Pressable>
              </View>
            ))}
            <Pressable style={wk.editAddTask} onPress={() => setEditTasks(ts => [...ts, { id: Date.now(), text: '', done: false }])}>
              <Text style={[wk.editAddTaskText, { color }]}>＋  Add task</Text>
            </Pressable>
            <View style={wk.editActions}>
              <Pressable style={[wk.editCancel, { borderColor: theme.cardBorder }]} onPress={() => setIsEditing(false)}>
                <Text style={{ color: theme.subtext, fontWeight: '600', fontSize: 14 }}>Cancel</Text>
              </Pressable>
              <Pressable style={[wk.editSave, { backgroundColor: color }]} onPress={saveEdit}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Save</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* ── Task list (expanded, not editing) ── */}
        {!isEditing && expanded && (
          <View style={[wk.taskList, { borderTopColor: theme.divider }]}>
            {routine.tasks.map(task => (
              <Pressable key={task.id} style={wk.taskRow} onPress={() => onToggleTask(routine.id, task.id)}>
                <View style={[wk.taskCheck, task.done && { backgroundColor: color, borderColor: color }]}>
                  {task.done && <Text style={wk.taskMark}>✓</Text>}
                </View>
                <Text style={[wk.taskText, { color: theme.text }, task.done && wk.taskTextDone]} numberOfLines={2}>
                  {task.text}
                </Text>
              </Pressable>
            ))}
            {addingTask ? (
              <View style={wk.addTaskRow}>
                <TextInput
                  style={[wk.addTaskInput, { color: theme.text, borderColor: theme.cardBorder, backgroundColor: theme.bg }]}
                  placeholder="New task..."
                  placeholderTextColor={theme.muted}
                  value={newTaskText}
                  onChangeText={setNewTaskText}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={confirmAddTask}
                />
                <Pressable style={[wk.addTaskConfirm, { backgroundColor: color }]} onPress={confirmAddTask}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Add</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable style={wk.addTaskBtn} onPress={() => setAddingTask(true)}>
                <Text style={[wk.addTaskBtnText, { color }]}>＋  Add task</Text>
              </Pressable>
            )}

            {/* ── Lists (e.g. Weekly Goals) ── */}
            {(routine.lists ?? []).map(list => (
              <WeeklyListBlock
                key={list.id}
                list={list}
                color={color}
                theme={theme}
                onChange={next => onUpdate(routine.id, { lists: (routine.lists ?? []).map(l => l.id === next.id ? next : l) })}
                onDelete={() => Alert.alert('Delete list?', `Remove "${list.name}" and everything in it?`, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete', style: 'destructive',
                    onPress: () => onUpdate(routine.id, { lists: (routine.lists ?? []).filter(l => l.id !== list.id) }),
                  },
                ])}
              />
            ))}
            <Pressable style={wk.addListBtn} onPress={promptAddList}>
              <Text style={[wk.addTaskBtnText, { color }]}>＋  Add list</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  )
}

// ── Weekly routine list block (e.g. "Weekly Goals") ──────────────────────
// A named, fully editable checklist inside a weekly routine: rename via ✏️,
// tap to check items, long-press an item to edit its text, ✕ to remove.

function WeeklyListBlock({ list, color, theme, onChange, onDelete }) {
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(list.name)
  const [newItem, setNewItem] = useState('')
  const items = list.items ?? []
  const done = items.filter(i => i.done).length

  function saveName() {
    const clean = nameDraft.trim()
    setEditingName(false)
    if (clean && clean !== list.name) onChange({ ...list, name: clean })
    else setNameDraft(list.name)
  }

  function addItem() {
    const text = newItem.trim()
    if (!text) return
    setNewItem('')
    onChange({ ...list, items: [...items, { id: Date.now(), text, done: false }] })
  }

  function editItem(item) {
    Alert.prompt('Edit item', undefined, text => {
      const clean = text?.trim()
      if (!clean) return
      onChange({ ...list, items: items.map(it => it.id === item.id ? { ...it, text: clean } : it) })
    }, 'plain-text', item.text)
  }

  return (
    <View style={[wk.listBlock, { borderColor: theme.cardBorder, backgroundColor: theme.isDark ? '#ffffff08' : '#f8f8fd' }]}>
      <View style={wk.listHeader}>
        {editingName ? (
          <TextInput
            style={[wk.listNameInput, { color: theme.text, borderColor: color + '88', backgroundColor: theme.bg }]}
            value={nameDraft}
            onChangeText={setNameDraft}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={saveName}
            onBlur={saveName}
          />
        ) : (
          <>
            <Text style={[wk.listName, { color }]}>📝 {list.name}</Text>
            {items.length > 0 && <Text style={[wk.listCount, { color: theme.muted }]}>{done}/{items.length}</Text>}
            <Pressable onPress={() => { setNameDraft(list.name); setEditingName(true) }} hitSlop={8} style={{ padding: 2 }}>
              <Text style={{ fontSize: 12 }}>✏️</Text>
            </Pressable>
            <Pressable onPress={onDelete} hitSlop={8} style={{ padding: 2 }}>
              <Text style={{ color: theme.muted, fontSize: 13, fontWeight: '600' }}>✕</Text>
            </Pressable>
          </>
        )}
      </View>

      {items.map(item => (
        <Pressable
          key={item.id}
          style={wk.listItemRow}
          onPress={() => onChange({ ...list, items: items.map(it => it.id === item.id ? { ...it, done: !it.done } : it) })}
          onLongPress={() => editItem(item)}
          delayLongPress={350}
        >
          <View style={[wk.listItemCheck, { borderColor: color }, item.done && { backgroundColor: color }]}>
            {item.done && <Text style={wk.taskMark}>✓</Text>}
          </View>
          <Text style={[wk.listItemText, { color: theme.text }, item.done && wk.taskTextDone]}>{item.text}</Text>
          <Pressable
            onPress={() => onChange({ ...list, items: items.filter(it => it.id !== item.id) })}
            hitSlop={8}
            style={{ padding: 4 }}
          >
            <Text style={{ color: theme.muted, fontSize: 12 }}>✕</Text>
          </Pressable>
        </Pressable>
      ))}

      <View style={wk.listAddRow}>
        <TextInput
          style={[wk.listAddInput, { color: theme.text, borderColor: theme.cardBorder, backgroundColor: theme.bg }]}
          placeholder="Add to this list…"
          placeholderTextColor={theme.muted}
          value={newItem}
          onChangeText={setNewItem}
          onSubmitEditing={addItem}
          returnKeyType="done"
        />
        <Pressable onPress={addItem} style={[wk.listAddBtn, { backgroundColor: color }]}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16, lineHeight: 18 }}>+</Text>
        </Pressable>
      </View>
    </View>
  )
}

// ── Weekly Routine creation modal ────────────────────────────────────────

function WeeklyRoutineModal({ visible, theme, onClose, onSave }) {
  const [name, setName] = useState('')
  const [tasks, setTasks] = useState([''])

  function reset() { setName(''); setTasks(['']) }
  function close() { reset(); onClose() }

  function save() {
    if (!name.trim()) return
    const taskList = tasks
      .filter(t => t.trim())
      .map((t, i) => ({ id: Date.now() + i, text: t.trim(), done: false }))
    if (!taskList.length) return
    onSave({ id: String(Date.now()), name: name.trim(), tasks: taskList })
    reset()
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={s.settingsOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={s.settingsBg} onPress={close} />
        <View style={[wk.modal, { backgroundColor: theme.card }]}>
          <View style={[s.settingsHandle, { backgroundColor: theme.divider }]} />
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={[wk.modalTitle, { color: theme.text }]}>New Weekly Routine</Text>
            <Text style={[wk.modalLabel, { color: theme.subtext }]}>NAME</Text>
            <TextInput
              style={[wk.modalNameInput, { color: theme.text, borderColor: theme.cardBorder, backgroundColor: theme.bg }]}
              placeholder="e.g. Sunday Reset Routine"
              placeholderTextColor={theme.muted}
              value={name}
              onChangeText={setName}
            />
            <Text style={[wk.modalLabel, { color: theme.subtext }]}>TASKS</Text>
            {tasks.map((t, i) => (
              <View key={i} style={wk.modalTaskRow}>
                <TextInput
                  style={[wk.modalTaskInput, { color: theme.text, borderColor: theme.cardBorder, backgroundColor: theme.bg }]}
                  placeholder={`Task ${i + 1}...`}
                  placeholderTextColor={theme.muted}
                  value={t}
                  onChangeText={v => setTasks(prev => prev.map((x, j) => j === i ? v : x))}
                />
                {tasks.length > 1 && (
                  <Pressable onPress={() => setTasks(prev => prev.filter((_, j) => j !== i))} hitSlop={10} style={{ padding: 8 }}>
                    <Text style={{ color: '#ef4444', fontSize: 14 }}>✕</Text>
                  </Pressable>
                )}
              </View>
            ))}
            <Pressable style={wk.modalAddTask} onPress={() => setTasks(t => [...t, ''])}>
              <Text style={[wk.modalAddTaskText, { color: '#6366f1' }]}>＋  Add another task</Text>
            </Pressable>
            <Pressable style={[wk.modalSave, { backgroundColor: '#6366f1' }]} onPress={save}>
              <Text style={wk.modalSaveText}>Save Routine</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────

export default function RoutinesScreen() {
  const { user, profile } = useAuth()
  const { theme } = useTheme()
  const navigation = useNavigation()
  const [routines, setRoutines] = useState([])
  const [streak, setStreak] = useState({ current: 0, longest: 0 })
  const [routineStreaks, setRoutineStreaks] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [todayMuscle, setTodayMuscle] = useState(null)
  const [hiddenSet, setHiddenSet] = useState(new Set())
  const [activeTab, setActiveTab] = useState('daily')
  const [weeklyRoutines, setWeeklyRoutines] = useState([])
  const [weeklyModalOpen, setWeeklyModalOpen] = useState(false)
  const [sections, setSections] = useState({ ...DEFAULT_SECTIONS })
  // Which dashboard group each routine is in: 'everyday' (default) | 'whenever'
  const [groupMap, setGroupMap] = useState({})
  // Stale-while-revalidate: once anything has loaded, focus refetches keep
  // rendering the current content — the blank/error states are first-load only.
  const hasLoadedRef = useRef(false)
  const lastLoadAtRef = useRef(0)
  // Fingerprint of everything the notification sync schedules from, so the
  // sync (which re-reads the routine list itself) only fires on real changes.
  const notifSyncKeyRef = useRef(null)

  useLayoutEffect(() => {
    navigation.setOptions({
      headerStyle: { backgroundColor: theme.header },
      headerShadowVisible: false,
      headerTitle: () => (
        <Text style={{ fontSize: 17, fontWeight: '800', color: theme.text, letterSpacing: -0.3 }}>My Routines</Text>
      ),
    })
  }, [navigation, theme])

  const load = useCallback(async ({ force = false } = {}) => {
    if (!user) return
    // A focus refetch inside the throttle window keeps rendering cached state.
    if (!force && hasLoadedRef.current && Date.now() - lastLoadAtRef.current < REFETCH_MS) return
    try {
      // Only the per-routine reads depend on the names list — everything else
      // runs in one parallel batch right behind the single names query.
      const names = await getRoutineNames(user.id)
      const [templates, runs, settingsArr, hiddenArr, str, split, rStreaks, gMap, wkRoutines, sec] = await Promise.all([
        getRoutineTemplates(user.id, names),
        getTodayRunsEither(user.id, names),
        Promise.all(names.map(n => getRoutineSettings(user.id, n))), // device-local reads
        getHiddenDefaults(user.id),
        getStreak(user.id),
        getGymSplit(user.id),
        getRoutineStreaks(user.id),
        getRoutineGroupMap(user.id),
        getWeeklyRoutines(user.id),
        getSections(user.id),
      ])
      setGroupMap(gMap)
      setRoutines(names.map((name, i) => ({ name, template: templates[name], run: runs[name], settings: settingsArr[i] })))
      setHiddenSet(new Set(hiddenArr))
      setStreak(str)
      setRoutineStreaks(rStreaks)
      const muscle = split?.days?.[todaySplitIndex()] ?? null
      setTodayMuscle(muscle)
      const todayStr = today()
      const todayDow = new Date().getDay()
      let wkUpdated = false
      const wkReset = wkRoutines.map(r => {
        if (r.autoReset && r.resetDays?.[todayDow] && r.lastResetDate !== todayStr) {
          wkUpdated = true
          return {
            ...r,
            tasks: r.tasks.map(t => ({ ...t, done: false })),
            lists: (r.lists ?? []).map(l => ({ ...l, items: (l.items ?? []).map(it => ({ ...it, done: false })) })),
            lastResetDate: todayStr,
          }
        }
        return r
      })
      if (wkUpdated) await saveWeeklyRoutines(user.id, wkReset)
      setWeeklyRoutines(wkReset)
      setSections(sec)
      setActiveTab(prev => (prev === 'weekly' && !sec.weekly) ? 'daily' : prev)
      setError(false)
      hasLoadedRef.current = true
      lastLoadAtRef.current = Date.now()
      // Keep routine start-time reminders in sync. The sync re-reads the
      // routine list itself, so only fire it when something it schedules from
      // (names, groups, hidden set, per-routine schedules) actually changed.
      const notifKey = JSON.stringify([names, gMap, [...hiddenArr].sort(), settingsArr])
      if (notifSyncKeyRef.current !== notifKey) {
        notifSyncKeyRef.current = notifKey
        syncRoutineNotifications(user.id)
      }
    } catch {
      // A failed refetch keeps the stale screen — the error page only appears
      // when there is nothing loaded to show instead.
      if (!hasLoadedRef.current) setError(true)
    } finally {
      setLoading(false)
    }
  }, [user])

  async function handleHide(name) {
    Alert.alert(
      `Hide ${name} Routine?`,
      "This routine won't count toward your streak while hidden. You can show it again at any time.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Hide Routine', style: 'destructive', onPress: async () => {
          const next = new Set(hiddenSet)
          next.add(name)
          setHiddenSet(next)
          await setHiddenDefaults(user.id, [...next])
        }},
      ]
    )
  }

  async function handleUnhide(name) {
    const next = new Set(hiddenSet)
    next.delete(name)
    setHiddenSet(next)
    await setHiddenDefaults(user.id, [...next])
  }

  function handleDeleteCustom(name) {
    Alert.alert(
      `Delete "${name}"?`,
      'This will permanently remove the routine and all its tasks. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await deleteRoutine(user.id, name)
          } catch (e) {
            Alert.alert('Delete Failed', e?.message ?? 'Something went wrong. Please try again.')
            return
          }
          load({ force: true })
        }},
      ]
    )
  }

  async function handleWeeklyToggleTask(routineId, taskId) {
    const next = weeklyRoutines.map(r =>
      r.id !== routineId ? r : {
        ...r,
        tasks: r.tasks.map(t => t.id === taskId ? { ...t, done: !t.done } : t),
      }
    )
    setWeeklyRoutines(next)
    await saveWeeklyRoutines(user.id, next)
  }

  async function handleWeeklySaveTask(routineId, text) {
    const next = weeklyRoutines.map(r =>
      r.id !== routineId ? r : {
        ...r,
        tasks: [...r.tasks, { id: Date.now(), text, done: false }],
      }
    )
    setWeeklyRoutines(next)
    await saveWeeklyRoutines(user.id, next)
  }

  function handleWeeklyDeleteRoutine(routineId) {
    Alert.alert('Delete Routine?', 'This will remove this weekly routine.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const next = weeklyRoutines.filter(r => r.id !== routineId)
        setWeeklyRoutines(next)
        await saveWeeklyRoutines(user.id, next)
      }},
    ])
  }

  async function handleWeeklyAddRoutine(routine) {
    const next = [...weeklyRoutines, routine]
    setWeeklyRoutines(next)
    await saveWeeklyRoutines(user.id, next)
    setWeeklyModalOpen(false)
  }

  async function handleWeeklyUpdateRoutine(routineId, updates) {
    const next = weeklyRoutines.map(r => r.id !== routineId ? r : { ...r, ...updates })
    setWeeklyRoutines(next)
    await saveWeeklyRoutines(user.id, next)
  }

  useFocusEffect(useCallback(() => { load() }, [load]))

  if (loading) return <View style={[s.page, { backgroundColor: theme.bg }]} />

  if (error) return (
    <View style={[s.page, s.errorPage, { backgroundColor: theme.bg }]}>
      <Text style={[s.errorTitle, { color: theme.text }]}>We couldn't load your routines</Text>
      <Text style={[s.errorSub, { color: theme.subtext }]}>Check your connection and try again.</Text>
      <Pressable
        style={[s.errorBtn, { backgroundColor: theme.accent }]}
        onPress={() => { setLoading(true); load() }}
      >
        <Text style={s.errorBtnText}>Retry</Text>
      </Pressable>
    </View>
  )

  const groupOf = n => groupMap[n] ?? 'everyday'
  const everydayRoutines = routines.filter(r => groupOf(r.name) === 'everyday')
  const wheneverRoutines = routines.filter(r => groupOf(r.name) === 'whenever')

  // Only Every day routines count toward the daily "all done" celebration —
  // Whenever routines are optional by definition.
  const visibleEveryday = everydayRoutines.filter(r => !hiddenSet.has(r.name))
  const doneCount = visibleEveryday.filter(r => r.run?.finished).length
  const allDone = doneCount > 0 && doneCount === visibleEveryday.length

  return (
    <KeyboardAvoidingView
      style={[s.page, { backgroundColor: theme.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.content}>

        <DailyDashboard
          user={user}
          profile={profile}
          routines={everydayRoutines}
          hiddenSet={hiddenSet}
          routineStreaks={routineStreaks}
          theme={theme}
        />

        {/* Tab switcher — Weekly only shows when enabled in section settings */}
        {sections.weekly && (
          <View style={[wk.tabRow, { backgroundColor: theme.isDark ? '#1e1e2e' : '#ececf8' }]}>
            <Pressable
              style={[wk.tab, activeTab === 'daily' && [wk.tabActive, { backgroundColor: theme.card }]]}
              onPress={() => setActiveTab('daily')}
            >
              <Text style={[wk.tabText, { color: activeTab === 'daily' ? '#4f46e5' : theme.subtext, fontSize: 13 }]}>Daily</Text>
            </Pressable>
            <Pressable
              style={[wk.tab, activeTab === 'weekly' && [wk.tabActive, { backgroundColor: theme.card }]]}
              onPress={() => setActiveTab('weekly')}
            >
              <Text style={[wk.tabText, { color: activeTab === 'weekly' ? '#4f46e5' : theme.subtext, fontSize: 13 }]}>Weekly</Text>
            </Pressable>
          </View>
        )}

        {activeTab === 'daily' ? (
          <>
            {allDone && <StreakBadge streak={streak} />}
            {allDone && (
              <View style={[s.allDoneBanner, { backgroundColor: theme.isDark ? '#0d2e21' : '#ecfdf5', borderColor: theme.isDark ? '#1a5c3a' : '#a7f3d0' }]}>
                <Text style={s.allDoneEmoji}>🎉</Text>
                <Text style={[s.allDoneText, { color: theme.isDark ? '#34d399' : '#065f46' }]}>
                  All routines done for today!
                </Text>
              </View>
            )}
            {/* ── Every day — priority routines (+ Organize, right-aligned) ── */}
            <View style={s.groupHeaderRow}>
              <View style={[s.groupChip, { backgroundColor: EVERYDAY_COLOR + '1c' }]}>
                <Text style={s.groupHeaderEmoji}>⭐</Text>
                <Text style={[s.groupHeaderText, { color: EVERYDAY_COLOR }]}>EVERY DAY</Text>
              </View>
              <Text style={[s.groupHeaderHint, { color: theme.muted }]}>aim to do these daily</Text>
              <View style={[s.groupRule, { backgroundColor: EVERYDAY_COLOR + '2a' }]} />
              {routines.length > 1 && (
                <Pressable onPress={() => router.push('/reorder-routines')} hitSlop={8}>
                  <Text style={{ color: theme.accent, fontWeight: '700', fontSize: 13 }}>⇅ Organize</Text>
                </Pressable>
              )}
            </View>
            {everydayRoutines.length === 0 && (
              <Text style={[s.groupEmptyHint, { color: theme.muted }]}>
                No priority routines yet — tap ⇅ Organize to move one here.
              </Text>
            )}
            {everydayRoutines.map(({ name, template, run, settings }) => (
              <RoutineCard
                key={name}
                name={name}
                template={template}
                run={run}
                todayMuscle={name === 'Fitness' ? todayMuscle : null}
                routineStreak={routineStreaks[name] ?? 0}
                settings={settings}
                isDefault={DEFAULT_ROUTINES.has(name)}
                isHidden={hiddenSet.has(name)}
                onHide={() => handleHide(name)}
                onUnhide={() => handleUnhide(name)}
                onDelete={() => handleDeleteCustom(name)}
                group="everyday"
              />
            ))}

            {/* ── Whenever — no-pressure routines ── */}
            <View style={[s.groupHeaderRow, { marginTop: 14 }]}>
              <View style={[s.groupChip, { backgroundColor: WHENEVER_COLOR + '1c' }]}>
                <Text style={s.groupHeaderEmoji}>🌊</Text>
                <Text style={[s.groupHeaderText, { color: WHENEVER_COLOR }]}>WHENEVER</Text>
              </View>
              <Text style={[s.groupHeaderHint, { color: theme.muted }]}>for when you feel like it</Text>
              <View style={[s.groupRule, { backgroundColor: WHENEVER_COLOR + '2a' }]} />
            </View>
            {wheneverRoutines.length === 0 && (
              <Text style={[s.groupEmptyHint, { color: theme.muted }]}>
                Nothing here yet — tap ⇅ Organize to move routines you don't need to do daily.
              </Text>
            )}
            {wheneverRoutines.map(({ name, template, run, settings }) => (
              <RoutineCard
                key={name}
                name={name}
                template={template}
                run={run}
                todayMuscle={name === 'Fitness' ? todayMuscle : null}
                routineStreak={routineStreaks[name] ?? 0}
                settings={settings}
                isDefault={DEFAULT_ROUTINES.has(name)}
                isHidden={hiddenSet.has(name)}
                onHide={() => handleHide(name)}
                onUnhide={() => handleUnhide(name)}
                onDelete={() => handleDeleteCustom(name)}
                group="whenever"
              />
            ))}
            <Pressable
              style={[s.addBtn, { borderColor: theme.isDark ? '#28284a' : '#dde0f8' }]}
              onPress={() => router.push('/setup-routine?name=new')}
            >
              <Text style={[s.addBtnText, { color: theme.accent }]}>＋  Add New Routine</Text>
            </Pressable>
          </>
        ) : (
          <>
            {weeklyRoutines.map((routine, i) => (
              <WeeklyRoutineCard
                key={routine.id}
                routine={routine}
                theme={theme}
                colorIndex={i}
                onToggleTask={handleWeeklyToggleTask}
                onDelete={() => handleWeeklyDeleteRoutine(routine.id)}
                onSaveTask={handleWeeklySaveTask}
                onUpdate={handleWeeklyUpdateRoutine}
              />
            ))}
            <Pressable
              style={[s.addBtn, { borderColor: theme.isDark ? '#28284a' : '#dde0f8' }]}
              onPress={() => setWeeklyModalOpen(true)}
            >
              <Text style={[s.addBtnText, { color: theme.accent }]}>＋  Add Weekly Routine</Text>
            </Pressable>
          </>
        )}

      </ScrollView>

      <WeeklyRoutineModal
        visible={weeklyModalOpen}
        theme={theme}
        onClose={() => setWeeklyModalOpen(false)}
        onSave={handleWeeklyAddRoutine}
      />

    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: 16, paddingBottom: 36 },

  card: {
    flexDirection: 'row',
    borderRadius: 22,
    marginBottom: 14,
    borderWidth: 2,
    shadowOffset: { width: 4, height: 5 },
    shadowOpacity: 0.18,
    shadowRadius: 0,
    elevation: 6,
    overflow: 'hidden',
  },
  cardStripe: { width: 6 },
  cardContent: { flex: 1, padding: 16, paddingTop: 22 },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  emojiCircle: {
    width: 50, height: 50, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
  },
  emoji: { fontSize: 26 },
  cardNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardName: { fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  defaultCornerTag: {
    position: 'absolute', top: 9, left: 18,
    fontSize: 9, fontWeight: '500', letterSpacing: 0.5, opacity: 0.55,
  },
  rStreak: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  rStreakText: { fontSize: 12, fontWeight: '700', color: '#ea580c' },
  cardStatus: { fontSize: 13, marginTop: 2, fontWeight: '500' },
  cardDesc: { fontSize: 12, marginTop: 3, lineHeight: 16, fontStyle: 'italic' },

  cardTopRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTime: { fontSize: 11, fontWeight: '500', marginTop: 3 },
  cardEditBtn: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 10, borderWidth: 1,
  },
  cardEditBtnText: { fontSize: 11, fontWeight: '700' },
  cardHideBtn: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 10, borderWidth: 1,
  },
  cardHideBtnText: { fontSize: 11, fontWeight: '600' },
  cardDeleteBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  cardDeleteBtnIcon: { fontSize: 13 },

  doneBadge: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
  },
  doneBadgeText: { color: '#10b981', fontWeight: '800', fontSize: 14 },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#f97316' },
  liveText: { fontSize: 12, fontWeight: '700', color: '#f97316' },

  splitPillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  splitPill: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  splitPillText: { fontSize: 12, fontWeight: '700' },

  cardBtn: {
    borderRadius: 14, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center',
  },
  cardBtnText: { color: '#fff', fontWeight: '700', fontSize: 15, letterSpacing: 0.1 },

  allDoneBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 16, padding: 14, marginBottom: 14, borderWidth: 1,
  },
  allDoneEmoji: { fontSize: 24 },
  allDoneText: { fontSize: 15, fontWeight: '700' },

  addBtn: {
    borderRadius: 18, padding: 16, alignItems: 'center', marginTop: 4,
    borderWidth: 1.5, borderStyle: 'dashed',
  },
  addBtnText: { fontWeight: '700', fontSize: 15 },

  // Bottom-sheet scaffolding (used by the Weekly Routine + label modals)
  settingsOverlay: { flex: 1, justifyContent: 'flex-end' },
  settingsBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  settingsHandle: {
    width: 40, height: 4, borderRadius: 2,
    alignSelf: 'center', marginBottom: 20,
  },

  // Routine group sections (Every day / Whenever)
  groupHeaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 2, marginBottom: 10, marginTop: 2,
  },
  groupChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 9, paddingHorizontal: 9, paddingVertical: 4,
  },
  groupHeaderEmoji: { fontSize: 12 },
  groupHeaderText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.7 },
  groupHeaderHint: { fontSize: 11, fontWeight: '500' },
  groupRule: { flex: 1, height: 2, borderRadius: 1, minWidth: 8 },
  groupEmptyHint: {
    fontSize: 12, lineHeight: 17, paddingHorizontal: 4, marginBottom: 14,
  },

  // Load failure
  errorPage: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2, textAlign: 'center' },
  errorSub: { fontSize: 13, fontWeight: '500', textAlign: 'center', marginTop: 6, lineHeight: 18 },
  errorBtn: { borderRadius: 14, paddingVertical: 13, paddingHorizontal: 30, marginTop: 20 },
  errorBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
})

const db = StyleSheet.create({
  card: {
    borderRadius: 22, borderWidth: 2, padding: 16, marginBottom: 14,
    shadowOffset: { width: 4, height: 5 },
    shadowOpacity: 0.18, shadowRadius: 0, elevation: 6,
  },
  headerRow:  { flexDirection: 'row', alignItems: 'center' },
  welcome:    { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  dateStr:    { fontSize: 12, fontWeight: '500', marginTop: 2 },
  motivation: { fontSize: 12, fontStyle: 'italic', marginTop: 4 },
  circleWrap:  { alignItems: 'center', justifyContent: 'center' },
  circleLabel: {
    position: 'absolute', flexDirection: 'row',
    alignItems: 'baseline', justifyContent: 'center',
  },
  circleNum: { fontSize: 16, fontWeight: '800' },
  circleDen: { fontSize: 10, fontWeight: '700' },
  streakRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  streakChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
  },
  streakChipText: { fontSize: 11, fontWeight: '700' },
  collapseBtn: { paddingLeft: 10, alignSelf: 'flex-start', paddingTop: 3 },
  chevron:     { fontSize: 12, fontWeight: '700' },
  divider:     { height: StyleSheet.hairlineWidth, marginVertical: 9 },
  eventRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  eventTitle:  { flex: 1, fontSize: 13, fontWeight: '500' },
  eventTime:   { fontSize: 11, fontWeight: '600' },

  // Rules for today
  rulesHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2 },
  rulesTitle: { fontSize: 13, fontWeight: '700' },
  rulesEdit: { fontSize: 12, fontWeight: '700' },
  // flex-start + flexible text so long rules wrap onto the next line
  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
  ruleNum: {
    width: 20, height: 20, borderRadius: 7,
    alignItems: 'center', justifyContent: 'center',
  },
  ruleNumText: { fontSize: 11, fontWeight: '800' },
  ruleText: { flex: 1, flexShrink: 1, fontSize: 13, fontWeight: '500', lineHeight: 18, flexWrap: 'wrap' },

  rulesSheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 10, paddingHorizontal: 24, paddingBottom: 40,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 20,
  },
  rulesSheetTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  rulesSheetSub: { fontSize: 13, marginTop: 4, marginBottom: 10 },
  rulesEditRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingVertical: 10, borderBottomWidth: 1,
  },
  rulesEditInput: { flex: 1, fontSize: 15, fontWeight: '500', paddingVertical: 0, paddingTop: 1, lineHeight: 20 },
  rulesDelete: { fontSize: 13, fontWeight: '600', padding: 4 },
  rulesAddRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  rulesAddInput: {
    flex: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, borderWidth: 1.5,
  },
  rulesAddBtn: {
    width: 38, height: 38, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  rulesAddBtnText: { color: '#fff', fontWeight: '800', fontSize: 20, lineHeight: 22 },
  rulesDoneBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  rulesDoneBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
})

const wk = StyleSheet.create({
  // Tab switcher
  tabRow: {
    flexDirection: 'row', borderRadius: 16, padding: 4,
    marginBottom: 16, gap: 4,
  },
  tab: {
    flex: 1, paddingVertical: 10,
    alignItems: 'center', borderRadius: 12,
  },
  tabActive: {
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
  },
  tabText: { fontSize: 14, fontWeight: '700' },

  // Weekly Routine card
  card: {
    flexDirection: 'row', borderRadius: 22, marginBottom: 14,
    borderWidth: 2, overflow: 'hidden',
    shadowOffset: { width: 4, height: 5 },
    shadowOpacity: 0.18, shadowRadius: 0, elevation: 6,
  },
  cardStripe: { width: 6 },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center',
    padding: 16, paddingTop: 18,
  },
  cardIcon: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  cardEmoji: { fontSize: 24 },
  cardName: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  cardStatus: { fontSize: 13, fontWeight: '500', marginTop: 2 },
  taskList: {
    paddingHorizontal: 16, paddingBottom: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  taskRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10,
  },
  taskCheck: {
    width: 28, height: 28, borderRadius: 9, borderWidth: 2,
    borderColor: '#d1d5db', alignItems: 'center', justifyContent: 'center',
  },
  taskMark: { color: '#fff', fontSize: 13, fontWeight: '800' },
  taskText: { flex: 1, fontSize: 15, fontWeight: '500' },
  taskTextDone: { color: '#ccc', textDecorationLine: 'line-through' },
  addTaskRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8 },
  addTaskInput: {
    flex: 1, borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 9, fontSize: 14,
  },
  addTaskConfirm: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12 },
  addTaskBtn: { paddingVertical: 12, alignItems: 'center' },
  addTaskBtnText: { fontSize: 14, fontWeight: '700' },

  // Lists inside a weekly routine
  listBlock: { marginTop: 12, borderRadius: 14, borderWidth: 1, padding: 12 },
  listHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  listName: { flex: 1, fontSize: 13.5, fontWeight: '800', letterSpacing: -0.1 },
  listCount: { fontSize: 11.5, fontWeight: '700' },
  listNameInput: {
    flex: 1, borderRadius: 10, borderWidth: 1.5,
    paddingHorizontal: 10, paddingVertical: 7, fontSize: 14, fontWeight: '700',
  },
  listItemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  listItemCheck: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  listItemText: { flex: 1, fontSize: 13.5, fontWeight: '500' },
  listAddRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  listAddInput: {
    flex: 1, borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 13,
  },
  listAddBtn: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  addListBtn: { paddingVertical: 10, alignItems: 'center', marginTop: 4 },

  // Creation modal
  modal: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 10, paddingHorizontal: 24, paddingBottom: 48,
    maxHeight: '82%',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 20,
  },
  modalTitle: {
    fontSize: 20, fontWeight: '700', letterSpacing: -0.3,
    marginBottom: 20, marginTop: 8,
  },
  modalLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 0.9,
    marginBottom: 8,
  },
  modalNameInput: {
    borderWidth: 1.5, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, marginBottom: 20,
  },
  modalTaskRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  modalTaskInput: {
    flex: 1, borderWidth: 1.5, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 11, fontSize: 15,
  },
  modalAddTask: { paddingVertical: 12, marginBottom: 4 },
  modalAddTaskText: { fontWeight: '700', fontSize: 15 },
  modalSave: {
    borderRadius: 16, paddingVertical: 15,
    alignItems: 'center', marginTop: 8,
  },
  modalSaveText: { color: '#fff', fontWeight: '800', fontSize: 16 },

  // Shared day-of-week circles
  dayRow: { flexDirection: 'row', gap: 6, marginBottom: 14, justifyContent: 'center' },
  dayCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dayCircleText: { fontSize: 12, fontWeight: '700' },

  // Routine card edit button
  cardEditIconBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 9, borderWidth: 1 },
  cardEditIconText: { fontSize: 11, fontWeight: '700' },

  // Inline edit section
  editSection: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  editLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.9, marginBottom: 8 },
  editNameInput: {
    borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 16,
  },
  editToggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 12, marginBottom: 14,
    borderWidth: 1, borderRadius: 12,
  },
  editTaskRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  editTaskInput: {
    flex: 1, borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 9, fontSize: 14,
  },
  editAddTask: { paddingVertical: 10, marginBottom: 14 },
  editAddTaskText: { fontWeight: '700', fontSize: 14 },
  editActions: { flexDirection: 'row', gap: 8 },
  editCancel: {
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  editSave: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
})


