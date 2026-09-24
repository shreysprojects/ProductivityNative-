import { useState, useEffect, useRef } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Modal, KeyboardAvoidingView, Platform, Alert, AppState, ActivityIndicator } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Image } from 'expo-image'
import * as Notifications from 'expo-notifications'
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable'
import ExerciseVideo from '../components/ExerciseVideo'
import { router, useLocalSearchParams, useNavigation } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { useAuth } from '../lib/AuthContext'
import { useTheme } from '../lib/ThemeContext'
import { loadWorkoutPlan, getLastSetsByExercise, saveWorkoutSession, sanitizeWorkoutExercises, today } from '../lib/storage'
import { saveFitPhoto } from '../lib/photoStorage'

const COLOR_DEFAULT = '#2b7fff'
const COL = { set: 44, prev: 64, check: 44 }

// Set types. Warm-ups and drop sets are labelled W and D instead of a
// number; the number counts working sets only.
const SET_TYPES = {
  normal: { label: 'Normal',   badge: null, color: null },
  warmup: { label: 'Warm-up',  badge: 'W',  color: '#f59e0b' },
  drop:   { label: 'Drop set', badge: 'D',  color: '#8b5cf6' },
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

// One rest-over notification at a time: rescheduled on every rest, cancelled
// on skip, finish, exit and unmount.
const REST_NOTIF_ID = 'workout-rest-over'

// Plans travel between accounts (friends copy each other's), so the numbers
// this screen does sums with are bounded here as well as in storage: a sets
// count of 1e8 hung the screen, and counts stored as text added up to "043 sets".
function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}
const setCount = ex => clampInt(ex?.sets, 1, 20, 3)
const restSecs = ex => clampInt(ex?.restSeconds, 0, 900, 90)

// Decimal-comma keyboards type "22,5", which parseFloat reads as 22.
const toAmount = v => parseFloat(String(v ?? '').replace(',', '.')) || 0

// A previous set's weight in today's unit: 135 lbs pre-fills a kg column as
// 61.2, not 135.
function prevWeight(prev, unit) {
  const w = Number(prev?.weight) || 0
  if (prev?.isTime) return w
  if (prev?.unit === 'lbs' && unit === 'kg') return +(w * 0.453592).toFixed(1)
  if (prev?.unit === 'kg' && unit === 'lbs') return +(w / 0.453592).toFixed(1)
  return w
}

// An unfinished workout is kept on the phone as it goes, so one that iOS
// kills in the background (Expo Go often is, while the phone is locked
// between sets) can be picked up again later that day.
const DRAFT_KEY = (userId, group) => `@workout_draft_${userId}_${group}`

function clearDraft(userId, group) {
  AsyncStorage.removeItem(DRAFT_KEY(userId, group)).catch(() => {})
}

// Today's draft for this workout, or null. Anything else found is dropped:
// yesterday's session, or one whose rows no longer line up with its exercises.
async function readDraft(userId, group) {
  try {
    const raw = await AsyncStorage.getItem(DRAFT_KEY(userId, group))
    const d = raw ? JSON.parse(raw) : null
    if (!d) return null
    const exercises = sanitizeWorkoutExercises(d.exercises)
    const rows = Array.isArray(d.rows) ? d.rows : []
    const saved = Array.isArray(d.exercises) ? d.exercises.length : 0
    if (d.date !== today() || !exercises.length || exercises.length !== saved || rows.length !== saved) {
      clearDraft(userId, group)
      return null
    }
    const flags = o => Object.fromEntries(exercises.map((_, i) => [i, !!o?.[i]]))
    return {
      exercises,
      rows: rows.map(list => (Array.isArray(list) ? list : []).slice(0, 50).map(r => ({
        id: typeof r?.id === 'string' ? r.id : uid(),
        type: SET_TYPES[r?.type] ? r.type : 'normal',
        weight: typeof r?.weight === 'string' ? r.weight : '',
        reps: typeof r?.reps === 'string' ? r.reps : '',
        done: !!r?.done,
      }))),
      skipped: flags(d.skipped),
      timeModes: flags(d.timeModes),
      startedAt: Number(d.startedAt) || Date.now(),
      restEndsAt: Number(d.restEndsAt) > Date.now() ? Number(d.restEndsAt) : null,
      restFor: typeof d.restFor === 'string' ? d.restFor : null,
    }
  } catch {
    return null
  }
}

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

// The 1-second workout clock lives in its own component so each tick
// re-renders only the timer pill, not the whole screen. Elapsed derives from
// the start timestamp on every tick, so unmounting loses nothing.
function ElapsedTimer({ startedAt, styles: s }) {
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    const base = startedAt || Date.now()
    const tick = () => setElapsedMs(Date.now() - base)
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt])

  return (
    <View style={s.timerPill}>
      <Text style={s.timerText}>{fmtElapsed(elapsedMs)}</Text>
    </View>
  )
}

// The rest countdown ticks in its own component too, so each second
// re-renders these few characters rather than every set on the page. Rest is
// a deadline, not a counter: iOS pauses JS timers while the phone is locked,
// so the seconds are re-derived from it on every tick, and again the moment
// the app is active again. onDone(endsAt) fires once the deadline passes.
function RestLeft({ endsAt, onDone, style }) {
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    const tick = () => {
      const t = Date.now()
      setNow(t)
      if (t >= endsAt) onDone(endsAt)
    }
    tick()
    const id = setInterval(tick, 1000)
    const sub = AppState.addEventListener('change', state => { if (state === 'active') tick() })
    return () => { clearInterval(id); sub.remove() }
  }, [endsAt])

  return <Text style={style}>{Math.max(0, Math.ceil((endsAt - now) / 1000))}s</Text>
}

