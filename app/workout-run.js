import { useState, useEffect, useRef } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Modal, KeyboardAvoidingView, Platform, Alert } from 'react-native'
import { Image } from 'expo-image'
import ExerciseVideo from '../components/ExerciseVideo'
import { router, useLocalSearchParams } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { useAuth } from '../lib/AuthContext'
import { useTheme } from '../lib/ThemeContext'
import { getWorkoutPlan, getLastWorkoutLog, saveWorkoutLog, today } from '../lib/storage'
import { saveFitPhoto } from '../lib/photoStorage'

const COLOR_DEFAULT = '#2b7fff'
const COL = { set: 40, prev: 76, check: 46 }

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

// The 1-second workout clock lives in its own component so each tick
// re-renders only the timer pill, not the whole screen (exercise GIF, set
// table, modals). Elapsed derives from the start timestamp on every tick, so
// unmounting during rests / on finish loses nothing and needs no parent state.
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

export default function WorkoutRun() {
  const { muscleGroup } = useLocalSearchParams()
  const { user } = useAuth()
  const { unit, theme } = useTheme()
  const COLOR = theme.accent
  const s = makeStyles(theme, COLOR)

  const [exercises,    setExercises]    = useState([])
  const [prevData,     setPrevData]     = useState({})
  const [loadingPlan,  setLoadingPlan]  = useState(true)
  const [phase,        setPhase]        = useState('ready')
  const [exerciseIdx,  setExerciseIdx]  = useState(0)
  const [setIdx,       setSetIdx]       = useState(0)
  const [weight,       setWeight]       = useState('')
  const [reps,         setReps]         = useState('')
  const [restLeft,     setRestLeft]     = useState(90)
  const [log,          setLog]          = useState([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editSets,     setEditSets]     = useState(3)
  const [editRest,     setEditRest]     = useState(90)
  const [overviewOpen, setOverviewOpen] = useState(false)
  const [timeModes,    setTimeModes]    = useState({}) // exerciseIdx → true=time, false=weight
  const [progressPhoto, setProgressPhoto] = useState(null)

  const intervalRef  = useRef(null)
  const startTimeRef = useRef(null)

  useEffect(() => {
    if (!user || !muscleGroup) return
    Promise.all([
      getWorkoutPlan(user.id, muscleGroup),
      getLastWorkoutLog(user.id, muscleGroup),
    ]).then(([plan, prevLog]) => {
      const prev = {}
      if (prevLog?.exercises) {
        for (const ex of prevLog.exercises) prev[ex.name] = ex.sets ?? []
      }
      setPrevData(prev)
      setExercises(plan)
      setLog(plan.map(ex => ({ exerciseId: ex.id, name: ex.name, inputType: ex.inputType ?? 'reps', gifUrl: ex.gifUrl ?? null, sets: [], skipped: false })))
      const modes = {}
      plan.forEach((ex, i) => { modes[i] = ex.inputType === 'time' })
      setTimeModes(modes)
      setLoadingPlan(false)
    })
  }, [user, muscleGroup])

  // Rest countdown
  useEffect(() => {
    clearInterval(intervalRef.current)
    if (phase !== 'rest') return
    intervalRef.current = setInterval(() => {
      setRestLeft(prev => {
        if (prev <= 1) { clearInterval(intervalRef.current); setPhase('exercise'); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(intervalRef.current)
  }, [phase])

  // ElapsedTimer clears its own interval when it unmounts; only the rest
  // countdown still needs clearing here.
  useEffect(() => () => {
    clearInterval(intervalRef.current)
  }, [])

  function prefillForSet(exName, setIndex) {
    const prev = prevData[exName]?.[setIndex]
    if (prev) { setWeight(String(prev.weight)); setReps(String(prev.reps)) }
    else { setWeight(''); setReps('') }
  }

  function startWorkout() {
    startTimeRef.current = Date.now()
    const ex = exercises[0]
    prefillForSet(ex.name, 0)
    setExerciseIdx(0)
    setSetIdx(0)
    setPhase('exercise')
  }

  function completeSet() {
    const ex        = exercises[exerciseIdx]
    const totalSets = ex.sets ?? 3
    const isLastSet = setIdx >= totalSets - 1
    const isLastEx  = exerciseIdx >= exercises.length - 1

    // In time mode the weight column holds seconds, so both fields read from it
    const isTime    = timeModes[exerciseIdx] ?? false
    const amount    = parseFloat(weight) || 0

    const newLog = log.map((entry, i) =>
      i === exerciseIdx
        ? {
            ...entry,
            sets: [...entry.sets, {
              reps: parseInt(reps, 10) || 0,
              weight: amount,
              time: isTime ? amount : 0,
              unit,
              isTime,
            }],
          }
        : entry
    )
    setLog(newLog)

    if (isLastSet && isLastEx) { finishWorkout(newLog); return }

    if (isLastSet) {
      const nextIdx = exerciseIdx + 1
      setExerciseIdx(nextIdx)
      setSetIdx(0)
      prefillForSet(exercises[nextIdx].name, 0)
    } else {
      setSetIdx(setIdx + 1)
    }

    setRestLeft(ex.restSeconds ?? 90)
    setPhase('rest')
  }

  function skipExercise() {
    const newLog = log.map((entry, i) =>
      i === exerciseIdx ? { ...entry, skipped: true } : entry
    )
    setLog(newLog)
    const isLastEx = exerciseIdx >= exercises.length - 1
    if (isLastEx) { finishWorkout(newLog); return }
    const nextIdx = exerciseIdx + 1
    setExerciseIdx(nextIdx)
    setSetIdx(0)
    prefillForSet(exercises[nextIdx].name, 0)
    setPhase('exercise')
  }

  function skipRest() { clearInterval(intervalRef.current); setPhase('exercise') }

  function toggleTimeMode() {
    setTimeModes(prev => ({ ...prev, [exerciseIdx]: !(prev[exerciseIdx] ?? false) }))
  }

  function navigateTo(targetIdx) {
    clearInterval(intervalRef.current)
    setPhase('exercise')
    setExerciseIdx(targetIdx)
    const loggedCount = log[targetIdx]?.sets?.length ?? 0
    const totalForEx  = exercises[targetIdx]?.sets ?? 3
    setSetIdx(loggedCount)
    if (loggedCount < totalForEx) {
      prefillForSet(exercises[targetIdx].name, loggedCount)
    } else {
      setWeight(''); setReps('')
    }
  }

  function goBack() {
    if (exerciseIdx === 0) return
    navigateTo(exerciseIdx - 1)
  }

  function moveForward() {
    if (exerciseIdx >= exercises.length - 1) { finishWorkout(log); return }
    navigateTo(exerciseIdx + 1)
  }

  function uncheckSet(rowIndex) {
    const removedSet = log[exerciseIdx]?.sets?.[rowIndex]
    const newSets = (log[exerciseIdx]?.sets ?? []).slice(0, rowIndex)
    setLog(prev => prev.map((entry, i) =>
      i === exerciseIdx ? { ...entry, sets: newSets } : entry
    ))
    setSetIdx(rowIndex)
    if (removedSet) {
      setWeight(removedSet.weight ? String(removedSet.weight) : '')
      setReps(removedSet.reps ? String(removedSet.reps) : '')
    }
  }

  function addSet() {
    setExercises(prev => prev.map((ex, i) =>
      i === exerciseIdx ? { ...ex, sets: (ex.sets ?? 3) + 1 } : ex
    ))
  }

  function openSettings() {
    const ex = exercises[exerciseIdx]
    setEditSets(ex.sets ?? 3)
    setEditRest(ex.restSeconds ?? 90)
    setSettingsOpen(true)
  }

  function applySettings() {
    setExercises(prev => prev.map((ex, i) =>
      i === exerciseIdx ? { ...ex, sets: editSets, restSeconds: editRest } : ex
    ))
    setSettingsOpen(false)
  }

  async function finishWorkout(finalLog) {
    clearInterval(intervalRef.current)
    setPhase('done')
    if (user) {
      await saveWorkoutLog(user.id, today(), {
        date: today(), muscleGroup,
        startedAt: startTimeRef.current, completedAt: Date.now(),
        exercises: finalLog,
      })
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
  if (loadingPlan) return <View style={s.page} />

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
    const totalSets = exercises.reduce((sum, ex) => sum + (ex.sets ?? 3), 0)
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
            <View key={ex.id} style={s.readyItem}>
              <View style={s.readyNum}>
                <Text style={s.readyNumText}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.readyItemName}>{ex.name}</Text>
                <Text style={s.readyItemMeta}>{ex.sets ?? 3} sets</Text>
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
    const totalDone = log.reduce((sum, e) => {
      const real = (e.sets ?? []).filter(st => st.reps > 0 || st.weight > 0)
      return sum + (real.length > 0 ? real.length : (e.sets ?? []).length)
    }, 0)
    return (
      <View style={s.page}>
        <ScrollView contentContainerStyle={s.doneContent} showsVerticalScrollIndicator={false}>
          <Text style={s.doneEmoji}>🎉</Text>
          <Text style={s.doneTitle}>Workout Complete!</Text>
          {!!muscleGroup && (
            <Text style={s.doneSub}>{muscleGroup.replace(/\+/g, ' · ')}  ·  {totalDone} sets done</Text>
          )}
          {log.map((entry, i) => {
            const allSets = entry.sets ?? []
            const realSets = allSets.filter(st => st.reps > 0 || st.weight > 0)
            // Explicitly skipped: only treat as skipped if no real sets (ignore accidental 0-value logs)
            // Not skipped: treat as skipped only if no sets were logged at all
            const effectivelySkipped = entry.skipped ? realSets.length === 0 : allSets.length === 0
            const displaySets = realSets.length > 0 ? realSets : allSets
            return (
              <View key={entry.exerciseId} style={s.doneSummary}>
                <View style={[s.doneIcon, effectivelySkipped && s.doneIconSkipped]}>
                  <Text style={s.doneIconText}>{effectivelySkipped ? '–' : '✓'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.doneSummaryName}>{entry.name}</Text>
                  {effectivelySkipped ? (
                    <Text style={s.doneSummaryMeta}>Skipped</Text>
                  ) : displaySets.length > 0 ? (
                    <Text style={s.doneSummaryMeta}>
                      {displaySets.map(st =>
                        (timeModes[i] ?? false)
                          ? `${st.weight}s`
                          : st.weight > 0 ? `${st.weight}${unit}×${st.reps}` : String(st.reps)
                      ).join('  ')}
                    </Text>
                  ) : null}
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

  // ── Exercise + inline rest ────────────────────────────────────────────────
  const ex        = exercises[exerciseIdx]
  const totalSets = ex.sets ?? 3
  const pct       = Math.round((exerciseIdx / exercises.length) * 100)
  const logged          = log[exerciseIdx]?.sets ?? []
  const isResting       = phase === 'rest'
  const isTimedExercise = timeModes[exerciseIdx] ?? false

  return (
    <KeyboardAvoidingView style={s.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.exContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* Top row: exit | timer/rest | settings */}
        <View style={s.topRow}>
          <Pressable style={s.topSide} onPress={() => { clearInterval(intervalRef.current); router.back() }}>
            <Text style={s.backText}>← Exit</Text>
          </Pressable>

          {isResting ? (
            <Pressable style={s.restPill} onPress={skipRest}>
              <Text style={s.restPillLabel}>REST</Text>
              <Text style={s.restPillTime}>{restLeft}s</Text>
              <Text style={s.restPillSkip}>· Skip →</Text>
            </Pressable>
          ) : (
            <ElapsedTimer startedAt={startTimeRef.current} styles={s} />
          )}

          <View style={[s.topSide, { alignItems: 'flex-end' }]}>
            <Pressable onPress={openSettings} style={s.settingsBtn}>
              <Text style={s.settingsBtnText}>⚙ Sets & Rest</Text>
            </Pressable>
          </View>
        </View>

        {/* View all exercises */}
        <Pressable style={s.viewAllBtn} onPress={() => setOverviewOpen(true)}>
          <Text style={s.viewAllText}>All exercises ({exercises.length})  ↓</Text>
        </Pressable>

        {/* Progress */}
        <View style={s.progressRow}>
          <Text style={s.progressText}>Exercise {exerciseIdx + 1} of {exercises.length}</Text>
          <Text style={s.progressPct}>{pct}%</Text>
        </View>
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${pct}%` }]} />
        </View>

        {exerciseIdx > 0 && (
          <Pressable style={s.prevExBtn} onPress={goBack}>
            <Text style={s.prevExText}>← {exercises[exerciseIdx - 1].name}</Text>
          </Pressable>
        )}

        {/* Exercise card */}
        <View style={s.exCard}>
          <Text style={s.exName}>{ex.name}</Text>
          {ex.category ? <Text style={s.exCategory}>{ex.category}</Text> : null}
          {ex.gifUrl && (
            <Image source={{ uri: ex.gifUrl }} style={s.exImage} contentFit="contain" autoplay />
          )}
          {/* Custom exercises carry a YouTube demo instead of a GIF */}
          {!ex.gifUrl && !!ex.videoId && (
            <ExerciseVideo videoId={ex.videoId} style={{ marginBottom: 4 }} />
          )}
        </View>

        {/* Set table */}
        <View style={s.setTable}>
          <View style={s.tableHead}>
            <Text style={[s.th, { width: COL.set }]}>SET</Text>
            <Text style={[s.th, { width: COL.prev }]}>PREV</Text>
            <Pressable style={s.thToggle} onPress={toggleTimeMode} hitSlop={10}>
              <Text style={s.th}>{isTimedExercise ? 'SECS' : unit.toUpperCase()}</Text>
              <Text style={s.thToggleIcon}>⇄</Text>
            </Pressable>
            <Text style={[s.th, { flex: 1 }]}>REPS</Text>
            <View style={{ width: COL.check }} />
          </View>

          {Array.from({ length: totalSets }).map((_, i) => {
            const isDone    = i < setIdx
            const isActive  = i === setIdx
            const prev      = prevData[ex.name]?.[i]
            const loggedSet = logged[i]

            return (
              <View key={i} style={[s.tableRow, isDone && s.tableRowDone, isActive && s.tableRowActive]}>
                <Text style={[s.setNum, { width: COL.set }, isDone && { color: COLOR }]}>{i + 1}</Text>

                <View style={[s.prevCell, { width: COL.prev }]}>
                  <Text style={s.prevText} numberOfLines={1}>
                    {prev
                      ? isTimedExercise ? `${prev.weight}s` : `${prev.weight}×${prev.reps}`
                      : '—'}
                  </Text>
                </View>

                <View style={{ flex: 1, alignItems: 'center' }}>
                  {isDone ? (
                    <Text style={[s.cellText, { color: COLOR }]}>
                      {isTimedExercise
                        ? loggedSet?.weight != null ? `${loggedSet.weight}s` : '—'
                        : loggedSet?.weight || '—'}
                    </Text>
                  ) : isActive ? (
                    <TextInput
                      style={s.cellInput}
                      value={weight}
                      onChangeText={setWeight}
                      keyboardType="decimal-pad"
                      placeholder="—"
                      placeholderTextColor="#ccc"
                      selectTextOnFocus
                      textAlign="center"
                    />
                  ) : (
                    <Text style={s.cellMuted}>—</Text>
                  )}
                </View>

                <View style={{ flex: 1, alignItems: 'center' }}>
                  {isDone ? (
                    <Text style={[s.cellText, { color: COLOR }]}>{loggedSet?.reps || '—'}</Text>
                  ) : isActive ? (
                    <TextInput
                      style={s.cellInput}
                      value={reps}
                      onChangeText={setReps}
                      keyboardType="number-pad"
                      placeholder="—"
                      placeholderTextColor="#ccc"
                      selectTextOnFocus
                      textAlign="center"
                    />
                  ) : (
                    <Text style={s.cellMuted}>—</Text>
                  )}
                </View>

                <View style={{ width: COL.check, alignItems: 'center' }}>
                  {isDone ? (
                    <Pressable style={s.checkDone} onPress={() => uncheckSet(i)}>
                      <Text style={s.checkMark}>✓</Text>
                    </Pressable>
                  ) : isActive ? (
                    <Pressable style={s.checkActive} onPress={isResting ? () => {} : completeSet}>
                      <Text style={s.checkMark}> </Text>
                    </Pressable>
                  ) : (
                    <View style={s.checkEmpty} />
                  )}
                </View>
              </View>
            )
          })}

          <Pressable style={s.addSetRow} onPress={addSet}>
            <Text style={s.addSetText}>+ ADD SET</Text>
          </Pressable>
        </View>

        {/* Actions */}
        {isResting ? (
          <View style={s.restActions}>
            <View style={s.restBanner}>
              <View style={s.restDot} />
              <Text style={s.restBannerText}>Resting · {restLeft}s remaining</Text>
            </View>
            <Pressable style={s.skipRestInlineBtn} onPress={skipRest}>
              <Text style={s.skipRestInlineText}>Skip Rest  →</Text>
            </Pressable>
            <Pressable style={s.finishEarlyBtn} onPress={() => finishWorkout(log)}>
              <Text style={s.finishEarlyText}>Finish Workout  ✓</Text>
            </Pressable>
          </View>
        ) : setIdx >= totalSets ? (
          <View style={s.actions}>
            <Pressable style={s.logBtn} onPress={moveForward}>
              <Text style={s.logBtnText}>
                {exerciseIdx < exercises.length - 1 ? 'Next Exercise  →' : 'Finish Workout  ✓'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={s.actions}>
            <Pressable style={s.logBtn} onPress={completeSet}>
              <Text style={s.logBtnText}>Log Set {setIdx + 1}  ✓</Text>
            </Pressable>
            <Pressable style={s.skipExBtn} onPress={skipExercise}>
              <Text style={s.skipExText}>Skip Exercise  →</Text>
            </Pressable>
            <Pressable style={s.finishEarlyBtn} onPress={() => finishWorkout(log)}>
              <Text style={s.finishEarlyText}>Finish Workout  ✓</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* Overview modal */}
      <Modal visible={overviewOpen} transparent animationType="slide" onRequestClose={() => setOverviewOpen(false)}>
        <View style={s.ovOverlay}>
          <Pressable style={s.ovBg} onPress={() => setOverviewOpen(false)} />
          <View style={s.ovSheet}>
            <View style={s.ovHandle} />
            <Text style={s.ovTitle}>All Exercises</Text>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
              {exercises.map((exItem, i) => {
                const entry      = log[i]
                const setsLogged = entry?.sets?.length ?? 0
                const total      = exItem.sets ?? 3
                const isPast     = i < exerciseIdx
                const isActiveEx = i === exerciseIdx

                return (
                  <Pressable
                    key={exItem.id}
                    style={[s.ovItem, isActiveEx && s.ovItemActive]}
                    onPress={() => { setOverviewOpen(false); navigateTo(i) }}
                  >
                    <View style={s.ovThumbWrap}>
                      {exItem.gifUrl ? (
                        <Image source={{ uri: exItem.gifUrl }} style={s.ovThumb} contentFit="cover" autoplay={false} />
                      ) : (
                        <View style={[s.ovThumb, s.ovThumbEmpty]}>
                          <Text style={{ fontSize: 18 }}>🏋️</Text>
                        </View>
                      )}
                      {isPast && (
                        <View style={s.ovThumbOverlay}>
                          <Text style={s.ovThumbCheckText}>✓</Text>
                        </View>
                      )}
                      {isActiveEx && <View style={s.ovThumbBorder} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.ovName}>{exItem.name}</Text>
                      {entry?.skipped ? (
                        <Text style={s.ovSub}>Skipped</Text>
                      ) : setsLogged > 0 ? (
                        <Text style={s.ovSub} numberOfLines={1}>
                          {entry.sets.map(st =>
                            (timeModes[i] ?? false)
                              ? `${st.weight}s`
                              : st.weight > 0 ? `${st.weight}×${st.reps}` : String(st.reps)
                          ).join('  ')}
                          {setsLogged < total ? `  ·  ${setsLogged}/${total} sets` : ''}
                        </Text>
                      ) : (
                        <Text style={s.ovSub}>{total} sets</Text>
                      )}
                    </View>
                    {isActiveEx ? <View style={s.ovActiveDot} /> : <Text style={s.ovChevron}>›</Text>}
                  </Pressable>
                )
              })}
            </ScrollView>
            <Pressable style={s.ovCloseBtn} onPress={() => setOverviewOpen(false)}>
              <Text style={s.ovCloseText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Settings modal */}
      <Modal visible={settingsOpen} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <Pressable style={s.modalBackdrop} onPress={() => setSettingsOpen(false)} />
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>{ex.name}</Text>
            <Text style={s.modalSubtitle}>Adjust for this session</Text>

            <Text style={s.modalLabel}>SETS</Text>
            <View style={s.modalStepper}>
              <Pressable style={s.modalStepBtn} onPress={() => setEditSets(n => Math.max(1, n - 1))}>
                <Text style={s.modalStepText}>−</Text>
              </Pressable>
              <Text style={s.modalStepValue}>{editSets}</Text>
              <Pressable style={s.modalStepBtn} onPress={() => setEditSets(n => n + 1)}>
                <Text style={s.modalStepText}>+</Text>
              </Pressable>
            </View>

            <Text style={s.modalLabel}>REST (seconds)</Text>
            <View style={s.modalStepper}>
              <Pressable style={s.modalStepBtn} onPress={() => setEditRest(n => Math.max(15, n - 15))}>
                <Text style={s.modalStepText}>−</Text>
              </Pressable>
              <Text style={s.modalStepValue}>{editRest}s</Text>
              <Pressable style={s.modalStepBtn} onPress={() => setEditRest(n => n + 15)}>
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

  // Exercise phase
  exContent: { padding: 20, paddingTop: 56, paddingBottom: 40 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  topSide: { flex: 1 },
  settingsBtn: { backgroundColor: theme.input, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  settingsBtnText: { color: theme.subtext, fontSize: 13, fontWeight: '600' },

  // Elapsed timer pill
  timerPill: {
    backgroundColor: theme.input, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  timerText: { fontSize: 13, fontWeight: '700', color: theme.subtext },

  // Rest pill (replaces timer during rest)
  restPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#fff7ed', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 6,
    borderWidth: 1, borderColor: '#fed7aa',
  },
  restPillLabel: { fontSize: 10, fontWeight: '800', color: '#f97316', letterSpacing: 1 },
  restPillTime: { fontSize: 14, fontWeight: '800', color: '#ea580c' },
  restPillSkip: { fontSize: 11, fontWeight: '600', color: '#fb923c' },

  // View all button
  viewAllBtn: {
    alignSelf: 'flex-start', marginBottom: 14,
    paddingVertical: 4, paddingHorizontal: 2,
  },
  viewAllText: { fontSize: 12, fontWeight: '700', color: COLOR + 'cc', letterSpacing: 0.2 },

  prevExBtn: { alignSelf: 'flex-start', paddingVertical: 5, marginBottom: 10 },
  prevExText: { fontSize: 12, fontWeight: '600', color: '#aaa' },

  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  progressText: { fontSize: 13, color: '#aaa', fontWeight: '500' },
  progressPct: { fontSize: 13, fontWeight: '700', color: COLOR },
  progressTrack: { height: 7, backgroundColor: theme.input, borderRadius: 4, marginBottom: 20, overflow: 'hidden' },
  progressFill: { height: 7, borderRadius: 4, backgroundColor: COLOR },

  exCard: {
    backgroundColor: theme.card, borderRadius: 20, padding: 20,
    borderWidth: 1.5, borderColor: COLOR + '33', alignItems: 'center', marginBottom: 16,
    shadowColor: theme.isDark ? 'transparent' : '#0d1b5e',
    shadowOffset: { width: 4, height: 5 }, shadowOpacity: 0.18, shadowRadius: 0, elevation: 6,
  },
  exName: { fontSize: 22, fontWeight: '800', color: theme.text, textAlign: 'center', marginBottom: 2 },
  exCategory: { fontSize: 12, color: theme.subtext, marginBottom: 14 },
  exImage: { width: '100%', aspectRatio: 1, borderRadius: 14, marginBottom: 4, backgroundColor: theme.input },

  // Set table
  setTable: {
    backgroundColor: theme.card, borderRadius: 20,
    borderWidth: 1, borderColor: theme.divider,
    marginBottom: 16, overflow: 'hidden',
    shadowColor: theme.isDark ? 'transparent' : '#0d1b5e',
    shadowOffset: { width: 4, height: 5 }, shadowOpacity: 0.18, shadowRadius: 0, elevation: 4,
  },
  tableHead: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10,
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

  tableRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: theme.divider,
  },
  tableRowDone: { backgroundColor: theme.accent + '18' },
  tableRowActive: { backgroundColor: theme.accent + '10' },

  setNum: { fontSize: 15, fontWeight: '700', color: theme.muted, textAlign: 'center' },

  prevCell: {
    backgroundColor: theme.input, borderRadius: 8,
    paddingVertical: 6, paddingHorizontal: 4, alignItems: 'center',
  },
  prevText: { fontSize: 12, color: theme.muted, textAlign: 'center' },

  cellText: { fontSize: 16, fontWeight: '700', textAlign: 'center', color: theme.text },
  cellMuted: { fontSize: 15, color: theme.muted, textAlign: 'center' },

  cellInput: {
    width: 60, height: 36,
    backgroundColor: theme.input, borderRadius: 10,
    fontSize: 16, fontWeight: '600', color: theme.text,
    textAlign: 'center', borderWidth: 1.5, borderColor: COLOR + '55',
  },

  checkDone: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLOR, alignItems: 'center', justifyContent: 'center',
  },
  checkActive: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 2, borderColor: COLOR + '66',
    alignItems: 'center', justifyContent: 'center',
  },
  checkEmpty: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: theme.cardBorder },
  checkMark: { color: '#fff', fontWeight: '800', fontSize: 13 },

  addSetRow: {
    paddingVertical: 13, alignItems: 'center',
    borderTopWidth: 1, borderTopColor: theme.divider,
  },
  addSetText: { fontSize: 12, fontWeight: '800', color: theme.muted, letterSpacing: 1.5 },

  // Actions — normal
  actions: { gap: 10 },
  logBtn: {
    backgroundColor: COLOR, borderRadius: 18, padding: 18, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15, shadowRadius: 8, elevation: 4,
  },
  logBtnText: { color: '#fff', fontWeight: '800', fontSize: 17 },
  skipExBtn: { alignItems: 'center', padding: 10 },
  skipExText: { color: theme.muted, fontSize: 14, fontWeight: '600' },

  // Actions — rest state
  restActions: { gap: 10 },
  restBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff7ed', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#fed7aa',
    justifyContent: 'center',
  },
  restDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#f97316' },
  restBannerText: { fontSize: 15, fontWeight: '700', color: '#c2410c' },
  skipRestInlineBtn: { alignItems: 'center', padding: 10 },
  skipRestInlineText: { color: '#f97316', fontSize: 14, fontWeight: '700' },
  finishEarlyBtn: { alignItems: 'center', paddingVertical: 6 },
  finishEarlyText: { color: '#10b981', fontSize: 13, fontWeight: '600' },

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

  // Overview bottom sheet
  ovOverlay: { flex: 1, justifyContent: 'flex-end' },
  ovBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  ovSheet: {
    backgroundColor: theme.card, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 10, paddingHorizontal: 20, paddingBottom: 36,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 16,
  },
  ovHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: theme.divider,
    alignSelf: 'center', marginBottom: 16,
  },
  ovTitle: { fontSize: 18, fontWeight: '800', color: theme.text, marginBottom: 14 },
  ovItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.divider,
  },
  ovItemActive: { backgroundColor: COLOR + '08', borderRadius: 12, paddingHorizontal: 8, marginHorizontal: -8 },
  ovNum: {
    width: 30, height: 30, borderRadius: 9, backgroundColor: theme.input,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  ovNumDone: { backgroundColor: '#10b981' },
  ovNumCurrent: { backgroundColor: COLOR },
  ovNumText: { fontSize: 13, fontWeight: '800', color: theme.muted },
  ovName: { fontSize: 15, fontWeight: '600', color: theme.text },
  ovSub: { fontSize: 12, color: theme.muted, marginTop: 1 },
  ovActiveDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: COLOR, flexShrink: 0,
  },
  ovChevron: { fontSize: 20, color: theme.muted, flexShrink: 0 },
  ovThumbWrap: {
    width: 44, height: 44, borderRadius: 10, overflow: 'hidden',
    flexShrink: 0,
  },
  ovThumb: { width: 44, height: 44, backgroundColor: theme.input },
  ovThumbEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent + '18' },
  ovThumbOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(16, 185, 129, 0.75)',
    alignItems: 'center', justifyContent: 'center',
  },
  ovThumbCheckText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  ovThumbBorder: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 10, borderWidth: 2.5, borderColor: COLOR,
  },
  ovCloseBtn: {
    backgroundColor: theme.input, borderRadius: 14, padding: 14,
    alignItems: 'center', marginTop: 14,
  },
  ovCloseText: { fontWeight: '700', fontSize: 15, color: theme.subtext },

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
