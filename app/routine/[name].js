import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  View, Text, Pressable, StyleSheet, ScrollView, FlatList,
  Alert, TextInput, Modal, Animated, ActivityIndicator, Dimensions,
  Linking, Platform, PanResponder,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Svg, { Polyline, Circle, Line as SvgLine } from 'react-native-svg'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { router, useLocalSearchParams, useFocusEffect, Redirect } from 'expo-router'
import { useAuth } from '../../lib/AuthContext'
import { useTheme } from '../../lib/ThemeContext'
import RunRoutine from '../../components/RunRoutine'
import { routineTheme } from '../../lib/themes'
import { todaySplitIndex, DAY_LABELS, muscleColor, muscleTextColor, normalizeDay } from '../../lib/splitData'
import {
  getRoutineTemplate, loadRoutineTemplate, saveRoutineTemplate, getTodayRun, getRoutineRunsForDate,
  saveRun, resetTodayRun, getGymSplit, getWorkoutRoutineList, deleteWorkoutPlan, renameWorkoutPlan, getWorkoutPlan,
  getDayTodos, saveDayTodos, getWorkoutLogsRange, getAllWorkoutLogs, deleteWorkoutLog, today, getRoutineSettings,
  getWeightLogs, saveWeightLog, getMorningSettings, saveMorningSettings,
  getLooksData, saveLooksData, quickCheckToggle,
  setLooksInRoutine, syncIntegratedTasks, altRoutineName, wipeAltRoutine, taskGoalSecs,
  stepImageUnlocked, subStepImageUnlocked, runWithAdjustedStart,
  recordRunCompletion, skipRunStep, reopenRunStep, toggleLaterItem, withoutPendingLater,
  laterItems, pendingLater, runFullyDone,
} from '../../lib/storage'
import { advanceRunStep, finishRun, checklistTaskMs, timedRunFrom } from '../../lib/runSteps'
import { trySync, pendingUpsert, pendingDeleteIds } from '../../lib/syncQueue'
import { collectPhotoUris } from '../../lib/photoPaths'
import AIRoutineModal from '../../components/AIRoutineModal'
import ImageViewerModal from '../../components/ImageViewerModal'
import MuscleMap from '../../components/MuscleMap'
import ExerciseVideo from '../../components/ExerciseVideo'
import { useSheetDrag } from '../../lib/useSheetDrag'
import { supabase } from '../../lib/supabase'
import { getFitPhotos, getPhotoPasscode, setPhotoPasscode, deleteFitPhoto, deleteStepImage } from '../../lib/photoStorage'
import { autoLogSpan } from '../../lib/timeLogging'
import { maybePromptReview } from '../../lib/review'
import { getRoutinePrefs, saveRoutinePrefs } from '../../lib/routinePrefs'
import {
  getSleep, startSleep, cancelSleep, wakeUp, sleepDurationShort, clockLabel, nightlyLogs,
} from '../../lib/sleepStorage'

const CELL_W = Math.floor((Dimensions.get('window').width - 20 - 24) / 7)
const CELL_H = CELL_W

function fmtMs(ms) {
  const sec = Math.floor(ms / 1000)
  const m = Math.floor(sec / 60)
  return m > 0 ? `${m}m ${sec % 60}s` : `${sec}s`
}

function fmtGoalSecs(s) {
  if (!s) return ''
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m > 0 && sec > 0) return `${m}m ${sec}s`
  if (m > 0) return `${m}m`
  return `${sec}s`
}

// Clock-style elapsed time: 04:32, or 1:04:32 once an hour has passed.
function fmtElapsedSecs(secs) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

// Running total for checklist mode: how long the whole routine has taken so
// far, counted from the moment it was started. Lives in its own component so
// the once-a-second tick re-renders this card only, not the task list.
function ChecklistTimer({ startedAt, doneCount, totalCount, goalSecs, color, theme }) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.floor((Date.now() - (startedAt || Date.now())) / 1000)))

  useEffect(() => {
    const base = startedAt || Date.now()
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - base) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt])

  const hasGoal = goalSecs > 0
  const over = hasGoal && elapsed > goalSecs
  const timeColor = over ? '#ef4444' : color

  return (
    <View style={[s.clTimerCard, { backgroundColor: theme.card, borderColor: over ? '#ef444455' : color + '33' }]}>
      <View style={{ flex: 1 }}>
        <Text style={[s.clTimerLabel, { color: theme.muted }]}>TOTAL TIME</Text>
        <Text style={[s.clTimerBig, { color: timeColor }]}>{fmtElapsedSecs(elapsed)}</Text>
        {hasGoal && (
          <Text style={[s.clTimerSub, { color: over ? '#ef4444' : theme.subtext }]}>
            {over ? `+${fmtElapsedSecs(elapsed - goalSecs)} over the ${fmtGoalSecs(goalSecs)} goal` : `goal ${fmtGoalSecs(goalSecs)}`}
          </Text>
        )}
      </View>
      <View style={[s.clTimerCountPill, { backgroundColor: color + '14' }]}>
        <Text style={[s.clTimerCountText, { color }]}>{doneCount} / {totalCount}</Text>
        <Text style={[s.clTimerCountSub, { color: theme.subtext }]}>done</Text>
      </View>
    </View>
  )
}

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

const MORNING_TIPS = [
  { emoji: '📵', text: 'No phone for the first 30 mins — protect your attention' },
  { emoji: '💧', text: 'Drink a full glass of water right after waking up' },
  { emoji: '☀️', text: 'Get natural sunlight within an hour to set your body clock' },
  { emoji: '🧘', text: '5 mins of stretching or deep breathing before tasks' },
  { emoji: '📋', text: 'Write down 1–3 clear intentions for the day' },
  { emoji: '🚫', text: 'Skip caffeine for the first 90 mins — let cortisol peak naturally' },
]

const NIGHT_TIPS = [
  { emoji: '📵', text: 'No screens 30–60 mins before bed — blue light blocks melatonin' },
  { emoji: '🌑', text: 'Keep your room dark and cool (65–68°F / 18–20°C)' },
  { emoji: '📚', text: 'Swap social media for a book or calm music to wind down' },
  { emoji: '🕙', text: 'Stick to the same bedtime — consistency beats extra hours' },
  { emoji: '☕', text: 'No caffeine after 2 PM — it has a 6-hour half-life' },
  { emoji: '🛏️', text: 'Use your bed only for sleep to train your brain to wind down' },
]

function routineQuote(name) {
  const q = {
    Morning: 'A great morning sets the tone for an amazing day.',
    Evening: 'Wind down and reflect on your wins today.',
    Night: 'Rest and recharge for tomorrow.',
    Fitness: 'Every rep brings you closer to your goals.',
    Nutrition: 'Fuel your body, power your day.',
  }
  return q[name] ?? 'Stay consistent and build momentum.'
}

function MorningTodoList({ userId, theme, color, onHide }) {
  const [todos, setTodos] = useState([])
  const [newText, setNewText] = useState('')
  const date = today()

  useFocusEffect(useCallback(() => {
    getDayTodos(userId, date).then(setTodos).catch(() => {})
  }, [userId, date]))

  async function addTodo() {
    const text = newText.trim()
    if (!text) return
    const item = { id: Date.now(), text, done: false }
    const next = [...todos, item]
    setTodos(next)
    setNewText('')
    await saveDayTodos(userId, date, next)
  }

  async function toggleTodo(id) {
    const next = todos.map(t => t.id === id ? { ...t, done: !t.done } : t)
    setTodos(next)
    await saveDayTodos(userId, date, next)
  }

  async function deleteTodo(id) {
    const next = todos.filter(t => t.id !== id)
    setTodos(next)
    await saveDayTodos(userId, date, next)
  }

  const done = todos.filter(t => t.done).length

  return (
    <View style={[ts.section, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <View style={ts.header}>
        <Text style={[ts.title, { color: theme.text }]}>Write down some goals for today</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {todos.length > 0 && (
            <Text style={[ts.count, { color: theme.subtext }]}>{done}/{todos.length}</Text>
          )}
          <Pressable onPress={onHide} hitSlop={8}>
            <Text style={[ts.hideLink, { color: theme.muted }]}>Hide</Text>
          </Pressable>
        </View>
      </View>

      {todos.map(todo => (
        <View key={todo.id} style={[ts.item, { borderBottomColor: theme.divider }]}>
          <Pressable
            onPress={() => toggleTodo(todo.id)}
            style={[ts.check, todo.done && ts.checkDone]}
          >
            {todo.done && <Text style={ts.checkMark}>✓</Text>}
          </Pressable>
          <Text style={[ts.itemText, { color: theme.text }, todo.done && ts.itemDone]}>
            {todo.text}
          </Text>
          <Pressable onPress={() => deleteTodo(todo.id)} style={ts.del} hitSlop={8}>
            <Text style={[ts.delText, { color: theme.muted }]}>✕</Text>
          </Pressable>
        </View>
      ))}

      <View style={[ts.inputRow, { borderTopColor: theme.divider }]}>
        <TextInput
          style={[ts.input, { color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder }]}
          placeholder="Add a task…"
          placeholderTextColor={theme.muted}
          value={newText}
          onChangeText={setNewText}
          onSubmitEditing={addTodo}
          returnKeyType="done"
        />
        <Pressable onPress={addTodo} style={[ts.addBtn, { backgroundColor: color }]}>
          <Text style={ts.addBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  )
}

// ── Weight advice ──────────────────────────────────────────────────────────
function weightAdvice(logs, goal, unit) {
  if (logs.length < 2) return null
  const recent = logs.slice(0, Math.min(7, logs.length))
  const older  = logs.slice(Math.min(7, logs.length), Math.min(14, logs.length))
  const recentAvg = recent.reduce((s, l) => s + l.weight, 0) / recent.length
  const olderAvg  = older.length > 0 ? older.reduce((s, l) => s + l.weight, 0) / older.length : recentAvg
  const trend = recentAvg - olderAvg

  if (!goal) return { label: `Avg ${recentAvg.toFixed(1)} ${unit}`, tip: 'Set a goal below to get personalized feedback.' }
  if (goal === 'lose') {
    if (trend < -0.3) return { label: `↓ ${Math.abs(trend).toFixed(1)} ${unit} trend`, tip: "Trending down — keep it up! 💪" }
    if (trend >  0.3) return { label: `↑ ${trend.toFixed(1)} ${unit} trend`, tip: 'Weight going up. Try a 200 kcal daily deficit and more movement.' }
    return { label: 'Weight stable', tip: 'To start losing, reduce portions slightly and add daily walks.' }
  }
  if (goal === 'gain') {
    if (trend >  0.3) return { label: `↑ ${trend.toFixed(1)} ${unit} trend`, tip: 'Gaining steadily — keep eating in a surplus and training hard 💪' }
    if (trend < -0.3) return { label: `↓ ${Math.abs(trend).toFixed(1)} ${unit} trend`, tip: 'Weight dropping — add 200–300 extra calories daily to support growth.' }
    return { label: 'Weight stable', tip: 'Not seeing gains? Add more calories and track your protein intake.' }
  }
  if (Math.abs(trend) < 0.3) return { label: 'Weight stable ✅', tip: 'Holding steady — great discipline! Keep up the consistency.' }
  return trend > 0
    ? { label: `↑ ${trend.toFixed(1)} ${unit} trend`, tip: 'Creeping up — small cuts to portions will help.' }
    : { label: `↓ ${Math.abs(trend).toFixed(1)} ${unit} trend`, tip: 'Drifting down — eat a bit more to stay at your target.' }
}

// ── Weight sparkline ───────────────────────────────────────────────────────
function WeightSparkline({ logs, color, theme }) {
  if (logs.length < 2) return null
  const W = 240, H = 70
  const PAD = { l: 8, r: 8, t: 10, b: 10 }
  const min = Math.min(...logs.map(l => l.weight))
  const max = Math.max(...logs.map(l => l.weight))
  const span = max - min || 1
  const cW = W - PAD.l - PAD.r, cH = H - PAD.t - PAD.b
  const pts = logs.map((l, i) => ({
    x: PAD.l + (logs.length > 1 ? (i / (logs.length - 1)) * cW : cW / 2),
    y: PAD.t + cH - ((l.weight - min) / span) * cH,
  }))
  return (
    <Svg width={W} height={H} style={wt.sparkline}>
      <SvgLine x1={PAD.l} y1={PAD.t + cH / 2} x2={W - PAD.r} y2={PAD.t + cH / 2}
        stroke={theme.divider} strokeWidth={1} strokeDasharray="3,3" />
      <Polyline points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color}
        strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y}
          r={i === pts.length - 1 ? 5 : 3}
          fill={i === pts.length - 1 ? color : '#fff'}
          stroke={color} strokeWidth={1.5} />
      ))}
    </Svg>
  )
}

// Many keyboards type a decimal comma ("72,5"), which parseFloat reads as 72.
function parseDecimal(text) {
  return parseFloat(String(text ?? '').trim().replace(',', '.'))
}

const WEIGHT_GOALS = ['lose', 'maintain', 'gain']
const WEIGHT_GOAL_LABELS = { lose: 'Lose weight', maintain: 'Maintain', gain: 'Gain / Build' }

