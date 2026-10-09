import { useState, useEffect, useRef, useCallback } from 'react'
import { View, Text, Pressable, StyleSheet, Animated, Alert, Image, Modal, TextInput } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { useTheme } from '../lib/ThemeContext'
import { stepImageUnlocked, subStepImageUnlocked, parseStartTimeInput } from '../lib/runSteps'
import ImageViewerModal from './ImageViewerModal'

const RING_R    = 52
const RING_STR  = 8
const CIRC      = 2 * Math.PI * RING_R

function fmt(secs) {
  const m = String(Math.floor(secs / 60)).padStart(2, '0')
  const s = String(secs % 60).padStart(2, '0')
  return `${m}:${s}`
}

function fmtClock(ts) {
  const d = new Date(ts)
  const h = d.getHours() % 12 || 12
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m} ${d.getHours() < 12 ? 'am' : 'pm'}`
}

const EARLIER_CHIPS = [1, 5, 10, 15]

// The 1-second clock lives in its own component so each tick re-renders only
// the timer, not the whole run card (task photo, sub-task list, upcoming
// pills). The parent reads the latest value through onElapsed into a ref when
// a button press needs it — that write never triggers a parent render.
function StepTimer({ startedAt, goalSecs, color, styles: s, onElapsed }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const base = startedAt || Date.now()
    const tick = () => {
      const secs = Math.floor((Date.now() - base) / 1000)
      setElapsed(secs)
      onElapsed(secs)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt, onElapsed])

  const hasGoal = goalSecs > 0
  const over    = hasGoal && elapsed > goalSecs
  const tColor  = over ? '#ef4444' : color
  const ringOff = hasGoal ? CIRC * (1 - Math.min(elapsed / goalSecs, 1)) : CIRC

  return hasGoal ? (
    <View style={s.ringBox}>
      <Svg width={130} height={130} style={StyleSheet.absoluteFill}>
        <Circle cx={65} cy={65} r={RING_R} stroke={tColor + '22'} strokeWidth={RING_STR} fill="none" />
        <Circle cx={65} cy={65} r={RING_R} stroke={tColor} strokeWidth={RING_STR} fill="none"
          strokeDasharray={CIRC} strokeDashoffset={ringOff}
          strokeLinecap="round" rotation="-90" originX={65} originY={65} />
      </Svg>
      <Text style={[s.timerBig, { color: tColor, fontSize: 30 }]}>{fmt(elapsed)}</Text>
      <Text style={[s.timerSub, { color: over ? '#ef4444' : '#c4c4c4' }]}>
        {over ? `+${fmt(elapsed - goalSecs)} over` : `/ ${fmt(goalSecs)}`}
      </Text>
    </View>
  ) : (
    <View style={[s.timerCircle, { borderColor: color + '33' }]}>
      <Text style={[s.timerBig, { color }]}>{fmt(elapsed)}</Text>
    </View>
  )
}

function motivationalMsg(step, total) {
  const pct = step / total
  if (pct === 0) return "Let's go! 🚀"
  if (pct < 0.3) return 'Great start! 💪'
  if (pct < 0.6) return 'Keep going! 🔥'
  if (pct < 0.85) return 'Almost there! ⚡'
  return 'Last one! 🎯'
}

// `busy` is true while a move to another task is still being saved; the
// buttons that move the run wait for it, so a double tap can't move it twice.
export default function RunRoutine({ run, color = '#2b7fff', busy = false, onStepDone, onFinish, onGoBack, onToggleSubTask, onJumpTo, onAdjustStart, onSkip }) {
  const { theme } = useTheme()
  const s = makeStyles(theme)
  const { currentStep, steps } = run
  const step    = steps[currentStep]
  // Finish once no other task is still open. Tasks can be done out of order
  // (skipped, checked off in the checklist, gone back to), so the last task
  // on the list isn't necessarily the last one left.
  const isLast  = steps.every((t, i) => i === currentStep || !!t.completedAt)
  const [photoViewer, setPhotoViewer] = useState(null)
  const [adjustVisible, setAdjustVisible] = useState(false)
  const [timeText, setTimeText] = useState('')

  const btnScale  = useRef(new Animated.Value(1)).current
  const cardScale = useRef(new Animated.Value(0.94)).current
  const cardOpacity = useRef(new Animated.Value(0)).current

  // Pop-in animation on each new task. Keyed on the task itself, not just the
  // position: editing the routine mid-run can slide a different task into the
  // same index.
  useEffect(() => {
    cardScale.setValue(0.94)
    cardOpacity.setValue(0)
    Animated.parallel([
      Animated.spring(cardScale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 10 }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start()
  }, [currentStep, step.id])

  // Latest elapsed seconds, written by StepTimer without re-rendering this
  // tree; read at press time by Done/Finish.
  const elapsedRef = useRef(0)
  const handleElapsed = useCallback(secs => { elapsedRef.current = secs }, [])

  function pressIn() {
    Animated.spring(btnScale, { toValue: 0.94, useNativeDriver: true, speed: 40, bounciness: 4 }).start()
  }
  function pressOut() {
    Animated.spring(btnScale, { toValue: 1, useNativeDriver: true, speed: 15, bounciness: 12 }).start()
  }

  // Progress counts tasks actually done, not the position in the list.
  const doneCount = steps.filter(t => t.completedAt).length
  const pct      = Math.round((doneCount / steps.length) * 100)
  const goalSecs = step.timeGoalSecs ?? (step.timeGoalMins ?? 0) * 60
  const hasSubs  = step.subTasks?.length > 0
  const subDone  = step.subTasks?.filter(st => st.done).length ?? 0
  const upcoming = steps
    .map((t, i) => ({ t, i }))
    .filter(({ t, i }) => i > currentStep && !t.completedAt)
    .slice(0, 3)
  const imageUnlocked = stepImageUnlocked(steps, currentStep)
  // Any task the user moved past with unchecked sub-steps
  const skippedBefore = steps.slice(0, currentStep).some(t => t.subTasks?.some(st => !st.done))

  // Finishing with unchecked sub-steps anywhere gets a heads-up first, with a
  // jump straight back to the earliest task that still has some.
  function handleFinishPress(ms) {
    const unfinished = steps
      .map((t, i) => ({ i, text: t.text }))
      .filter(({ i }) => steps[i].subTasks?.some(st => !st.done))
    if (unfinished.length === 0 || !onJumpTo) { onFinish(ms); return }
    const short = t => (t.length > 24 ? t.slice(0, 24) + '…' : t)
    const names = unfinished.length === 1
      ? `"${short(unfinished[0].text)}"`
      : unfinished.length === 2
        ? `"${short(unfinished[0].text)}" and "${short(unfinished[1].text)}"`
        : `"${short(unfinished[0].text)}", "${short(unfinished[1].text)}" and ${unfinished.length - 2} more`
    Alert.alert(
      'Unfinished steps',
      `Unfinished steps in ${names}. Go back to them?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Finish anyway', style: 'destructive', onPress: () => onFinish(ms) },
        // Already on that task: closing the alert is all "go back" means,
        // and its timer must keep running.
        { text: 'Go back', onPress: () => { if (unfinished[0].i !== currentStep) onJumpTo(unfinished[0].i) } },
      ]
    )
  }

  function applyAdjust(ts) {
    setAdjustVisible(false)
    setTimeText('')
    onAdjustStart?.(ts)
  }

  function applyExactTime() {
    const ts = parseStartTimeInput(timeText, Date.now())
    if (ts == null) {
      Alert.alert('Time not recognized', 'Enter a time like "6:45 am" or "18:45".')
      return
    }
    applyAdjust(ts)
  }

  return (
    <View>

      {/* ── Progress dots ─────────────────────────────────────── */}
      <View style={s.dotsRow}>
        {steps.map((t, i) => (
          <View key={i} style={[
            s.dot,
            i !== currentStep && !!t.completedAt && [s.dotDone, { backgroundColor: color }],
            i === currentStep && [s.dotCurrent, { backgroundColor: color }],
            i !== currentStep && !t.completedAt && s.dotFuture,
          ]} />
        ))}
      </View>

      {/* ── Motivational + pct ────────────────────────────────── */}
      <View style={s.topRow}>
        <Text style={[s.motivational, { color }]}>{motivationalMsg(doneCount, steps.length)}</Text>
        <Text style={[s.pctLabel, { color }]}>{pct}%</Text>
      </View>

      {/* ── Main task card ────────────────────────────────────── */}
      <Animated.View style={[
        s.card, { borderColor: color + '38' },
        { transform: [{ scale: cardScale }], opacity: cardOpacity },
      ]}>
        {/* NOW badge */}
        <View style={[s.nowBadge, { backgroundColor: color }]}>
          <Text style={s.nowBadgeText}>NOW  ·  {currentStep + 1} / {steps.length}</Text>
        </View>

        <Text style={s.taskName}>{step.text}</Text>

        {/* Optional task picture, held back until the tasks above are done.
            Working forward this is always unlocked; it only bites when the
            user jumps ahead to a later task. */}
        {!!step.image && (
          imageUnlocked ? (
            <Pressable onPress={() => setPhotoViewer(step.image)}>
              <Image source={{ uri: step.image }} style={s.taskImage} resizeMode="cover" />
            </Pressable>
          ) : (
            <Text style={s.taskImageLocked}>🔒 Photo unlocks when the tasks above are done</Text>
          )
        )}

        {/* Sub-tasks */}
        {hasSubs && (
          <View style={s.subSection}>
            <Text style={[s.subHeader, { color }]}>{subDone} / {step.subTasks.length} steps</Text>
            {step.subTasks.map((st, j) => (
              <View key={st.id}>
                <Pressable style={s.subRow} onPress={() => onToggleSubTask(st.id)}>
                  <View style={[s.subCheck, st.done && { backgroundColor: color, borderColor: color }]}>
                    {st.done && <Text style={s.subMark}>✓</Text>}
                  </View>
                  <Text style={[s.subText, st.done && s.subDone]}>{st.text}</Text>
                </Pressable>
                {/* This step's photo waits for the steps above it */}
                {!!st.image && (
                  subStepImageUnlocked(step.subTasks, j) ? (
                    <Pressable onPress={() => setPhotoViewer(st.image)}>
                      <Image source={{ uri: st.image }} style={s.subImage} resizeMode="cover" />
                    </Pressable>
                  ) : (
                    <Text style={s.subImageLocked}>🔒 Photo unlocks when the steps above are checked</Text>
                  )
                )}
              </View>
            ))}
          </View>
        )}

        {/* Timer */}
        <Pressable
          style={s.timerWrap}
          onPress={onAdjustStart ? () => setAdjustVisible(true) : undefined}
          disabled={!onAdjustStart}
        >
          <StepTimer
            key={step.id}
            startedAt={step.startedAt}
            goalSecs={goalSecs}
            color={color}
            styles={s}
            onElapsed={handleElapsed}
          />
        </Pressable>
        {onAdjustStart && (
          <Pressable onPress={() => setAdjustVisible(true)} hitSlop={6}>
            <Text style={[s.adjustLink, { color: color + '99' }]}>Started at a different time?</Text>
          </Pressable>
        )}
      </Animated.View>

      {/* ── Upcoming pills ───────────────────────────────────── */}
      {upcoming.length > 0 && (
        <View style={s.upcomingRow}>
          {upcoming.map(({ t, i }) => (
            <View key={t.id} style={[s.upcomingPill, { backgroundColor: color + '10', borderColor: color + '28' }]}>
              <View style={[s.upcomingNum, { backgroundColor: color + '22' }]}>
                <Text style={[s.upcomingNumText, { color }]}>{i + 1}</Text>
              </View>
              <Text style={[s.upcomingText, { color: color + 'cc' }]} numberOfLines={1}>{t.text}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ── Action button ────────────────────────────────────── */}
      <Animated.View style={{ transform: [{ scale: btnScale }] }}>
        <Pressable
          style={[s.btn, { backgroundColor: isLast ? '#10b981' : color }, busy && { opacity: 0.6 }]}
          onPressIn={pressIn}
          onPressOut={pressOut}
          disabled={busy}
          onPress={() => isLast ? handleFinishPress(elapsedRef.current * 1000) : onStepDone(elapsedRef.current * 1000)}
        >
          <Text style={s.btnText}>
            {isLast ? 'Finish Routine  ✓' : 'Done, Next Task  →'}
          </Text>
        </Pressable>
      </Animated.View>

      {/* ── Skip for later: the task joins today's do-later list.
           A task that's already done has nothing left to skip. ── */}
      {onSkip && !step.completedAt && (
        <Pressable style={s.backBtn} onPress={() => onSkip(elapsedRef.current * 1000)} hitSlop={6} disabled={busy}>
          <Text style={[s.backBtnText, { color: '#f59e0b' }]}>Skip, do later  ⏭</Text>
        </Pressable>
      )}

      {/* ── Go back ──────────────────────────────────────────── */}
      {currentStep > 0 && (
        <Pressable style={s.backBtn} onPress={() => onGoBack?.()} disabled={busy}>
          <Text style={[s.backBtnText, { color: color + 'aa' }]}>← Previous Task</Text>
          {skippedBefore && (
            <Text style={s.skippedNote}>(SOME STEPS ARE SKIPPED)</Text>
          )}
        </Pressable>
      )}

      <ImageViewerModal uri={photoViewer} onClose={() => setPhotoViewer(null)} />

      {/* ── Adjust timer ─────────────────────────────────────── */}
      <Modal visible={adjustVisible} transparent animationType="fade" onRequestClose={() => setAdjustVisible(false)}>
        <View style={s.adjOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAdjustVisible(false)} />
          <View style={s.adjModal}>
            <Text style={s.adjTitle}>Adjust timer</Text>
            <Text style={s.adjBody}>
              This task's timer started at {fmtClock(step.startedAt || Date.now())}. If you really began at a
              different time, fix it here — your recorded times will match.
            </Text>

            <Text style={[s.adjSectionLabel, { color }]}>I STARTED EARLIER</Text>
            <View style={s.adjChipRow}>
              {EARLIER_CHIPS.map(mins => (
                <Pressable
                  key={mins}
                  style={[s.adjChip, { borderColor: color + '44', backgroundColor: color + '0e' }]}
                  onPress={() => applyAdjust((step.startedAt || Date.now()) - mins * 60000)}
                >
                  <Text style={[s.adjChipText, { color }]}>−{mins} min</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.adjSectionLabel, { color }]}>OR THE EXACT TIME</Text>
            <View style={s.adjTimeRow}>
              <TextInput
                style={s.adjTimeInput}
                placeholder='e.g. "6:45 am" or "18:45"'
                placeholderTextColor={theme.muted}
                value={timeText}
                onChangeText={setTimeText}
                returnKeyType="done"
                onSubmitEditing={applyExactTime}
                autoCorrect={false}
              />
              <Pressable style={[s.adjSetBtn, { backgroundColor: color }]} onPress={applyExactTime}>
                <Text style={s.adjSetBtnText}>Set</Text>
              </Pressable>
            </View>

            <Pressable hitSlop={8} onPress={() => applyAdjust(Date.now())}>
              <Text style={[s.adjRestart, { color }]}>Restart this task's timer from 0:00</Text>
            </Pressable>
            <Pressable hitSlop={8} onPress={() => setAdjustVisible(false)}>
              <Text style={s.adjClose}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  )
}

function makeStyles(theme) { return StyleSheet.create({
  // Progress dots
  dotsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginBottom: 14, paddingHorizontal: 2,
  },
  dot:        { height: 6, flex: 1, borderRadius: 3 },
  dotDone:    { height: 6, opacity: 0.5 },
  dotCurrent: { height: 9, flex: 1.8, borderRadius: 5 },
  dotFuture:  { backgroundColor: theme.divider },

  topRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 14, paddingHorizontal: 2,
  },
  motivational: { fontSize: 14, fontWeight: '700' },
  pctLabel:     { fontSize: 14, fontWeight: '800' },

  // Card
  card: {
    backgroundColor: theme.card, borderRadius: 32,
    paddingHorizontal: 24, paddingTop: 22, paddingBottom: 40,
    borderWidth: 2, alignItems: 'center', marginBottom: 14,
    shadowColor: theme.isDark ? 'transparent' : '#0d1b5e',
    shadowOffset: { width: 4, height: 5 }, shadowOpacity: 0.18, shadowRadius: 0, elevation: 10,
  },
  nowBadge: {
    paddingHorizontal: 18, paddingVertical: 8,
    borderRadius: 20, marginBottom: 18,
  },
  nowBadgeText: { fontSize: 11, fontWeight: '900', letterSpacing: 1.8, color: '#fff' },
  taskName: {
    fontSize: 30, fontWeight: '800', color: theme.text,
    textAlign: 'center', marginBottom: 20, lineHeight: 38,
  },

  taskImage: {
    width: '100%', height: 180, borderRadius: 18, marginBottom: 18,
    backgroundColor: theme.divider,
  },
  taskImageLocked: {
    fontSize: 12.5, fontWeight: '600', color: theme.muted,
    marginBottom: 18, opacity: 0.8,
  },
  subImage: {
    width: '100%', height: 150, borderRadius: 14,
    marginTop: 4, marginBottom: 10, backgroundColor: theme.divider,
  },
  subImageLocked: {
    fontSize: 12, fontWeight: '600', color: theme.muted,
    marginTop: 2, marginBottom: 8, marginLeft: 32, opacity: 0.8,
  },

  // Subtasks
  subSection: { width: '100%', marginBottom: 16 },
  subHeader: { fontSize: 12, fontWeight: '700', letterSpacing: 1, textAlign: 'center', marginBottom: 12 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 },
  subCheck: {
    width: 32, height: 32, borderRadius: 10, borderWidth: 2,
    borderColor: theme.cardBorder, alignItems: 'center', justifyContent: 'center',
  },
  subMark: { color: '#fff', fontSize: 14, fontWeight: '800' },
  subText: { flex: 1, fontSize: 17, color: theme.text, fontWeight: '600' },
  subDone: { color: theme.muted, textDecorationLine: 'line-through' },

  // Timer
  timerWrap: { marginTop: 4 },
  ringBox: {
    width: 130, height: 130, alignItems: 'center', justifyContent: 'center',
  },
  timerCircle: {
    width: 140, height: 140, borderRadius: 70,
    borderWidth: 2, alignItems: 'center', justifyContent: 'center',
  },
  timerBig: { fontSize: 42, fontWeight: '300' },
  timerSub: { fontSize: 13, fontWeight: '500', marginTop: 4 },
  adjustLink: { fontSize: 12.5, fontWeight: '600', marginTop: 12, textAlign: 'center' },

  // Adjust-timer modal
  adjOverlay: { flex: 1, backgroundColor: '#00000088', justifyContent: 'center', padding: 24 },
  adjModal: { borderRadius: 20, padding: 22, backgroundColor: theme.card },
  adjTitle: { fontSize: 19, fontWeight: '800', marginBottom: 6, color: theme.text },
  adjBody: { fontSize: 14, lineHeight: 20, marginBottom: 16, color: theme.subtext },
  adjSectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  adjChipRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  adjChip: {
    flex: 1, borderWidth: 1, borderRadius: 12,
    paddingVertical: 10, alignItems: 'center',
  },
  adjChipText: { fontSize: 13, fontWeight: '700' },
  adjTimeRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  adjTimeInput: {
    flex: 1, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: theme.text, borderColor: theme.cardBorder, backgroundColor: theme.bg,
  },
  adjSetBtn: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12 },
  adjSetBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  adjRestart: { textAlign: 'center', marginTop: 18, fontSize: 14, fontWeight: '700' },
  adjClose: { textAlign: 'center', marginTop: 14, fontSize: 14, fontWeight: '600', color: theme.subtext },

  // Upcoming
  upcomingRow: { gap: 7, marginBottom: 14 },
  upcomingPill: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10,
  },
  upcomingNum: {
    width: 24, height: 24, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  upcomingNumText: { fontSize: 12, fontWeight: '800' },
  upcomingText: { flex: 1, fontSize: 14, fontWeight: '600' },

  backBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 12,
  },
  backBtnText: { fontSize: 14, fontWeight: '600' },
  skippedNote: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4, color: '#f59e0b' },

  // Button
  btn: {
    borderRadius: 22, padding: 20, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.22, shadowRadius: 12, elevation: 8,
  },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 17, letterSpacing: 0.3 },
}) }
