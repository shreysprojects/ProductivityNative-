import { useState, useEffect } from 'react'
import {
  View, Text, Pressable, StyleSheet, ScrollView,
  TextInput, Modal, KeyboardAvoidingView, Platform,
} from 'react-native'
import { router, useNavigation } from 'expo-router'
import { useTheme } from '../lib/ThemeContext'
import { useProductivity } from '../lib/ProductivityContext'

const COLOR = '#6366f1'
const GOAL_PRESETS = [15, 30, 45, 60, 90, 120]

function fmtSeconds(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
}

function fmtMins(m) {
  if (m >= 60) {
    const h = Math.floor(m / 60)
    const rem = m % 60
    return rem > 0 ? `${h}h ${rem}m` : `${h}h`
  }
  return `${m}m`
}

function encouragement(rating, actualMins, goalMins) {
  const pct = goalMins > 0 ? actualMins / goalMins : 1
  if (rating >= 9) return "Outstanding focus! You were in the zone."
  if (rating >= 7) return pct >= 0.9 ? "Great session — goal hit, solid effort!" : "Strong effort and high quality work!"
  if (rating >= 5) return "Good session. Consistency beats perfection."
  return "Every session counts. Tomorrow's a fresh start."
}

// ── Setup Screen ──────────────────────────────────────────────────────────────

