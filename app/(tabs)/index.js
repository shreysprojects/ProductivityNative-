import { useState, useCallback, useLayoutEffect, useEffect, useRef } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  Modal, Switch, Alert, KeyboardAvoidingView, Platform,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Svg, { Polyline, Circle, Line as SvgLine } from 'react-native-svg'
import { router, useFocusEffect, useNavigation } from 'expo-router'
import { useAuth } from '../../lib/AuthContext'
import { useTheme } from '../../lib/ThemeContext'
import StreakBadge from '../../components/StreakBadge'
import { getRoutineNames, getRoutineTemplate, getTodayRun, getStreak, getGymSplit, getRoutineStreaks, deleteRoutine, getHiddenDefaults, setHiddenDefaults, getRoutineSettings, getWeeklyGoals, saveWeeklyGoals, getWeeklyRoutines, saveWeeklyRoutines, getWeeklyGoalsConfig, saveWeeklyGoalsConfig, today, getDayTodos, getCalendarEvents, getScheduleItems, getTasks, getJournalEntries, getRoutineLabels, saveRoutineLabels, getRoutineLabelMap, saveRoutineLabelMap } from '../../lib/storage'
import { getSections, DEFAULT_SECTIONS } from '../../lib/sectionsStorage'
import { routineTheme } from '../../lib/themes'
import { todaySplitIndex, muscleColor, muscleTextColor, normalizeDay } from '../../lib/splitData'
import { useProductivity } from '../../lib/ProductivityContext'
import { getProductivitySessions, getTodayProductiveMinutes, clearProductivitySessions } from '../../lib/productivityStorage'

const PROD_COLOR    = '#6366f1'
const DEFAULT_ROUTINES = new Set(['Morning', 'Fitness', 'Night'])

function fmtMinsShort(m) {
  if (m <= 0) return '0m'
  if (m >= 60) {
    const h = Math.floor(m / 60)
    const rem = m % 60
    return rem > 0 ? `${h}h ${rem}m` : `${h}h`
  }
  return `${m}m`
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getInsight(sessions) {
  if (sessions.length < 2) return null
  const deepS    = sessions.filter(s => s.rating >= 8)
  const shallowS = sessions.filter(s => s.rating < 8)
  const deepMins    = deepS.reduce((sum, s) => sum + (s.actualMins || 0), 0)
  const shallowMins = shallowS.reduce((sum, s) => sum + (s.actualMins || 0), 0)
  const totalMins   = deepMins + shallowMins
  if (totalMins === 0) return null
  const deepPct      = deepMins / totalMins
  const avgDeepMins  = deepS.length    ? deepMins / deepS.length       : 0
  const avgShalMins  = shallowS.length ? shallowMins / shallowS.length : 0
  const recentAvg = sessions.slice(-3).reduce((s, x) => s + x.rating, 0) / Math.min(3, sessions.length)
  const olderAvg  = sessions.slice(0, 3).reduce((s, x) => s + x.rating, 0) / Math.min(3, sessions.length)
  const improving = recentAvg > olderAvg + 0.5

  if (shallowMins > deepMins * 3 && shallowMins > 20) {
    return {
      label: `${fmtMinsShort(deepMins)} deep vs ${fmtMinsShort(shallowMins)} shallow focus`,
      tip: 'Most time is low-focus. Try single-task 25 min blocks with phone away.',
    }
  }
  if (deepPct >= 0.6) {
    return {
      label: `${Math.round(deepPct * 100)}% of your time is deep focus`,
      tip: improving ? 'Focus quality is trending up — keep the momentum!' : 'Excellent focus quality. Stay intentional.',
    }
  }
  if (deepS.length > 0 && avgShalMins > avgDeepMins * 1.5) {
    return {
      label: `Shorter sessions score higher (avg ${fmtMinsShort(Math.round(avgDeepMins))} for 8+)`,
      tip: 'Your best sessions are shorter. Try 25 min focused blocks.',
    }
  }
  if (improving) {
    return {
      label: 'Focus quality trending up lately',
      tip: 'Recent sessions score higher than earlier ones. Keep it up!',
    }
  }
  const avg = (sessions.reduce((s, x) => s + x.rating, 0) / sessions.length).toFixed(1)
  return {
    label: `${fmtMinsShort(totalMins)} tracked · avg ${avg}/10`,
    tip: 'Log more sessions to unlock personalized focus insights.',
  }
}

function ScoreSparkline({ sessions, theme, selectedIdx, onSelect }) {
  if (sessions.length < 2) return null
  const W = 230, H = 64
  const PAD = { left: 6, right: 6, top: 10, bottom: 10 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom
  const pts = sessions.map((s, i) => ({
    x: PAD.left + (i / (sessions.length - 1)) * chartW,
    y: PAD.top + chartH - ((s.rating - 1) / 9) * chartH,
  }))
  const pointsStr = pts.map(p => `${p.x},${p.y}`).join(' ')
  return (
    <Svg width={W} height={H}>
      <SvgLine x1={PAD.left} y1={PAD.top + chartH / 2} x2={W - PAD.right} y2={PAD.top + chartH / 2}
        stroke={theme.divider} strokeWidth={1} strokeDasharray="3,3" />
      <Polyline points={pointsStr} fill="none" stroke={PROD_COLOR} strokeWidth={2}
        strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <Circle
          key={i}
          cx={p.x} cy={p.y}
          r={selectedIdx === i ? 8 : 6}
          fill={selectedIdx === i ? '#fff' : PROD_COLOR}
          stroke={PROD_COLOR}
          strokeWidth={selectedIdx === i ? 2.5 : 0}
          onPress={() => onSelect(selectedIdx === i ? null : i)}
        />
      ))}
    </Svg>
  )
}

