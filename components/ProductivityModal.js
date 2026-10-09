import { useState } from 'react'
import {
  View, Text, Pressable, StyleSheet, ScrollView,
  TextInput, Modal, KeyboardAvoidingView, Platform, Alert,
} from 'react-native'
import { useTheme } from '../lib/ThemeContext'
import { useProductivity } from '../lib/ProductivityContext'

const COLOR = '#6366f1'
const GOAL_PRESETS = [15, 30, 45, 60, 90, 120]

function fmtMins(m) {
  if (m >= 60) { const h = Math.floor(m / 60), r = m % 60; return r ? `${h}h ${r}m` : `${h}h` }
  return `${m}m`
}
function fmtSecs(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
}

export default function ProductivityModal() {
  const { theme } = useTheme()
  const {
    showSessionModal, closeSession,
    activeSession, elapsedSeconds, isPaused,
    pause, resume, startSession, endSession, abandonSession,
  } = useProductivity()

  const [taskDesc,   setTaskDesc]   = useState('')
  const [goalMins,   setGoalMins]   = useState(60)
  const [showCustom, setShowCustom] = useState(false)
  const [customGoal, setCustomGoal] = useState('')
  const [showRating, setShowRating] = useState(false)
  const [rating,     setRating]     = useState(null)
  const [notes,      setNotes]      = useState('')
  const [saving,     setSaving]     = useState(false)

  const effectiveGoal = showCustom ? (parseInt(customGoal) || 0) : goalMins
  const canStart  = effectiveGoal >= 1 && effectiveGoal <= 480
  const goalSecs  = (activeSession?.goalMins ?? 60) * 60
  const progress  = Math.min(elapsedSeconds / goalSecs, 1)
  const overtime  = elapsedSeconds > goalSecs

  function handleStart() {
    if (!canStart) return
    startSession(taskDesc.trim(), effectiveGoal)
  }

  async function handleSave() {
    if (!rating || saving) return
    setSaving(true)
    closeSession()
    await endSession(rating, notes.trim())
    setShowRating(false)
    setRating(null)
    setNotes('')
    setTaskDesc('')
    setGoalMins(60)
    setShowCustom(false)
    setCustomGoal('')
    setSaving(false)
  }

  function handleClose() {
    closeSession()
  }

  return (
    <Modal
      visible={showSessionModal}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={m.wrapper}
      >
        <Pressable style={m.backdrop} onPress={handleClose} />

        <View style={[m.sheet, { backgroundColor: theme.card }]}>
          <Pressable onPress={handleClose} hitSlop={16}>
            <View style={[m.handle, { backgroundColor: theme.divider }]} />
          </Pressable>

          {/* ── Setup ── */}
          {!activeSession && (
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={[m.title, { color: theme.text }]}>New Session</Text>

              <Text style={[m.label, { color: theme.subtext }]}>WHAT ARE YOU WORKING ON?</Text>
              <TextInput
                style={[m.input, { backgroundColor: theme.isDark ? '#1e1e38' : '#f4f4fc', color: theme.text, borderColor: theme.cardBorder }]}
                placeholder="e.g. Study, work on project..."
                placeholderTextColor={theme.muted}
                value={taskDesc}
                onChangeText={setTaskDesc}
                returnKeyType="done"
              />

              <Text style={[m.label, { color: theme.subtext, marginTop: 18 }]}>GOAL TIME</Text>
              <View style={m.presets}>
                {GOAL_PRESETS.map(min => (
                  <Pressable
                    key={min}
                    style={[
                      m.pill,
                      { borderColor: theme.cardBorder, backgroundColor: theme.isDark ? '#1e1e38' : '#f4f4fc' },
                      !showCustom && goalMins === min && { backgroundColor: COLOR, borderColor: COLOR },
                    ]}
                    onPress={() => { setGoalMins(min); setShowCustom(false) }}
                  >
                    <Text style={[m.pillText, { color: !showCustom && goalMins === min ? '#fff' : theme.subtext }]}>
                      {fmtMins(min)}
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  style={[m.pill, { borderColor: theme.cardBorder, backgroundColor: theme.isDark ? '#1e1e38' : '#f4f4fc' }, showCustom && { backgroundColor: COLOR, borderColor: COLOR }]}
                  onPress={() => setShowCustom(true)}
                >
                  <Text style={[m.pillText, { color: showCustom ? '#fff' : theme.subtext }]}>Custom</Text>
                </Pressable>
              </View>
              {showCustom && (
                <TextInput
                  style={[m.input, { backgroundColor: theme.isDark ? '#1e1e38' : '#f4f4fc', color: theme.text, borderColor: theme.cardBorder, marginTop: 10 }]}
                  placeholder="Minutes (1–480)"
                  placeholderTextColor={theme.muted}
                  value={customGoal}
                  onChangeText={setCustomGoal}
                  keyboardType="number-pad"
                  returnKeyType="done"
                />
              )}

              <Pressable style={[m.primaryBtn, !canStart && { opacity: 0.4 }]} onPress={handleStart} disabled={!canStart}>
                <Text style={m.primaryBtnText}>Start Session  →</Text>
              </Pressable>
            </ScrollView>
          )}

          {/* ── Timer ── */}
          {activeSession && !showRating && (
            <View style={m.timerBlock}>
              <View style={[m.taskBadge, { backgroundColor: COLOR + '18' }]}>
                <Text style={[m.taskBadgeText, { color: COLOR }]} numberOfLines={1}>
                  {activeSession.taskDesc || 'Productivity Session'}
                </Text>
              </View>

              <Text style={[m.timerBig, { color: theme.text }]}>{fmtSecs(elapsedSeconds)}</Text>
              <Text style={[m.timerSub, { color: theme.subtext }]}>
                {overtime ? 'Goal reached!' : `/ ${fmtMins(activeSession.goalMins)} goal`}
              </Text>

              <View style={[m.progressTrack, { backgroundColor: theme.isDark ? '#28284a' : '#e8e8f5' }]}>
                <View style={[m.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: overtime ? '#10b981' : COLOR }]} />
              </View>

              <View style={m.timerBtns}>
                <Pressable
                  style={[m.timerBtn, { borderColor: theme.cardBorder, backgroundColor: theme.isDark ? '#1e1e38' : '#f4f4fc' }]}
                  onPress={isPaused ? resume : pause}
                >
                  <Text style={[m.timerBtnText, { color: COLOR }]}>{isPaused ? '▶  Resume' : '⏸  Pause'}</Text>
                </Pressable>
                <Pressable style={[m.timerBtn, { backgroundColor: '#ef4444', borderColor: '#ef4444' }]} onPress={() => setShowRating(true)}>
                  <Text style={[m.timerBtnText, { color: '#fff' }]}>End Session</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* ── Rating ── */}
          {showRating && (
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false}>
              <Text style={[m.title, { color: theme.text }]}>Rate Your Session</Text>
              <Text style={[m.label, { color: theme.subtext, marginBottom: 16 }]}>HOW PRODUCTIVE WERE YOU?</Text>
              <View style={m.ratingGrid}>
                {[1,2,3,4,5,6,7,8,9,10].map(n => (
                  <Pressable
                    key={n}
                    style={[
                      m.ratingDot,
                      { borderColor: rating === n ? COLOR : theme.cardBorder, backgroundColor: rating === n ? COLOR : (theme.isDark ? '#1e1e38' : '#f4f4fc') },
                    ]}
                    onPress={() => setRating(n)}
                  >
                    <Text style={[m.ratingDotText, { color: rating === n ? '#fff' : theme.text }]}>{n}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[m.label, { color: theme.subtext, marginTop: 4 }]}>HOW DID IT GO? (OPTIONAL)</Text>
              <TextInput
                style={[m.notesInput, { color: theme.text, backgroundColor: theme.isDark ? '#1e1e38' : '#f4f4fc', borderColor: theme.cardBorder }]}
                placeholder="Reflect on your session…"
                placeholderTextColor={theme.muted}
                multiline
                maxLength={200}
                value={notes}
                onChangeText={setNotes}
              />
              <Pressable style={[m.primaryBtn, !rating && { opacity: 0.4 }]} onPress={handleSave} disabled={!rating || saving}>
                <Text style={m.primaryBtnText}>{saving ? 'Saving…' : 'Save Session'}</Text>
              </Pressable>
              <Pressable style={m.backBtn} onPress={() => setShowRating(false)}>
                <Text style={[m.backBtnText, { color: theme.subtext }]}>← Back to timer</Text>
              </Pressable>
              <Pressable
                style={m.abandonBtn}
                onPress={() => Alert.alert(
                  'Abandon Session?',
                  "This session won't be saved to your history.",
                  [
                    { text: 'Keep Rating', style: 'cancel' },
                    { text: 'Abandon', style: 'destructive', onPress: () => {
                      abandonSession()
                      closeSession()
                      setShowRating(false)
                      setRating(null)
                      setNotes('')
                    }},
                  ]
                )}
              >
                <Text style={m.abandonBtnText}>Abandon session</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const m = StyleSheet.create({
  wrapper:  { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 10, paddingHorizontal: 22, paddingBottom: 44,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 20,
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  title:  { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, marginBottom: 18 },
  label:  { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8 },
  input: {
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, fontWeight: '500',
  },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill:     { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1 },
  pillText: { fontSize: 13, fontWeight: '600' },
  primaryBtn:     { marginTop: 22, backgroundColor: COLOR, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  timerBlock: { alignItems: 'center', paddingVertical: 8 },
  taskBadge:     { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 16, maxWidth: '100%' },
  taskBadgeText: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  timerBig: { fontSize: 58, fontWeight: '800', letterSpacing: -2, fontVariant: ['tabular-nums'] },
  timerSub: { fontSize: 14, fontWeight: '500', marginTop: 2, marginBottom: 18 },
  progressTrack: { width: '100%', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 20 },
  progressFill:  { height: 8, borderRadius: 4 },
  timerBtns: { flexDirection: 'row', gap: 10, width: '100%' },
  timerBtn:     { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1.5 },
  timerBtnText: { fontWeight: '700', fontSize: 15 },

  ratingGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  ratingDot:     { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  ratingDotText: { fontSize: 17, fontWeight: '700' },
  notesInput: {
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 14, minHeight: 72, textAlignVertical: 'top', marginTop: 8, marginBottom: 4,
  },
  backBtn:       { alignItems: 'center', paddingVertical: 14 },
  backBtnText:   { fontSize: 14 },
  abandonBtn:    { alignItems: 'center', paddingBottom: 6 },
  abandonBtnText:{ fontSize: 13, fontWeight: '500', color: '#ef444488' },
})