function SetupView({ theme }) {
  const { startSession } = useProductivity()
  const [taskDesc, setTaskDesc] = useState('')
  const [goalMins, setGoalMins] = useState(60)
  const [customGoal, setCustomGoal] = useState('')
  const [showCustom, setShowCustom] = useState(false)

  const effectiveGoal = showCustom ? (parseInt(customGoal) || 0) : goalMins
  const canStart = effectiveGoal >= 1 && effectiveGoal <= 480

  function handleStart() {
    if (!canStart) return
    startSession(taskDesc.trim(), effectiveGoal)
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={s.setupContent}>
        <View style={[s.setupCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <Text style={s.setupIcon}>🎯</Text>
          <Text style={[s.setupTitle, { color: theme.text }]}>New Session</Text>
          <Text style={[s.setupSub, { color: theme.subtext }]}>
            Set your goal and get focused.
          </Text>

          <Text style={[s.fieldLabel, { color: theme.subtext }]}>WHAT ARE YOU WORKING ON?</Text>
          <TextInput
            style={[s.textInput, { backgroundColor: theme.isDark ? '#1e1e38' : '#f4f4fc', color: theme.text, borderColor: theme.cardBorder }]}
            placeholder="e.g. Study chapter 4, work on project..."
            placeholderTextColor={theme.muted}
            value={taskDesc}
            onChangeText={setTaskDesc}
            returnKeyType="done"
          />

          <Text style={[s.fieldLabel, { color: theme.subtext, marginTop: 20 }]}>GOAL TIME</Text>
          <View style={s.presetRow}>
            {GOAL_PRESETS.map(m => (
              <Pressable
                key={m}
                style={[
                  s.presetPill,
                  { borderColor: theme.cardBorder, backgroundColor: theme.isDark ? '#1e1e38' : '#f4f4fc' },
                  !showCustom && goalMins === m && { backgroundColor: COLOR, borderColor: COLOR },
                ]}
                onPress={() => { setGoalMins(m); setShowCustom(false) }}
              >
                <Text style={[
                  s.presetText,
                  { color: theme.subtext },
                  !showCustom && goalMins === m && { color: '#fff' },
                ]}>
                  {fmtMins(m)}
                </Text>
              </Pressable>
            ))}
            <Pressable
              style={[
                s.presetPill,
                { borderColor: theme.cardBorder, backgroundColor: theme.isDark ? '#1e1e38' : '#f4f4fc' },
                showCustom && { backgroundColor: COLOR, borderColor: COLOR },
              ]}
              onPress={() => setShowCustom(true)}
            >
              <Text style={[s.presetText, { color: showCustom ? '#fff' : theme.subtext }]}>Custom</Text>
            </Pressable>
          </View>

          {showCustom && (
            <TextInput
              style={[s.textInput, { backgroundColor: theme.isDark ? '#1e1e38' : '#f4f4fc', color: theme.text, borderColor: theme.cardBorder, marginTop: 10 }]}
              placeholder="Minutes (1–480)"
              placeholderTextColor={theme.muted}
              value={customGoal}
              onChangeText={setCustomGoal}
              keyboardType="number-pad"
              returnKeyType="done"
            />
          )}

          <Pressable
            style={[s.startBtn, !canStart && { opacity: 0.4 }]}
            onPress={handleStart}
            disabled={!canStart}
          >
            <Text style={s.startBtnText}>Start Session  →</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// ── Active Timer Screen ───────────────────────────────────────────────────────

function TimerView({ theme }) {
  const { activeSession, elapsedSeconds, isPaused, pause, resume } = useProductivity()
  const [showEndModal, setShowEndModal] = useState(false)
  const [rating, setRating] = useState(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const { endSession } = useProductivity()
  const [summary, setSummary] = useState(null)

  const goalSecs = (activeSession?.goalMins ?? 60) * 60
  const progress = Math.min(elapsedSeconds / goalSecs, 1)
  const overtime = elapsedSeconds > goalSecs

  async function handleSave() {
    if (!rating) return
    setSaving(true)
    const saved = await endSession(rating, notes.trim())
    setSaving(false)
    setShowEndModal(false)
    setSummary(saved)
  }

  if (summary) {
    return <SummaryView summary={summary} theme={theme} />
  }

  return (
    <View style={[s.timerPage, { backgroundColor: theme.bg }]}>
      <View style={[s.timerCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>

        <View style={[s.taskBadge, { backgroundColor: COLOR + '18' }]}>
          <Text style={[s.taskBadgeText, { color: COLOR }]} numberOfLines={2}>
            {activeSession?.taskDesc || 'Productivity Session'}
          </Text>
        </View>

        <Text style={[s.timerDisplay, { color: theme.text }]}>
          {fmtSeconds(elapsedSeconds)}
        </Text>
        <Text style={[s.timerGoal, { color: theme.subtext }]}>
          {overtime ? 'Over goal!' : `Goal: ${fmtMins(activeSession?.goalMins ?? 60)}`}
        </Text>

        {/* Progress bar */}
        <View style={[s.progressTrack, { backgroundColor: theme.isDark ? '#28284a' : '#e8e8f5' }]}>
          <View style={[
            s.progressFill,
            { width: `${Math.round(progress * 100)}%`, backgroundColor: overtime ? '#10b981' : COLOR },
          ]} />
        </View>
        <Text style={[s.progressLabel, { color: theme.subtext }]}>
          {overtime ? '100%+ — Goal reached!' : `${Math.round(progress * 100)}% of goal`}
        </Text>

        <View style={s.timerBtns}>
          <Pressable
            style={[s.pauseBtn, { backgroundColor: theme.isDark ? '#28284a' : '#f0f0f8', borderColor: theme.cardBorder }]}
            onPress={isPaused ? resume : pause}
          >
            <Text style={[s.pauseBtnText, { color: COLOR }]}>
              {isPaused ? '▶  Resume' : '⏸  Pause'}
            </Text>
          </Pressable>
          <Pressable
            style={s.endBtn}
            onPress={() => setShowEndModal(true)}
          >
            <Text style={s.endBtnText}>End Session</Text>
          </Pressable>
        </View>
      </View>

      {/* Rating modal */}
      <Modal visible={showEndModal} transparent animationType="slide" onRequestClose={() => setShowEndModal(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={s.modalBg} onPress={() => setShowEndModal(false)} />
          <View style={[s.modalSheet, { backgroundColor: theme.card }]}>
            <View style={[s.modalHandle, { backgroundColor: theme.divider }]} />
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <Text style={[s.modalTitle, { color: theme.text }]}>Rate Your Session</Text>
              <Text style={[s.modalSub, { color: theme.subtext }]}>How productive were you?</Text>

              <View style={s.ratingGrid}>
                {[1,2,3,4,5,6,7,8,9,10].map(n => (
                  <Pressable
                    key={n}
                    style={[
                      s.ratingDot,
                      { borderColor: rating === n ? COLOR : theme.cardBorder, backgroundColor: rating === n ? COLOR : (theme.isDark ? '#1e1e38' : '#f4f4fc') },
                    ]}
                    onPress={() => setRating(n)}
                  >
                    <Text style={[s.ratingDotText, { color: rating === n ? '#fff' : theme.text }]}>{n}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[s.notesLabel, { color: theme.subtext }]}>HOW DID IT GO? (OPTIONAL)</Text>
              <TextInput
                style={[s.notesInput, { color: theme.text, backgroundColor: theme.isDark ? '#1e1e38' : '#f4f4fc', borderColor: theme.cardBorder }]}
                placeholder="Reflect on your session…"
                placeholderTextColor={theme.muted}
                multiline
                maxLength={200}
                value={notes}
                onChangeText={setNotes}
              />

              <Pressable
                style={[s.saveBtn, !rating && { opacity: 0.4 }]}
                onPress={handleSave}
                disabled={!rating || saving}
              >
                <Text style={s.saveBtnText}>{saving ? 'Saving…' : 'Save Session'}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

// ── Summary Screen ────────────────────────────────────────────────────────────

function SummaryView({ summary, theme }) {
  const hrs = Math.floor(summary.actualMins / 60)
  const mins = summary.actualMins % 60
  const timeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`
  const goalStr = fmtMins(summary.goalMins)
  const metGoal = summary.actualMins >= summary.goalMins

  return (
    <View style={[s.summaryPage, { backgroundColor: theme.bg }]}>
      <View style={[s.summaryCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
        <Text style={s.summaryEmoji}>{summary.rating >= 8 ? '🔥' : summary.rating >= 6 ? '💪' : '👍'}</Text>
        <Text style={[s.summaryTitle, { color: theme.text }]}>Session Complete</Text>

        <View style={[s.summaryRow, { backgroundColor: theme.isDark ? '#1e1e38' : '#f4f4fc' }]}>
          <View style={s.summaryStat}>
            <Text style={[s.summaryStatVal, { color: theme.text }]}>{timeStr}</Text>
            <Text style={[s.summaryStatLabel, { color: theme.subtext }]}>Time Focused</Text>
          </View>
          <View style={[s.summaryDivider, { backgroundColor: theme.divider }]} />
          <View style={s.summaryStat}>
            <Text style={[s.summaryStatVal, { color: metGoal ? '#10b981' : theme.text }]}>{goalStr}</Text>
            <Text style={[s.summaryStatLabel, { color: theme.subtext }]}>Goal{metGoal ? ' ✓' : ''}</Text>
          </View>
          <View style={[s.summaryDivider, { backgroundColor: theme.divider }]} />
          <View style={s.summaryStat}>
            <Text style={[s.summaryStatVal, { color: COLOR }]}>{summary.rating}/10</Text>
            <Text style={[s.summaryStatLabel, { color: theme.subtext }]}>Score</Text>
          </View>
        </View>

        {summary.taskDesc ? (
          <Text style={[s.summaryTask, { color: theme.subtext }]}>"{summary.taskDesc}"</Text>
        ) : null}

        {summary.notes ? (
          <Text style={[s.summaryNotes, { color: theme.subtext, backgroundColor: theme.isDark ? '#1e1e38' : '#f4f4fc', borderColor: theme.cardBorder }]}>
            {summary.notes}
          </Text>
        ) : null}

        <Text style={[s.summaryEncourage, { color: theme.text }]}>
          {encouragement(summary.rating, summary.actualMins, summary.goalMins)}
        </Text>

        <Pressable style={s.doneBtn} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')}>
          <Text style={s.doneBtnText}>Done</Text>
        </Pressable>
      </View>
    </View>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function ProductivitySessionScreen() {
  const { theme } = useTheme()
  const { activeSession } = useProductivity()
  const navigation = useNavigation()

  useEffect(() => {
    navigation.setOptions({
      title: activeSession ? 'Session Active' : 'New Session',
      headerStyle: { backgroundColor: theme.header },
      headerShadowVisible: false,
      headerTintColor: theme.text,
      headerTitleStyle: { fontWeight: '700', fontSize: 17 },
    })
  }, [navigation, theme, !!activeSession])

  if (activeSession) return <TimerView theme={theme} />
  return <SetupView theme={theme} />
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // Setup
  setupContent: { padding: 16, paddingBottom: 40 },
  setupCard: {
    borderRadius: 24, padding: 24, borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07, shadowRadius: 12, elevation: 4,
  },
  setupIcon: { fontSize: 40, textAlign: 'center', marginBottom: 8 },
  setupTitle: { fontSize: 24, fontWeight: '800', textAlign: 'center', letterSpacing: -0.4 },
  setupSub: { fontSize: 14, textAlign: 'center', marginTop: 4, marginBottom: 24 },
  fieldLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8 },
  textInput: {
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, fontWeight: '500',
  },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  presetPill: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1,
  },
  presetText: { fontSize: 13, fontWeight: '600' },
  startBtn: {
    marginTop: 28, backgroundColor: COLOR,
    borderRadius: 16, paddingVertical: 16, alignItems: 'center',
  },
  startBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  // Timer
  timerPage: { flex: 1, padding: 16 },
  timerCard: {
    borderRadius: 24, padding: 24, borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07, shadowRadius: 12, elevation: 4,
    alignItems: 'center',
  },
  taskBadge: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 20 },
  taskBadgeText: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  timerDisplay: { fontSize: 72, fontWeight: '800', letterSpacing: -2, fontVariant: ['tabular-nums'] },
  timerGoal: { fontSize: 14, fontWeight: '500', marginTop: 4, marginBottom: 20 },
  progressTrack: { width: '100%', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: 8, borderRadius: 4 },
  progressLabel: { fontSize: 12, fontWeight: '500', marginBottom: 24 },
  timerBtns: { flexDirection: 'row', gap: 10, width: '100%' },
  pauseBtn: {
    flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1.5,
  },
  pauseBtnText: { fontWeight: '700', fontSize: 15 },
  endBtn: {
    flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center',
    backgroundColor: '#ef4444',
  },
  endBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Rating modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 10, paddingHorizontal: 24, paddingBottom: 44,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 20,
  },
  modalHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, marginBottom: 4 },
  modalSub: { fontSize: 14, marginBottom: 20 },
  ratingGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  ratingDot: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5,
  },
  ratingDotText: { fontSize: 17, fontWeight: '700' },
  notesLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8, marginTop: 4 },
  notesInput: {
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 14, minHeight: 72, textAlignVertical: 'top', marginBottom: 20,
  },
  saveBtn: { backgroundColor: COLOR, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  // Summary
  summaryPage: { flex: 1, padding: 16, justifyContent: 'center' },
  summaryCard: {
    borderRadius: 24, padding: 24, borderWidth: 1, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07, shadowRadius: 12, elevation: 4,
  },
  summaryEmoji: { fontSize: 52, marginBottom: 8 },
  summaryTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3, marginBottom: 20 },
  summaryRow: {
    flexDirection: 'row', width: '100%', borderRadius: 16,
    paddingVertical: 16, marginBottom: 16,
  },
  summaryStat: { flex: 1, alignItems: 'center', gap: 4 },
  summaryStatVal: { fontSize: 20, fontWeight: '800' },
  summaryStatLabel: { fontSize: 12, fontWeight: '500' },
  summaryDivider: { width: 1 },
  summaryTask: { fontSize: 14, fontStyle: 'italic', textAlign: 'center', marginBottom: 8, paddingHorizontal: 8 },
  summaryNotes: {
    fontSize: 13, lineHeight: 19, textAlign: 'center', paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1, marginBottom: 12, width: '100%',
  },
  summaryEncourage: { fontSize: 15, fontWeight: '600', textAlign: 'center', marginBottom: 28, paddingHorizontal: 8 },
  doneBtn: { backgroundColor: COLOR, borderRadius: 16, paddingVertical: 15, paddingHorizontal: 48, alignItems: 'center' },
  doneBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
})