function ProductivityCard({ theme, userId }) {
  const { activeSession, elapsedSeconds, isPaused, pause, resume, openSession } = useProductivity()
  const [todayMins,      setTodayMins]      = useState(0)
  const [recentSessions, setRecentSessions] = useState([])
  const [selectedIdx,    setSelectedIdx]    = useState(null)
  const wasActive = useRef(false)

  function refreshStats(uid) {
    getTodayProductiveMinutes(uid).then(setTodayMins)
    getProductivitySessions(uid, 30).then(sessions => {
      setRecentSessions([...sessions].reverse())
      setSelectedIdx(null)
    })
  }

  useFocusEffect(useCallback(() => {
    if (!userId) return
    refreshStats(userId)
  }, [userId]))

  useEffect(() => {
    if (wasActive.current && !activeSession && userId) refreshStats(userId)
    wasActive.current = !!activeSession
  }, [activeSession, userId])

  const isActive      = !!activeSession
  const chartSessions = recentSessions.slice(-7)
  const selectedSess  = selectedIdx != null ? chartSessions[selectedIdx] : null
  const insight       = recentSessions.length >= 2 ? getInsight(recentSessions) : null
  const deepMins    = recentSessions.filter(s => s.rating >= 8).reduce((sum, s) => sum + (s.actualMins || 0), 0)
  const shallowMins = recentSessions.filter(s => s.rating <  8).reduce((sum, s) => sum + (s.actualMins || 0), 0)

  function fmtElapsed(s) {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
  }

  function handleReset() {
    Alert.alert(
      'Reset Deep Work Stats',
      'This will permanently delete all your session history. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: async () => {
          await clearProductivitySessions(userId)
          refreshStats(userId)
        }},
      ]
    )
  }

  return (
    <View style={[pc.card, { backgroundColor: theme.card, borderColor: theme.cardBorder, shadowColor: theme.isDark ? 'transparent' : '#0d1b5e' }]}>
      <View style={[pc.stripe, { backgroundColor: PROD_COLOR }]} />
      <View style={pc.body}>

        <View style={pc.headerRow}>
          <View style={[pc.iconCircle, { backgroundColor: theme.isDark ? '#1e1e38' : '#eef2ff' }]}>
            <Text style={pc.icon}>🎯</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[pc.title, { color: theme.text }]}>Deep Work</Text>
            <Text style={[pc.sub, { color: theme.subtext }]}>
              {todayMins > 0 ? `${fmtMinsShort(todayMins)} focused today` : 'No sessions yet today'}
            </Text>
          </View>
          {isActive && (
            <View style={[pc.liveBadge, { backgroundColor: theme.isDark ? '#1e1e38' : '#eef2ff' }]}>
              <View style={[pc.liveDot, { backgroundColor: isPaused ? '#fbbf24' : '#6366f1' }]} />
              <Text style={[pc.liveText, { color: PROD_COLOR }]}>
                {isPaused ? 'Paused' : 'Live'}
              </Text>
            </View>
          )}
        </View>

        {isActive ? (
          <View style={[pc.activeRow, { backgroundColor: theme.isDark ? '#1e1e38' : '#eef2ff' }]}>
            <View style={{ flex: 1 }}>
              <Text style={[pc.activeTask, { color: theme.text }]} numberOfLines={1}>
                {activeSession.taskDesc || 'Productivity Session'}
              </Text>
              <Text style={[pc.activeTimer, { color: PROD_COLOR }]}>
                {fmtElapsed(elapsedSeconds)} / {activeSession.goalMins}m goal
              </Text>
            </View>
            <Pressable style={[pc.pauseBtn, { borderColor: theme.cardBorder }]} onPress={isPaused ? resume : pause}>
              <Text style={[pc.pauseBtnText, { color: PROD_COLOR }]}>{isPaused ? '▶' : '⏸'}</Text>
            </Pressable>
          </View>
        ) : chartSessions.length >= 2 ? (
          <>
            {insight && (
              <View style={[pc.insight, { backgroundColor: PROD_COLOR + '12', borderColor: PROD_COLOR + '28' }]}>
                <Text style={[pc.insightLabel, { color: PROD_COLOR }]}>{insight.label}</Text>
                <Text style={[pc.insightTip, { color: theme.subtext }]}>{insight.tip}</Text>
              </View>
            )}

            <View style={pc.chartRow}>
              <ScoreSparkline
                sessions={chartSessions}
                theme={theme}
                selectedIdx={selectedIdx}
                onSelect={setSelectedIdx}
              />
              <View style={pc.chartMeta}>
                <Text style={[pc.chartMetaVal, { color: PROD_COLOR }]}>
                  {chartSessions[chartSessions.length - 1]?.rating ?? '—'}/10
                </Text>
                <Text style={[pc.chartMetaLabel, { color: theme.subtext }]}>Last score</Text>
              </View>
            </View>

            {(deepMins > 0 || shallowMins > 0) && (
              <View style={pc.focusRow}>
                <View style={[pc.focusChip, { backgroundColor: PROD_COLOR + '18' }]}>
                  <Text style={[pc.focusVal, { color: PROD_COLOR }]}>{fmtMinsShort(deepMins)}</Text>
                  <Text style={[pc.focusLbl, { color: PROD_COLOR + 'cc' }]}>deep focus</Text>
                </View>
                <View style={[pc.focusChip, { backgroundColor: theme.isDark ? '#28284a' : '#ebebf5' }]}>
                  <Text style={[pc.focusVal, { color: theme.text }]}>{fmtMinsShort(shallowMins)}</Text>
                  <Text style={[pc.focusLbl, { color: theme.subtext }]}>shallow focus</Text>
                </View>
              </View>
            )}

            {selectedSess && (
              <View style={[pc.detailBox, { backgroundColor: theme.isDark ? '#1e1e38' : '#f4f4fc', borderColor: theme.cardBorder }]}>
                <Text style={[pc.detailTask, { color: theme.text }]} numberOfLines={2}>
                  {selectedSess.taskDesc || 'No description'}
                </Text>
                <View style={pc.detailMeta}>
                  <Text style={[pc.detailChip, { backgroundColor: PROD_COLOR + '18', color: PROD_COLOR }]}>
                    {selectedSess.rating}/10
                  </Text>
                  <Text style={[pc.detailChip, { backgroundColor: theme.isDark ? '#28284a' : '#e8e8f5', color: theme.subtext }]}>
                    {fmtMinsShort(selectedSess.actualMins)}
                  </Text>
                  <Text style={[pc.detailChip, { backgroundColor: theme.isDark ? '#28284a' : '#e8e8f5', color: theme.subtext }]}>
                    {formatDate(selectedSess.date)}
                  </Text>
                </View>
              </View>
            )}
          </>
        ) : null}

        <Pressable style={[pc.btn, { backgroundColor: PROD_COLOR }]} onPress={openSession}>
          <Text style={pc.btnText}>{isActive ? 'View Session  →' : '+ Start Session'}</Text>
        </Pressable>

        {recentSessions.length > 0 && (
          <Pressable onPress={handleReset} style={pc.resetLink}>
            <Text style={[pc.resetLinkText, { color: theme.muted }]}>Reset stats</Text>
          </Pressable>
        )}

      </View>
    </View>
  )
}

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

  useFocusEffect(useCallback(() => {
    if (!user?.id) return
    const key = today()
    Promise.all([
      getCalendarEvents(user.id),
      getDayTodos(user.id, key),
      getScheduleItems(user.id),
      getTasks(user.id),
      getJournalEntries(user.id),
    ]).then(([events, todos, schedule, allTasks, jEntries]) => {
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
    })
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
    </View>
  )
}

function RoutineCard({ name, template, run, todayMuscle, routineStreak, settings, isDefault, isHidden, onHide, onUnhide, onDelete, routineLabels = [], onOpenLabels }) {
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
  const timeRange = settings
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

        {!isHidden && (
          <View style={s.labelChipsRow}>
            {routineLabels.map(l => (
              <Pressable
                key={l.id}
                style={[s.labelChip, { backgroundColor: l.color + '1c', borderColor: l.color + '55' }]}
                onPress={onOpenLabels}
                hitSlop={4}
              >
                <View style={[s.labelChipDot, { backgroundColor: l.color }]} />
                <Text style={[s.labelChipText, { color: l.color }]}>{l.name}</Text>
              </Pressable>
            ))}
            <Pressable
              style={[s.labelAddChip, { borderColor: theme.cardBorder }]}
              onPress={onOpenLabels}
              hitSlop={6}
            >
              <Text style={[s.labelChipText, { color: theme.muted }]}>
                {routineLabels.length ? '＋' : '＋ Label'}
              </Text>
            </Pressable>
          </View>
        )}

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
const DAY_NAMES  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ── Weekly Goals list (top of Weekly tab) ────────────────────────────────

function WeeklyGoalsList({ userId, theme }) {
  const [goals, setGoals] = useState([])
  const [config, setConfig] = useState({ resetDayOfWeek: null, lastResetDate: null })
  const [adding, setAdding] = useState(false)
  const [newText, setNewText] = useState('')
  const [newDueDate, setNewDueDate] = useState('')
  const [formResetDay, setFormResetDay] = useState(null)

  useEffect(() => {
    async function loadData() {
      const [g, c] = await Promise.all([getWeeklyGoals(userId), getWeeklyGoalsConfig(userId)])
      const todayStr = today()
      const todayDow = new Date().getDay()
      if (c.resetDayOfWeek !== null && c.resetDayOfWeek === todayDow && c.lastResetDate !== todayStr) {
        const reset = g.map(goal => ({ ...goal, done: false }))
        const newConfig = { ...c, lastResetDate: todayStr }
        setGoals(reset)
        setConfig(newConfig)
        await saveWeeklyGoals(userId, reset)
        await saveWeeklyGoalsConfig(userId, newConfig)
      } else {
        setGoals(g)
        setConfig(c)
      }
    }
    loadData()
  }, [userId])

  async function toggle(id) {
    const next = goals.map(g => g.id === id ? { ...g, done: !g.done } : g)
    setGoals(next)
    await saveWeeklyGoals(userId, next)
  }

  function openAddForm() {
    setFormResetDay(config.resetDayOfWeek)
    setNewText('')
    setNewDueDate('')
    setAdding(true)
  }

  async function add() {
    if (!newText.trim()) { setAdding(false); return }
    const newGoal = { id: Date.now(), text: newText.trim(), done: false, dueDate: newDueDate.trim() || null }
    const next = [...goals, newGoal]
    setGoals(next)
    await saveWeeklyGoals(userId, next)
    if (formResetDay !== config.resetDayOfWeek) {
      const newConfig = { ...config, resetDayOfWeek: formResetDay }
      setConfig(newConfig)
      await saveWeeklyGoalsConfig(userId, newConfig)
    }
    setNewText('')
    setNewDueDate('')
    setAdding(false)
  }

  async function remove(id) {
    const next = goals.filter(g => g.id !== id)
    setGoals(next)
    await saveWeeklyGoals(userId, next)
  }

  return (
    <View style={[wk.goalsCard, { backgroundColor: theme.card, borderColor: theme.cardBorder, shadowColor: theme.isDark ? 'transparent' : '#0d1b5e' }]}>
      <View style={wk.goalsHeaderRow}>
        <View style={wk.goalsTitleRow}>
          <Text style={wk.goalsIcon}>📋</Text>
          <View>
            <Text style={[wk.goalsTitle, { color: theme.text }]}>Weekly Goals</Text>
            <Text style={[wk.goalsSub, { color: theme.subtext }]}>
              {goals.filter(g => g.done).length} / {goals.length} done
              {config.resetDayOfWeek !== null ? `  ·  ↺ ${DAY_NAMES[config.resetDayOfWeek]}` : ''}
            </Text>
          </View>
        </View>
        <Pressable style={[wk.goalsAddBtn, { backgroundColor: '#6366f1' }]} onPress={openAddForm}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 20, lineHeight: 22 }}>＋</Text>
        </Pressable>
      </View>
      {goals.length === 0 && !adding && (
        <Text style={[wk.goalsEmpty, { color: theme.subtext }]}>Tap ＋ to add a weekly goal</Text>
      )}
      {goals.map(g => (
        <Pressable key={g.id} style={[wk.goalRow, { borderBottomColor: theme.divider }]} onPress={() => toggle(g.id)}>
          <View style={[wk.goalCheck, g.done && { backgroundColor: '#6366f1', borderColor: '#6366f1' }]}>
            {g.done && <Text style={wk.goalCheckMark}>✓</Text>}
          </View>
          <Text style={[wk.goalText, { color: theme.text }, g.done && wk.goalTextDone]} numberOfLines={2}>{g.text}</Text>
          {g.dueDate && (
            <View style={[wk.goalDueBadge, { backgroundColor: '#6366f120' }]}>
              <Text style={[wk.goalDueBadgeText, { color: '#6366f1' }]}>{g.dueDate}</Text>
            </View>
          )}
          <Pressable onPress={() => remove(g.id)} hitSlop={12}>
            <Text style={[wk.goalRemove, { color: theme.muted }]}>✕</Text>
          </Pressable>
        </Pressable>
      ))}
      {adding && (
        <View style={wk.goalAddForm}>
          <TextInput
            style={[wk.goalAddInput, { color: theme.text, borderColor: '#6366f1', backgroundColor: theme.bg }]}
            placeholder="What's your goal this week?"
            placeholderTextColor={theme.muted}
            value={newText}
            onChangeText={setNewText}
            autoFocus
            returnKeyType="next"
          />
          <TextInput
            style={[wk.goalAddInput, { color: theme.text, borderColor: theme.cardBorder, backgroundColor: theme.bg, marginTop: 8 }]}
            placeholder="Due by (optional, e.g. Jun 3)"
            placeholderTextColor={theme.muted}
            value={newDueDate}
            onChangeText={setNewDueDate}
            returnKeyType="done"
            onSubmitEditing={add}
          />
          <Text style={[wk.goalResetLabel, { color: theme.subtext }]}>RESET GOALS LIST ON:</Text>
          <View style={wk.dayRow}>
            {DAY_LABELS.map((label, i) => (
              <Pressable
                key={i}
                style={[wk.dayCircle,
                  formResetDay === i
                    ? { backgroundColor: '#6366f1' }
                    : { backgroundColor: theme.isDark ? '#2a2a3e' : '#e5e7eb' },
                ]}
                onPress={() => setFormResetDay(formResetDay === i ? null : i)}
              >
                <Text style={[wk.dayCircleText, { color: formResetDay === i ? '#fff' : theme.subtext }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={wk.goalAddActions}>
            <Pressable style={[wk.goalAddCancel, { borderColor: theme.cardBorder }]} onPress={() => setAdding(false)}>
              <Text style={{ color: theme.subtext, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
            <Pressable style={[wk.goalAddConfirm, { backgroundColor: '#6366f1', flex: 1, alignItems: 'center' }]} onPress={add}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Add Goal</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  )
}

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
          </View>
        )}
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

// ── Habits ────────────────────────────────────────────────────────────────


// ── Main screen ───────────────────────────────────────────────────────────

export default function RoutinesScreen() {
  const { user, profile } = useAuth()
  const { theme } = useTheme()
  const navigation = useNavigation()
  const [routines, setRoutines] = useState([])
  const [streak, setStreak] = useState({ current: 0, longest: 0 })
  const [routineStreaks, setRoutineStreaks] = useState({})
  const [loading, setLoading] = useState(true)
  const [todayMuscle, setTodayMuscle] = useState(null)
  const [hiddenSet, setHiddenSet] = useState(new Set())
  const [activeTab, setActiveTab] = useState('daily')
  const [weeklyRoutines, setWeeklyRoutines] = useState([])
  const [weeklyModalOpen, setWeeklyModalOpen] = useState(false)
  const [sections, setSections] = useState({ ...DEFAULT_SECTIONS })
  const [labels, setLabels] = useState([])
  const [labelMap, setLabelMap] = useState({})
  const [labelModalFor, setLabelModalFor] = useState(null) // routine name being labeled
  const [editingLabelId, setEditingLabelId] = useState(null)
  const [editingLabelName, setEditingLabelName] = useState('')

  useLayoutEffect(() => {
    navigation.setOptions({
      headerStyle: { backgroundColor: theme.header },
      headerShadowVisible: false,
      headerTitle: () => (
        <Text style={{ fontSize: 17, fontWeight: '800', color: theme.text, letterSpacing: -0.3 }}>My Routines</Text>
      ),
    })
  }, [navigation, theme])

  const load = useCallback(async () => {
    if (!user) return
    const [names, hiddenArr, str, split, rStreaks, lbls, lblMap] = await Promise.all([
      getRoutineNames(user.id),
      getHiddenDefaults(user.id),
      getStreak(user.id),
      getGymSplit(user.id),
      getRoutineStreaks(user.id),
      getRoutineLabels(user.id),
      getRoutineLabelMap(user.id),
    ])
    setLabels(lbls)
    setLabelMap(lblMap)
    const [templates, runs, settingsArr] = await Promise.all([
      Promise.all(names.map(n => getRoutineTemplate(user.id, n))),
      Promise.all(names.map(n => getTodayRun(user.id, n))),
      Promise.all(names.map(n => getRoutineSettings(user.id, n))),
    ])
    setRoutines(names.map((name, i) => ({ name, template: templates[i], run: runs[i], settings: settingsArr[i] })))
    setHiddenSet(new Set(hiddenArr))
    setStreak(str)
    setRoutineStreaks(rStreaks)
    const muscle = split?.days?.[todaySplitIndex()] ?? null
    setTodayMuscle(muscle)
    const wkRoutines = await getWeeklyRoutines(user.id)
    const todayStr = today()
    const todayDow = new Date().getDay()
    let wkUpdated = false
    const wkReset = wkRoutines.map(r => {
      if (r.autoReset && r.resetDays?.[todayDow] && r.lastResetDate !== todayStr) {
        wkUpdated = true
        return { ...r, tasks: r.tasks.map(t => ({ ...t, done: false })), lastResetDate: todayStr }
      }
      return r
    })
    if (wkUpdated) await saveWeeklyRoutines(user.id, wkReset)
    setWeeklyRoutines(wkReset)
    const sec = await getSections(user.id)
    setSections(sec)
    setActiveTab(prev => (prev === 'weekly' && !sec.weekly) ? 'daily' : prev)
    setLoading(false)
  }, [user])

  async function toggleRoutineLabel(routineName, labelId) {
    const current = labelMap[routineName] ?? []
    const next = {
      ...labelMap,
      [routineName]: current.includes(labelId)
        ? current.filter(id => id !== labelId)
        : [...current, labelId],
    }
    setLabelMap(next)
    await saveRoutineLabelMap(user.id, next)
  }

  async function saveLabelRename() {
    const clean = editingLabelName.trim()
    if (clean) {
      const next = labels.map(l => l.id === editingLabelId ? { ...l, name: clean } : l)
      setLabels(next)
      await saveRoutineLabels(user.id, next)
    }
    setEditingLabelId(null)
    setEditingLabelName('')
  }

  function closeLabelModal() {
    setLabelModalFor(null)
    setEditingLabelId(null)
    setEditingLabelName('')
  }

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
          await deleteRoutine(user.id, name)
          load()
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

  const visibleRoutines = routines.filter(r => !hiddenSet.has(r.name))
  const doneCount = visibleRoutines.filter(r => r.run?.finished).length
  const allDone = doneCount > 0 && doneCount === visibleRoutines.length

  return (
    <KeyboardAvoidingView
      style={[s.page, { backgroundColor: theme.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.content}>

        <DailyDashboard
          user={user}
          profile={profile}
          routines={routines}
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
            {/* HIDDEN for now (not deleted) — restore by removing `false &&` */}
            {false && sections.productivity && <ProductivityCard theme={theme} userId={user?.id} />}
            {routines.length > 1 && (
              <Pressable
                onPress={() => router.push('/reorder-routines')}
                hitSlop={8}
                style={{ alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 4, marginBottom: 2 }}
              >
                <Text style={{ color: theme.accent, fontWeight: '700', fontSize: 13 }}>⇅ Reorder</Text>
              </Pressable>
            )}
            {routines.map(({ name, template, run, settings }) => (
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
                routineLabels={(labelMap[name] ?? []).map(id => labels.find(l => l.id === id)).filter(Boolean)}
                onOpenLabels={() => setLabelModalFor(name)}
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
            {/* HIDDEN for now (not deleted) — restore by removing `false &&` */}
            {false && <WeeklyGoalsList userId={user.id} theme={theme} />}
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

      {/* Label picker — assign labels to a routine, rename labels inline */}
      <Modal
        visible={!!labelModalFor}
        transparent
        animationType="slide"
        onRequestClose={closeLabelModal}
      >
        <KeyboardAvoidingView style={s.settingsOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={s.settingsBg} onPress={closeLabelModal} />
          <View style={[s.labelSheet, { backgroundColor: theme.card }]}>
            <View style={[s.settingsHandle, { backgroundColor: theme.divider }]} />
            <Text style={[s.labelSheetTitle, { color: theme.text }]}>🏷  {labelModalFor}</Text>
            <Text style={[s.labelSheetSub, { color: theme.muted }]}>
              Tap a label to add or remove it. Use ✏️ to rename a label everywhere.
            </Text>

            {labels.map(l => {
              const active = (labelMap[labelModalFor] ?? []).includes(l.id)
              const editing = editingLabelId === l.id
              return (
                <View key={l.id} style={[s.labelRow, { borderBottomColor: theme.divider }]}>
                  {editing ? (
                    <>
                      <View style={[s.labelChipDot, { backgroundColor: l.color }]} />
                      <TextInput
                        style={[s.labelEditInput, { color: theme.text, borderColor: l.color + '88', backgroundColor: theme.bg }]}
                        value={editingLabelName}
                        onChangeText={setEditingLabelName}
                        autoFocus
                        returnKeyType="done"
                        onSubmitEditing={saveLabelRename}
                        maxLength={20}
                      />
                      <Pressable onPress={saveLabelRename} hitSlop={8}>
                        <Text style={{ color: l.color, fontWeight: '800', fontSize: 14 }}>Save</Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <Pressable style={s.labelRowMain} onPress={() => toggleRoutineLabel(labelModalFor, l.id)} hitSlop={4}>
                        <View style={[s.labelChipDot, { backgroundColor: l.color }]} />
                        <Text style={[s.labelRowName, { color: theme.text }]}>{l.name}</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => { setEditingLabelId(l.id); setEditingLabelName(l.name) }}
                        hitSlop={8}
                        style={{ padding: 4 }}
                      >
                        <Text style={{ fontSize: 13 }}>✏️</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => toggleRoutineLabel(labelModalFor, l.id)}
                        hitSlop={8}
                        style={[s.labelCheck, { borderColor: active ? l.color : theme.muted }, active && { backgroundColor: l.color }]}
                      >
                        {active && <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>✓</Text>}
                      </Pressable>
                    </>
                  )}
                </View>
              )
            })}

            <Pressable style={[s.labelDoneBtn, { backgroundColor: theme.accent }]} onPress={closeLabelModal}>
              <Text style={s.labelDoneBtnText}>Done</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>


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

  // Routine labels
  labelChipsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: -4, marginBottom: 12 },
  labelChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4,
  },
  labelChipDot: { width: 7, height: 7, borderRadius: 4 },
  labelChipText: { fontSize: 11, fontWeight: '700' },
  labelAddChip: {
    borderRadius: 8, borderWidth: 1, borderStyle: 'dashed',
    paddingHorizontal: 8, paddingVertical: 4,
  },

  labelSheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 10, paddingHorizontal: 24, paddingBottom: 40,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 20,
  },
  labelSheetTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  labelSheetSub: { fontSize: 13, marginTop: 4, marginBottom: 8 },
  labelRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 14, borderBottomWidth: 1,
  },
  labelRowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  labelRowName: { fontSize: 16, fontWeight: '600' },
  labelCheck: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  labelEditInput: {
    flex: 1, borderRadius: 10, borderWidth: 1.5,
    paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, fontWeight: '600',
  },
  labelDoneBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  labelDoneBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
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
})

const pc = StyleSheet.create({
  card: {
    flexDirection: 'row', borderRadius: 22, marginBottom: 14,
    borderWidth: 2, overflow: 'hidden',
    shadowOffset: { width: 4, height: 5 },
    shadowOpacity: 0.18, shadowRadius: 0, elevation: 6,
  },
  stripe: { width: 6 },
  body: { flex: 1, padding: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  iconCircle: {
    width: 46, height: 46, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  icon: { fontSize: 24 },
  title: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  sub: { fontSize: 12, marginTop: 2, fontWeight: '500' },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  liveText: { fontSize: 12, fontWeight: '700' },
  activeRow: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 12, padding: 12, marginBottom: 12, gap: 10,
  },
  activeTask: { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  activeTimer: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  pauseBtn: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  pauseBtnText: { fontSize: 14, fontWeight: '700' },
  chartRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  chartMeta: { alignItems: 'flex-end' },
  chartMetaVal: { fontSize: 18, fontWeight: '800' },
  chartMetaLabel: { fontSize: 11, fontWeight: '500', marginTop: 2 },
  insight: {
    borderRadius: 12, padding: 10, marginBottom: 10, borderWidth: 1,
  },
  insightLabel: { fontSize: 12, fontWeight: '700', marginBottom: 3 },
  insightTip:   { fontSize: 12, fontWeight: '500', lineHeight: 17 },
  focusRow:  { flexDirection: 'row', gap: 8, marginBottom: 10 },
  focusChip: { flex: 1, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10 },
  focusVal:  { fontSize: 15, fontWeight: '800' },
  focusLbl:  { fontSize: 11, fontWeight: '600', marginTop: 2 },
  detailBox: {
    borderRadius: 12, padding: 10, marginBottom: 10, borderWidth: 1,
  },
  detailTask: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  detailMeta: { flexDirection: 'row', gap: 6 },
  detailChip: {
    fontSize: 12, fontWeight: '600',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
  },
  btn: { borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  resetLink: { alignItems: 'center', paddingTop: 10 },
  resetLinkText: { fontSize: 12, fontWeight: '500' },
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

  // Weekly Goals card
  goalsCard: {
    borderRadius: 22, borderWidth: 2,
    paddingHorizontal: 18, paddingVertical: 16, marginBottom: 14,
    shadowOffset: { width: 4, height: 5 },
    shadowOpacity: 0.18, shadowRadius: 0, elevation: 6,
  },
  goalsHeaderRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 14,
  },
  goalsTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  goalsIcon: { fontSize: 28 },
  goalsTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  goalsSub: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  goalsAddBtn: {
    width: 34, height: 34, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  goalsEmpty: {
    fontSize: 14, fontStyle: 'italic',
    textAlign: 'center', paddingVertical: 16,
  },
  goalRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  goalCheck: {
    width: 26, height: 26, borderRadius: 8, borderWidth: 2,
    borderColor: '#d1d5db', alignItems: 'center', justifyContent: 'center',
  },
  goalCheckMark: { color: '#fff', fontSize: 12, fontWeight: '800' },
  goalText: { flex: 1, fontSize: 15, fontWeight: '500' },
  goalTextDone: { color: '#ccc', textDecorationLine: 'line-through' },
  goalRemove: { fontSize: 14 },
  goalAddInput: {
    borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
  },
  goalAddConfirm: {
    paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12,
  },
  goalDueBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  goalDueBadgeText: { fontSize: 11, fontWeight: '600' },
  goalAddForm: { paddingTop: 10 },
  goalResetLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8, marginTop: 12 },
  goalAddActions: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 4 },
  goalAddCancel: {
    paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },

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