// Labels for one exercise's rows: W / D for warm-ups and drop sets, a running
// number for working sets.
function setLabels(rows) {
  let n = 0
  return rows.map(r => {
    const t = SET_TYPES[r.type] ?? SET_TYPES.normal
    if (t.badge) return t.badge
    n += 1
    return String(n)
  })
}

export default function WorkoutRun() {
  const { muscleGroup } = useLocalSearchParams()
  const { user } = useAuth()
  const userId = user?.id
  const navigation = useNavigation()
  const { unit, theme } = useTheme()
  const COLOR = theme.accent
  const s = makeStyles(theme, COLOR)

  const [exercises,    setExercises]    = useState([])
  const [prevData,     setPrevData]     = useState({})
  const [loadingPlan,  setLoadingPlan]  = useState(true)
  const [loadError,    setLoadError]    = useState(null)      // why the plan couldn't be read; null = fine
  const [phase,        setPhase]        = useState('ready')   // ready | active | done
  // rows[exerciseIdx] = [{ id, type, weight, reps, done }]: every set of every
  // exercise, all on one page, editable in any order.
  const [rows,         setRows]         = useState([])
  const [skipped,      setSkipped]      = useState({})
  // Rest is a wall-clock deadline (see RestLeft), so time spent with the
  // phone locked still counts.
  const [restEndsAt,   setRestEndsAt]   = useState(null)      // ms timestamp; null = not resting
  const [restFor,      setRestFor]      = useState(null)
  const notifPermRef = useRef(null)     // null = not asked yet, then true/false
  // The rest running now, for the notification code to check once its
  // awaits are done: a rest skipped or replaced meanwhile gets no notification.
  const restEndsRef = useRef(null)
  const notifQueue = useRef(Promise.resolve())
  const [log,          setLog]          = useState([])
  const [settingsFor,  setSettingsFor]  = useState(null)      // exercise index whose rest is being edited
  const [editRest,     setEditRest]     = useState(90)
  const [timeModes,    setTimeModes]    = useState({})        // exerciseIdx → true=time, false=weight
  const [mediaOpen,    setMediaOpen]    = useState({})        // exerciseIdx → full GIF / video shown
  const [progressPhoto, setProgressPhoto] = useState(null)

  const startTimeRef = useRef(null)
  // Loaded once per visit. Reloading on an auth event (the hourly token
  // refresh) re-seeded every set from last time in the middle of a workout.
  const loadStarted = useRef(false)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  // Set once leaving has been decided, so the guard below lets it through.
  const leavingRef = useRef(false)
  const draftRef = useRef(null)

  useEffect(() => {
    if (!userId || !muscleGroup || loadStarted.current) return
    loadStarted.current = true
    readDraft(userId, muscleGroup).then(draft => {
      if (!draft) { loadPlan(); return }
      Alert.alert(
        'Resume workout?',
        "You started this workout earlier today and didn't finish it.",
        [
          { text: 'Start over', style: 'destructive', onPress: () => { clearDraft(userId, muscleGroup); loadPlan() } },
          { text: 'Resume', onPress: () => resumeDraft(draft) },
        ],
      )
    })
  }, [userId, muscleGroup])

  function loadPlan() {
    setLoadError(null)
    setLoadingPlan(true)
    Promise.all([
      loadWorkoutPlan(userId, muscleGroup),
      // Last sets per exercise, from any workout; keyed by lowercase name.
      getLastSetsByExercise(userId).catch(() => ({})),
    ]).then(([plan, prev]) => {
      // Once a workout is under way, nothing re-seeds its sets.
      if (phaseRef.current !== 'ready') return
      setPrevData(prev)
      setExercises(plan)
      // Every set starts filled in from last time, so a repeat of last
      // session is a row of ticks.
      setRows(plan.map(ex => Array.from({ length: setCount(ex) }, (_, k) => makeRow(prevSets(prev, ex.name)[k]))))
      const modes = {}
      plan.forEach((ex, i) => { modes[i] = ex.inputType === 'time' })
      setTimeModes(modes)
    }).catch(e => {
      setLoadError(e?.message || 'Could not load this workout.')
    }).finally(() => setLoadingPlan(false))
  }

  // Straight back into the session as it was left, rest countdown included.
  function resumeDraft(d) {
    setExercises(d.exercises)
    setRows(d.rows)
    setSkipped(d.skipped)
    setTimeModes(d.timeModes)
    startTimeRef.current = d.startedAt
    if (d.restEndsAt) {
      restEndsRef.current = d.restEndsAt
      setRestEndsAt(d.restEndsAt)
      setRestFor(d.restFor)
    }
    setPhase('active')
    setLoadingPlan(false)
    getLastSetsByExercise(userId).then(setPrevData).catch(() => {})
  }

  function makeRow(prev) {
    const weight = prevWeight(prev, unit)
    const reps = parseInt(prev?.reps, 10) || 0
    return {
      id: uid(),
      type: SET_TYPES[prev?.type] ? prev.type : 'normal',
      weight: weight ? String(weight) : '',
      reps: reps ? String(reps) : '',
      done: false,
    }
  }

  const prevSets = (map, name) => map[String(name ?? '').trim().toLowerCase()] ?? []

  // Leaving mid-workout throws the session away unless it is finished first.
  // `action` is the navigation that was held up to ask, when it wasn't the
  // Exit button (the Android back button, say).
  function confirmExit(action) {
    Alert.alert(
      'Exit workout?',
      'Sets from this session are only saved when you finish.',
      [
        { text: 'Keep going', style: 'cancel' },
        { text: 'Exit without saving', style: 'destructive', onPress: () => leave(action) },
        { text: 'Finish & save', onPress: requestFinish },
      ],
    )
  }

  function leave(action) {
    stopRest()
    draftRef.current = null
    clearDraft(userId, muscleGroup)
    leavingRef.current = true
    if (action) navigation.dispatch(action)
    else router.back()
  }

  // The listener below is set up once per phase, so it reaches the latest
  // confirmExit (and the sets a "Finish & save" would save) through a ref.
  const confirmExitRef = useRef(confirmExit)
  confirmExitRef.current = confirmExit

  // Mid-workout, a stray swipe from the screen edge must not end the session.
  // The gesture is off while active (iOS would complete it natively, before
  // anything could ask), and every other way out asks first, like "← Exit".
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: phase !== 'active' })
    if (phase !== 'active') return
    return navigation.addListener('beforeRemove', e => {
      if (leavingRef.current) return
      e.preventDefault()
      confirmExitRef.current(e.data.action)
    })
  }, [navigation, phase])

  // The session is written to the phone a moment after each change, and at
  // once when the app leaves the foreground, since that is when iOS kills it.
  function writeDraft() {
    if (!draftRef.current) return
    AsyncStorage.setItem(DRAFT_KEY(userId, muscleGroup), JSON.stringify(draftRef.current)).catch(() => {})
  }

  useEffect(() => {
    if (phase !== 'active' || !userId) { draftRef.current = null; return }
    draftRef.current = {
      date: today(), muscleGroup, startedAt: startTimeRef.current,
      exercises, rows, skipped, timeModes, restEndsAt, restFor,
    }
    const t = setTimeout(writeDraft, 1000)
    return () => clearTimeout(t)
  }, [phase, exercises, rows, skipped, timeModes, restEndsAt])

  useEffect(() => {
    if (phase !== 'active') return
    const sub = AppState.addEventListener('change', state => { if (state !== 'active') writeDraft() })
    return () => sub.remove()
  }, [phase])

  // Scheduling is async and can wait on the permission prompt, so the
  // notification calls run one after another, in the order rests start and
  // stop.
  function queueNotif(fn) {
    notifQueue.current = notifQueue.current.then(fn).catch(() => {})
  }

  // A locked phone cannot show the countdown, so the end of the rest is a
  // local notification set for the deadline itself. Permission is asked once
  // per session; without it the countdown still works, just silently.
  function scheduleRestNotification(endsAt, exerciseName) {
    queueNotif(async () => {
      if (notifPermRef.current === null) {
        const perm = await Notifications.requestPermissionsAsync()
        const S = Notifications.IosAuthorizationStatus
        notifPermRef.current = perm.granted ||
          [S.AUTHORIZED, S.PROVISIONAL, S.EPHEMERAL].includes(perm.ios?.status)
      }
      // Answering the prompt takes time. A rest that has ended or been
      // replaced meanwhile, or is about to end anyway, gets nothing.
      if (!notifPermRef.current || restEndsRef.current !== endsAt || endsAt - Date.now() < 1000) return
      await Notifications.cancelScheduledNotificationAsync(REST_NOTIF_ID).catch(() => {})
      await Notifications.scheduleNotificationAsync({
        identifier: REST_NOTIF_ID,
        content: {
          title: 'Rest over',
          body: exerciseName ? `Back to ${exerciseName}.` : 'Time for the next set.',
          sound: true,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: endsAt },
      })
      // Skipped while that was being scheduled: take it back.
      if (restEndsRef.current !== endsAt) await Notifications.cancelScheduledNotificationAsync(REST_NOTIF_ID)
    })
  }

  function cancelRestNotification() {
    queueNotif(() => Notifications.cancelScheduledNotificationAsync(REST_NOTIF_ID))
  }

  function startRest(seconds, exerciseName) {
    const secs = Math.max(0, Math.round(seconds))
    if (secs === 0) { stopRest(); return }
    const endsAt = Date.now() + secs * 1000
    restEndsRef.current = endsAt
    setRestEndsAt(endsAt)
    setRestFor(exerciseName)
    scheduleRestNotification(endsAt, exerciseName)
  }

  function stopRest() {
    restEndsRef.current = null
    setRestEndsAt(null)
    cancelRestNotification()
  }

  // The countdown reached zero. The notification is left to fire.
  function endRest(at) {
    if (restEndsRef.current !== at) return
    restEndsRef.current = null
    setRestEndsAt(null)
  }

  // Leaving the screen any other way must not leave a stray "Rest over".
  useEffect(() => () => { restEndsRef.current = null; cancelRestNotification() }, [])

  function startWorkout() {
    startTimeRef.current = Date.now()
    setPhase('active')
  }

  // ── Row edits ─────────────────────────────────────────────────────────────

  const updateRows = (exIdx, fn) => setRows(prev => prev.map((list, i) => (i === exIdx ? fn(list) : list)))

  function updateRow(exIdx, rowId, patch) {
    updateRows(exIdx, list => list.map(r => (r.id === rowId ? { ...r, ...patch } : r)))
  }

  function toggleDone(exIdx, rowId) {
    const row = rows[exIdx]?.find(r => r.id === rowId)
    if (!row) return
    const nowDone = !row.done
    updateRow(exIdx, rowId, { done: nowDone })
    if (nowDone) startRest(restSecs(exercises[exIdx]), exercises[exIdx]?.name ?? null)
  }

  function skipRest() { stopRest() }

  // A new set starts from the values of the one above it.
  function addRow(exIdx) {
    updateRows(exIdx, list => {
      const last = list[list.length - 1]
      return [...list, { id: uid(), type: 'normal', weight: last?.weight ?? '', reps: last?.reps ?? '', done: false }]
    })
  }

  function deleteRow(exIdx, rowId) {
    updateRows(exIdx, list => list.filter(r => r.id !== rowId))
  }

  // Tap the set number to choose its type.
  function pickType(exIdx, row) {
    const choose = type => updateRow(exIdx, row.id, { type })
    Alert.alert('Set type', 'What kind of set is this?', [
      { text: 'Warm-up', onPress: () => choose('warmup') },
      { text: 'Drop set', onPress: () => choose('drop') },
      { text: 'Normal', onPress: () => choose('normal') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  function toggleSkip(exIdx) {
    setSkipped(prev => ({ ...prev, [exIdx]: !prev[exIdx] }))
  }

  function toggleTimeMode(exIdx) {
    setTimeModes(prev => ({ ...prev, [exIdx]: !(prev[exIdx] ?? false) }))
  }

  function openSettings(exIdx) {
    setEditRest(restSecs(exercises[exIdx]))
    setSettingsFor(exIdx)
  }

  function applySettings() {
    setExercises(prev => prev.map((ex, i) => (i === settingsFor ? { ...ex, restSeconds: editRest } : ex)))
    setSettingsFor(null)
  }

  // ── Finish ────────────────────────────────────────────────────────────────

  // Only ticked sets are saved. Every set starts filled in from last time,
  // so a weight in the box is no sign the set was done; a skipped exercise
  // saves none, and one with nothing ticked is logged as skipped.
  function buildLog() {
    return exercises.map((ex, i) => {
      const isTime = timeModes[i] ?? false
      const sets = skipped[i] ? [] : (rows[i] ?? [])
        .filter(r => r.done)
        .map(r => {
          const amount = toAmount(r.weight)
          return { reps: parseInt(r.reps, 10) || 0, weight: amount, time: isTime ? amount : 0, unit, isTime, type: r.type, done: true }
        })
      return {
        exerciseId: ex.id,
        name: ex.name,
        inputType: ex.inputType ?? 'reps',
        gifUrl: ex.gifUrl ?? null,
        skipped: sets.length === 0,
        sets,
      }
    })
  }

  function requestFinish() {
    const pending = exercises.reduce((n, _, i) => (skipped[i] ? n : n + (rows[i] ?? []).filter(r => !r.done).length), 0)
    const skippedCount = exercises.filter((_, i) => skipped[i]).length
    const go = () => { const finalLog = buildLog(); setLog(finalLog); finishWorkout(finalLog) }
    if (pending === 0 && skippedCount === 0) { go(); return }
    const notes = []
    if (pending > 0) notes.push(`${pending} set${pending === 1 ? ' is' : 's are'} not ticked off and won't be saved.`)
    if (skippedCount > 0) notes.push(`${skippedCount} exercise${skippedCount === 1 ? ' is' : 's are'} skipped.`)
    Alert.alert(
      'Finish workout?',
      notes.join(' '),
      [{ text: 'Keep going', style: 'cancel' }, { text: 'Finish', onPress: go }],
    )
  }

  async function finishWorkout(finalLog) {
    stopRest()
    draftRef.current = null
    setPhase('done')
    if (userId) {
      const date = today()
      // One session of the day: another workout already finished today is
      // kept alongside this one instead of being overwritten by it.
      await saveWorkoutSession(userId, date, {
        date, muscleGroup,
        startedAt: startTimeRef.current, completedAt: Date.now(),
        exercises: finalLog,
      })
      // Only once it is saved: until then the draft can still bring it back.
      clearDraft(userId, muscleGroup)
    }
    Alert.alert(
      '📸 Progress photo?',
      'Capture how you look today — watch your transformation build day by day on the fitness calendar.',
      [
        { text: 'Not today', style: 'cancel' },
        { text: 'Take photo', onPress: takeProgressPhoto },
      ]
    )
  }

  async function takeProgressPhoto() {
    if (!user) return
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) {
      Alert.alert('Camera access needed', 'Allow camera access in your device settings to take progress photos.')
      return
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6 })
    if (result.canceled || !result.assets?.[0]?.uri) return
    try {
      const saved = await saveFitPhoto(user.id, today(), result.assets[0].uri)
      setProgressPhoto(saved)
    } catch {
      Alert.alert('Could not save photo', 'Please try again.')
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loadingPlan) {
    return (
      <View style={s.page}>
        <View style={s.readyContent}>
          <Pressable onPress={() => router.back()} style={s.back}>
            <Text style={s.backText}>← Exit</Text>
          </Pressable>
          <ActivityIndicator color={COLOR} style={{ marginTop: 40 }} />
        </View>
      </View>
    )
  }

  // ── Couldn't load ────────────────────────────────────────────────────────
  // Not "No exercises planned": the plan may well be there.
  if (loadError) {
    return (
      <View style={s.page}>
        <View style={s.emptyWrap}>
          <Text style={s.emptyEmoji}>⚠️</Text>
          <Text style={s.emptyTitle}>Couldn't load this workout</Text>
          <Text style={s.emptySub}>{loadError}</Text>
          <Pressable style={s.emptyBtn} onPress={loadPlan}>
            <Text style={s.emptyBtnText}>Retry</Text>
          </Pressable>
          <Pressable style={s.emptyBack} onPress={() => router.back()} hitSlop={8}>
            <Text style={s.backText}>← Go Back</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── Empty plan ───────────────────────────────────────────────────────────
  if (!loadingPlan && exercises.length === 0) {
    return (
      <View style={s.page}>
        <View style={s.emptyWrap}>
          <Text style={s.emptyEmoji}>🏋️</Text>
          <Text style={s.emptyTitle}>No exercises planned</Text>
          <Text style={s.emptySub}>Go to Fitness and tap "Edit" to build your workout.</Text>
          <Pressable style={s.emptyBtn} onPress={() => router.back()}>
            <Text style={s.emptyBtnText}>← Go Back</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── Ready ────────────────────────────────────────────────────────────────
  if (phase === 'ready') {
    const totalSets = exercises.reduce((sum, ex) => sum + setCount(ex), 0)
    return (
      <View style={s.page}>
        <ScrollView contentContainerStyle={s.readyContent} showsVerticalScrollIndicator={false}>
          <Pressable onPress={() => router.back()} style={s.back}>
            <Text style={s.backText}>← Exit</Text>
          </Pressable>
          <Text style={s.readyTitle}>Today's Workout</Text>
          {!!muscleGroup && (
            <View style={s.groupBadge}>
              <Text style={s.groupBadgeText}>{muscleGroup.replace(/\+/g, ' · ')}</Text>
            </View>
          )}
          <Text style={s.readyMeta}>{exercises.length} exercise{exercises.length !== 1 ? 's' : ''}  ·  {totalSets} sets</Text>

          {exercises.map((ex, i) => (
            <View key={`${i}-${ex.id}`} style={s.readyItem}>
              <View style={s.readyNum}>
                <Text style={s.readyNumText}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.readyItemName}>{ex.name}</Text>
                <Text style={s.readyItemMeta}>{setCount(ex)} sets</Text>
              </View>
              {ex.gifUrl ? (
                <Image source={{ uri: ex.gifUrl }} style={s.readyThumb} contentFit="cover" autoplay={false} />
              ) : (
                <View style={s.readyThumbPlaceholder}><Text style={{ fontSize: 18 }}>🏋️</Text></View>
              )}
            </View>
          ))}

          <Pressable style={s.beginBtn} onPress={startWorkout}>
            <Text style={s.beginBtnText}>Begin Workout  →</Text>
          </Pressable>
        </ScrollView>
      </View>
    )
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  if (phase === 'done') {
    // The log holds ticked sets only, so every set in it counts as done.
    const totalDone = log.reduce((sum, e) => sum + (e.sets ?? []).length, 0)
    const typeMark = st => (st.type === 'warmup' ? 'W ' : st.type === 'drop' ? 'D ' : '')
    return (
      <View style={s.page}>
        <ScrollView contentContainerStyle={s.doneContent} showsVerticalScrollIndicator={false}>
          <Text style={s.doneEmoji}>🎉</Text>
          <Text style={s.doneTitle}>Workout Complete!</Text>
          {!!muscleGroup && (
            <Text style={s.doneSub}>{muscleGroup.replace(/\+/g, ' · ')}  ·  {totalDone} sets done</Text>
          )}
          {log.map((entry, i) => {
            const doneSets = entry.sets ?? []
            const notDone = doneSets.length === 0
            return (
              <View key={`${i}-${entry.exerciseId}`} style={s.doneSummary}>
                <View style={[s.doneIcon, notDone && s.doneIconSkipped]}>
                  <Text style={s.doneIconText}>{notDone ? '–' : '✓'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.doneSummaryName}>{entry.name}</Text>
                  {notDone ? (
                    <Text style={s.doneSummaryMeta}>Skipped</Text>
                  ) : (
                    <Text style={s.doneSummaryMeta}>
                      {doneSets.map(st =>
                        typeMark(st) + ((timeModes[i] ?? false)
                          ? `${st.weight}s`
                          : st.weight > 0 ? `${st.weight}${unit}×${st.reps}` : String(st.reps))
                      ).join('  ')}
                    </Text>
                  )}
                </View>
              </View>
            )
          })}
          {progressPhoto ? (
            <View style={s.photoCard}>
              <Image source={{ uri: progressPhoto }} style={s.photoPreview} contentFit="cover" />
              <Pressable style={s.photoRetake} onPress={takeProgressPhoto}>
                <Text style={s.photoRetakeText}>↻ Retake</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={s.photoBtn} onPress={takeProgressPhoto}>
              <Text style={{ fontSize: 20 }}>📸</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.photoBtnTitle}>Take a progress photo</Text>
                <Text style={s.photoBtnSub}>See your transformation on the fitness calendar</Text>
              </View>
            </Pressable>
          )}
          <Pressable style={s.finishBtn} onPress={() => router.back()}>
            <Text style={s.finishBtnText}>← Back to Fitness</Text>
          </Pressable>
        </ScrollView>
      </View>
    )
  }

  // ── Active: every exercise on one page ───────────────────────────────────
  const totalRows = exercises.reduce((n, _, i) => (skipped[i] ? n : n + (rows[i]?.length ?? 0)), 0)
  const doneRows  = exercises.reduce((n, _, i) => (skipped[i] ? n : n + (rows[i] ?? []).filter(r => r.done).length), 0)
  const pct       = totalRows ? Math.round((doneRows / totalRows) * 100) : 0
  const isResting = restEndsAt != null

  return (
    <KeyboardAvoidingView style={s.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.exContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* Top row: exit | timer or rest | sets done */}
        <View style={s.topRow}>
          <Pressable style={s.topSide} onPress={() => confirmExit()}>
            <Text style={s.backText}>← Exit</Text>
          </Pressable>

          {isResting ? (
            <Pressable style={s.restPill} onPress={skipRest}>
              <Text style={s.restPillLabel}>REST</Text>
              <RestLeft endsAt={restEndsAt} onDone={endRest} style={s.restPillTime} />
              <Text style={s.restPillSkip}>· Skip →</Text>
            </Pressable>
          ) : (
            <ElapsedTimer startedAt={startTimeRef.current} styles={s} />
          )}

          <View style={[s.topSide, { alignItems: 'flex-end' }]}>
            <Text style={s.setsDoneText}>{doneRows}/{totalRows} sets</Text>
          </View>
        </View>

        {/* Progress */}
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${pct}%` }]} />
        </View>

        {isResting && (
          <View style={s.restBanner}>
            <View style={s.restDot} />
            <Text style={s.restBannerText} numberOfLines={1}>
              Resting{restFor ? ` after ${restFor}` : ''} · <RestLeft endsAt={restEndsAt} onDone={endRest} />
            </Text>
            <Pressable onPress={skipRest} hitSlop={8}>
              <Text style={s.restBannerSkip}>Skip</Text>
            </Pressable>
          </View>
        )}

        <Text style={s.hint}>Tick a set when it's done; only ticked sets are saved. Tap a set number for warm-up or drop set. Swipe a set left to remove it.</Text>

        {exercises.map((ex, i) => {
          const exRows = rows[i] ?? []
          const labels = setLabels(exRows)
          const isTimed = timeModes[i] ?? false
          const isSkipped = !!skipped[i]
          const exDone = exRows.length > 0 && exRows.every(r => r.done)
          return (
            <View key={`${i}-${ex.id}`} style={[s.exBlock, exDone && !isSkipped && s.exBlockDone, isSkipped && s.exBlockSkipped]}>
              {/* Header: thumbnail (tap for the demo), name, rest, actions */}
              <View style={s.exHead}>
                <Pressable onPress={() => setMediaOpen(m => ({ ...m, [i]: !m[i] }))} hitSlop={4}>
                  {ex.gifUrl ? (
                    <Image source={{ uri: ex.gifUrl }} style={s.exThumb} contentFit="cover" autoplay={false} />
                  ) : (
                    <View style={[s.exThumb, s.exThumbEmpty]}><Text style={{ fontSize: 18 }}>🏋️</Text></View>
                  )}
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={s.exBlockName} numberOfLines={2}>{i + 1}. {ex.name}</Text>
                  <Text style={s.exBlockMeta}>
                    {ex.category ? `${ex.category} · ` : ''}rest {restSecs(ex)}s
                    {isSkipped ? ' · skipped' : ''}
                  </Text>
                </View>
                <Pressable onPress={() => openSettings(i)} style={s.exHeadBtn} hitSlop={6}>
                  <Text style={s.exHeadBtnText}>⚙</Text>
                </Pressable>
                <Pressable onPress={() => toggleSkip(i)} style={s.exHeadBtn} hitSlop={6}>
                  <Text style={[s.exHeadBtnText, { color: isSkipped ? COLOR : theme.muted }]}>{isSkipped ? 'Undo' : 'Skip'}</Text>
                </Pressable>
              </View>

              {mediaOpen[i] && (
                ex.gifUrl ? (
                  <Image source={{ uri: ex.gifUrl }} style={s.exImage} contentFit="contain" autoplay />
                ) : ex.videoId ? (
                  <ExerciseVideo videoId={ex.videoId} style={{ marginBottom: 8 }} />
                ) : null
              )}

              {!isSkipped && (
                <View style={s.setTable}>
                  <View style={s.tableHead}>
                    <Text style={[s.th, { width: COL.set }]}>SET</Text>
                    <Text style={[s.th, { width: COL.prev }]}>PREV</Text>
                    <Pressable style={s.thToggle} onPress={() => toggleTimeMode(i)} hitSlop={10}>
                      <Text style={s.th}>{isTimed ? 'SECS' : unit.toUpperCase()}</Text>
                      <Text style={s.thToggleIcon}>⇄</Text>
                    </Pressable>
                    <Text style={[s.th, { flex: 1 }]}>REPS</Text>
                    <View style={{ width: COL.check }} />
                  </View>

                  {exRows.map((row, k) => {
                    const prev = prevSets(prevData, ex.name)[k]
                    const type = SET_TYPES[row.type] ?? SET_TYPES.normal
                    return (
                      <ReanimatedSwipeable
                        key={row.id}
                        friction={2}
                        rightThreshold={36}
                        overshootRight={false}
                        renderRightActions={() => (
                          <Pressable style={s.swipeDelete} onPress={() => deleteRow(i, row.id)}>
                            <Text style={s.swipeDeleteIcon}>🗑</Text>
                          </Pressable>
                        )}
                      >
                        <View style={[s.tableRow, row.done && s.tableRowDone]}>
                          <Pressable onPress={() => pickType(i, row)} hitSlop={6} style={{ width: COL.set, alignItems: 'center' }}>
                            <View style={[s.setBadge, type.color && { backgroundColor: type.color + '22' }]}>
                              <Text style={[s.setNum, type.color && { color: type.color }, row.done && !type.color && { color: COLOR }]}>
                                {labels[k]}
                              </Text>
                            </View>
                          </Pressable>

                          <View style={[s.prevCell, { width: COL.prev }]}>
                            <Text style={s.prevText} numberOfLines={1}>
                              {prev
                                ? isTimed ? `${Number(prev.weight) || 0}s` : `${prevWeight(prev, unit)}×${Number(prev.reps) || 0}`
                                : '—'}
                            </Text>
                          </View>

                          <View style={{ flex: 1, alignItems: 'center' }}>
                            <TextInput
                              style={[s.cellInput, row.done && s.cellInputDone]}
                              value={row.weight}
                              onChangeText={v => updateRow(i, row.id, { weight: v })}
                              keyboardType="decimal-pad"
                              placeholder="—"
                              placeholderTextColor="#ccc"
                              selectTextOnFocus
                              textAlign="center"
                            />
                          </View>

                          <View style={{ flex: 1, alignItems: 'center' }}>
                            <TextInput
                              style={[s.cellInput, row.done && s.cellInputDone]}
                              value={row.reps}
                              onChangeText={v => updateRow(i, row.id, { reps: v })}
                              keyboardType="number-pad"
                              placeholder="—"
                              placeholderTextColor="#ccc"
                              selectTextOnFocus
                              textAlign="center"
                            />
                          </View>

                          <View style={{ width: COL.check, alignItems: 'center' }}>
                            <Pressable style={row.done ? s.checkDone : s.checkActive} onPress={() => toggleDone(i, row.id)} hitSlop={6}>
                              <Text style={s.checkMark}>{row.done ? '✓' : ' '}</Text>
                            </Pressable>
                          </View>
                        </View>
                      </ReanimatedSwipeable>
                    )
                  })}

                  <Pressable style={s.addSetRow} onPress={() => addRow(i)}>
                    <Text style={s.addSetText}>+ ADD SET</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )
        })}

        <Pressable style={s.logBtn} onPress={requestFinish}>
          <Text style={s.logBtnText}>Finish Workout  ✓</Text>
        </Pressable>
      </ScrollView>

      {/* Rest settings, per exercise */}
      <Modal visible={settingsFor !== null} transparent animationType="fade" onRequestClose={() => setSettingsFor(null)}>
        <View style={s.modalOverlay}>
          <Pressable style={s.modalBackdrop} onPress={() => setSettingsFor(null)} />
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>{exercises[settingsFor]?.name ?? ''}</Text>
            <Text style={s.modalSubtitle}>Rest between sets, for this session</Text>

            <Text style={s.modalLabel}>REST (seconds)</Text>
            <View style={s.modalStepper}>
              <Pressable style={s.modalStepBtn} onPress={() => setEditRest(n => Math.max(15, n - 15))}>
                <Text style={s.modalStepText}>−</Text>
              </Pressable>
              <Text style={s.modalStepValue}>{editRest}s</Text>
              <Pressable style={s.modalStepBtn} onPress={() => setEditRest(n => Math.min(900, n + 15))}>
                <Text style={s.modalStepText}>+</Text>
              </Pressable>
            </View>

            <Pressable style={s.modalApplyBtn} onPress={applySettings}>
              <Text style={s.modalApplyText}>Apply</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  )
}

function makeStyles(theme, COLOR = COLOR_DEFAULT) { return StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.bg },
  back: { marginBottom: 20 },
  backText: { color: COLOR, fontSize: 15, fontWeight: '600' },

  // Empty
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyEmoji: { fontSize: 64, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: theme.text, marginBottom: 8 },
  emptySub: { fontSize: 14, color: theme.subtext, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  emptyBtn: { backgroundColor: COLOR, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  emptyBack: { marginTop: 18 },

  // Ready
  readyContent: { padding: 20, paddingTop: 56, paddingBottom: 40 },
  readyTitle: { fontSize: 28, fontWeight: '800', color: theme.text, marginBottom: 8 },
  groupBadge: {
    backgroundColor: COLOR + '18', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 4,
    alignSelf: 'flex-start', marginBottom: 8,
  },
  groupBadgeText: { fontSize: 12, fontWeight: '700', color: COLOR, letterSpacing: 0.5 },
  readyMeta: { fontSize: 14, color: theme.subtext, marginBottom: 24 },
  readyItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: theme.card, borderRadius: 16, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: theme.divider,
  },
  readyNum: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: COLOR + '18',
    alignItems: 'center', justifyContent: 'center',
  },
  readyNumText: { fontSize: 14, fontWeight: '800', color: COLOR },
  readyItemName: { fontSize: 15, fontWeight: '700', color: theme.text },
  readyItemMeta: { fontSize: 12, color: theme.subtext, marginTop: 2 },
  readyThumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: theme.input },
  readyThumbPlaceholder: {
    width: 44, height: 44, borderRadius: 8, backgroundColor: '#eef2ff',
    alignItems: 'center', justifyContent: 'center',
  },
  beginBtn: {
    backgroundColor: COLOR, borderRadius: 18, padding: 18,
    alignItems: 'center', marginTop: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15, shadowRadius: 8, elevation: 4,
  },
  beginBtnText: { color: '#fff', fontWeight: '800', fontSize: 17 },

  // Active
  exContent: { padding: 20, paddingTop: 56, paddingBottom: 40 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  topSide: { flex: 1 },
  setsDoneText: { fontSize: 13, fontWeight: '700', color: theme.subtext, fontVariant: ['tabular-nums'] },

  timerPill: {
    backgroundColor: theme.input, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  timerText: { fontSize: 13, fontWeight: '700', color: theme.subtext },

  restPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#fff7ed', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 6,
    borderWidth: 1, borderColor: '#fed7aa',
  },
  restPillLabel: { fontSize: 10, fontWeight: '800', color: '#f97316', letterSpacing: 1 },
  restPillTime: { fontSize: 14, fontWeight: '800', color: '#ea580c' },
  restPillSkip: { fontSize: 11, fontWeight: '600', color: '#fb923c' },

  progressTrack: { height: 7, backgroundColor: theme.input, borderRadius: 4, marginBottom: 14, overflow: 'hidden' },
  progressFill: { height: 7, borderRadius: 4, backgroundColor: COLOR },

  restBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff7ed', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: '#fed7aa', marginBottom: 12,
  },
  restDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#f97316' },
  restBannerText: { flex: 1, fontSize: 13.5, fontWeight: '700', color: '#c2410c' },
  restBannerSkip: { fontSize: 13, fontWeight: '800', color: '#f97316' },

  hint: { fontSize: 12, color: theme.muted, fontWeight: '500', lineHeight: 17, marginBottom: 14 },

  exBlock: {
    backgroundColor: theme.card, borderRadius: 20, padding: 14, marginBottom: 14,
    borderWidth: 1.5, borderColor: theme.divider,
    shadowColor: theme.isDark ? 'transparent' : '#0d1b5e',
    shadowOffset: { width: 4, height: 5 }, shadowOpacity: 0.18, shadowRadius: 0, elevation: 4,
  },
  exBlockDone: { borderColor: COLOR + '66' },
  exBlockSkipped: { opacity: 0.6 },
  exHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  exThumb: { width: 48, height: 48, borderRadius: 10, backgroundColor: theme.input },
  exThumbEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: COLOR + '18' },
  exBlockName: { fontSize: 16, fontWeight: '800', color: theme.text, lineHeight: 20 },
  exBlockMeta: { fontSize: 12, color: theme.subtext, marginTop: 2 },
  exHeadBtn: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10, backgroundColor: theme.input },
  exHeadBtnText: { fontSize: 13, fontWeight: '700', color: theme.subtext },
  exImage: { width: '100%', aspectRatio: 1, borderRadius: 14, marginBottom: 10, backgroundColor: theme.input },

  // Set table
  setTable: {
    borderRadius: 14, borderWidth: 1, borderColor: theme.divider, overflow: 'hidden',
  },
  tableHead: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: theme.divider,
    backgroundColor: theme.input,
  },
  th: { fontSize: 10, fontWeight: '800', color: theme.muted, letterSpacing: 1, textAlign: 'center' },
  thToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  thToggleIcon: {
    fontSize: 13, color: COLOR, fontWeight: '800',
    backgroundColor: COLOR + '1a', borderRadius: 6,
    paddingHorizontal: 5, paddingVertical: 1, overflow: 'hidden',
  },

  // Rows sit over the swipe action, so they need their own opaque background.
  tableRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: theme.divider,
    backgroundColor: theme.card,
  },
  tableRowDone: { backgroundColor: theme.isDark ? '#1f3f8a' : '#eaf3ff' },
  setBadge: { minWidth: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  setNum: { fontSize: 14, fontWeight: '800', color: theme.muted, textAlign: 'center' },

  prevCell: {
    backgroundColor: theme.input, borderRadius: 8,
    paddingVertical: 6, paddingHorizontal: 4, alignItems: 'center',
  },
  prevText: { fontSize: 11.5, color: theme.muted, textAlign: 'center' },

  cellInput: {
    width: 58, height: 36,
    backgroundColor: theme.input, borderRadius: 10,
    fontSize: 16, fontWeight: '600', color: theme.text,
    textAlign: 'center', borderWidth: 1.5, borderColor: COLOR + '40',
  },
  cellInputDone: { borderColor: COLOR, color: COLOR },

  checkDone: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLOR, alignItems: 'center', justifyContent: 'center',
  },
  checkActive: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 2, borderColor: COLOR + '66',
    alignItems: 'center', justifyContent: 'center',
  },
  checkMark: { color: '#fff', fontWeight: '800', fontSize: 13 },

  swipeDelete: {
    width: 76, backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center',
  },
  swipeDeleteIcon: { fontSize: 22 },

  addSetRow: {
    paddingVertical: 11, alignItems: 'center',
    backgroundColor: theme.card,
  },
  addSetText: { fontSize: 12, fontWeight: '800', color: theme.muted, letterSpacing: 1.5 },

  logBtn: {
    backgroundColor: COLOR, borderRadius: 18, padding: 18, alignItems: 'center', marginTop: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15, shadowRadius: 8, elevation: 4,
  },
  logBtnText: { color: '#fff', fontWeight: '800', fontSize: 17 },

  // Done
  doneContent: { padding: 24, paddingTop: 60, alignItems: 'center' },
  doneEmoji: { fontSize: 64, marginBottom: 12 },
  doneTitle: { fontSize: 28, fontWeight: '800', color: theme.text, marginBottom: 6 },
  doneSub: { fontSize: 14, color: theme.subtext, marginBottom: 24 },
  doneSummary: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    width: '100%', backgroundColor: theme.card, borderRadius: 16, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: theme.divider,
  },
  doneIcon: {
    width: 28, height: 28, borderRadius: 10, backgroundColor: COLOR,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  doneIconSkipped: { backgroundColor: '#d1d5db' },
  doneIconText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  doneSummaryName: { fontSize: 15, fontWeight: '600', color: theme.text },
  doneSummaryMeta: { fontSize: 12, color: theme.muted, marginTop: 2 },
  finishBtn: {
    backgroundColor: COLOR, borderRadius: 16, padding: 16,
    alignItems: 'center', width: '100%', marginTop: 16,
  },
  finishBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },

  photoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%',
    borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: COLOR + '66',
    backgroundColor: COLOR + '0d', padding: 14, marginTop: 16,
  },
  photoBtnTitle: { color: theme.text, fontWeight: '700', fontSize: 15 },
  photoBtnSub: { color: theme.subtext, fontSize: 12, marginTop: 2 },
  photoCard: { width: '100%', marginTop: 16, alignItems: 'center' },
  photoPreview: { width: '100%', height: 260, borderRadius: 16 },
  photoRetake: { paddingVertical: 10 },
  photoRetakeText: { color: COLOR, fontWeight: '700', fontSize: 13 },

  // Settings modal
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalBox: {
    backgroundColor: theme.card, borderRadius: 24, padding: 24, width: 300,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18, shadowRadius: 20, elevation: 10,
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: theme.text, marginBottom: 2, textAlign: 'center' },
  modalSubtitle: { fontSize: 12, color: theme.subtext, textAlign: 'center', marginBottom: 20 },
  modalLabel: { fontSize: 10, fontWeight: '800', color: theme.muted, letterSpacing: 1.5, textAlign: 'center', marginBottom: 10 },
  modalStepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginBottom: 20 },
  modalStepBtn: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: theme.input,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.cardBorder,
  },
  modalStepText: { fontSize: 22, color: theme.text, fontWeight: '300' },
  modalStepValue: { fontSize: 28, fontWeight: '700', color: theme.text, minWidth: 60, textAlign: 'center' },
  modalApplyBtn: { backgroundColor: COLOR, borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 4 },
  modalApplyText: { color: '#fff', fontWeight: '700', fontSize: 15 },
}) }