// ── Weight tracker ─────────────────────────────────────────────────────────
function WeightTracker({ userId, theme, color, morningSettings, onUpdateSettings }) {
  const { unit } = useTheme()
  const [logs, setLogs] = useState([])
  const [inputWeight, setInputWeight] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [showGoalEditor, setShowGoalEditor] = useState(false)
  const [editGoal, setEditGoal] = useState(null)
  const [editTarget, setEditTarget] = useState('')
  const todayStr = today()

  useFocusEffect(useCallback(() => {
    getWeightLogs(userId).then(setLogs)
  }, [userId]))

  const todayLog = logs.find(l => l.date === todayStr)
  const graphLogs = [...logs].slice(0, 14).reverse()
  const showInput = !todayLog || isEditing

  async function logWeight() {
    const w = parseDecimal(inputWeight)
    if (!w || w <= 0 || w > 999) return
    await saveWeightLog(userId, todayStr, w)
    setInputWeight('')
    setIsEditing(false)
    getWeightLogs(userId).then(setLogs)
  }

  async function saveGoal() {
    const target = parseDecimal(editTarget)
    const ns = {
      ...morningSettings,
      weightGoal: editGoal,
      targetWeight: target > 0 ? target : null,
    }
    await saveMorningSettings(userId, ns)
    onUpdateSettings(ns)
    setShowGoalEditor(false)
  }

  const advice = weightAdvice(logs, morningSettings.weightGoal, unit)

  return (
    <View style={[wt.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>

      <View style={wt.header}>
        <Text style={[wt.title, { color: theme.text }]}>⚖️  Weight Tracker</Text>
        <Pressable onPress={async () => {
          const ns = { ...morningSettings, hideWeight: true }
          await saveMorningSettings(userId, ns)
          onUpdateSettings(ns)
        }} hitSlop={8}>
          <Text style={[wt.hideBtn, { color: theme.muted }]}>Hide</Text>
        </Pressable>
      </View>

      <Text style={[wt.tip, { color: theme.subtext }]}>
        Weigh yourself right as you get up before eating, drinking, or using the washroom for most accuracy.
      </Text>

      {todayLog && !isEditing && (
        <View style={[wt.loggedRow, { backgroundColor: color + '12', borderColor: color + '28' }]}>
          <Text style={[wt.loggedValue, { color }]}>{todayLog.weight} {unit}</Text>
          <Text style={[wt.loggedLabel, { color: theme.subtext }]}>logged today</Text>
          <Pressable onPress={() => { setInputWeight(String(todayLog.weight)); setIsEditing(true) }} hitSlop={8}>
            <Text style={[wt.updateBtn, { color }]}>Update</Text>
          </Pressable>
        </View>
      )}

      {showInput && (
        <View style={wt.inputRow}>
          <TextInput
            style={[wt.input, { color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder }]}
            placeholder={`This morning's weight (${unit})`}
            placeholderTextColor={theme.muted}
            value={inputWeight}
            onChangeText={setInputWeight}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={logWeight}
          />
          <Pressable onPress={logWeight} style={[wt.logBtn, { backgroundColor: color }]}>
            <Text style={wt.logBtnText}>{todayLog ? 'Save' : 'Log'}</Text>
          </Pressable>
          {isEditing && (
            <Pressable onPress={() => { setIsEditing(false); setInputWeight('') }} hitSlop={8}>
              <Text style={[wt.cancelEdit, { color: theme.muted }]}>✕</Text>
            </Pressable>
          )}
        </View>
      )}

      {graphLogs.length >= 2 && (
        <View style={wt.graphWrap}>
          <WeightSparkline logs={graphLogs} color={color} theme={theme} />
          {advice && (
            <View style={[wt.adviceBox, { backgroundColor: color + '10', borderColor: color + '22' }]}>
              <Text style={[wt.adviceLabel, { color }]}>{advice.label}</Text>
              <Text style={[wt.adviceTip, { color: theme.subtext }]}>{advice.tip}</Text>
            </View>
          )}
        </View>
      )}

      {!showGoalEditor ? (
        <Pressable onPress={() => { setEditGoal(morningSettings.weightGoal); setEditTarget(morningSettings.targetWeight ? String(morningSettings.targetWeight) : ''); setShowGoalEditor(true) }}
          style={[wt.goalRow, { borderTopColor: theme.divider }]}>
          <Text style={[wt.goalLabel, { color: theme.subtext }]}>Goal</Text>
          <Text style={[wt.goalValue, { color: theme.text }]}>
            {morningSettings.weightGoal ? WEIGHT_GOAL_LABELS[morningSettings.weightGoal] : 'Not set'}
            {morningSettings.targetWeight ? `  ·  ${morningSettings.targetWeight} ${unit} target` : ''}
          </Text>
          <Text style={[wt.goalEdit, { color }]}>Edit ›</Text>
        </Pressable>
      ) : (
        <View style={[wt.goalEditor, { borderTopColor: theme.divider }]}>
          <Text style={[wt.goalEditorHdr, { color: theme.subtext }]}>MY GOAL</Text>
          <View style={wt.goalChipRow}>
            {WEIGHT_GOALS.map(g => (
              <Pressable key={g} onPress={() => setEditGoal(g)}
                style={[
                  wt.goalChip,
                  { borderColor: theme.cardBorder, backgroundColor: theme.isDark ? '#1a1a2e' : '#f4f4f8' },
                  editGoal === g && { backgroundColor: color, borderColor: color },
                ]}>
                <Text style={[wt.goalChipText, { color: theme.text }, editGoal === g && { color: '#fff' }]}>
                  {WEIGHT_GOAL_LABELS[g]}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={[wt.input, { color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder, marginTop: 10 }]}
            placeholder={`Target weight in ${unit} (optional)`}
            placeholderTextColor={theme.muted}
            value={editTarget}
            onChangeText={setEditTarget}
            keyboardType="decimal-pad"
            returnKeyType="done"
          />
          <View style={wt.goalActions}>
            <Pressable onPress={() => setShowGoalEditor(false)} style={wt.goalCancel}>
              <Text style={[wt.goalCancelText, { color: theme.subtext }]}>Cancel</Text>
            </Pressable>
            <Pressable onPress={saveGoal} style={[wt.goalSaveBtn, { backgroundColor: color }]}>
              <Text style={wt.goalSaveText}>Save</Text>
            </Pressable>
          </View>
        </View>
      )}

    </View>
  )
}

// ── Looks section ─────────────────────────────────────────────────────────

// ── Night: sleep tracker ──────────────────────────────────────────────────
// The Night counterpart of the weight tracker: set the time you're going to
// sleep (and, optionally, when you want to be up). The home dashboard then
// shows how long you've slept and asks whether you're up; each night is logged.

const SLEEP_BLUE = '#3b82f6'

function timeParts(ms) {
  const d = new Date(ms)
  const h = d.getHours()
  return { h: String(h % 12 || 12), m: String(d.getMinutes()).padStart(2, '0'), ap: h >= 12 ? 'PM' : 'AM' }
}

// h:m AM/PM form fields → minutes since midnight, or null when invalid.
function partsToMins(h, m, ap) {
  const hi = parseInt(h, 10), mi = parseInt(m, 10)
  if (isNaN(hi) || isNaN(mi) || hi < 1 || hi > 12 || mi < 0 || mi > 59) return null
  let h24 = hi
  if (ap === 'PM' && hi < 12) h24 += 12
  if (ap === 'AM' && hi === 12) h24 = 0
  return h24 * 60 + mi
}

function SleepTimeField({ h, m, ap, onH, onM, onAp, theme, color }) {
  return (
    <View style={sl.timeField}>
      <TextInput
        style={[sl.timeInput, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
        value={h} onChangeText={onH} keyboardType="number-pad" maxLength={2}
        placeholder="—" placeholderTextColor={theme.muted}
      />
      <Text style={[sl.timeColon, { color: theme.muted }]}>:</Text>
      <TextInput
        style={[sl.timeInput, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
        value={m} onChangeText={onM} keyboardType="number-pad" maxLength={2}
        placeholder="—" placeholderTextColor={theme.muted}
      />
      <View style={[sl.apToggle, { backgroundColor: theme.isDark ? '#1c1c32' : '#f0f0f8' }]}>
        {['AM', 'PM'].map(v => (
          <Pressable key={v} style={[sl.apBtn, ap === v && { backgroundColor: color }]} onPress={() => onAp(v)}>
            <Text style={[sl.apText, { color: ap === v ? '#fff' : theme.subtext }]}>{v}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function SleepTracker({ userId, theme, color }) {
  const [sleep, setSleep] = useState({ session: null, logs: [] })
  const [busy, setBusy] = useState(false)
  const now = timeParts(Date.now())
  const [sh, setSH] = useState(now.h)
  const [sm, setSM] = useState(now.m)
  const [sap, setSAp] = useState(now.ap)
  const [wh, setWH] = useState('')
  const [wm, setWM] = useState('')
  const [wap, setWAp] = useState('AM')
  const [, setTick] = useState(0)

  useFocusEffect(useCallback(() => {
    getSleep(userId).then(setSleep).catch(() => {})
  }, [userId]))

  // While asleep the "so far" figure keeps moving.
  useEffect(() => {
    if (!sleep.session) return
    const id = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(id)
  }, [sleep.session])

  async function setSleepTime() {
    const sMins = partsToMins(sh, sm, sap)
    if (sMins === null) { Alert.alert('Check the time', 'Use hours 1 to 12 and minutes 0 to 59.'); return }
    const now = Date.now()
    const d = new Date(now)
    d.setHours(Math.floor(sMins / 60), sMins % 60, 0, 0)
    // More than six hours ahead reads as "last night" (logging in the small
    // hours); anything nearer is tonight, even a little in the future. More
    // than twelve hours behind is tonight after midnight (12:30 AM set at
    // 11 PM). Days move by the calendar, not by 24 hours, so a night that
    // changes the clocks still lands on the time typed.
    if (d.getTime() > now + 6 * 3600000) d.setDate(d.getDate() - 1)
    else if (d.getTime() < now - 12 * 3600000) d.setDate(d.getDate() + 1)
    const sleepAt = d.getTime()

    let wakeGoalAt = null
    if (wh.trim() || wm.trim()) {
      const wMins = partsToMins(wh, wm.trim() ? wm : '0', wap)
      if (wMins === null) { Alert.alert('Check the wake-up time', 'Use hours 1 to 12 and minutes 0 to 59, or leave it blank.'); return }
      const w = new Date(sleepAt)
      w.setHours(Math.floor(wMins / 60), wMins % 60, 0, 0)
      if (w.getTime() <= sleepAt) w.setDate(w.getDate() + 1)
      wakeGoalAt = w.getTime()
    }

    setBusy(true)
    try {
      const saved = await startSleep(userId, { sleepAt, wakeGoalAt })
      setSleep(saved)
      // The sleep is saved either way, but someone counting on the alarm
      // needs to know it isn't coming.
      if (wakeGoalAt && !saved?.session?.notifId) {
        Alert.alert(
          'No wake-up alarm',
          wakeGoalAt <= Date.now()
            ? `${clockLabel(wakeGoalAt)} has already passed, so there's no alarm for it. Your sleep time is saved.`
            : 'Your sleep time is saved, but the alarm couldn’t be set. Check that notifications are allowed for LifeLayer in Settings.',
        )
      }
    } catch (e) {
      Alert.alert('Could not save', String(e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  async function handleWake() {
    try { setSleep(await wakeUp(userId)) } catch (e) { Alert.alert('Could not save', String(e?.message ?? e)) }
  }
  async function handleCancel() {
    try { setSleep(await cancelSleep(userId)) } catch (e) { Alert.alert('Could not save', String(e?.message ?? e)) }
  }

  const session = sleep.session
  // A nap is logged beside the night it follows; "last night" and the
  // average read one night per day.
  const logs = nightlyLogs(sleep.logs)
  const last = logs[0]
  const recent = logs.slice(0, 7)
  const avgMins = recent.length ? Math.round(recent.reduce((s, l) => s + (l.minutes || 0), 0) / recent.length) : null
  const asleepFor = session && Date.now() > session.sleepAt ? Date.now() - session.sleepAt : 0

  return (
    <View style={[wt.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <View style={wt.header}>
        <Text style={[wt.title, { color: theme.text }]}>🌙  Sleep Tracker</Text>
      </View>
      <Text style={[wt.tip, { color: theme.subtext }]}>
        Set the time you're going to sleep. Next time you open the app, the home page shows how long you slept and asks if you're up.
      </Text>

      {session ? (
        <>
          <View style={[wt.loggedRow, { backgroundColor: color + '12', borderColor: color + '28' }]}>
            <View style={{ flex: 1 }}>
              <Text style={[wt.loggedValue, { color, fontSize: 17 }]}>Sleeping since {clockLabel(session.sleepAt)}</Text>
              <Text style={[wt.loggedLabel, { color: theme.subtext, marginTop: 2 }]}>
                {session.wakeGoalAt ? `Wake-up at ${clockLabel(session.wakeGoalAt)}` : 'No wake-up time set'}
                {asleepFor > 0 ? `  ·  ${sleepDurationShort(asleepFor)} so far` : ''}
              </Text>
            </View>
          </View>
          <View style={sl.actionRow}>
            <Pressable style={[sl.actionBtn, { backgroundColor: SLEEP_BLUE }]} onPress={handleWake}>
              <Text style={sl.actionText}>I woke up</Text>
            </Pressable>
            <Pressable style={[sl.actionBtn, { backgroundColor: '#ef4444' }]} onPress={handleCancel}>
              <Text style={sl.actionText}>Cancel</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <View style={sl.form}>
          <View style={sl.labelRow}>
            <Text style={[sl.label, { color: theme.subtext }]}>GOING TO SLEEP AT</Text>
            <Pressable onPress={() => { const p = timeParts(Date.now()); setSH(p.h); setSM(p.m); setSAp(p.ap) }} hitSlop={8}>
              <Text style={[sl.link, { color }]}>Use now</Text>
            </Pressable>
          </View>
          <SleepTimeField h={sh} m={sm} ap={sap} onH={setSH} onM={setSM} onAp={setSAp} theme={theme} color={color} />

          <Text style={[sl.label, { color: theme.subtext, marginTop: 14 }]}>WAKE UP AT (optional)</Text>
          <SleepTimeField h={wh} m={wm} ap={wap} onH={setWH} onM={setWM} onAp={setWAp} theme={theme} color={color} />
          <Text style={[sl.hint, { color: theme.muted }]}>Set one and you'll get a notification at that time.</Text>

          <Pressable
            style={[sl.setBtn, { backgroundColor: color, opacity: busy ? 0.6 : 1 }]}
            onPress={setSleepTime}
            disabled={busy}
          >
            <Text style={sl.setBtnText}>{busy ? 'Saving…' : 'Set sleep time'}</Text>
          </Pressable>
        </View>
      )}

      {(last || avgMins !== null) && (
        <View style={[wt.goalRow, { borderTopColor: theme.divider }]}>
          <Text style={[wt.goalLabel, { color: theme.subtext }]}>Last night</Text>
          <Text style={[wt.goalValue, { color: theme.text }]}>
            {last ? sleepDurationShort((last.minutes || 0) * 60000) : '—'}
            {avgMins !== null && recent.length > 1
              ? `  ·  ${sleepDurationShort(avgMins * 60000)} avg over ${recent.length} nights`
              : ''}
          </Text>
        </View>
      )}
    </View>
  )
}

const sl = StyleSheet.create({
  form: { paddingHorizontal: 16, paddingBottom: 14 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 10, fontWeight: '800', letterSpacing: 1.3, marginBottom: 8 },
  link: { fontSize: 12, fontWeight: '700', marginBottom: 8 },
  hint: { fontSize: 11.5, fontWeight: '500', marginTop: 8, lineHeight: 16 },
  timeField: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timeInput: {
    width: 54, borderRadius: 10, borderWidth: 1.5, paddingVertical: 8,
    fontSize: 16, fontWeight: '700', textAlign: 'center',
  },
  timeColon: { fontSize: 18, fontWeight: '700' },
  apToggle: { flexDirection: 'row', borderRadius: 10, padding: 3, marginLeft: 6 },
  apBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  apText: { fontSize: 12, fontWeight: '800' },
  setBtn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 14 },
  setBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  actionRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 14 },
  actionBtn: { flex: 1, borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  actionText: { color: '#fff', fontWeight: '800', fontSize: 14 },
})

// ── Looks section ─────────────────────────────────────────────────────────

const LOOKS_COLOR = '#ec4899'

// Looks data is largely model output, so every field is made plain text and
// anything off-shape is dropped before it is shown or saved: one number or
// object where a string belongs crashed the Morning screen on every open.
// `limits` caps the lengths of fresh AI suggestions; saved data keeps
// whatever the user typed.
const NO_LIMITS = { name: Infinity, product: Infinity, explanation: Infinity }

function cleanLooksCategories(list, limits = NO_LIMITS) {
  const text = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '')
  return (Array.isArray(list) ? list : [])
    .filter(c => c && typeof c === 'object')
    .map(c => ({
      ...c,
      name: text(c.name, limits.name) || 'Skin Care',
      steps: (Array.isArray(c.steps) ? c.steps : [])
        .filter(st => st && typeof st === 'object' && text(st.name, limits.name))
        .map(st => ({
          ...st,
          name: text(st.name, limits.name),
          product: text(st.product, limits.product) || null,
          explanation: text(st.explanation, limits.explanation) || null,
        })),
    }))
}

// ── Phone Downtime (iOS Shortcuts) ──────────────────────────────────────────
// iOS doesn't let an app toggle Screen Time / Downtime directly, but it CAN run
// a user-created Shortcut. The user makes a "Set Focus" shortcut once (named
// below); tapping the button hands off to the Shortcuts app to turn it on.
const DOWNTIME_SHORTCUT = 'LifeLayer Downtime'
const DOWNTIME_SEEN_KEY = '@downtime_setup_seen'

async function runDowntimeShortcut(routineName) {
  // openURL (not canOpenURL) so we don't need LSApplicationQueriesSchemes.
  const url =
    `shortcuts://run-shortcut?name=${encodeURIComponent(DOWNTIME_SHORTCUT)}` +
    `&input=text&text=${encodeURIComponent(routineName)}`
  await Linking.openURL(url)
}

function DowntimeCard({ theme, color, routineName }) {
  const [setupVisible, setSetupVisible] = useState(false)

  async function onStart() {
    try {
      // First time ever: show the one-time setup steps instead of bouncing the
      // user into the Shortcuts app with a "shortcut not found" error.
      const seen = await AsyncStorage.getItem(DOWNTIME_SEEN_KEY)
      if (!seen) {
        setSetupVisible(true)
        await AsyncStorage.setItem(DOWNTIME_SEEN_KEY, '1')
        return
      }
      await runDowntimeShortcut(routineName)
    } catch {
      setSetupVisible(true)
    }
  }

  async function runNow() {
    setSetupVisible(false)
    try { await runDowntimeShortcut(routineName) } catch {}
  }

  const steps = [
    'Open the Shortcuts app and tap + to create a new shortcut.',
    'Add the action “Set Focus” (or “Turn Do Not Disturb On”). Choose Downtime / Do Not Disturb — you can set how long it stays on.',
    `Rename the shortcut to exactly “${DOWNTIME_SHORTCUT}”.`,
    'Come back and tap Start downtime — your Focus turns on automatically.',
  ]

  return (
    <View style={[dt.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <View style={dt.row}>
        <View style={[dt.iconWrap, { backgroundColor: color + '18' }]}>
          <Text style={{ fontSize: 20 }}>🌙</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[dt.title, { color: theme.text }]}>Phone Downtime</Text>
          <Text style={[dt.sub, { color: theme.subtext }]}>
            Turn on a Focus so you can stay off your phone during your routine.
          </Text>
        </View>
      </View>
      <View style={dt.actions}>
        <Pressable style={[dt.startBtn, { backgroundColor: color }]} onPress={onStart}>
          <Text style={dt.startBtnText}>Start downtime</Text>
        </Pressable>
        <Pressable hitSlop={8} onPress={() => setSetupVisible(true)}>
          <Text style={[dt.help, { color }]}>How to set up</Text>
        </Pressable>
      </View>

      <Modal visible={setupVisible} transparent animationType="fade" onRequestClose={() => setSetupVisible(false)}>
        <View style={dt.overlay}>
          <View style={[dt.modal, { backgroundColor: theme.card }]}>
            <Text style={[dt.modalTitle, { color: theme.text }]}>Set up Downtime</Text>
            <Text style={[dt.modalBody, { color: theme.subtext }]}>
              iPhone only lets apps start a Focus through the Shortcuts app — a quick one-time setup:
            </Text>
            {steps.map((step, i) => (
              <View key={i} style={dt.stepRow}>
                <View style={[dt.stepNum, { backgroundColor: color }]}>
                  <Text style={dt.stepNumText}>{i + 1}</Text>
                </View>
                <Text style={[dt.stepText, { color: theme.text }]}>{step}</Text>
              </View>
            ))}
            <Pressable style={[dt.modalBtn, { backgroundColor: color }]} onPress={() => Linking.openURL('shortcuts://').catch(() => {})}>
              <Text style={dt.modalBtnText}>Open Shortcuts app</Text>
            </Pressable>
            <Pressable hitSlop={8} onPress={runNow}>
              <Text style={[dt.help, { color, textAlign: 'center', marginTop: 14 }]}>Already set it up? Start downtime</Text>
            </Pressable>
            <Pressable hitSlop={8} onPress={() => setSetupVisible(false)}>
              <Text style={[dt.modalClose, { color: theme.subtext }]}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const dt = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '700' },
  sub: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 14 },
  startBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  startBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  help: { fontSize: 13, fontWeight: '700' },
  overlay: { flex: 1, backgroundColor: '#00000088', justifyContent: 'center', padding: 24 },
  modal: { borderRadius: 20, padding: 22 },
  modalTitle: { fontSize: 19, fontWeight: '800', marginBottom: 6 },
  modalBody: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  stepNum: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepNumText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  stepText: { flex: 1, fontSize: 14, lineHeight: 19 },
  modalBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  modalBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  modalClose: { textAlign: 'center', marginTop: 14, fontSize: 14, fontWeight: '600' },
})

function LooksSection({ userId, theme, onHide, integrated, onToggleIntegrate }) {
  const [looksData, setLooksData] = useState({ hidden: false, categories: [] })
  const [addingCat, setAddingCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [addingStepFor, setAddingStepFor] = useState(null)
  const [newStepName, setNewStepName] = useState('')
  const [newStepProduct, setNewStepProduct] = useState('')
  const [showDisclaimer, setShowDisclaimer] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [expandedSteps, setExpandedSteps] = useState(new Set())

  function toggleExpanded(id) {
    setExpandedSteps(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // The latest data, for an update that lands after a wait (the analysis
  // takes seconds) and must not undo a change made in the meantime.
  const looksRef = useRef(looksData)

  useFocusEffect(useCallback(() => {
    getLooksData(userId).then(d => {
      const next = {
        hideExplanations: false,
        ...d,
        categories: cleanLooksCategories(d?.categories),
        skinNote: typeof d?.skinNote === 'string' ? d.skinNote : null,
      }
      looksRef.current = next
      setLooksData(next)
    })
  }, [userId]))

  // Takes the new data, or a function from the latest data to the new data.
  async function update(next) {
    const value = typeof next === 'function' ? next(looksRef.current) : next
    looksRef.current = value
    setLooksData(value)
    await saveLooksData(userId, value)
  }

  function addCategory() {
    if (!newCatName.trim()) { setAddingCat(false); return }
    update({ ...looksData, categories: [...looksData.categories, { id: String(Date.now()), name: newCatName.trim(), steps: [] }] })
    setNewCatName('')
    setAddingCat(false)
  }

  function deleteCategory(catId) {
    update({ ...looksData, categories: looksData.categories.filter(c => c.id !== catId) })
  }

  function addStep(catId) {
    if (!newStepName.trim()) { setAddingStepFor(null); return }
    update({
      ...looksData,
      categories: looksData.categories.map(c =>
        c.id !== catId ? c : {
          ...c,
          steps: [...c.steps, { id: String(Date.now()), name: newStepName.trim(), product: newStepProduct.trim() || null, explanation: null }],
        }
      ),
    })
    setNewStepName('')
    setNewStepProduct('')
    setAddingStepFor(null)
  }

  function deleteStep(catId, stepId) {
    update({
      ...looksData,
      categories: looksData.categories.map(c =>
        c.id !== catId ? c : { ...c, steps: c.steps.filter(s => s.id !== stepId) }
      ),
    })
  }

  function handleAnalyzePress() {
    if (looksData.categories.length > 0) {
      Alert.alert(
        'Replace routine?',
        'This will replace your current Looks routine with AI-generated suggestions.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Replace', style: 'destructive', onPress: () => setShowDisclaimer(true) },
        ]
      )
    } else {
      setShowDisclaimer(true)
    }
  }

  async function startAnalysis() {
    setShowDisclaimer(false)
    Alert.alert('Upload Photo', 'How would you like to add your photo?', [
      { text: 'Camera', onPress: captureFromCamera },
      { text: 'Photo Library', onPress: pickFromLibrary },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  async function captureFromCamera() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera access is required to take a photo.')
      return
    }
    const result = await ImagePicker.launchCameraAsync({
      base64: true,
      quality: 0.6,
      allowsEditing: true,
      aspect: [1, 1],
    })
    if (!result.canceled && result.assets?.[0]?.base64) {
      await analyzeImage(result.assets[0].base64)
    }
  }

  // The system photo picker needs no library permission (only the camera
  // does), so asking for one only turned away people who had declined it.
  async function pickFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      base64: true,
      quality: 0.6,
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: 'images',
    })
    if (!result.canceled && result.assets?.[0]?.base64) {
      await analyzeImage(result.assets[0].base64)
    }
  }

  async function analyzeImage(base64) {
    setAnalyzing(true)
    try {
      const { data, error } = await supabase.functions.invoke('openai-proxy', {
        body: { action: 'analyze_looks', base64 },
      })
      if (error) {
        // Limits/flags/oversized photos come back as non-2xx, so the reason is on the error body.
        let detail = null
        try { detail = await error.context?.json() } catch {}
        if (detail?.error === 'daily_limit') {
          Alert.alert('Daily limit reached', detail.reason)
          return
        }
        if (detail?.error === 'image_too_large') {
          Alert.alert('Photo too large', detail.reason)
          return
        }
        if (detail?.error === 'flagged') {
          Alert.alert('Inappropriate Image', 'Please only upload appropriate photos for skin analysis.')
          return
        }
        if (detail?.error === 'limit_unavailable' || detail?.error === 'moderation_unavailable') {
          Alert.alert('Try again', detail.reason)
          return
        }
        throw new Error(detail?.reason ?? error.message ?? 'Request failed')
      }
      if (data?.error === 'daily_limit') {
        Alert.alert('Daily limit reached', data.reason)
        return
      }
      const parsed = data ?? {}
      if (parsed.error === 'inappropriate') {
        Alert.alert('Inappropriate Image', 'Please only upload appropriate photos for skin analysis.')
        return
      }
      if (parsed.error === 'quality') {
        Alert.alert('Image Quality', 'Please use a well-lit photo where your full face is clearly visible and centered.')
        return
      }
      if (!Array.isArray(parsed.categories)) throw new Error('Unexpected response shape')
      const ts = Date.now()
      const categories = cleanLooksCategories(
        parsed.categories.slice(0, 10).map((cat, ci) => ({
          id: String(ts + ci),
          name: cat?.name,
          steps: (Array.isArray(cat?.steps) ? cat.steps.slice(0, 20) : []).map((step, si) => ({
            id: String(ts + ci * 100 + si + 1),
            name: step?.name,
            product: /^(n\/a|none|-)$/i.test(String(step?.product ?? '').trim()) ? null : step?.product,
            explanation: step?.explanation,
          })),
        })),
        { name: 80, product: 120, explanation: 400 },
      ).filter(cat => cat.steps.length > 0)
      if (categories.length === 0) throw new Error('No suggestions came back. Please try again.')
      const skinNote = typeof parsed.skinNote === 'string' ? parsed.skinNote.trim().slice(0, 400) || null : null
      // Built on the data as it is now, not as it was when the photo was sent.
      await update(prev => ({ ...prev, categories, skinNote }))
    } catch (e) {
      Alert.alert('Analysis failed', e.message ?? 'Something went wrong. Please try again.')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <View style={[lks.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <View style={lks.titleRow}>
        <Text style={[lks.title, { color: theme.text }]}>✨  Looks</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Pressable onPress={() => update({ ...looksData, hideExplanations: !looksData.hideExplanations })} hitSlop={8}>
            <Text style={[lks.hideLink, { color: looksData.hideExplanations ? LOOKS_COLOR : theme.muted }]}>
              {looksData.hideExplanations ? 'Show AI notes' : 'Hide AI notes'}
            </Text>
          </Pressable>
          <Pressable onPress={onHide} hitSlop={8}>
            <Text style={[lks.hideLink, { color: theme.muted }]}>Hide</Text>
          </Pressable>
        </View>
      </View>

      <Pressable
        style={[lks.aiBtn, { borderColor: LOOKS_COLOR + '44', backgroundColor: LOOKS_COLOR + '0c' }]}
        onPress={handleAnalyzePress}
        disabled={analyzing}
      >
        {analyzing
          ? <ActivityIndicator size="small" color={LOOKS_COLOR} />
          : <Text style={{ fontSize: 14 }}>🤖</Text>
        }
        <View style={{ flex: 1 }}>
          <Text style={[lks.aiBtnText, { color: LOOKS_COLOR }]}>
            {analyzing ? 'Analyzing your skin & hair…' : 'Analyze my skin and hair with AI'}
          </Text>
          {!analyzing && (
            <Text style={[lks.aiBtnSub, { color: theme.muted }]}>
              Upload a selfie for personalized skin & hair picks
            </Text>
          )}
        </View>
        {!analyzing && <Text style={{ color: LOOKS_COLOR, fontSize: 16, fontWeight: '600' }}>→</Text>}
      </Pressable>

      {looksData.skinNote ? (
        <View style={[lks.skinNoteBox, { backgroundColor: LOOKS_COLOR + '10', borderColor: LOOKS_COLOR + '33' }]}>
          <Text style={{ fontSize: 16 }}>🌟</Text>
          <Text style={[lks.skinNoteText, { color: theme.text, flex: 1 }]}>{looksData.skinNote}</Text>
        </View>
      ) : null}

      {looksData.categories.map(cat => (
        <View key={cat.id} style={[lks.catSection, { borderTopColor: theme.divider }]}>
          <View style={lks.catHeader}>
            <Text style={[lks.catName, { color: theme.text }]}>{cat.name}</Text>
            <Pressable onPress={() => deleteCategory(cat.id)} hitSlop={12}>
              <Text style={[lks.removeX, { color: theme.muted }]}>✕</Text>
            </Pressable>
          </View>

          {cat.steps.map(step => {
            const expanded = expandedSteps.has(step.id)
            return (
              <View key={step.id}>
                <View style={lks.stepRow}>
                  <View style={[lks.stepDot, { backgroundColor: LOOKS_COLOR }]} />
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Text style={[lks.stepName, { color: theme.text }]} numberOfLines={1}>{step.name}</Text>
                    {step.product && !expanded && (
                      <>
                        <Text style={[lks.arrow, { color: theme.muted }]}>→</Text>
                        <Pressable style={{ flex: 1 }} onPress={() => toggleExpanded(step.id)}>
                          <Text style={[lks.stepProduct, { color: LOOKS_COLOR }]} numberOfLines={1}>{step.product}</Text>
                        </Pressable>
                      </>
                    )}
                  </View>
                  <Pressable onPress={() => deleteStep(cat.id, step.id)} hitSlop={12}>
                    <Text style={[lks.removeX, { color: theme.muted, fontSize: 10 }]}>✕</Text>
                  </Pressable>
                </View>
                {step.product && expanded && (
                  <View style={lks.expandedProductBlock}>
                    <Text style={[lks.stepProduct, { color: LOOKS_COLOR }]}>{step.product}</Text>
                    <Pressable onPress={() => toggleExpanded(step.id)} hitSlop={8}>
                      <Text style={[lks.collapseArrow, { color: theme.muted }]}>∧</Text>
                    </Pressable>
                  </View>
                )}
                {step.explanation && !looksData.hideExplanations ? (
                  <Text style={[lks.stepExpl, { color: theme.muted }]}>{step.explanation}</Text>
                ) : null}
              </View>
            )
          })}

          {addingStepFor === cat.id ? (
            <View style={lks.addForm}>
              <TextInput
                style={[lks.input, { color: theme.text, borderColor: LOOKS_COLOR + '88', backgroundColor: theme.input }]}
                placeholder="Step (e.g. Moisturizer)"
                placeholderTextColor={theme.muted}
                value={newStepName}
                onChangeText={setNewStepName}
                autoFocus
              />
              <TextInput
                style={[lks.input, { color: theme.text, borderColor: theme.inputBorder, backgroundColor: theme.input, marginTop: 7 }]}
                placeholder="Product (e.g. Cerave) — optional"
                placeholderTextColor={theme.muted}
                value={newStepProduct}
                onChangeText={setNewStepProduct}
                returnKeyType="done"
                onSubmitEditing={() => addStep(cat.id)}
              />
              <View style={lks.formRow}>
                <Pressable style={[lks.cancelBtn, { borderColor: theme.inputBorder }]} onPress={() => { setAddingStepFor(null); setNewStepName(''); setNewStepProduct('') }}>
                  <Text style={{ color: theme.subtext, fontWeight: '600', fontSize: 13 }}>Cancel</Text>
                </Pressable>
                <Pressable style={[lks.confirmBtn, { backgroundColor: LOOKS_COLOR }]} onPress={() => addStep(cat.id)}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Add Step</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable style={lks.addLineBtn} onPress={() => { setAddingStepFor(cat.id); setNewStepName(''); setNewStepProduct('') }}>
              <Text style={[lks.addLineBtnText, { color: LOOKS_COLOR }]}>＋  Add step</Text>
            </Pressable>
          )}
        </View>
      ))}

      {addingCat ? (
        <View style={[lks.addCatBlock, { borderTopColor: looksData.categories.length > 0 ? theme.divider : 'transparent' }]}>
          <TextInput
            style={[lks.input, { color: theme.text, borderColor: LOOKS_COLOR + '88', backgroundColor: theme.input }]}
            placeholder="Category name (e.g. Skin care)"
            placeholderTextColor={theme.muted}
            value={newCatName}
            onChangeText={setNewCatName}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={addCategory}
          />
          <View style={lks.formRow}>
            <Pressable style={[lks.cancelBtn, { borderColor: theme.inputBorder }]} onPress={() => { setAddingCat(false); setNewCatName('') }}>
              <Text style={{ color: theme.subtext, fontWeight: '600', fontSize: 13 }}>Cancel</Text>
            </Pressable>
            <Pressable style={[lks.confirmBtn, { backgroundColor: LOOKS_COLOR }]} onPress={addCategory}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Add</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          style={[lks.addCatBtn, { borderColor: LOOKS_COLOR + '55', marginTop: looksData.categories.length > 0 ? 10 : 0 }]}
          onPress={() => setAddingCat(true)}
        >
          <Text style={[lks.addCatBtnText, { color: LOOKS_COLOR }]}>＋  Add category</Text>
        </Pressable>
      )}

      {(looksData.categories.length > 0 || integrated) && (
        <Pressable
          style={[lks.integrateBtn, {
            borderColor: LOOKS_COLOR + (integrated ? '66' : '55'),
            backgroundColor: integrated ? LOOKS_COLOR + '14' : 'transparent',
          }]}
          onPress={() => onToggleIntegrate(looksData)}
        >
          <Text style={[lks.integrateBtnText, { color: LOOKS_COLOR }]}>
            {integrated ? '✓  In your Morning tasks' : '＋  Add to Morning tasks'}
          </Text>
          <Text style={[lks.integrateBtnSub, { color: theme.muted }]}>
            {integrated
              ? 'Synced with this card. Tap to remove from your Morning tasks.'
              : 'Do your Looks routine as part of your Morning routine — as one task or one per category.'}
          </Text>
        </Pressable>
      )}

      <Modal visible={showDisclaimer} transparent animationType="fade" onRequestClose={() => setShowDisclaimer(false)}>
        <View style={lks.disclaimerOverlay}>
          <Pressable style={lks.disclaimerBg} onPress={() => setShowDisclaimer(false)} />
          <View style={[lks.disclaimerCard, { backgroundColor: theme.card }]}>
            <Text style={[lks.disclaimerTitle, { color: theme.text }]}>AI Skin Analysis</Text>
            <Text style={[lks.disclaimerBody, { color: theme.subtext, marginBottom: 12 }]}>
              By continuing, you agree that your photo is sent securely to our AI provider (OpenAI) for a one-time analysis. It is not stored after the analysis, and it is used only to generate your skincare and haircare suggestions.
            </Text>
            <Text style={[lks.disclaimerBody, { color: theme.subtext }]}>
              This feature is for general self-care guidance only. For serious, painful, or worsening skin concerns, please speak with a dermatologist or healthcare professional.
            </Text>
            <View style={lks.disclaimerBtns}>
              <Pressable
                style={[lks.disclaimerCancelBtn, { borderColor: theme.cardBorder }]}
                onPress={() => setShowDisclaimer(false)}
              >
                <Text style={[lks.disclaimerCancelText, { color: theme.subtext }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[lks.disclaimerConfirmBtn, { backgroundColor: LOOKS_COLOR }]}
                onPress={startAnalysis}
              >
                <Text style={lks.disclaimerConfirmText}>Agree & continue →</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

function MonthCalendar({ year, month, logMap, accentColor, theme, onDayPress, musclesByGroup = {} }) {
  const ABBR = ['M','T','W','T','F','S','S']
  const firstDay = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startOffset = (firstDay.getDay() + 6) % 7

  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`

  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const rows = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))

  return (
    <View style={hcs.month}>
      <Text style={[hcs.monthTitle, { color: theme.text }]}>{MONTH_NAMES[month]} {year}</Text>
      <View style={hcs.weekRow}>
        {ABBR.map((a, i) => (
          <View key={i} style={hcs.cell}>
            <Text style={[hcs.dayLabel, { color: theme.subtext }]}>{a}</Text>
          </View>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={hcs.weekRow}>
          {row.map((day, di) => {
            if (!day) return <View key={di} style={hcs.cell} />
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
            const log = logMap[dateStr]
            const isToday = dateStr === todayStr
            const isFuture = dateStr > todayStr
            const muscles = musclesByGroup[log?.muscleGroup]
            return (
              <View key={di} style={hcs.cell}>
                <Pressable
                  style={[
                    hcs.monthCell,
                    { borderColor: theme.cardBorder },
                    log && { borderColor: accentColor + '55', backgroundColor: accentColor + '08' },
                    isToday && { borderColor: accentColor, backgroundColor: accentColor + '15' },
                  ]}
                  onPress={log ? () => onDayPress(log) : undefined}
                >
                  {log && muscles && (
                    <MuscleMap muscles={muscles.primary} secondaryMuscles={muscles.secondary} size={CELL_W} interactive={false} />
                  )}
                  <View style={hcs.monthOverlay}>
                    <Text style={[
                      hcs.monthDayNum,
                      { color: isFuture ? theme.muted : isToday ? accentColor : log ? accentColor : theme.text },
                      log && { fontWeight: '700' },
                    ]}>
                      {day}
                    </Text>
                  </View>
                </Pressable>
              </View>
            )
          })}
        </View>
      ))}
    </View>
  )
}

// ── Progress photo viewer (optionally passcode-protected) ──────────────────

// Wrong passcode guesses are counted on the device, so closing the sheet
// doesn't reset them: after a few misses, each further try waits longer.
const PASS_FAILS_KEY = uid => `@fitpass_fails_${uid}`
const FREE_PASS_TRIES = 3

async function readPassFails(userId) {
  try {
    const v = JSON.parse((await AsyncStorage.getItem(PASS_FAILS_KEY(userId))) ?? 'null')
    return { count: v?.count ?? 0, until: v?.until ?? 0 }
  } catch {
    return { count: 0, until: 0 }
  }
}

function writePassFails(userId, fails) {
  return (fails
    ? AsyncStorage.setItem(PASS_FAILS_KEY(userId), JSON.stringify(fails))
    : AsyncStorage.removeItem(PASS_FAILS_KEY(userId))
  ).catch(() => {})
}

function waitLabel(until) {
  const secs = Math.max(1, Math.ceil((until - Date.now()) / 1000))
  return secs >= 60 ? `${Math.ceil(secs / 60)} min` : `${secs} sec`
}

function FitPhotoSection({ userId, date, theme, accentColor }) {
  const [photoUri, setPhotoUri] = useState(null)
  const [hasPass, setHasPass] = useState(false)
  const [locked, setLocked] = useState(false)
  const [codeInput, setCodeInput] = useState('')
  const [settingCode, setSettingCode] = useState(false)
  const [newCode, setNewCode] = useState('')
  // The first entry of a new passcode while it is being repeated.
  const [firstCode, setFirstCode] = useState(null)
  // When the next unlock try is allowed after too many wrong ones (0: now).
  const [waitUntil, setWaitUntil] = useState(0)

  useEffect(() => {
    let active = true
    Promise.all([getFitPhotos(userId), getPhotoPasscode(userId), readPassFails(userId)]).then(([map, pass, fails]) => {
      if (!active) return
      setPhotoUri(map[date] ?? null)
      setHasPass(!!pass)
      setLocked(!!pass && !!map[date])
      setCodeInput(''); setSettingCode(false); setNewCode(''); setFirstCode(null)
      setWaitUntil(fails.until > Date.now() ? fails.until : 0)
    })
    return () => { active = false }
  }, [userId, date])

  useEffect(() => {
    if (!waitUntil) return
    const id = setTimeout(() => setWaitUntil(0), Math.max(0, waitUntil - Date.now()))
    return () => clearTimeout(id)
  }, [waitUntil])

  if (!photoUri) return null

  async function tryUnlock() {
    const fails = await readPassFails(userId)
    if (fails.until > Date.now()) { setWaitUntil(fails.until); setCodeInput(''); return }
    const pass = await getPhotoPasscode(userId)
    const guess = codeInput
    setCodeInput('')
    if (guess === pass) {
      await writePassFails(userId, null)
      setLocked(false)
      return
    }
    const count = fails.count + 1
    const until = count >= FREE_PASS_TRIES
      ? Date.now() + Math.min(30000 * 2 ** (count - FREE_PASS_TRIES), 60 * 60 * 1000)
      : 0
    await writePassFails(userId, { count, until })
    setWaitUntil(until)
    Alert.alert('Wrong passcode', until ? `Too many tries. Try again in ${waitLabel(until)}.` : 'Please try again.')
  }

  // Asked for twice: a mistyped code nobody knows would lock the photos away.
  async function saveNewCode() {
    if (newCode.length !== 4) return
    if (firstCode === null) { setFirstCode(newCode); setNewCode(''); return }
    if (newCode !== firstCode) {
      setFirstCode(null); setNewCode('')
      Alert.alert('Passcodes don’t match', 'Choose a passcode and enter the same one twice.')
      return
    }
    await setPhotoPasscode(userId, newCode)
    await writePassFails(userId, null)
    setHasPass(true); setSettingCode(false); setNewCode(''); setFirstCode(null)
    Alert.alert('Passcode set 🔒', 'Your progress photos are now protected.')
  }

  // There is no recovering a forgotten passcode: resetting it also deletes
  // the photos it protects, so it can't be used to get around it.
  function confirmResetPass() {
    Alert.alert(
      'Forgot your passcode?',
      'Resetting removes the passcode and permanently deletes all of your progress photos on this device. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete photos & reset', style: 'destructive', onPress: async () => {
          try {
            const map = await getFitPhotos(userId)
            for (const d of Object.keys(map)) await deleteFitPhoto(userId, d)
            await setPhotoPasscode(userId, null)
            await writePassFails(userId, null)
            setHasPass(false); setLocked(false); setWaitUntil(0); setPhotoUri(null)
          } catch {
            Alert.alert('Could not reset', 'Please try again.')
          }
        } },
      ],
    )
  }

  function confirmDeletePhoto() {
    Alert.alert('Delete this photo?', 'This progress photo will be permanently deleted from this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await deleteFitPhoto(userId, date)
          setPhotoUri(null)
        } catch {
          Alert.alert('Could not delete', 'Please try again.')
        }
      } },
    ])
  }

  async function removePass() {
    await setPhotoPasscode(userId, null)
    setHasPass(false)
  }

  return (
    <View style={fp.wrap}>
      <Text style={[fp.label, { color: theme.subtext }]}>PROGRESS PHOTO</Text>
      {locked ? (
        <View style={[fp.lockBox, { borderColor: theme.cardBorder, backgroundColor: theme.isDark ? '#ffffff06' : '#00000004' }]}>
          <Text style={{ fontSize: 26 }}>🔒</Text>
          <Text style={[fp.lockText, { color: theme.subtext }]}>
            {waitUntil ? `Too many tries. Try again in ${waitLabel(waitUntil)}.` : 'Enter your passcode to view'}
          </Text>
          <View style={fp.codeRow}>
            <TextInput
              style={[fp.codeInput, { color: theme.text, borderColor: theme.cardBorder, backgroundColor: theme.bg }]}
              value={codeInput} onChangeText={setCodeInput}
              keyboardType="number-pad" maxLength={4} secureTextEntry
              placeholder="••••" placeholderTextColor={theme.muted}
            />
            <Pressable
              style={[fp.codeBtn, { backgroundColor: accentColor, opacity: codeInput.length === 4 && !waitUntil ? 1 : 0.4 }]}
              onPress={tryUnlock} disabled={codeInput.length !== 4 || !!waitUntil}
            >
              <Text style={fp.codeBtnText}>Unlock</Text>
            </Pressable>
          </View>
          <Pressable onPress={confirmResetPass} hitSlop={8}>
            <Text style={[fp.forgotText, { color: theme.muted }]}>Forgot passcode?</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <Image source={{ uri: photoUri }} style={fp.photo} contentFit="cover" />
          {settingCode ? (
            <View style={{ marginTop: 10 }}>
              <Text style={[fp.hint, { color: theme.subtext }]}>
                {firstCode === null
                  ? 'Choose a 4-digit passcode. If you ever forget it, resetting it deletes your progress photos.'
                  : 'Enter the same passcode again.'}
              </Text>
              <View style={fp.codeRow}>
                <TextInput
                  key={firstCode === null ? 'choose' : 'repeat'}
                  style={[fp.codeInput, { color: theme.text, borderColor: theme.cardBorder, backgroundColor: theme.bg }]}
                  value={newCode} onChangeText={setNewCode}
                  keyboardType="number-pad" maxLength={4} secureTextEntry
                  placeholder={firstCode === null ? '4-digit code' : 'Repeat code'} placeholderTextColor={theme.muted}
                  autoFocus
                />
                <Pressable
                  style={[fp.codeBtn, { backgroundColor: accentColor, opacity: newCode.length === 4 ? 1 : 0.4 }]}
                  onPress={saveNewCode} disabled={newCode.length !== 4}
                >
                  <Text style={fp.codeBtnText}>{firstCode === null ? 'Next' : 'Set'}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={fp.actionsRow}>
              {hasPass ? (
                <Pressable onPress={removePass} hitSlop={8}>
                  <Text style={[fp.actionText, { color: theme.muted }]}>🔓 Remove passcode</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => setSettingCode(true)} hitSlop={8}>
                  <Text style={[fp.actionText, { color: accentColor }]}>🔒 Protect with passcode</Text>
                </Pressable>
              )}
              <Pressable onPress={confirmDeletePhoto} hitSlop={8}>
                <Text style={[fp.actionText, { color: '#ef4444' }]}>🗑 Delete photo</Text>
              </Pressable>
            </View>
          )}
        </>
      )}
    </View>
  )
}

const fp = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  photo: { width: '100%', height: 280, borderRadius: 16 },
  lockBox: {
    borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed',
    alignItems: 'center', paddingVertical: 22, gap: 8,
  },
  lockText: { fontSize: 13, fontWeight: '600' },
  codeRow: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  codeInput: {
    borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 9,
    fontSize: 18, fontWeight: '700', letterSpacing: 6, minWidth: 110, textAlign: 'center',
  },
  codeBtn: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12 },
  codeBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  actionsRow: { flexDirection: 'row', justifyContent: 'center', gap: 18, paddingTop: 10 },
  actionText: { fontSize: 13, fontWeight: '700' },
  hint: { fontSize: 12, fontWeight: '600', lineHeight: 17, textAlign: 'center', marginBottom: 8, paddingHorizontal: 8 },
  forgotText: { fontSize: 12.5, fontWeight: '700', marginTop: 2 },
})

// Removing a day's workout also offers to remove that day's progress photo,
// which would otherwise stay on the phone with nothing left that shows it.
async function confirmDeleteWorkout(userId, log, dateLabel, onDeleted) {
  let hasPhoto = false
  try { hasPhoto = !!(await getFitPhotos(userId))[log.date] } catch {}
  const remove = async withPhoto => {
    try {
      await deleteWorkoutLog(userId, log.date)
    } catch {
      Alert.alert('Could not delete', 'Please check your connection and try again.')
      return
    }
    if (withPhoto) await deleteFitPhoto(userId, log.date).catch(() => {})
    onDeleted()
  }
  const what = `${log.muscleGroup || 'This workout'} on ${dateLabel} will be removed from your history.`
  Alert.alert(
    'Delete this workout?',
    hasPhoto ? `${what} That day also has a progress photo.` : what,
    hasPhoto
      ? [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete workout only', onPress: () => remove(false) },
          { text: 'Delete workout and photo', style: 'destructive', onPress: () => remove(true) },
        ]
      : [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => remove(false) },
        ],
  )
}

function WorkoutHistoryModal({ visible, onClose, userId, accentColor, theme, onDeleted }) {
  const { unit } = useTheme()
  const [logMap, setLogMap] = useState({})
  const [musclesByGroup, setMusclesByGroup] = useState({})
  const [loading, setLoading] = useState(true)
  const [detailLog, setDetailLog] = useState(null)
  const detailDrag = useSheetDrag(() => setDetailLog(null), { visible: !!detailLog })
  const [detailMuscles, setDetailMuscles] = useState({ primary: [], secondary: [] })
  const [monthCount, setMonthCount] = useState(12)

  // Remove the workout shown in the detail sheet from that day's history.
  // The week strip behind this modal is told too, or it keeps showing it.
  function confirmDeleteDetail() {
    const log = detailLog
    if (!log?.date) return
    confirmDeleteWorkout(userId, log, fmtDate(log.date), () => {
      setLogMap(prev => { const next = { ...prev }; delete next[log.date]; return next })
      setDetailLog(null)
      onDeleted?.(log.date)
    })
  }

  useEffect(() => {
    if (!visible) return
    setLoading(true)
    getAllWorkoutLogs(userId).then(async map => {
      setLogMap(map)
      const uniqueGroups = [...new Set(Object.values(map).map(l => l.muscleGroup).filter(Boolean))]
      const byGroup = {}
      await Promise.all(uniqueGroups.map(async group => {
        const plan = await getWorkoutPlan(userId, group)
        const primary = new Set(), secondary = new Set()
        plan.forEach(ex => {
          ex.muscles?.forEach(m => m?.name && primary.add(m.name))
          ex.musclesSecondary?.forEach(m => m?.name && secondary.add(m.name))
        })
        if (primary.size > 0) byGroup[group] = { primary: [...primary], secondary: [...secondary] }
      }))
      setMusclesByGroup(byGroup)
      setLoading(false)
    })
  }, [visible, userId])

  useEffect(() => {
    if (!detailLog) { setDetailMuscles({ primary: [], secondary: [] }); return }
    getWorkoutPlan(userId, detailLog.muscleGroup).then(plan => {
      const primary = new Set(), secondary = new Set()
      plan.forEach(ex => {
        ex.muscles?.forEach(m => m?.name && primary.add(m.name))
        ex.musclesSecondary?.forEach(m => m?.name && secondary.add(m.name))
      })
      setDetailMuscles({ primary: [...primary], secondary: [...secondary] })
    })
  }, [detailLog, userId])

  const months = useMemo(() => {
    const result = []
    const now = new Date()
    for (let i = 0; i < monthCount; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      result.push({ year: d.getFullYear(), month: d.getMonth() })
    }
    return result
  }, [monthCount])

  function fmtDate(dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr + 'T12:00:00Z')
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }

  function fmtDur(startedAt, completedAt) {
    if (!startedAt || !completedAt) return null
    const m = Math.floor((completedAt - startedAt) / 60000)
    if (m < 1) return null
    const h = Math.floor(m / 60)
    return h > 0 ? `${h}h ${m % 60}m` : `${m}m`
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[hcs.screen, { backgroundColor: theme.bg }]}>
        {/* Header */}
        <View style={[hcs.header, { borderBottomColor: theme.headerBorder, backgroundColor: theme.header }]}>
          <Text style={[hcs.headerTitle, { color: theme.text }]}>Workout History</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={[hcs.doneBtn, { color: accentColor }]}>Done</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={hcs.loadingWrap}>
            <ActivityIndicator color={accentColor} size="large" />
          </View>
        ) : (
          <FlatList
            // Virtualized so a year of months doesn't mount at once — every
            // logged day cell carries a MuscleMap (a body PNG plus overlay
            // images), so the old ScrollView paid for all ~12 months of them
            // on open. Only the months near the viewport mount now; offscreen
            // ones are recycled as the user scrolls.
            data={months}
            keyExtractor={({ year, month }) => `${year}-${month}`}
            renderItem={({ item: { year, month } }) => (
              <MonthCalendar
                year={year}
                month={month}
                logMap={logMap}
                accentColor={accentColor}
                theme={theme}
                onDayPress={log => setDetailLog(log)}
                musclesByGroup={musclesByGroup}
              />
            )}
            initialNumToRender={3}
            maxToRenderPerBatch={3}
            windowSize={7}
            // Same endless paging the ScrollView's onScroll did by hand: near
            // the bottom, extend the month list and let useMemo grow `months`.
            onEndReached={() => setMonthCount(c => c + 6)}
            onEndReachedThreshold={0.5}
            contentContainerStyle={hcs.scrollContent}
            showsVerticalScrollIndicator={false}
            ListFooterComponent={<View style={{ height: 40 }} />}
          />
        )}

        {/* Detail overlay */}
        {detailLog && (
          <>
            <Animated.View pointerEvents="none" style={[hcs.detailOverlay, { opacity: detailDrag.backdrop }]} />
            <Pressable style={StyleSheet.absoluteFill} onPress={detailDrag.close} />
            <Animated.View style={[hcs.detailSheet, { backgroundColor: theme.card, transform: [{ translateY: detailDrag.dragY }] }]}>
              <View {...detailDrag.handlePan.panHandlers} style={detailDrag.grabStyle}>
                <View style={[wcs.handle, { backgroundColor: theme.divider }]} />
              </View>
              <View style={wcs.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[wcs.sheetTitle, { color: theme.text }]}>{detailLog.muscleGroup}</Text>
                  <Text style={[wcs.sheetMeta, { color: theme.subtext }]}>
                    {fmtDate(detailLog.date)}
                    {fmtDur(detailLog.startedAt, detailLog.completedAt)
                      ? `  ·  ${fmtDur(detailLog.startedAt, detailLog.completedAt)}`
                      : ''}
                  </Text>
                </View>
              </View>
              {detailMuscles.primary.length > 0 && (
                <View style={{ alignItems: 'center', marginBottom: 12 }}>
                  <MuscleMap muscles={detailMuscles.primary} secondaryMuscles={detailMuscles.secondary} size={220} />
                </View>
              )}

              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 360 }}>
                <FitPhotoSection userId={userId} date={detailLog.date} theme={theme} accentColor={accentColor} />
                {(detailLog.exercises ?? []).map((ex, i) => (
                  <View key={ex.exerciseId ?? i} style={[wcs.exBlock, { borderBottomColor: theme.divider }]}>
                    <View style={wcs.exNameRow}>
                      <View style={wcs.exThumbWrap}>
                        {ex.gifUrl ? (
                          <Image source={{ uri: ex.gifUrl }} style={wcs.exThumb} contentFit="cover" autoplay={false} />
                        ) : (
                          <View style={[wcs.exThumb, wcs.exThumbEmpty]}>
                            <Text style={{ fontSize: 18 }}>🏋️</Text>
                          </View>
                        )}
                        {ex.skipped && !(ex.sets ?? []).some(st => st.reps > 0 || st.weight > 0) && (
                          <View style={wcs.exThumbOverlay}>
                            <Text style={wcs.exThumbOverlayText}>–</Text>
                          </View>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[wcs.exName, { color: theme.text }]}>{ex.name}</Text>
                        {ex.skipped && !(ex.sets ?? []).some(st => st.reps > 0 || st.weight > 0) && (
                          <Text style={wcs.skippedLabel}>Skipped</Text>
                        )}
                      </View>
                    </View>
                    {(ex.sets ?? []).some(st => st.reps > 0 || st.weight > 0) && (
                      <View style={wcs.setsRow}>
                        {ex.sets.map((st, si) => (
                          <View key={si} style={[wcs.setChip, { backgroundColor: theme.isDark ? '#ffffff08' : '#00000007', borderColor: theme.isDark ? '#ffffff14' : '#0000000d' }]}>
                            <Text style={[wcs.setChipNum, { color: theme.muted }]}>{si + 1}</Text>
                            <Text style={[wcs.setChipVal, { color: theme.text }]}>
                              {st.weight > 0 ? `${st.weight}${unit} × ${st.reps}` : `${st.reps} reps`}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                ))}
              </ScrollView>
              <Pressable style={[wcs.closeBtn, { backgroundColor: accentColor }]} onPress={() => setDetailLog(null)}>
                <Text style={wcs.closeBtnText}>Close</Text>
              </Pressable>
              <Pressable style={wcs.deleteBtn} onPress={confirmDeleteDetail} hitSlop={6}>
                <Text style={wcs.deleteBtnText}>Delete this workout from history</Text>
              </Pressable>
            </Animated.View>
          </>
        )}
      </View>
    </Modal>
  )
}

function WorkoutWeekCalendar({ userId, theme, accentColor }) {
  const [weekLogs, setWeekLogs] = useState([])
  const [weekMuscles, setWeekMuscles] = useState({})
  const [detailLog, setDetailLog] = useState(null)
  const detailDrag = useSheetDrag(() => setDetailLog(null), { visible: !!detailLog })
  const [detailMuscles, setDetailMuscles] = useState({ primary: [], secondary: [] })
  const [historyVisible, setHistoryVisible] = useState(false)
  const { unit } = useTheme()

  // Remove the workout shown in the sheet from that day's history.
  function confirmDeleteDetail() {
    const log = detailLog
    if (!log?.date) return
    confirmDeleteWorkout(userId, log, fmtDetailDate(log.date), () => {
      clearWeekDay(log.date)
      setDetailLog(null)
    })
  }

  // A workout deleted here or from "View all" leaves the strip at once.
  function clearWeekDay(date) {
    setWeekLogs(prev => prev.map(d => d.date === date ? { ...d, log: null } : d))
  }

  useEffect(() => {
    if (!detailLog) { setDetailMuscles({ primary: [], secondary: [] }); return }
    getWorkoutPlan(userId, detailLog.muscleGroup).then(plan => {
      const primary = new Set(), secondary = new Set()
      plan.forEach(ex => {
        ex.muscles?.forEach(m => m?.name && primary.add(m.name))
        ex.musclesSecondary?.forEach(m => m?.name && secondary.add(m.name))
      })
      setDetailMuscles({ primary: [...primary], secondary: [...secondary] })
    })
  }, [detailLog, userId])

  useFocusEffect(useCallback(() => {
    const js = new Date()
    const dow = js.getDay()
    const diff = dow === 0 ? -6 : 1 - dow
    const monday = new Date(js)
    monday.setDate(js.getDate() + diff)
    const startDay = new Date(monday)
    startDay.setDate(monday.getDate() - 7)
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(startDay)
      d.setDate(startDay.getDate() + i)
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    })
    // The whole strip in ONE range query — this used to be fourteen
    // getWorkoutLog calls, one per cell. Then one plan fetch per UNIQUE
    // muscle group: a split repeats the same few groups across the two
    // weeks, so fetching per day re-downloaded the same plan over and over.
    getWorkoutLogsRange(userId, days[0], days[days.length - 1]).then(async logsByDate => {
      setWeekLogs(days.map(date => ({ date, log: logsByDate[date] ?? null })))
      const groups = [...new Set(days.map(d => logsByDate[d]?.muscleGroup).filter(Boolean))]
      const byGroup = {}
      await Promise.all(groups.map(async group => {
        const plan = await getWorkoutPlan(userId, group)
        const primary = new Set(), secondary = new Set()
        plan.forEach(ex => {
          ex.muscles?.forEach(m => m?.name && primary.add(m.name))
          ex.musclesSecondary?.forEach(m => m?.name && secondary.add(m.name))
        })
        byGroup[group] = { primary: [...primary], secondary: [...secondary] }
      }))
      const muscles = {}
      for (const date of days) {
        const group = logsByDate[date]?.muscleGroup
        if (group) muscles[date] = byGroup[group]
      }
      setWeekMuscles(muscles)
    })
  }, [userId]))

  if (!weekLogs.length) return null

  const js = new Date()
  const todayStr = `${js.getFullYear()}-${String(js.getMonth()+1).padStart(2,'0')}-${String(js.getDate()).padStart(2,'0')}`
  const ABBR = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

  function fmtDetailDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00Z')
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  function fmtDuration(startedAt, completedAt) {
    if (!startedAt || !completedAt) return null
    const m = Math.floor((completedAt - startedAt) / 60000)
    if (m < 1) return null
    const h = Math.floor(m / 60)
    return h > 0 ? `${h}h ${m % 60}m` : `${m}m`
  }

  return (
    <View style={[wcs.card, { backgroundColor: theme.isDark ? theme.bg : '#f8f7ff', borderColor: theme.cardBorder }]}>
      <View style={wcs.calHeader}>
        <Text style={[wcs.header, { color: theme.subtext }]}>THIS WEEK</Text>
        <Pressable onPress={() => setHistoryVisible(true)} hitSlop={8}>
          <Text style={[wcs.viewAllBtn, { color: accentColor }]}>View all →</Text>
        </Pressable>
      </View>
      <View style={wcs.abbrRow}>
        {ABBR.map((a, i) => (
          <View key={i} style={wcs.abbrCell}>
            <Text style={[wcs.abbrText, { color: theme.subtext }]}>{a}</Text>
          </View>
        ))}
      </View>
      {[weekLogs.slice(0, 7), weekLogs.slice(7, 14)].map((week, wi) => (
        <View key={wi} style={[wcs.row, wi === 0 && { marginBottom: 4 }]}>
          {week.map(({ date, log }) => {
            const isToday = date === todayStr
            const isFuture = date > todayStr
            const dateNum = parseInt(date.slice(8), 10)
            const workout = log?.muscleGroup
            const dayMuscles = weekMuscles[date]
            return (
              <Pressable
                key={date}
                style={[
                  wcs.col,
                  { borderColor: theme.cardBorder },
                  workout && { borderColor: accentColor + '55', backgroundColor: theme.isDark ? accentColor + '14' : accentColor + '08' },
                  isToday && { borderColor: accentColor, backgroundColor: accentColor + '18' },
                ]}
                onPress={workout ? () => setDetailLog(log) : undefined}
              >
                {workout && dayMuscles && (
                  <MuscleMap muscles={dayMuscles.primary} secondaryMuscles={dayMuscles.secondary} size={CELL_W} interactive={false} />
                )}
                <View style={wcs.overlayWrap}>
                  <Text style={[
                    wcs.overlayNum,
                    workout
                      ? { color: '#fff', textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 }
                      : { color: isFuture ? theme.muted : isToday ? accentColor : theme.text },
                  ]}>
                    {dateNum}
                  </Text>
                </View>
              </Pressable>
            )
          })}
        </View>
      ))}

      <Modal visible={!!detailLog} transparent animationType="slide" onRequestClose={detailDrag.close}>
        <View style={wcs.modalOverlay}>
          <Animated.View pointerEvents="none" style={[wcs.modalBg, { opacity: detailDrag.backdrop }]} />
          <Pressable style={StyleSheet.absoluteFill} onPress={detailDrag.close} />
          <Animated.View style={[wcs.sheet, { backgroundColor: theme.card, transform: [{ translateY: detailDrag.dragY }] }]}>
            <View {...detailDrag.handlePan.panHandlers} style={detailDrag.grabStyle}>
              <View style={[wcs.handle, { backgroundColor: theme.divider }]} />
            </View>
            {detailLog && (
              <>
                <View style={wcs.sheetHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[wcs.sheetTitle, { color: theme.text }]}>{detailLog.muscleGroup}</Text>
                    <Text style={[wcs.sheetMeta, { color: theme.subtext }]}>
                      {fmtDetailDate(detailLog.date)}
                      {fmtDuration(detailLog.startedAt, detailLog.completedAt)
                        ? `  ·  ${fmtDuration(detailLog.startedAt, detailLog.completedAt)}`
                        : ''}
                    </Text>
                  </View>
                </View>
                {detailMuscles.primary.length > 0 && (
                  <View style={{ alignItems: 'center', marginBottom: 12 }}>
                    <MuscleMap muscles={detailMuscles.primary} secondaryMuscles={detailMuscles.secondary} size={220} />
                  </View>
                )}

                <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
                  <FitPhotoSection userId={userId} date={detailLog.date} theme={theme} accentColor={accentColor} />
                  {(detailLog.exercises ?? []).map((ex, i) => (
                    <View key={ex.exerciseId ?? i} style={[wcs.exBlock, { borderBottomColor: theme.divider }]}>
                      <View style={wcs.exNameRow}>
                        <View style={wcs.exThumbWrap}>
                          {ex.gifUrl ? (
                            <Image source={{ uri: ex.gifUrl }} style={wcs.exThumb} contentFit="cover" autoplay={false} />
                          ) : (
                            <View style={[wcs.exThumb, wcs.exThumbEmpty]}>
                              <Text style={{ fontSize: 18 }}>🏋️</Text>
                            </View>
                          )}
                          {ex.skipped && !(ex.sets ?? []).some(st => st.reps > 0 || st.weight > 0) && (
                            <View style={wcs.exThumbOverlay}>
                              <Text style={wcs.exThumbOverlayText}>–</Text>
                            </View>
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[wcs.exName, { color: theme.text }]}>{ex.name}</Text>
                          {ex.skipped && !(ex.sets ?? []).some(st => st.reps > 0 || st.weight > 0) && <Text style={wcs.skippedLabel}>Skipped</Text>}
                        </View>
                      </View>
                      {(ex.sets ?? []).some(st => st.reps > 0 || st.weight > 0) && (
                        <View style={wcs.setsRow}>
                          {ex.sets.map((st, si) => (
                            <View key={si} style={[wcs.setChip, { backgroundColor: theme.isDark ? '#ffffff08' : '#00000007', borderColor: theme.isDark ? '#ffffff14' : '#0000000d' }]}>
                              <Text style={[wcs.setChipNum, { color: theme.muted }]}>{si + 1}</Text>
                              <Text style={[wcs.setChipVal, { color: theme.text }]}>
                                {st.weight > 0 ? `${st.weight}${unit} × ${st.reps}` : `${st.reps} reps`}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  ))}
                </ScrollView>
              </>
            )}
            <Pressable style={[wcs.closeBtn, { backgroundColor: accentColor }]} onPress={detailDrag.close}>
              <Text style={wcs.closeBtnText}>Close</Text>
            </Pressable>
            {!!detailLog && (
              <Pressable style={wcs.deleteBtn} onPress={confirmDeleteDetail} hitSlop={6}>
                <Text style={wcs.deleteBtnText}>Delete this workout from history</Text>
              </Pressable>
            )}
          </Animated.View>
        </View>
      </Modal>
      <WorkoutHistoryModal
        visible={historyVisible}
        onClose={() => setHistoryVisible(false)}
        userId={userId}
        accentColor={accentColor}
        theme={theme}
        onDeleted={clearWeekDay}
      />
    </View>
  )
}

const wcs = StyleSheet.create({
  card: {
    borderRadius: 16, borderWidth: 1,
    paddingHorizontal: 10, paddingTop: 12, paddingBottom: 8,
    marginBottom: 12,
  },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingHorizontal: 2 },
  header: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  viewAllBtn: { fontSize: 12, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 4 },
  col: {
    flex: 1, height: CELL_H,
    borderRadius: 12, borderWidth: 1.5,
    overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  abbrRow: { flexDirection: 'row', gap: 4, marginBottom: 4 },
  abbrCell: { flex: 1, alignItems: 'center' },
  abbrText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.3 },
  overlayWrap: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  overlayNum: { fontSize: 16, fontWeight: '800' },

  // Detail modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 10, paddingHorizontal: 20, paddingBottom: 36,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 16,
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 18 },
  sheetHeader: { marginBottom: 14 },
  sheetTitle: { fontSize: 20, fontWeight: '800' },
  sheetMeta: { fontSize: 13, marginTop: 3 },

  exBlock: { paddingVertical: 12, borderBottomWidth: 1 },
  exNameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  exNum: {
    minWidth: 28, height: 28, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  exNumText: { fontSize: 12, fontWeight: '800' },
  exName: { fontSize: 15, fontWeight: '700', flex: 1 },
  skipBadge: { backgroundColor: '#f1f5f9', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  skipBadgeText: { fontSize: 9, fontWeight: '800', color: '#94a3b8', letterSpacing: 0.5 },

  exThumbWrap: { width: 44, height: 44, borderRadius: 10, overflow: 'hidden', flexShrink: 0 },
  exThumb: { width: 44, height: 44, backgroundColor: '#f6f7fb' },
  exThumbEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#eef2ff' },
  exThumbOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(148,163,184,0.7)',
    alignItems: 'center', justifyContent: 'center',
  },
  exThumbOverlayText: { color: '#fff', fontWeight: '800', fontSize: 18 },
  skippedLabel: { fontSize: 11, color: '#94a3b8', fontWeight: '600', marginTop: 2 },

  setsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  setChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 8, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  setChipNum: { fontSize: 10, fontWeight: '700' },
  setChipVal: { fontSize: 13, fontWeight: '600' },

  closeBtn: { borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 16 },
  closeBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  deleteBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  deleteBtnText: { color: '#ef4444', fontWeight: '700', fontSize: 14 },
})

// Single-field name prompt. `prompt` is { title, message, placeholder,
// initialValue, onSubmit } or null when closed.
function NamePromptModal({ prompt, theme, color, onClose }) {
  const [value, setValue] = useState('')

  useEffect(() => {
    if (prompt) setValue(prompt.initialValue ?? '')
  }, [prompt])

  function submit() {
    const submitted = value
    const handler = prompt?.onSubmit
    onClose()
    handler?.(submitted)
  }

  return (
    <Modal visible={!!prompt} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.promptOverlay}>
        <Pressable style={s.promptBg} onPress={onClose} />
        <View style={[s.promptCard, { backgroundColor: theme.card }]}>
          <Text style={[s.promptTitle, { color: theme.text }]}>{prompt?.title}</Text>
          {prompt?.message ? (
            <Text style={[s.promptMessage, { color: theme.subtext }]}>{prompt.message}</Text>
          ) : null}
          <TextInput
            style={[s.promptInput, { color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder }]}
            value={value}
            onChangeText={setValue}
            placeholder={prompt?.placeholder}
            placeholderTextColor={theme.muted}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
          />
          <View style={s.promptBtns}>
            <Pressable style={[s.promptCancelBtn, { borderColor: theme.cardBorder }]} onPress={onClose}>
              <Text style={[s.promptCancelText, { color: theme.subtext }]}>Cancel</Text>
            </Pressable>
            <Pressable style={[s.promptSaveBtn, { backgroundColor: color }]} onPress={submit}>
              <Text style={s.promptSaveText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ── Last night's run ───────────────────────────────────────────────────────
// A routine begun late in the evening often ends after midnight, but storage
// reads only today's run, so at 12:00 an unfinished one simply vanished.
// Until LATE_RUN_UNTIL_HOUR the screen also looks for last night's run and
// keeps offering it while it is unfinished. It is saved, and its completion
// recorded, under its own date.
const LATE_RUN_UNTIL_HOUR = 5

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function getLateRun(userId, routineName) {
  const now = new Date()
  if (now.getHours() >= LATE_RUN_UNTIL_HOUR) return null
  const y = new Date(now)
  y.setDate(y.getDate() - 1)
  const date = localDateStr(y)
  try {
    // A save still waiting in the queue (made offline) is newer than the row.
    const queued = await pendingUpsert('routine_runs', { user_id: userId, routine_name: routineName, date })
    let run = queued?.data ?? null
    if (!queued) {
      if ((await pendingDeleteIds('routine_runs')).has(`${routineName}|${date}`)) return null
      const rows = await getRoutineRunsForDate(userId, date)
      run = rows.find(r => r.routine_name === routineName)?.data ?? null
    }
    return run?.date === date && !run.finished && !run.quick && run.steps?.length ? run : null
  } catch {
    return null
  }
}

// Today's run or, failing that, last night's unfinished one.
async function getCurrentRun(userId, routineName) {
  return (await getTodayRun(userId, routineName)) ?? (await getLateRun(userId, routineName))
}

// After tasks are replaced or wiped, the photos they used that nothing points
// at any more — not the new tasks, not the routine's other variant — are
// deleted; left alone they would hold upload slots for good.
async function freeUnusedPhotos(userId, name, isAlt, oldTasks, newTasks) {
  try {
    // Strict: if the other variant can't be read nothing is deleted, since a
    // photo it shares would break. The slot sweep frees real leftovers later.
    const other = await loadRoutineTemplate(userId, isAlt ? name : altRoutineName(name))
    const keep = new Set([...collectPhotoUris(newTasks), ...collectPhotoUris(other)])
    for (const uri of new Set(collectPhotoUris(oldTasks))) {
      if (!keep.has(uri)) deleteStepImage(uri)
    }
  } catch {}
}

export default function RoutineScreen() {
  const { name } = useLocalSearchParams()
  const { user } = useAuth()
  // The id, not the object, is what everything below reads: the session can
  // end while this screen is open, and user.id would then crash the app.
  const userId = user?.id
  const { theme } = useTheme()
  const card = routineTheme(name)
  const isFitness = name === 'Fitness'
  const isMorning = name === 'Morning'
  const isNight   = name === 'Night'

  // Main vs Alternative variant. The alternative is a lighter fallback routine
  // for days the user can't do the main one — same tables, name-suffixed key.
  const [variant, setVariant] = useState('main')
  const isAlt = variant === 'alt'
  const storageName = isAlt ? altRoutineName(name) : name
  // On first open only, land on whichever variant was worked on today.
  const autoPickedVariant = useRef(false)

  const [template, setTemplate] = useState([])
  const [run, setRun] = useState(null)
  // The run on screen, also kept in a ref so every tap builds on the latest
  // copy rather than the one its render captured, and shows at once instead
  // of after its save comes back. Quick taps used to build on the same stale
  // copy and undo each other.
  const runRef = useRef(null)
  // Everything that writes the run goes out strictly one after another, so a
  // slow save can never land after — and undo — a newer one.
  const runWork = useRef(Promise.resolve())
  // Counts changes made on this screen. A read that started before one must
  // not replace it with the older copy it read.
  const runEdits = useRef(0)
  // Done, Finish, Skip and going back move the run to another task. Until
  // that move is saved they wait, so a double tap can't move it twice.
  const [stepBusy, setStepBusy] = useState(false)
  const stepBusyRef = useRef(false)
  // Loads are numbered; one overtaken by a newer load (a quick Main /
  // Alternative switch) or by the screen losing focus is dropped.
  const loadSeq = useRef(0)
  // The variant whose data is on screen. While another one is loading the
  // content stays dimmed and takes no taps, so nothing done to the old data
  // is written under the new variant's name.
  const [loadedName, setLoadedName] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [namePrompt, setNamePrompt] = useState(null)
  const [routineDesc, setRoutineDesc] = useState('')
  const [gymSplit, setGymSplit] = useState(null)
  const [morningSettings, setMorningSettings] = useState({ hideTodo: false, hideWeight: false, hideLooks: false, weightGoal: null, targetWeight: null })
  const [aiModalOpen, setAiModalOpen] = useState(false)
  const [allRoutines, setAllRoutines] = useState([])
  const [previewRoutine, setPreviewRoutine] = useState(null)
  const [previewExercises, setPreviewExercises] = useState([])
  const [loadingPreview, setLoadingPreview] = useState(false)
  const previewPrimaryMuscles = useMemo(() => {
    const set = new Set()
    previewExercises.forEach(ex => {
      ex.muscles?.forEach(m => m?.name && set.add(m.name))
    })
    return [...set]
  }, [previewExercises])

  const previewSecondaryMuscles = useMemo(() => {
    const set = new Set()
    previewExercises.forEach(ex => {
      ex.musclesSecondary?.forEach(m => m?.name && set.add(m.name))
    })
    return [...set]
  }, [previewExercises])
  const [previewExDetail, setPreviewExDetail] = useState(null)
  // Step-by-step vs checklist while a run is underway. Starts from the saved
  // preference; once the user taps the toggle on this visit, that choice wins
  // over any re-read of the preference (screen focus, variant switch).
  const [viewMode, setViewMode] = useState('steps')
  const [defaultRunMode, setDefaultRunMode] = useState('steps')
  const viewModeChosen = useRef(false)
  // Fitness only: the workout features (My Workouts, week calendar, gym split)
  // can be tucked away for people who use the routine without the tracker.
  const [hideWorkouts, setHideWorkouts] = useState(false)

  async function setWorkoutsHidden(hidden) {
    if (!userId) return
    const saved = await saveRoutinePrefs(userId, { hideWorkouts: hidden })
    setHideWorkouts(saved.hideWorkouts)
  }

  function chooseViewMode(mode) {
    viewModeChosen.current = true
    setViewMode(mode)
  }

  async function makeViewModeDefault() {
    if (!userId) return
    const saved = await saveRoutinePrefs(userId, { runMode: viewMode })
    setDefaultRunMode(saved.runMode)
  }

  // Pull-down-to-dismiss for the workout preview sheet: the handle strip and
  // the title header are grab areas; a long pull or a quick flick closes the
  // whole sheet (detail view included), a short one snaps back.
  const previewDragY = useRef(new Animated.Value(0)).current
  const previewBackdrop = useRef(previewDragY.interpolate({
    inputRange: [0, 260], outputRange: [1, 0], extrapolate: 'clamp',
  })).current
  // The offset is reset when the preview opens, not here: on iOS the Modal
  // stays mounted through its own dismiss animation, so resetting now would
  // flash the sheet back onto the screen before it slides away a second time.
  const closePreview = () => {
    Animated.timing(previewDragY, {
      toValue: Dimensions.get('window').height, duration: 180, useNativeDriver: true,
    }).start(() => {
      setPreviewRoutine(null)
      setPreviewExDetail(null)
    })
  }
  const previewHandlePan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (_, g) => { previewDragY.setValue(Math.max(0, g.dy)) },
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_, g) => {
      if (g.dy > 120 || (g.dy > 40 && g.vy > 0.6)) closePreview()
      else Animated.spring(previewDragY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start()
    },
    onPanResponderTerminate: () => {
      Animated.spring(previewDragY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start()
    },
  })).current

  const startBtnScale = useRef(new Animated.Value(1)).current
  const doneAnim      = useRef(new Animated.Value(0)).current
  // Content cross-fade: starts hidden so the first load fades in smoothly,
  // and Main/Alternative tab switches dim + restore instead of blanking.
  const contentFade   = useRef(new Animated.Value(0)).current

  // ── Run writes ───────────────────────────────────────────────────────────

  function showRun(next) {
    runRef.current = next
    setRun(next)
  }

  function queueRunWork(fn) {
    const work = runWork.current.then(fn)
    runWork.current = work.catch(() => {})
    return work
  }

  // Put a new version of the run on screen at once and queue its save. A
  // finished run also records the day, under the run's own date — every
  // finish path comes through here.
  function commitRun(next) {
    runEdits.current++
    showRun(next)
    const uid = userId, routineName = storageName
    return queueRunWork(async () => {
      await saveRun(uid, routineName, next)
      if (next.finished) await recordRunCompletion(uid, routineName, next)
    }).catch(() => {
      Alert.alert('Couldn’t save', 'Your last change may not have been saved. Check your connection and try again.')
    })
  }

  // Apply `change` to the latest run. It returns the new run, or the same one
  // when there is nothing to do.
  function updateRun(change) {
    const cur = runRef.current
    const next = cur && userId ? change(cur) : null
    return next && next !== cur ? commitRun(next) : Promise.resolve()
  }

  // A change that moves the run to another task. Refused while the last such
  // move is still saving; returns whether it went ahead. The hold ends when
  // the save lands, or after a moment at most: a request that hangs (no
  // signal) must not freeze the routine, and the queue keeps the writes in
  // order anyway — the hold only has to outlast a double tap.
  function moveRun(change) {
    if (stepBusyRef.current) return false
    const hold = {}
    stepBusyRef.current = hold
    setStepBusy(true)
    const release = () => {
      if (stepBusyRef.current !== hold) return
      stepBusyRef.current = null
      setStepBusy(false)
    }
    updateRun(change).finally(release)
    setTimeout(release, 1500)
    return true
  }

  // Read the run back after storage changed it (saving a template folds the
  // change into a run underway). Queued behind every write, so it sees them.
  // Not shown if a tap changed the run meanwhile, or if the screen has moved
  // on to other data since `seq`.
  async function refreshRun(uid, routineName, seq) {
    const edits = runEdits.current
    const fresh = await queueRunWork(() => getCurrentRun(uid, routineName))
    if (runEdits.current === edits && seq === loadSeq.current) showRun(fresh)
  }

  const load = useCallback(async () => {
    if (!userId || !name) return
    const seq = ++loadSeq.current
    const superseded = () => seq !== loadSeq.current
    // Set when this pass hands off to a re-run under the other variant: the
    // loading state has to stay up so the old variant never flashes in between.
    let handedOff = false
    setError(false)
    try {
      // First open only: if today's progress lives on the alternative (and not
      // the main), land on the Alternative tab so the user sees where they left off.
      if (!autoPickedVariant.current) {
        autoPickedVariant.current = true
        const [mainRun, altRun] = await Promise.all([
          getCurrentRun(userId, name),
          getCurrentRun(userId, altRoutineName(name)),
        ])
        if (superseded()) return
        // Already there (a retry on the Alternative tab): nothing would
        // re-trigger the load, so carry on with this one.
        if (!mainRun && altRun && !isAlt) {
          setVariant('alt')
          handedOff = true
          return // variant change re-triggers load with the alt storage name
        }
      }
      const edits = runEdits.current
      const promises = [
        getRoutineTemplate(userId, storageName),
        queueRunWork(() => getCurrentRun(userId, storageName)),
        isFitness ? getGymSplit(userId) : Promise.resolve(null),
        getRoutineSettings(userId, name),
      ]
      let [tmpl, todayRun, split, rSettings] = await Promise.all(promises)
      if (superseded()) return
      setRoutineDesc(rSettings?.description ?? '')
      if (isMorning && !isAlt) {
        tmpl = await queueRunWork(() => syncIntegratedTasks(userId, name, tmpl))
        // Re-read: syncing Looks tasks in also folds them into a run that is
        // already underway, which the copy read above predates.
        todayRun = await queueRunWork(() => getCurrentRun(userId, storageName))
        if (superseded()) return
      }
      setTemplate(tmpl)
      // A tap made while this was reading is newer than what it read.
      if (runEdits.current === edits) showRun(todayRun)
      setLoadedName(storageName)
      if (isFitness) {
        setGymSplit(split ?? null)
        const routines = await getWorkoutRoutineList(userId)
        if (superseded()) return
        setAllRoutines(routines)
      }
      if (isMorning) {
        const ms = await getMorningSettings(userId)
        if (superseded()) return
        setMorningSettings(ms)
      }
      Animated.timing(contentFade, { toValue: 1, duration: 160, useNativeDriver: true }).start()
    } catch {
      if (!superseded()) setError(true)
    } finally {
      if (!handedOff && !superseded()) setLoading(false)
    }
  }, [userId, name, storageName, isAlt, isFitness, isMorning])

  function retryLoad() {
    autoPickedVariant.current = false
    setError(false)
    setLoading(true)
    load()
  }

  // Losing focus drops a load still in flight; coming back starts a new one.
  useFocusEffect(useCallback(() => {
    load()
    return () => { loadSeq.current++ }
  }, [load]))

  // The preferred run mode can change under us in Settings, so re-read it on
  // every focus — but never override a mode the user picked on this visit.
  useFocusEffect(useCallback(() => {
    if (!userId) return
    let cancelled = false
    getRoutinePrefs(userId).then(p => {
      if (cancelled) return
      setDefaultRunMode(p.runMode)
      setHideWorkouts(p.hideWorkouts)
      if (!viewModeChosen.current) setViewMode(p.runMode)
    })
    return () => { cancelled = true }
  }, [userId]))

  function switchVariant(v) {
    if (v === variant) return
    // Dim the current content while the other variant loads; load() fades it
    // back in once the new data is set. Header and tabs stay in place.
    Animated.timing(contentFade, { toValue: 0.25, duration: 120, useNativeDriver: true }).start()
    setVariant(v)
  }

  useEffect(() => {
    if (run?.finished) {
      doneAnim.setValue(0)
      Animated.spring(doneAnim, { toValue: 1, useNativeDriver: true, speed: 10, bounciness: 8 }).start()
    }
  }, [run?.finished])

  // A finished routine writes itself onto the time log. This watches `finished`
  // rather than hooking each finish path (timer, checklist, quick-check) so
  // every one of them is covered; autoLogSpan's marker makes re-entry a no-op,
  // so re-opening a done routine can't resurrect a block you deleted.
  useEffect(() => {
    if (!userId || !loadedName || !run?.finished) return
    // Quick-checked runs have no timer, so the tick time is the whole span.
    const startedAt = run.startedAt ?? run.completedAt
    const completedAt = run.completedAt ?? startedAt
    if (!startedAt) return
    const d = new Date(startedAt)
    // The block goes on the day the routine really began. A start moved back
    // to before midnight belongs to the evening before the run's own date.
    autoLogSpan(userId, `routine:${loadedName}:${run.date}`, {
      day: localDateStr(d),
      startMins: d.getHours() * 60 + d.getMinutes(),
      durationMins: Math.round(Math.max(0, completedAt - startedAt) / 60000),
      text: `${name} routine`,
      kind: 'routine',
    }).catch(() => {})
  }, [userId, run?.finished, run?.date, run?.startedAt, run?.completedAt, loadedName, name])

  function startBtnPressIn() {
    Animated.spring(startBtnScale, { toValue: 0.96, useNativeDriver: true, speed: 40, bounciness: 4 }).start()
  }
  function startBtnPressOut() {
    Animated.spring(startBtnScale, { toValue: 1, useNativeDriver: true, speed: 15, bounciness: 12 }).start()
  }

  // Starting the timer keeps any tasks already ticked off without it and
  // begins at the first one still open. It used to wipe them — even on a
  // routine that was already all ticked.
  const startingRef = useRef(false)
  async function handleStart() {
    if (!userId || startingRef.current) return
    startingRef.current = true
    try {
      // A tick still being saved is part of what carries over.
      await queueRunWork(() => {})
      const cur = runRef.current
      if (cur && !cur.quick) return
      commitRun(timedRunFrom(template, cur, Date.now(), today()))
    } finally {
      startingRef.current = false
    }
  }

  // Tick a task off without starting the timer — records the check timestamp.
  // Queued with the run's other writes, so Start can't overtake a tick.
  function handlePreviewToggle(taskId) {
    if (!userId) return
    const uid = userId, routineName = storageName, tasks = template
    const edits = runEdits.current, seq = loadSeq.current
    queueRunWork(async () => {
      const updated = await quickCheckToggle(uid, routineName, tasks, taskId)
      if (runEdits.current === edits && seq === loadSeq.current) showRun(updated)
    }).catch(e => {
      // storage refuses the toggle when the run can't be read from anywhere
      // (cloud unreachable, no local mirror) — building on a guess would let
      // a blank run replay over real progress. Tell the user rather than
      // letting the tap silently do nothing.
      Alert.alert('Couldn’t update', e.message)
    })
  }

  // Done moves on to the next task still open. Tasks already done are never
  // walked through again or re-stamped.
  function handleStepDone(elapsedMs) {
    moveRun(r => advanceRunStep(r, Date.now(), elapsedMs))
  }

  function handleFinish(elapsedMs) {
    if (!moveRun(r => (r.finished ? r : finishRun(r, Date.now(), elapsedMs)))) return
    // After the first completed routine, ask for a review once (ever).
    setTimeout(() => { maybePromptReview() }, 1200)
  }

  // Skip the current task: it goes on today's do-later list and the routine
  // moves on. Reaching the end this way still leaves the routine short of
  // fully complete until the list is cleared.
  function handleSkipStep(elapsedMs) {
    moveRun(r => skipRunStep(r, r.currentStep, Date.now(), elapsedMs))
  }

  // Tick a do-later item (or untick it). The history row and streak follow.
  function handleLaterToggle(id) {
    updateRun(r => toggleLaterItem(r, id, Date.now()))
  }

  // Reopening a step also clears its skip mark and pulls it off the do-later
  // list, since the user is doing it now. The time it already has is kept.
  function handleGoBack() {
    moveRun(r => (r.currentStep > 0 ? reopenRunStep(r, r.currentStep - 1, Date.now()) : r))
  }

  // Jump back to an arbitrary earlier task (used by the "unfinished steps"
  // prompt on Finish). Same reopening as handleGoBack; the task already in
  // hand is left as it is, timer and all.
  function handleJumpTo(idx) {
    moveRun(r => (idx >= 0 && idx < r.steps.length && idx !== r.currentStep ? reopenRunStep(r, idx, Date.now()) : r))
  }

  // The user says the current task really began at a different time — reset
  // its timer to match, and let the routine's own start follow so total time
  // and the auto time-log stay truthful.
  function handleAdjustStart(newStartedAt) {
    updateRun(r => runWithAdjustedStart(r, newStartedAt, Date.now()))
  }

  function handleToggleSubTask(subTaskId) {
    updateRun(r => ({
      ...r,
      steps: r.steps.map((step, i) =>
        i === r.currentStep
          ? { ...step, subTasks: step.subTasks.map(st => st.id === subTaskId ? { ...st, done: !st.done } : st) }
          : step
      ),
    }))
  }

  // Photo the user tapped to see full screen, or null when nothing is open.
  const [photoViewer, setPhotoViewer] = useState(null)

  // Checklist mode: which tasks are expanded to show their sub-steps
  const [clExpanded, setClExpanded] = useState({})

  function handleChecklistSubToggle(stepIdx, subTaskId) {
    updateRun(r => ({
      ...r,
      steps: r.steps.map((step, i) =>
        i === stepIdx
          ? { ...step, subTasks: step.subTasks.map(st => st.id === subTaskId ? { ...st, done: !st.done } : st) }
          : step
      ),
    }))
  }

  function handleChecklistToggle(stepIdx) {
    updateRun(r => {
      const step = r.steps[stepIdx]
      if (!step) return r
      const now = Date.now()
      const nowDone = !step.completedAt
      const updatedSteps = r.steps.map((s, i) =>
        i !== stepIdx ? s : nowDone
          // Timed from the task ticked before it, not from the routine's start.
          ? { ...s, completedAt: now, elapsedMs: checklistTaskMs(r, now) }
          : { ...s, completedAt: null, elapsedMs: 0, startedAt: null, skipped: false }
      )
      const allDone = updatedSteps.every(s => !!s.completedAt)
      const firstUndone = updatedSteps.findIndex(s => !s.completedAt)
      // Unticking a skipped step means doing it now: its do-later entry goes.
      const base = nowDone ? r : withoutPendingLater(r, step.id)
      return {
        ...base,
        steps: updatedSteps,
        currentStep: allDone ? r.steps.length - 1 : Math.max(firstUndone, 0),
        ...(allDone ? { finished: true, completedAt: now } : {}),
      }
    })
  }

  // Checklist mode's skip: the row is handled, the task waits on the list.
  function handleChecklistSkip(stepIdx) {
    updateRun(r => {
      const now = Date.now()
      return skipRunStep(r, stepIdx, now, checklistTaskMs(r, now))
    })
  }

  // Every task is handled but the run isn't finished — an edit took away the
  // last open ones. Checklist mode has no Done button, so this is its Finish.
  function handleChecklistFinish() {
    if (!moveRun(r => (r.finished ? r : finishRun(r, Date.now())))) return
    setTimeout(() => { maybePromptReview() }, 1200)
  }

  function confirmReset() {
    // Last night's run is kept under its own date, which today's reset can't reach.
    const cur = runRef.current
    const lateDate = cur?.date && cur.date !== today() ? cur.date : null
    Alert.alert(
      lateDate ? 'Reset last night?' : 'Reset today?',
      lateDate
        ? 'This clears last night’s progress on this routine so you can start over.'
        : 'This clears your progress for today so you can start over.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset', style: 'destructive',
          onPress: async () => {
            if (!userId) return
            const uid = userId, routineName = storageName
            // Queued behind any save still going out, which would otherwise
            // land after the reset and bring the run back.
            await queueRunWork(async () => {
              if (!lateDate) return resetTodayRun(uid, routineName)
              await trySync('routine_runs', 'delete', null, { user_id: uid, routine_name: routineName, date: lateDate })
              await trySync('history', 'delete', null, { user_id: uid, date: lateDate, routine_name: name })
            })
            runEdits.current++
            showRun(null)
          },
        },
      ]
    )
  }

  async function applyAITasks(tasks) {
    if (!userId) return
    const uid = userId, routineName = storageName, seq = loadSeq.current
    const previous = template
    await queueRunWork(() => saveRoutineTemplate(uid, routineName, tasks))
    if (seq === loadSeq.current) setTemplate(tasks)
    // Saving folds the new tasks into a run that's underway; pull the result
    // back so the steps on screen match what was just saved.
    await refreshRun(uid, routineName, seq)
    // The replaced tasks' photos would otherwise keep their upload slots.
    freeUnusedPhotos(uid, name, isAlt, previous, tasks)
  }

  // Clear the alternative back to its empty state. Past completed days stay.
  function confirmWipeAlt() {
    Alert.alert(
      'Delete alternative?',
      `This removes your alternative ${name} routine and its progress today. Days you completed in the past are kept. You can rebuild it anytime.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            if (!userId) return
            const uid = userId, seq = loadSeq.current
            const previous = template
            await queueRunWork(() => wipeAltRoutine(uid, name))
            // Its photos go too, unless the main routine uses the same ones.
            freeUnusedPhotos(uid, name, true, previous, [])
            if (seq !== loadSeq.current) return
            setTemplate([])
            runEdits.current++
            showRun(null)
          },
        },
      ]
    )
  }

  // Seed the alternative from the current main routine. Photos and the Looks
  // link stay with the main routine, as when copying a single task: a photo
  // shared by both broke one of them as soon as the other deleted it.
  async function copyMainToAlt() {
    if (!userId) return
    const uid = userId, seq = loadSeq.current
    // Strict: offline with no copy on this device the lenient read returns
    // the stock tasks, which would be copied in place of the real routine.
    let mainTmpl
    try {
      mainTmpl = await loadRoutineTemplate(uid, name)
    } catch (e) {
      Alert.alert('Could not copy', e.message)
      return
    }
    if (mainTmpl.length === 0) {
      Alert.alert('Main routine is empty', 'Add tasks to your main routine first, or build the alternative from scratch.')
      return
    }
    const copy = mainTmpl.map(({ image, fromLooks, ...task }) => ({
      ...task,
      subTasks: (task.subTasks ?? []).map(({ image: stepImage, ...st }) => st),
    }))
    await queueRunWork(() => saveRoutineTemplate(uid, altRoutineName(name), copy))
    if (seq === loadSeq.current) setTemplate(copy)
  }

  // Mirror the Looks card into the Morning template (or pull it back out).
  // Saving the template folds the change into a run underway, so the run on
  // screen is read back too and the Looks tasks appear (or go) at once.
  const looksIntegrated = template.some(t => t.fromLooks)
  async function toggleLooksIntegration(looksData) {
    if (!userId) return
    const uid = userId, routineName = storageName, seq = loadSeq.current
    const apply = async (enabled, mode) => {
      const next = await queueRunWork(() => setLooksInRoutine(uid, enabled, mode))
      if (seq !== loadSeq.current) return
      setTemplate(next)
      await refreshRun(uid, routineName, seq)
    }
    if (looksIntegrated) {
      await apply(false)
      return
    }
    if (!looksData.categories.some(c => c.steps.length > 0)) {
      Alert.alert('Nothing to add yet', 'Add some steps to your Looks routine first.')
      return
    }
    Alert.alert(
      'Add Looks to Morning tasks',
      'How should your Looks routine show up?',
      [
        { text: 'One task with all steps', onPress: () => apply(true, 'single') },
        { text: 'A task per category', onPress: () => apply(true, 'multi') },
        { text: 'Cancel', style: 'cancel' },
      ]
    )
  }

  function createNewRoutine() {
    setNamePrompt({
      title: 'New Workout',
      message: 'Name your workout (e.g. Push Day, Full Body)',
      placeholder: 'Push Day',
      initialValue: '',
      onSubmit: routineName => {
        const trimmed = routineName?.trim()
        if (!trimmed) return
        router.push('/workout-library?muscleGroup=' + encodeURIComponent(trimmed))
      },
    })
  }

  // Open another workout before this one's exercises arrive and only the
  // latest may fill the sheet — otherwise A's list could show under B.
  const previewSeq = useRef(0)
  async function openRoutinePreview(routine) {
    const seq = ++previewSeq.current
    setPreviewExDetail(null)
    previewDragY.setValue(0)
    setPreviewRoutine(routine)
    setPreviewExercises([])
    setLoadingPreview(true)
    const exercises = await getWorkoutPlan(userId, routine.name)
    if (seq !== previewSeq.current) return
    setPreviewExercises(exercises)
    setLoadingPreview(false)
  }

  function confirmDeleteRoutine(routineName) {
    Alert.alert(
      'Delete Workout',
      `Remove "${routineName}" and all its exercises?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            await deleteWorkoutPlan(userId, routineName)
            setAllRoutines(prev => prev.filter(r => r.name !== routineName))
          },
        },
      ]
    )
  }

  function promptRenameRoutine(oldName) {
    setNamePrompt({
      title: 'Rename Workout',
      message: `New name for "${oldName}"`,
      placeholder: oldName,
      initialValue: oldName,
      onSubmit: async newName => {
        const clean = newName?.trim()
        if (!clean || clean === oldName) return
        try {
          await renameWorkoutPlan(userId, oldName, clean)
          setAllRoutines(prev => prev.map(r => r.name === oldName ? { ...r, name: clean } : r))
        } catch (e) {
          Alert.alert('Rename failed', e.message)
        }
      },
    })
  }

  function openWorkoutMenu(routineName) {
    Alert.alert(routineName, undefined, [
      { text: 'Rename', onPress: () => promptRenameRoutine(routineName) },
      { text: 'Delete', style: 'destructive', onPress: () => confirmDeleteRoutine(routineName) },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  function renderModeToggle() {
    const modeLabel = viewMode === 'checklist' ? 'checklist' : 'step-by-step'
    return (
      <View style={s.modeToggleBlock}>
        <View style={[s.modeToggleWrap, { backgroundColor: theme.isDark ? '#1a1a2e' : '#f1f5f9', borderColor: theme.cardBorder }]}>
          <Pressable
            style={[s.modeBtn, viewMode === 'steps' && { backgroundColor: card.color }]}
            onPress={() => chooseViewMode('steps')}
          >
            <Text style={[s.modeBtnText, { color: viewMode === 'steps' ? '#fff' : theme.subtext }]}>
              Step-by-step
            </Text>
          </Pressable>
          <Pressable
            style={[s.modeBtn, viewMode === 'checklist' && { backgroundColor: card.color }]}
            onPress={() => chooseViewMode('checklist')}
          >
            <Text style={[s.modeBtnText, { color: viewMode === 'checklist' ? '#fff' : theme.subtext }]}>
              Checklist
            </Text>
          </Pressable>
        </View>
        {/* One tap to keep this mode for every routine from now on. Also
            switchable under Settings → App Preferences. */}
        {viewMode !== defaultRunMode && (
          <Pressable onPress={makeViewModeDefault} hitSlop={8} style={s.modeDefaultBtn}>
            <Text style={[s.modeDefaultText, { color: card.color }]}>Make {modeLabel} my default</Text>
          </Pressable>
        )}
      </View>
    )
  }

  // Signed out (or the session ended) while this screen was open.
  if (!userId) return <Redirect href="/(auth)/login" />

  if (error) {
    return (
      <View style={[s.page, s.errorWrap, { backgroundColor: theme.bg }]}>
        <Text style={[s.errorTitle, { color: theme.text }]}>Something went wrong loading this routine.</Text>
        <Text style={[s.errorSub, { color: theme.subtext }]}>Check your connection and try again.</Text>
        <Pressable style={[s.errorBtn, { backgroundColor: card.color }]} onPress={retryLoad}>
          <Text style={s.errorBtnText}>Retry</Text>
        </Pressable>
      </View>
    )
  }

  // Blank themed background while loading, so the page never flashes stale
  // content before the first fade-in.
  if (loading) {
    return <View style={[s.page, { backgroundColor: theme.bg }]} />
  }

  const todayIdx = todaySplitIndex()
  const todayMuscle = gymSplit?.days?.[todayIdx] ?? 'Rest'
  const todayMuscles = normalizeDay(todayMuscle)

  const editHref = '/setup-routine?name=' + encodeURIComponent(name) + (isAlt ? '&variant=alt' : '')
  const altIsEmpty = isAlt && template.length === 0

  // Muscle-focus banner (or split setup card). Rendered below the hero banner
  // in the preview, and at the top while a run is in progress or finished.
  const fitnessSplitBanner = isFitness && !isAlt && !hideWorkouts && (gymSplit ? (
    <View style={[s.splitBanner, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <View style={{ flex: 1 }}>
        <Text style={[s.splitDay, { color: theme.subtext }]}>{DAY_LABELS[todayIdx]} · Muscle Focus</Text>
        <View style={s.splitPillsRow}>
          {normalizeDay(todayMuscle).map(m => (
            <View key={m} style={[s.splitPill, { backgroundColor: muscleColor(m) }]}>
              <Text style={[s.splitPillText, { color: muscleTextColor(m) }]}>{m}</Text>
            </View>
          ))}
        </View>
      </View>
      <Pressable style={s.splitEditBtn} onPress={() => router.push('/fitness-split')}>
        <Text style={[s.splitEditText, { color: card.color }]}>Edit Split →</Text>
      </Pressable>
    </View>
  ) : (
    <Pressable
      style={[s.splitSetupCard, { backgroundColor: theme.card, borderColor: theme.isDark ? '#1a5c3a' : '#a7f3d0' }]}
      onPress={() => router.push('/fitness-split')}
    >
      <Text style={s.splitSetupEmoji}>🏋️</Text>
      <View style={{ flex: 1 }}>
        <Text style={[s.splitSetupTitle, { color: theme.text }]}>Set Up Your Gym Split</Text>
        <Text style={[s.splitSetupSub, { color: theme.subtext }]}>Choose PPL, Arnold, Upper/Lower and more.</Text>
      </View>
      <Text style={[s.splitSetupArrow, { color: card.color }]}>→</Text>
    </Pressable>
  ))

  // Quick-check progress shown in the preview (tasks ticked without starting).
  const quickDoneCount = run?.steps?.filter(st => st.completedAt).length ?? 0
  const quickPct = template.length ? Math.round((quickDoneCount / template.length) * 100) : 0

  // The preview lists the template, but whether a task is done lives on the
  // run. Line them up in routine order so picture unlocking can read straight
  // down the list; before the routine is started every entry is undefined,
  // which correctly leaves everything past the first task locked.
  const previewSteps = template.map(t => run?.steps?.find(st => st.id === t.id))

  // Last night's run, still being finished after midnight.
  const isLateRun = !!run?.date && run.date !== today()
  // The summary tells apart tasks never done from ones done or put off.
  const fullyDone = runFullyDone(run)
  const notDoneCount = run?.steps?.filter(st => !st.completedAt).length ?? 0
  // Every task handled on a run that isn't finished yet (an edit removed the
  // last open ones).
  const allHandled = !!run && !run.finished && run.steps.length > 0 && notDoneCount === 0
  // The other variant is still loading: what's on screen belongs to the one
  // just left.
  const staleVariant = loadedName !== storageName

  return (
    <View style={[s.page, { backgroundColor: theme.bg }]}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: theme.headerBorder, backgroundColor: theme.header }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
          <Text style={[s.backText, { color: theme.text }]}>←</Text>
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerEmoji}>{card.emoji}</Text>
          <Text style={[s.headerTitle, { color: theme.text }]}>{name}</Text>
        </View>
        <View style={s.headerRight}>
          <Pressable onPress={() => setAiModalOpen(true)} hitSlop={8} style={s.aiHeaderBtn}>
            <Text style={[s.aiHeaderText, { color: card.color }]}>✦ AI</Text>
          </Pressable>
          <Pressable onPress={() => router.push(editHref)} style={s.editHeaderBtn}>
            <Text style={[s.editHeaderText, { color: card.color }]}>Edit</Text>
          </Pressable>
        </View>
      </View>

      {/* ── Main / Alternative tabs ── */}
      <View style={[s.variantTabs, { backgroundColor: theme.header, borderBottomColor: theme.headerBorder }]}>
        {[['main', 'Main'], ['alt', 'Alternative']].map(([key, label]) => {
          const active = variant === key
          return (
            <Pressable
              key={key}
              style={[s.variantTab, active && { borderBottomColor: card.color }]}
              onPress={() => switchVariant(key)}
            >
              <Text style={[s.variantTabText, { color: active ? card.color : theme.subtext }]}>
                {label}
              </Text>
            </Pressable>
          )
        })}
      </View>

      <Animated.View style={{ flex: 1, opacity: contentFade }} pointerEvents={staleVariant ? 'none' : 'auto'}>
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {/* ── Fitness: Split banner (top only while running/done — the preview
             places it below the hero banner instead) ── */}
        {run && !run.quick && fitnessSplitBanner}

        {/* ── Done ── */}
        {run?.finished && !run.quick && (
          <Animated.View style={{
            opacity: doneAnim,
            transform: [{ scale: doneAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
          }}>
            <View style={[s.doneHeader, {
              backgroundColor: theme.isDark ? theme.card : card.bg,
              borderColor: theme.isDark ? theme.cardBorder : card.border,
            }]}>
              <Text style={s.doneEmoji}>{fullyDone ? '🎉' : '⏭'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.doneTitle, { color: fullyDone ? card.color : '#f59e0b' }]}>
                  {fullyDone ? 'All done!' : 'Almost there'}
                </Text>
                <Text style={[s.doneSub, { color: theme.subtext }]}>
                  Total time: {fmtMs(run.completedAt - run.startedAt)}
                  {pendingLater(run) > 0 ? `  ·  ${pendingLater(run)} to do later` : ''}
                  {notDoneCount > 0 ? `  ·  ${notDoneCount} not done` : ''}
                </Text>
              </View>
            </View>
            {run.steps.map(step => {
              // A task never done gets no tick and no time, so it can't pass
              // for one that was done in "0s".
              const notDone = !step.completedAt
              return (
                <View key={step.id} style={[s.doneStep, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
                  <View style={[s.doneCheck, { backgroundColor: notDone ? theme.divider : step.skipped ? '#f59e0b' : card.color }]}>
                    <Text style={[s.doneCheckMark, notDone && { color: theme.muted }]}>
                      {notDone ? '–' : step.skipped ? '→' : '✓'}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.doneStepText, { color: notDone ? theme.muted : theme.text }]}>{step.text}</Text>
                    {step.subTasks?.filter(st => st.done).map(st => (
                      <Text key={st.id} style={[s.doneSubText, { color: theme.muted }]}>· {st.text}</Text>
                    ))}
                  </View>
                  <Text style={[s.doneTime, { color: step.skipped ? '#f59e0b' : notDone ? theme.muted : theme.subtext }]}>
                    {notDone ? 'not done' : step.skipped ? 'later' : fmtMs(step.elapsedMs)}
                  </Text>
                </View>
              )
            })}
            {/* Skipped steps wait here. Tick one whenever it gets done; the
                time it was ticked stays beside it, and the routine only
                counts as complete once the list is clear. */}
            {laterItems(run).length > 0 && (
              <View style={[s.laterCard, {
                backgroundColor: theme.card,
                borderColor: pendingLater(run) > 0 ? '#f59e0b66' : theme.cardBorder,
              }]}>
                <Text style={[s.laterTitle, { color: pendingLater(run) > 0 ? '#f59e0b' : theme.muted }]}>
                  DO LATER  ·  {laterItems(run).length - pendingLater(run)} / {laterItems(run).length} DONE
                </Text>
                {laterItems(run).map(item => (
                  <Pressable key={item.id} style={s.laterRow} onPress={() => handleLaterToggle(item.id)}>
                    <View style={[s.laterCheck, { borderColor: item.doneAt ? card.color : '#d1d5db' }, item.doneAt && { backgroundColor: card.color }]}>
                      {item.doneAt && <Text style={s.clCheckMark}>✓</Text>}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.laterText, { color: theme.text }, item.doneAt && { textDecorationLine: 'line-through', opacity: 0.55 }]}>
                        {item.text}
                      </Text>
                      <Text style={[s.laterMeta, { color: item.doneAt ? card.color : theme.muted }]}>
                        {item.doneAt
                          ? `Done at ${clockLabel(item.doneAt)}`
                          : `Skipped at ${clockLabel(item.skippedAt)}  ·  tap when done`}
                      </Text>
                    </View>
                  </Pressable>
                ))}
                <Text style={[s.laterHint, { color: theme.muted }]}>
                  {pendingLater(run) > 0
                    ? 'The routine counts as complete once these are ticked off.'
                    : 'Everything on the list is done.'}
                </Text>
              </View>
            )}
            <Pressable
              style={[s.editTmrBtn, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}
              onPress={() => router.push(editHref)}
            >
              <Text style={[s.editTmrText, { color: card.color }]}>Edit Tomorrow's Routine</Text>
            </Pressable>
            <Pressable style={s.resetBtn} onPress={confirmReset}>
              <Text style={s.resetText}>{isLateRun ? 'Reset last night' : 'Reset today'}</Text>
            </Pressable>
          </Animated.View>
        )}

        {/* ── Running ── */}
        {run && !run.finished && !run.quick && (
          <>
            {isLateRun && (
              <Text style={[s.workoutRunHint, { color: theme.subtext }]}>
                Still going from last night — it counts for yesterday when you finish.
              </Text>
            )}
            {renderModeToggle()}
            {viewMode === 'steps' ? (
              <RunRoutine
                run={run}
                color={card.color}
                busy={stepBusy}
                onStepDone={handleStepDone}
                onFinish={handleFinish}
                onGoBack={handleGoBack}
                onToggleSubTask={handleToggleSubTask}
                onJumpTo={handleJumpTo}
                onAdjustStart={handleAdjustStart}
                onSkip={handleSkipStep}
              />
            ) : (
              <View>
                <ChecklistTimer
                  startedAt={run.startedAt}
                  doneCount={run.steps.filter(st => st.completedAt).length}
                  totalCount={run.steps.length}
                  goalSecs={run.steps.reduce((sum, st) => sum + taskGoalSecs(st), 0)}
                  color={card.color}
                  theme={theme}
                />
                {run.steps.map((step, i) => {
                  const done = !!step.completedAt
                  return (
                    <Pressable
                      key={step.id}
                      style={[s.clItem, {
                        backgroundColor: theme.card,
                        borderColor: done ? (step.skipped ? '#f59e0b' : card.color) : theme.cardBorder,
                        shadowColor: done ? card.color : '#000',
                      }]}
                      onPress={() => handleChecklistToggle(i)}
                    >
                      <View style={[s.clCheck, { borderColor: done ? (step.skipped ? '#f59e0b' : card.color) : '#d1d5db' }, done && { backgroundColor: step.skipped ? '#f59e0b' : card.color }]}>
                        {done && <Text style={s.clCheckMark}>{step.skipped ? '→' : '✓'}</Text>}
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={s.clItemTitleRow}>
                          <Text style={[s.clItemText, { color: theme.text, flexShrink: 1 }, done && s.clItemDone]}>
                            {step.text}
                          </Text>
                          {done && step.skipped && <Text style={s.clLaterTag}>LATER</Text>}
                          {/* Skip: the row is handled for today's flow and the
                              task waits on the do-later list at the end. */}
                          {!done && (
                            <Pressable onPress={() => handleChecklistSkip(i)} hitSlop={8} style={s.clLaterBtn}>
                              <Text style={[s.clLaterBtnText, { color: theme.muted }]}>Later →</Text>
                            </Pressable>
                          )}
                        </View>
                        {step.subTasks?.length > 0 && (
                          <Pressable
                            onPress={() => setClExpanded(m => ({ ...m, [step.id]: !m[step.id] }))}
                            hitSlop={8}
                          >
                            <Text style={[s.clSubCount, { color: card.color }]}>
                              {step.subTasks.filter(st => st.done).length} / {step.subTasks.length} sub-steps  {clExpanded[step.id] ? '▾' : '▸'}
                            </Text>
                          </Pressable>
                        )}
                        {/* The picture waits until everything above it is ticked off.
                            It sits inside the row that checks the task off, so it
                            swallows its own taps — looking at the reference photo
                            should not complete the task. */}
                        {!!step.image && (
                          stepImageUnlocked(run.steps, i) ? (
                            <Pressable onPress={() => setPhotoViewer(step.image)}>
                              <Image
                                source={{ uri: step.image }}
                                style={[s.stepImage, { backgroundColor: theme.divider }]}
                                contentFit="cover"
                                transition={220}
                              />
                            </Pressable>
                          ) : (
                            <Text style={[s.stepImageLocked, { color: theme.muted }]}>
                              🔒 Photo unlocks when the steps above are checked
                            </Text>
                          )
                        )}
                        {clExpanded[step.id] && step.subTasks?.map((st, j) => (
                          <View key={st.id}>
                            <Pressable
                              style={s.clSubRow}
                              onPress={() => handleChecklistSubToggle(i, st.id)}
                              hitSlop={4}
                            >
                              <View style={[s.clSubCheck, { borderColor: st.done ? card.color : theme.cardBorder }, st.done && { backgroundColor: card.color }]}>
                                {st.done && <Text style={s.clSubMark}>✓</Text>}
                              </View>
                              <Text style={[s.clSubText, { color: st.done ? theme.muted : theme.text }, st.done && { textDecorationLine: 'line-through' }]}>
                                {st.text}
                              </Text>
                            </Pressable>
                            {/* This step's photo waits for the steps above it,
                                and for the task itself to be reachable. */}
                            {!!st.image && (
                              stepImageUnlocked(run.steps, i) && subStepImageUnlocked(step.subTasks, j) ? (
                                <Pressable onPress={() => setPhotoViewer(st.image)}>
                                  <Image
                                    source={{ uri: st.image }}
                                    style={[s.subStepImage, { backgroundColor: theme.divider }]}
                                    contentFit="cover"
                                    transition={220}
                                  />
                                </Pressable>
                              ) : (
                                <Text style={[s.stepImageLocked, { color: theme.muted }]}>
                                  🔒 Photo unlocks when the steps above are checked
                                </Text>
                              )
                            )}
                          </View>
                        ))}
                      </View>
                    </Pressable>
                  )
                })}
                {/* Every task handled but not finished — an edit took away
                    the last open ones. There's no Done button here, so
                    finishing (and stopping the timer) happens here. */}
                {allHandled && (
                  <Pressable
                    style={[s.clFinishBtn, stepBusy && { opacity: 0.6 }]}
                    onPress={handleChecklistFinish}
                    disabled={stepBusy}
                  >
                    <Text style={s.clFinishText}>Finish Routine  ✓</Text>
                  </Pressable>
                )}
              </View>
            )}
            <Pressable style={[s.resetBtn, { marginTop: 16 }]} onPress={confirmReset}>
              <Text style={s.resetText}>{isLateRun ? 'Reset last night' : 'Reset today'}</Text>
            </Pressable>
          </>
        )}

        {/* ── Preview (not started; also shown while quick-checking) ── */}
        {(!run || run.quick) && (
          <>
            {/* Hero banner */}
            <View style={[s.previewBanner, { backgroundColor: card.color, marginHorizontal: -16, marginTop: -16 }]}>
              {/* Floating emoji badge */}
              <View style={s.previewBannerBadge}>
                <Text style={s.previewBannerBadgeEmoji}>{card.emoji}</Text>
              </View>
              {/* Left-aligned title + count */}
              <View style={s.previewBannerLeft}>
                <Text style={s.previewBannerTitle}>Today's{'\n'}{isAlt ? 'Alt ' : ''}{name}</Text>
                <View style={s.previewBannerCountRow}>
                  <View style={s.previewBannerCountCheck}>
                    <Text style={s.previewBannerCountCheckMark}>✓</Text>
                  </View>
                  <Text style={s.previewBannerCountText}>
                    {template.length} task{template.length !== 1 ? 's' : ''}
                    {template.some(t => taskGoalSecs(t) > 0)
                      ? `  ·  ${fmtGoalSecs(template.reduce((sum, t) => sum + taskGoalSecs(t), 0))} goal`
                      : ''}
                  </Text>
                </View>
              </View>
              {/* Motivational quote pill */}
              <View style={s.previewBannerQuotePill}>
                <Text style={{ fontSize: 13 }}>✨</Text>
                <Text style={s.previewBannerQuoteText}>{routineDesc || routineQuote(name)}</Text>
              </View>
            </View>

            {/* Fitness: muscle focus, right under the title banner */}
            {fitnessSplitBanner}

            {/* Tips */}
            {(isMorning || isNight) && (
              <View style={s.tipsBannerWrap}>
                <Text style={[s.tipsBannerLabel, { color: theme.muted }]}>
                  {isMorning ? 'MORNING TIPS' : 'NIGHT TIPS'}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tipsBannerScroll}>
                  {(isMorning ? MORNING_TIPS : NIGHT_TIPS).map((tip, i) => (
                    <View key={i} style={[s.tipCard, { backgroundColor: card.color + '12', borderColor: card.color + '35' }]}>
                      <Text style={s.tipCardEmoji}>{tip.emoji}</Text>
                      <Text style={[s.tipCardText, { color: theme.text }]}>{tip.text}</Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Phone Downtime (morning/night, iOS only) */}
            {(isMorning || isNight) && Platform.OS === 'ios' && (
              <DowntimeCard theme={theme} color={card.color} routineName={name} />
            )}

            {/* Progress bar */}
            {!altIsEmpty && (
              <View style={[s.progressCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text style={[s.progressLabel, { color: theme.subtext }]}>{quickPct}% complete</Text>
                  <Text style={[s.progressCount, { color: theme.subtext }]}>{quickDoneCount} / {template.length}</Text>
                </View>
                <View style={[s.progressTrack, { backgroundColor: theme.isDark ? '#ffffff18' : '#e5e7eb' }]}>
                  <View style={[s.progressFill, { width: `${quickPct}%`, backgroundColor: card.color }]} />
                </View>
              </View>
            )}

            {/* Alternative not set up yet */}
            {altIsEmpty && (
              <View style={[s.altEmptyCard, { backgroundColor: theme.card, borderColor: card.color + '35' }]}>
                <Text style={s.altEmptyEmoji}>🔀</Text>
                <Text style={[s.altEmptyTitle, { color: theme.text }]}>No alternative yet</Text>
                <Text style={[s.altEmptySub, { color: theme.subtext }]}>
                  Build a lighter version of your {name} routine for days you're short on time or energy.
                </Text>
                <View style={s.altEmptyBtnRow}>
                  <Pressable
                    style={[s.altEmptyBtn, { borderColor: card.color }]}
                    onPress={copyMainToAlt}
                  >
                    <Text style={[s.altEmptyBtnText, { color: card.color }]}>Copy main routine</Text>
                  </Pressable>
                  <Pressable
                    style={[s.altEmptyBtn, s.altEmptyBtnFill, { backgroundColor: card.color }]}
                    onPress={() => router.push(editHref)}
                  >
                    <Text style={[s.altEmptyBtnText, { color: '#fff' }]}>Build from scratch</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </>
        )}

        {/* ── Fitness: My Workouts section. Rendered in every state, so a
            workout can be started while the routine is running: the run is
            saved as it goes and picks up again when the workout screen is
            left. ── */}
        {isFitness && !isAlt && !hideWorkouts && (
          <View style={[s.workoutSection, { borderTopColor: theme.divider }]}>
            <View style={s.workoutHeader}>
              <Text style={[s.workoutTitle, { color: theme.text }]}>💪 My Workouts</Text>
              <View style={s.workoutHeaderActions}>
                <Pressable onPress={() => setWorkoutsHidden(true)} hitSlop={8}>
                  <Text style={[s.workoutHideLink, { color: theme.muted }]}>Hide</Text>
                </Pressable>
                <Pressable onPress={createNewRoutine} hitSlop={8}>
                  <Text style={[s.workoutEditLink, { color: card.color }]}>+ New</Text>
                </Pressable>
              </View>
            </View>

            {(!run || run.quick) ? (
              <WorkoutWeekCalendar userId={userId} theme={theme} accentColor={card.color} />
            ) : !run.finished ? (
              <Text style={[s.workoutRunHint, { color: theme.subtext }]}>
                Your routine keeps running while you train. Start a workout here and come back to it after.
              </Text>
            ) : null}

            {allRoutines.length === 0 ? (
              <Pressable style={[s.workoutEmptyCard, { backgroundColor: theme.card, borderColor: theme.isDark ? '#28284a' : '#c7d2fe' }]} onPress={createNewRoutine}>
                <Text style={[s.workoutEmptyTitle, { color: card.color }]}>Create your first workout</Text>
                <Text style={[s.workoutEmptySub, { color: theme.subtext }]}>Tap + New to name a workout and add exercises.</Text>
              </Pressable>
            ) : (
              allRoutines.map(routine => (
                <Pressable
                  key={routine.name}
                  style={[s.routineCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
                  onPress={() => openRoutinePreview(routine)}
                  onLongPress={() => openWorkoutMenu(routine.name)}
                  delayLongPress={600}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[s.routineCardName, { color: theme.text }]}>{routine.name}</Text>
                    {routine.muscles?.length > 0 && (
                      <View style={s.routineMuscleTags}>
                        {routine.muscles.map(m => (
                          <View key={m} style={[s.routineMuscleTag, { backgroundColor: muscleColor(m) }]}>
                            <Text style={[s.routineMuscleTagText, { color: muscleTextColor(m) }]}>{m}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    <Text style={[s.routineCardCount, { color: theme.subtext }]}>
                      {routine.count > 0 ? `${routine.count} exercise${routine.count !== 1 ? 's' : ''}` : 'No exercises yet'}
                    </Text>
                  </View>
                  <View style={s.routineCardActions}>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <Pressable
                        style={[s.routineMenuBtn, { borderColor: theme.cardBorder }]}
                        onPress={() => openWorkoutMenu(routine.name)}
                        hitSlop={6}
                      >
                        <Text style={[s.routineMenuText, { color: theme.subtext }]}>⋯</Text>
                      </Pressable>
                      <Pressable
                        style={[s.routineEditBtn, { borderColor: theme.cardBorder }]}
                        onPress={() => router.push('/workout-library?muscleGroup=' + encodeURIComponent(routine.name))}
                      >
                        <Text style={[s.routineEditText, { color: card.color }]}>Edit</Text>
                      </Pressable>
                    </View>
                    {routine.count > 0 && (
                      <Pressable
                        style={[s.routineStartBtn, { backgroundColor: card.color }]}
                        onPress={() => router.push('/workout-run?muscleGroup=' + encodeURIComponent(routine.name))}
                      >
                        <Text style={s.routineStartText}>Start →</Text>
                      </Pressable>
                    )}
                  </View>
                </Pressable>
              ))
            )}

            {/* Workout preview modal — list + exercise detail in one modal */}
            <Modal
              visible={!!previewRoutine}
              transparent
              animationType="slide"
              onRequestClose={() => { if (previewExDetail) setPreviewExDetail(null); else setPreviewRoutine(null) }}
            >
              <View style={s.previewOverlay}>
                <Animated.View pointerEvents="none" style={[s.previewBg, { opacity: previewBackdrop }]} />
                <Pressable style={StyleSheet.absoluteFill} onPress={() => { if (previewExDetail) setPreviewExDetail(null); else closePreview() }} />
                <Animated.View style={[s.previewSheet, { backgroundColor: theme.card, transform: [{ translateY: previewDragY }] }]}>
                  <View {...previewHandlePan.panHandlers} style={s.previewGrabArea}>
                    <View style={[s.previewHandle, { backgroundColor: theme.divider }]} />
                  </View>

                  {/* ── Exercise detail view ── */}
                  {previewExDetail ? (
                    <>
                      <Pressable style={s.exDetailBack} onPress={() => setPreviewExDetail(null)}>
                        <Text style={[s.exDetailBackText, { color: card.color }]}>← Back</Text>
                      </Pressable>
                      <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 560 }}>
                        <Text style={[s.exDetailName, { color: theme.text }]}>{previewExDetail.name}</Text>
                        {!!previewExDetail.category && (
                          <Text style={[s.exDetailMeta, { color: theme.subtext }]}>
                            {previewExDetail.category}{previewExDetail.equipment ? `  ·  ${previewExDetail.equipment}` : ''}
                          </Text>
                        )}
                        {(previewExDetail.muscles?.length > 0 || previewExDetail.musclesSecondary?.length > 0) && (
                          <View style={s.exDetailMuscleRow}>
                            {previewExDetail.muscles?.map(m => (
                              <View key={m.name ?? m} style={s.exDetailMuscleTag}>
                                <Text style={s.exDetailMuscleText}>{m.name ?? m}</Text>
                              </View>
                            ))}
                            {previewExDetail.musclesSecondary?.map(m => (
                              <View key={m.name ?? m} style={s.exDetailMuscleTagSec}>
                                <Text style={s.exDetailMuscleTextSec}>{m.name ?? m}</Text>
                              </View>
                            ))}
                          </View>
                        )}
                        {previewExDetail.gifUrl ? (
                          <Image source={{ uri: previewExDetail.gifUrl }} style={s.exDetailGif} contentFit="contain" autoplay />
                        ) : previewExDetail.videoId ? (
                          <ExerciseVideo videoId={previewExDetail.videoId} style={{ marginBottom: 16 }} />
                        ) : (
                          <View style={s.exDetailNoGif}>
                            <Text style={{ fontSize: 48 }}>🏋️</Text>
                            <Text style={[s.exDetailNoGifText, { color: theme.muted }]}>No preview available</Text>
                          </View>
                        )}
                        {previewExDetail.instructions?.length > 0 && (
                          <View style={s.exDetailInstructions}>
                            <Text style={[s.exDetailInstructionsLabel, { color: theme.subtext }]}>HOW TO</Text>
                            {previewExDetail.instructions.map((step, i) => (
                              <View key={i} style={s.exDetailStep}>
                                <View style={[s.exDetailStepNum, { backgroundColor: card.color }]}>
                                  <Text style={s.exDetailStepNumText}>{i + 1}</Text>
                                </View>
                                <Text style={[s.exDetailStepText, { color: theme.text }]}>{step}</Text>
                              </View>
                            ))}
                          </View>
                        )}
                        <View style={{ height: 16 }} />
                      </ScrollView>
                    </>
                  ) : (
                  /* ── Exercise list view ── */
                    <>
                      {previewRoutine && (
                        <>
                          <View {...previewHandlePan.panHandlers} style={s.previewSheetHeader}>
                            <View style={{ flex: 1 }}>
                              <Text style={[s.previewSheetTitle, { color: theme.text }]}>{previewRoutine.name}</Text>
                              <Text style={[s.previewSheetMeta, { color: theme.subtext }]}>
                                {previewRoutine.count > 0 ? `${previewRoutine.count} exercise${previewRoutine.count !== 1 ? 's' : ''}` : 'No exercises yet'}
                              </Text>
                            </View>
                            {previewRoutine.muscles?.length > 0 && (
                              <View style={s.previewMuscleTags}>
                                {previewRoutine.muscles.map(m => (
                                  <View key={m} style={[s.routineMuscleTag, { backgroundColor: muscleColor(m) }]}>
                                    <Text style={[s.routineMuscleTagText, { color: muscleTextColor(m) }]}>{m}</Text>
                                  </View>
                                ))}
                              </View>
                            )}
                          </View>
                          <View style={s.previewBody}>
                            <MuscleMap muscles={previewPrimaryMuscles} secondaryMuscles={previewSecondaryMuscles} size={310} />
                            <ScrollView showsVerticalScrollIndicator={false} style={s.previewExList}>
                              {loadingPreview ? (
                                <View style={s.previewLoading}>
                                  <Text style={[s.previewLoadingText, { color: theme.muted }]}>Loading…</Text>
                                </View>
                              ) : previewExercises.length === 0 ? (
                                <View style={s.previewLoading}>
                                  <Text style={[s.previewLoadingText, { color: theme.muted }]}>No exercises added yet.</Text>
                                </View>
                              ) : (
                                previewExercises.map((ex, i) => (
                                  <Pressable key={ex.id ?? i} style={[s.previewExRow, { borderBottomColor: theme.divider }]} onPress={() => setPreviewExDetail(ex)}>
                                    {ex.gifUrl ? (
                                      <Image source={{ uri: ex.gifUrl }} style={s.previewExThumb} contentFit="cover" autoplay={false} />
                                    ) : (
                                      <View style={[s.previewExThumb, s.previewExThumbPlaceholder, { backgroundColor: card.color + '18' }]}>
                                        <Text style={s.previewExThumbEmoji}>🏋️</Text>
                                      </View>
                                    )}
                                    <View style={{ flex: 1, minWidth: 0 }}>
                                      <Text style={[s.previewExName, { color: theme.text }]} numberOfLines={1}>{ex.name}</Text>
                                      <Text style={[s.previewExMeta, { color: theme.subtext }]} numberOfLines={1}>
                                        {ex.sets ?? 3}×{ex.reps ?? 10}{ex.category ? `  ·  ${ex.category}` : ''}
                                      </Text>
                                    </View>
                                    <Text style={[s.previewExChevron, { color: theme.muted }]}>›</Text>
                                  </Pressable>
                                ))
                              )}
                            </ScrollView>
                          </View>
                        </>
                      )}
                      <View style={s.previewBtnRow}>
                        <Pressable
                          style={[s.previewEditBtn, { borderColor: card.color }]}
                          onPress={() => { setPreviewRoutine(null); router.push('/workout-library?muscleGroup=' + encodeURIComponent(previewRoutine.name)) }}
                        >
                          <Text style={[s.previewEditBtnText, { color: card.color }]}>Edit</Text>
                        </Pressable>
                        {previewRoutine?.count > 0 && (
                          <Pressable
                            style={[s.previewStartBtn, { backgroundColor: card.color }]}
                            onPress={() => { setPreviewRoutine(null); router.push('/workout-run?muscleGroup=' + encodeURIComponent(previewRoutine.name)) }}
                          >
                            <Text style={s.previewStartBtnText}>Start Workout  →</Text>
                          </Pressable>
                        )}
                      </View>
                    </>
                  )}
                </Animated.View>
              </View>
            </Modal>
          </View>
        )}

        {/* Fitness: workouts tucked away — one tap brings them back */}
        {isFitness && !isAlt && hideWorkouts && (
          <View style={s.hiddenPillsRow}>
            <Pressable
              style={[s.hiddenPill, { borderColor: card.color + '40', backgroundColor: card.color + '10' }]}
              onPress={() => setWorkoutsHidden(false)}
            >
              <Text style={[s.hiddenPillText, { color: card.color }]}>+ Show workouts</Text>
            </Pressable>
          </View>
        )}

        {(!run || run.quick) && (
          <>
            {/* Section label */}
            {!altIsEmpty && (
              <View style={s.previewSectionRow}>
                <Text style={{ fontSize: 16 }}>📋</Text>
                <Text style={[s.previewSectionLabel, { color: theme.subtext }]}>
                  {isAlt ? 'ALTERNATIVE TASKS' : 'YOUR TASKS'}
                </Text>
              </View>
            )}

            {template.map((task, i) => (
              <View key={task.id} style={[s.previewTask, {
                backgroundColor: theme.card,
                borderColor: theme.isDark ? theme.cardBorder : card.color + '28',
                shadowColor: card.color,
              }]}>
                <View style={[s.previewNum, { backgroundColor: card.color }]}>
                  <Text style={s.previewNumText}>{i + 1}</Text>
                </View>
                <View style={[s.previewTaskIcon, { backgroundColor: card.color + '18' }]}>
                  <Text style={{ fontSize: 20 }}>{task.emoji || taskIcon(task.text)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.previewTaskText, { color: theme.text }]}>{task.text}</Text>
                  {(task.subTasks?.length > 0 || taskGoalSecs(task) > 0) && (
                    <View style={s.previewTaskMeta}>
                      {task.subTasks?.length > 0 && (
                        <Text style={[s.previewSub, { color: card.color }]}>{task.subTasks.length} steps</Text>
                      )}
                      {taskGoalSecs(task) > 0 && (
                        <View style={[s.previewGoalChip, { backgroundColor: card.color + '18' }]}>
                          <Text style={[s.previewGoalText, { color: card.color }]}>⏱ {fmtGoalSecs(taskGoalSecs(task))}</Text>
                        </View>
                      )}
                    </View>
                  )}
                  {/* The picture waits until everything above it is ticked off */}
                  {!!task.image && (
                    stepImageUnlocked(previewSteps, i) ? (
                      <Pressable onPress={() => setPhotoViewer(task.image)}>
                        <Image
                          source={{ uri: task.image }}
                          style={[s.stepImage, { backgroundColor: theme.divider }]}
                          contentFit="cover"
                          transition={220}
                        />
                      </Pressable>
                    ) : (
                      <Text style={[s.stepImageLocked, { color: theme.muted }]}>
                        🔒 Photo unlocks when the steps above are checked
                      </Text>
                    )
                  )}
                </View>
                {(() => {
                  const step = run?.steps?.find(st => st.id === task.id)
                  const done = !!step?.completedAt
                  return (
                    <Pressable
                      onPress={() => handlePreviewToggle(task.id)}
                      hitSlop={10}
                      style={[s.previewTaskCheck, {
                        borderColor: done ? card.color : (theme.isDark ? '#ffffff28' : '#d1d5db'),
                        alignItems: 'center', justifyContent: 'center',
                      }, done && { backgroundColor: card.color }]}
                    >
                      {done && <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>✓</Text>}
                    </Pressable>
                  )
                })()}
              </View>
            ))}

            {/* Nothing left to start once every task is ticked off. */}
            {template.length > 0 && !(run?.quick && run.finished) && (
              <Animated.View style={{ transform: [{ scale: startBtnScale }] }}>
                <Pressable
                  style={[s.startBtn, { backgroundColor: card.color, shadowColor: card.color }]}
                  onPressIn={startBtnPressIn}
                  onPressOut={startBtnPressOut}
                  onPress={handleStart}
                >
                  <Text style={s.startBtnSparkle}>✦</Text>
                  <Text style={s.startBtnText}>{card.emoji}  Start {isAlt ? 'Alt ' : ''}{name} Routine  →</Text>
                  <Text style={s.startBtnSparkle}>✦</Text>
                </Pressable>
              </Animated.View>
            )}

            {/* Alternative: wipe it back to empty */}
            {isAlt && template.length > 0 && (
              <Pressable style={s.resetBtn} onPress={confirmWipeAlt}>
                <Text style={s.resetText}>Delete alternative routine</Text>
              </Pressable>
            )}
          </>
        )}

        {/* ── Morning: Goals + Weight + Looks (main routine only) ── */}
        {isMorning && !isAlt && (
          <>
            {!morningSettings.hideTodo && (
              <MorningTodoList
                userId={userId}
                theme={theme}
                color={card.color}
                onHide={async () => {
                  const ns = { ...morningSettings, hideTodo: true }
                  await saveMorningSettings(userId, ns)
                  setMorningSettings(ns)
                }}
              />
            )}
            {!morningSettings.hideWeight && (
              <WeightTracker
                userId={userId}
                theme={theme}
                color={card.color}
                morningSettings={morningSettings}
                onUpdateSettings={setMorningSettings}
              />
            )}
            {!morningSettings.hideLooks && (
              <LooksSection
                userId={userId}
                theme={theme}
                integrated={looksIntegrated}
                onToggleIntegrate={toggleLooksIntegration}
                onHide={async () => {
                  const ns = { ...morningSettings, hideLooks: true }
                  await saveMorningSettings(userId, ns)
                  setMorningSettings(ns)
                }}
              />
            )}
            {(morningSettings.hideTodo || morningSettings.hideWeight || morningSettings.hideLooks) && (
              <View style={s.hiddenPillsRow}>
                {morningSettings.hideTodo && (
                  <Pressable
                    style={[s.hiddenPill, { borderColor: card.color + '40', backgroundColor: card.color + '10' }]}
                    onPress={async () => {
                      const ns = { ...morningSettings, hideTodo: false }
                      await saveMorningSettings(userId, ns)
                      setMorningSettings(ns)
                    }}
                  >
                    <Text style={[s.hiddenPillText, { color: card.color }]}>+ Show goals</Text>
                  </Pressable>
                )}
                {morningSettings.hideWeight && (
                  <Pressable
                    style={[s.hiddenPill, { borderColor: card.color + '40', backgroundColor: card.color + '10' }]}
                    onPress={async () => {
                      const ns = { ...morningSettings, hideWeight: false }
                      await saveMorningSettings(userId, ns)
                      setMorningSettings(ns)
                    }}
                  >
                    <Text style={[s.hiddenPillText, { color: card.color }]}>+ Show weight tracker</Text>
                  </Pressable>
                )}
                {morningSettings.hideLooks && (
                  <Pressable
                    style={[s.hiddenPill, { borderColor: LOOKS_COLOR + '40', backgroundColor: LOOKS_COLOR + '10' }]}
                    onPress={async () => {
                      const ns = { ...morningSettings, hideLooks: false }
                      await saveMorningSettings(userId, ns)
                      setMorningSettings(ns)
                    }}
                  >
                    <Text style={[s.hiddenPillText, { color: LOOKS_COLOR }]}>+ Show looks</Text>
                  </Pressable>
                )}
              </View>
            )}
          </>
        )}

        {/* ── Night: sleep tracker (main routine only) ── */}
        {isNight && !isAlt && (
          <SleepTracker userId={userId} theme={theme} color={card.color} />
        )}

      </ScrollView>
      </Animated.View>

      <AIRoutineModal
        visible={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        routineName={name}
        existingTasks={template}
        onApplyTasks={applyAITasks}
        theme={theme}
        color={card.color}
      />

      <NamePromptModal
        prompt={namePrompt}
        theme={theme}
        color={card.color}
        onClose={() => setNamePrompt(null)}
      />

      <ImageViewerModal uri={photoViewer} onClose={() => setPhotoViewer(null)} />
    </View>
  )
}

// ── Workout history calendar styles ───────────────────────────────────────
const hcs = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  doneBtn: { fontSize: 15, fontWeight: '700' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8 },

  month: { marginBottom: 28 },
  monthTitle: { fontSize: 16, fontWeight: '800', marginBottom: 10, letterSpacing: -0.2 },
  weekRow: { flexDirection: 'row', marginBottom: 3 },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 2, paddingHorizontal: 1 },
  dayLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3, paddingVertical: 6 },
  monthCell: {
    width: CELL_W, height: CELL_W,
    borderRadius: 10, borderWidth: 1.5,
    overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  monthOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  monthDayNum: { fontSize: 13, fontWeight: '500' },

  detailOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.48)',
  },
  detailSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 10, paddingHorizontal: 20, paddingBottom: 40,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 16,
  },
})

// ── Morning todo styles ────────────────────────────────────────────────────
const ts = StyleSheet.create({
  section: {
    marginTop: 20, borderRadius: 20, overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8,
  },
  title: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  count: { fontSize: 13, fontWeight: '600' },
  hideLink: { fontSize: 13, fontWeight: '600' },
  item: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, gap: 12,
  },
  check: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: '#8b5cf6',
    alignItems: 'center', justifyContent: 'center',
  },
  checkDone: { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' },
  checkMark: { color: '#fff', fontWeight: '800', fontSize: 11 },
  itemText: { flex: 1, fontSize: 15, fontWeight: '500' },
  itemDone: { textDecorationLine: 'line-through', opacity: 0.45 },
  del: { padding: 4 },
  delText: { fontSize: 13, fontWeight: '600' },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, gap: 8,
  },
  input: {
    flex: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, borderWidth: 1.5,
  },
  addBtn: {
    width: 38, height: 38, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  addBtnText: { color: '#fff', fontWeight: '800', fontSize: 20, lineHeight: 22 },
})

// ── Routine screen styles ──────────────────────────────────────────────────
const s = StyleSheet.create({
  page: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    paddingTop: 84, paddingBottom: 16,
    borderBottomWidth: 1,
  },
  backBtn: { padding: 4 },
  backText: { fontSize: 26, lineHeight: 30 },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  headerEmoji: { fontSize: 22 },
  headerTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  aiHeaderBtn: { padding: 4 },
  aiHeaderText: { fontSize: 13, fontWeight: '700' },
  editHeaderBtn: { padding: 4 },
  editHeaderText: { fontSize: 15, fontWeight: '600' },

  variantTabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  variantTab: {
    flex: 1, alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2.5, borderBottomColor: 'transparent',
  },
  variantTabText: { fontSize: 14, fontWeight: '700', letterSpacing: -0.1 },

  altEmptyCard: {
    borderRadius: 20, borderWidth: 1.5,
    padding: 24, alignItems: 'center',
    marginTop: 4,
  },
  altEmptyEmoji: { fontSize: 40, marginBottom: 10 },
  altEmptyTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, marginBottom: 6 },
  altEmptySub: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 18 },
  altEmptyBtnRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  altEmptyBtn: {
    flex: 1, borderRadius: 14, borderWidth: 1.5,
    paddingVertical: 12, alignItems: 'center',
  },
  altEmptyBtnFill: { borderWidth: 0 },
  altEmptyBtnText: { fontSize: 13, fontWeight: '700' },

  content: { padding: 16, paddingBottom: 64 },

  tipsBannerWrap: { marginBottom: 16 },
  tipsBannerLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8 },
  tipsBannerScroll: { gap: 8, paddingRight: 4 },
  tipCard: { width: 148, borderRadius: 14, padding: 12, borderWidth: 1, flexShrink: 0 },
  tipCardEmoji: { fontSize: 22, marginBottom: 6 },
  tipCardText: { fontSize: 12, fontWeight: '500', lineHeight: 17 },

  splitBanner: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 16, padding: 14,
    marginBottom: 14, borderWidth: 1,
  },
  splitDay: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 6 },
  splitPillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  splitPill: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  splitPillText: { fontSize: 13, fontWeight: '700' },
  splitEditBtn: { paddingHorizontal: 4 },
  splitEditText: { fontSize: 13, fontWeight: '700' },
  splitSetupCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 16, padding: 14,
    marginBottom: 14, borderWidth: 1.5,
  },
  splitSetupEmoji: { fontSize: 26 },
  splitSetupTitle: { fontSize: 14, fontWeight: '700' },
  splitSetupSub: { fontSize: 12, marginTop: 2 },
  splitSetupArrow: { fontSize: 18, fontWeight: '700' },

  doneHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 16, padding: 16, marginBottom: 14, borderWidth: 1,
  },
  doneEmoji: { fontSize: 32 },
  doneTitle: { fontSize: 20, fontWeight: '800' },
  doneSub: { fontSize: 13, marginTop: 2 },
  doneStep: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    borderRadius: 14, padding: 14,
    marginBottom: 8, borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  doneCheck: {
    width: 28, height: 28, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  doneCheckMark: { color: '#fff', fontWeight: '700', fontSize: 13 },
  doneStepText: { fontSize: 15, fontWeight: '500' },
  doneSubText: { fontSize: 12, marginTop: 3 },
  doneTime: { fontSize: 13, fontWeight: '500' },
  // Do-later list on the summary
  laterCard: { borderRadius: 16, borderWidth: 1.5, padding: 14, marginTop: 6, marginBottom: 8 },
  laterTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginBottom: 4 },
  laterRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  laterCheck: { width: 26, height: 26, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  laterText: { fontSize: 15, fontWeight: '600' },
  laterMeta: { fontSize: 12, marginTop: 2, fontWeight: '500' },
  laterHint: { fontSize: 12, marginTop: 6 },
  // Checklist rows: skip affordance and the skipped tag
  clItemTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  clLaterTag: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6, color: '#f59e0b' },
  clLaterBtn: { paddingVertical: 4, paddingHorizontal: 6, marginLeft: 'auto' },
  clLaterBtnText: { fontSize: 12, fontWeight: '700' },
  editTmrBtn: {
    borderRadius: 14, padding: 14, alignItems: 'center',
    borderWidth: 1.5, marginTop: 8,
  },
  editTmrText: { fontWeight: '700', fontSize: 15 },
  resetBtn: { alignItems: 'center', padding: 10 },
  resetText: { color: '#ef4444', fontSize: 13 },

  previewHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 },
  previewTitle: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  previewCount: { fontSize: 13, fontWeight: '500' },

  previewBanner: {
    paddingTop: 36, paddingBottom: 24, paddingHorizontal: 20,
    marginBottom: 14,
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2, shadowRadius: 16, elevation: 8,
  },
  previewBannerBadge: {
    position: 'absolute', top: 20, right: 20,
    width: 70, height: 70, borderRadius: 35,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 10, elevation: 8,
  },
  previewBannerBadgeEmoji: { fontSize: 36 },
  previewBannerLeft: { paddingRight: 86, marginBottom: 16 },
  previewBannerTitle: {
    fontSize: 32, fontWeight: '900', color: '#fff',
    letterSpacing: -1, lineHeight: 36, marginBottom: 12,
  },
  previewBannerCountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  previewBannerCountCheck: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  previewBannerCountCheckMark: { fontSize: 11, fontWeight: '800', color: '#fff' },
  previewBannerCountText: { fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  previewBannerQuotePill: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  previewBannerQuoteText: {
    flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.85)',
    fontWeight: '500', lineHeight: 18,
  },
  progressCard: {
    borderRadius: 14, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 12,
    marginBottom: 14,
  },
  progressLabel: { fontSize: 12, fontWeight: '600' },
  progressCount: { fontSize: 12, fontWeight: '700' },
  progressTrack: { borderRadius: 6, height: 8, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 6 },
  previewSectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, marginTop: 2 },
  previewSectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },

  previewTask: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 18, paddingVertical: 10, paddingHorizontal: 12,
    marginBottom: 10, borderWidth: 1.5,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1, shadowRadius: 10, elevation: 4,
  },
  previewAccent: { width: 4, alignSelf: 'stretch' },
  previewNum: {
    width: 36, height: 36, borderRadius: 18, marginRight: 10,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  previewNumText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  previewTaskIcon: {
    width: 44, height: 44, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12, flexShrink: 0,
  },
  previewTaskCheck: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2,
    marginLeft: 8, flexShrink: 0,
  },
  previewTaskText: { fontSize: 16, fontWeight: '700' },
  previewTaskMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  previewSub: { fontSize: 13, fontWeight: '600', opacity: 0.75 },
  previewGoalChip: {
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  previewGoalText: { fontSize: 12, fontWeight: '700' },
  startBtn: {
    borderRadius: 20, paddingVertical: 18, paddingHorizontal: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, marginTop: 16,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.40, shadowRadius: 16, elevation: 8,
  },
  startBtnText: { color: '#fff', fontWeight: '800', fontSize: 17 },
  startBtnSparkle: { color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: '800' },

  workoutSection: {
    marginTop: 20, borderTopWidth: 1, paddingTop: 16,
  },
  workoutHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  workoutTitle: { fontSize: 17, fontWeight: '700' },
  workoutRunHint: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginBottom: 12 },
  workoutEditLink: { fontSize: 13, fontWeight: '600' },
  workoutHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  workoutHideLink: { fontSize: 13, fontWeight: '600' },
  workoutEmptyCard: {
    borderRadius: 14, padding: 16,
    borderWidth: 1.5, borderStyle: 'dashed',
  },
  workoutEmptyTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  workoutEmptySub: { fontSize: 13 },

  routineCard: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 14, padding: 14,
    marginBottom: 8, borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  routineCardName: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  routineCardCount: { fontSize: 12, fontWeight: '500' },
  routineCardActions: { gap: 6, alignItems: 'flex-end' },
  routineMenuBtn: {
    paddingHorizontal: 9, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, justifyContent: 'center',
  },
  routineMenuText: { fontSize: 12, fontWeight: '900', lineHeight: 14 },
  routineEditBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1,
  },
  routineEditText: { fontSize: 12, fontWeight: '700' },
  routineStartBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  routineStartText: { fontSize: 12, fontWeight: '700', color: '#fff' },

  routineMuscleTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4, marginBottom: 4 },
  routineMuscleTag: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  routineMuscleTagText: { fontSize: 10, fontWeight: '700' },

  previewOverlay: { flex: 1, justifyContent: 'flex-end' },
  previewBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  previewSheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 10, paddingHorizontal: 20, paddingBottom: 36,
    maxHeight: '90%',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 16,
  },
  // Full-width strip around the handle so it is a real grab target.
  previewGrabArea: { marginHorizontal: -20, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 14 },
  previewHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center' },
  previewSheetHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14, gap: 10 },
  previewSheetTitle: { fontSize: 20, fontWeight: '800' },
  previewSheetMeta: { fontSize: 13, marginTop: 3 },
  previewMuscleTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingTop: 4 },
  previewBody: { flexDirection: 'column', gap: 10 },
  previewExList: { maxHeight: 260 },
  previewLoading: { paddingVertical: 24, alignItems: 'center' },
  previewLoadingText: { fontSize: 14 },
  previewExRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, borderBottomWidth: 1,
  },
  previewExThumb: { width: 48, height: 48, borderRadius: 10, flexShrink: 0 },
  previewExThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  previewExThumbEmoji: { fontSize: 22 },
  previewExName: { fontSize: 15, fontWeight: '600' },
  previewExMeta: { fontSize: 12, marginTop: 2 },
  previewBtnRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  previewEditBtn: {
    flex: 1, borderRadius: 14, paddingVertical: 13,
    alignItems: 'center', borderWidth: 1.5,
  },
  previewEditBtnText: { fontWeight: '700', fontSize: 15 },
  previewStartBtn: { flex: 2, borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  previewStartBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  previewExChevron: { fontSize: 20, fontWeight: '300', paddingLeft: 4 },

  exDetailBack: { paddingVertical: 6, paddingBottom: 12 },
  exDetailBackText: { fontSize: 14, fontWeight: '700' },
  exDetailName: { fontSize: 20, fontWeight: '800', marginBottom: 4 },
  exDetailMeta: { fontSize: 13, marginBottom: 10 },
  exDetailMuscleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  exDetailMuscleTag: { backgroundColor: '#f0fdf4', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  exDetailMuscleText: { fontSize: 12, fontWeight: '600', color: '#065f46' },
  exDetailMuscleTagSec: { backgroundColor: '#fefce8', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  exDetailMuscleTextSec: { fontSize: 12, fontWeight: '600', color: '#854d0e' },
  exDetailGif: { width: '100%', aspectRatio: 1, borderRadius: 16, backgroundColor: '#f0f0f0', marginBottom: 16 },
  exDetailNoGif: { height: 120, alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 },
  exDetailNoGifText: { fontSize: 13 },
  exDetailInstructions: { gap: 10, marginBottom: 4 },
  exDetailInstructionsLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 2 },
  exDetailStep: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  exDetailStepNum: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  exDetailStepNumText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  exDetailStepText: { flex: 1, fontSize: 13, lineHeight: 19 },

  hiddenPillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  hiddenPill: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1,
  },
  hiddenPillText: { fontSize: 13, fontWeight: '600' },

  modeToggleWrap: {
    flexDirection: 'row', borderRadius: 14, padding: 4,
    borderWidth: 1,
  },
  modeBtn: {
    flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center',
  },
  modeBtnText: { fontSize: 13, fontWeight: '700' },
  modeToggleBlock: { marginBottom: 16 },
  modeDefaultBtn: { alignSelf: 'center', marginTop: 6, paddingVertical: 4, paddingHorizontal: 8 },
  modeDefaultText: { fontSize: 12, fontWeight: '700' },

  // Checklist mode: running total at the top of the list
  clTimerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 16, borderWidth: 1.5, padding: 14, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  clTimerLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  clTimerBig: { fontSize: 34, fontWeight: '300', marginTop: 2, fontVariant: ['tabular-nums'] },
  clTimerSub: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  clTimerCountPill: {
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 12, paddingVertical: 8, paddingHorizontal: 14, minWidth: 68,
  },
  clTimerCountText: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  clTimerCountSub: { fontSize: 11, fontWeight: '600', marginTop: 1 },

  clItem: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 18, padding: 16, marginBottom: 10, borderWidth: 1.5,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
  },
  clCheck: {
    width: 28, height: 28, borderRadius: 9, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 14, flexShrink: 0,
  },
  clCheckMark: { color: '#fff', fontWeight: '800', fontSize: 13 },
  clFinishBtn: { backgroundColor: '#10b981', borderRadius: 22, padding: 18, alignItems: 'center', marginTop: 6 },
  clFinishText: { color: '#fff', fontWeight: '800', fontSize: 17, letterSpacing: 0.3 },
  clItemText: { fontSize: 17, fontWeight: '600' },
  clItemDone: { textDecorationLine: 'line-through', opacity: 0.38 },
  stepImage: { width: '100%', height: 150, borderRadius: 14, marginTop: 10 },
  subStepImage: { width: '100%', height: 130, borderRadius: 12, marginTop: 2, marginBottom: 8 },
  stepImageLocked: { fontSize: 12, fontWeight: '600', marginTop: 6, opacity: 0.8 },
  clSubCount: { fontSize: 12, fontWeight: '600', marginTop: 3 },
  clSubRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, paddingRight: 8 },
  clSubCheck: {
    width: 22, height: 22, borderRadius: 7, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  clSubMark: { color: '#fff', fontSize: 11, fontWeight: '800' },
  clSubText: { flex: 1, fontSize: 14.5, fontWeight: '600', lineHeight: 19 },

  errorWrap: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  errorTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center', letterSpacing: -0.2 },
  errorSub: { fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  errorBtn: { borderRadius: 14, paddingVertical: 13, paddingHorizontal: 40, marginTop: 22 },
  errorBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  promptOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28 },
  promptBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  promptCard: {
    borderRadius: 24, padding: 24, width: '100%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2, shadowRadius: 24, elevation: 12,
  },
  promptTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  promptMessage: { fontSize: 14, lineHeight: 20, marginTop: 8 },
  promptInput: {
    borderRadius: 12, borderWidth: 1.5,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, fontWeight: '600', marginTop: 16,
  },
  promptBtns: { flexDirection: 'row', gap: 10, marginTop: 18 },
  promptCancelBtn: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center', borderWidth: 1.5 },
  promptCancelText: { fontWeight: '600', fontSize: 14 },
  promptSaveBtn: { flex: 2, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  promptSaveText: { color: '#fff', fontWeight: '700', fontSize: 14 },
})

// ── Weight tracker styles ──────────────────────────────────────────────────
const wt = StyleSheet.create({
  card: {
    marginTop: 14, borderRadius: 20, overflow: 'hidden', borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4,
  },
  title: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  hideBtn: { fontSize: 13, fontWeight: '600' },
  tip: { fontSize: 12, paddingHorizontal: 16, paddingBottom: 12, lineHeight: 17 },
  loggedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginBottom: 10,
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  loggedValue: { fontSize: 20, fontWeight: '800', marginRight: 4 },
  loggedLabel: { flex: 1, fontSize: 13, fontWeight: '500' },
  updateBtn: { fontSize: 13, fontWeight: '700' },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingBottom: 12, gap: 8,
  },
  input: {
    flex: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, borderWidth: 1.5,
  },
  logBtn: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  logBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  cancelEdit: { fontSize: 16, paddingHorizontal: 4 },
  graphWrap: { paddingHorizontal: 16, paddingBottom: 12 },
  sparkline: { marginBottom: 10 },
  adviceBox: {
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  adviceLabel: { fontSize: 12, fontWeight: '700', marginBottom: 3 },
  adviceTip: { fontSize: 12, fontWeight: '500', lineHeight: 17 },
  goalRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  goalLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, minWidth: 36 },
  goalValue: { flex: 1, fontSize: 13, fontWeight: '500' },
  goalEdit: { fontSize: 13, fontWeight: '700' },
  goalEditor: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16, borderTopWidth: StyleSheet.hairlineWidth },
  goalEditorHdr: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 10 },
  goalChipRow: { flexDirection: 'row', gap: 8 },
  goalChip: { flex: 1, borderWidth: 1.5, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  goalChipText: { fontSize: 12, fontWeight: '700' },
  goalActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  goalCancel: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  goalCancelText: { fontSize: 14, fontWeight: '600' },
  goalSaveBtn: { flex: 2, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  goalSaveText: { color: '#fff', fontWeight: '700', fontSize: 14 },
})

// ── Looks section styles ───────────────────────────────────────────────────
const lks = StyleSheet.create({
  card: {
    marginTop: 14, borderRadius: 20, overflow: 'hidden', borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14,
  },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  hideLink: { fontSize: 13, fontWeight: '600' },

  catSection: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, paddingBottom: 2, marginTop: 4 },
  catHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  catName: { fontSize: 14, fontWeight: '700' },
  removeX: { fontSize: 12, fontWeight: '600' },

  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 4, paddingLeft: 2 },
  stepDot: { width: 6, height: 6, borderRadius: 3 },
  stepName: { fontSize: 14, fontWeight: '500' },
  arrow: { fontSize: 12 },
  stepProduct: { fontSize: 13, fontWeight: '700' },

  addLineBtn: { paddingVertical: 8, paddingLeft: 2, marginTop: 2 },
  addLineBtnText: { fontSize: 13, fontWeight: '700' },

  addForm: { paddingTop: 8, paddingBottom: 4 },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  formRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  confirmBtn: { flex: 1, paddingVertical: 9, borderRadius: 12, alignItems: 'center' },

  addCatBlock: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, marginTop: 10 },
  addCatBtn: { borderRadius: 14, paddingVertical: 11, alignItems: 'center', borderWidth: 1.5 },
  addCatBtnText: { fontSize: 14, fontWeight: '700' },

  integrateBtn: {
    borderRadius: 14, borderWidth: 1.5,
    paddingVertical: 12, paddingHorizontal: 14,
    alignItems: 'center', marginTop: 10,
  },
  integrateBtnText: { fontSize: 14, fontWeight: '700' },
  integrateBtnSub: { fontSize: 11.5, fontWeight: '500', marginTop: 3, textAlign: 'center', lineHeight: 15 },

  aiBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed',
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10,
  },
  aiBtnText: { fontSize: 14, fontWeight: '700' },
  aiBtnSub: { fontSize: 12, marginTop: 2 },

  stepExpl: { fontSize: 12, paddingLeft: 13, paddingBottom: 4, lineHeight: 17, fontStyle: 'italic' },
  expandedProductBlock: { paddingLeft: 13, paddingBottom: 4, paddingTop: 1 },
  collapseArrow: { fontSize: 11, fontWeight: '700', marginTop: 4 },

  skinNoteBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10,
  },
  skinNoteText: { fontSize: 13, fontWeight: '500', lineHeight: 19 },

  disclaimerOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28 },
  disclaimerBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  disclaimerCard: {
    borderRadius: 24, padding: 24, width: '100%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2, shadowRadius: 24, elevation: 12,
  },
  disclaimerTitle: { fontSize: 18, fontWeight: '800', marginBottom: 12 },
  disclaimerBody: { fontSize: 14, lineHeight: 21, marginBottom: 22 },
  disclaimerBtns: { flexDirection: 'row', gap: 10 },
  disclaimerCancelBtn: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center', borderWidth: 1.5 },
  disclaimerCancelText: { fontWeight: '600', fontSize: 14 },
  disclaimerConfirmBtn: { flex: 2, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  disclaimerConfirmText: { color: '#fff', fontWeight: '700', fontSize: 14 },
})
