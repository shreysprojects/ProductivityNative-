import { useState, useEffect } from 'react'
import {
  View, Text, Pressable, StyleSheet, Modal, ScrollView,
  TextInput, ActivityIndicator, Alert, Platform, KeyboardAvoidingView,
} from 'react-native'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'

function fmtSecs(s) {
  if (!s) return ''
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m > 0 && sec > 0) return `${m}m ${sec}s`
  if (m > 0) return `${m}m`
  return `${sec}s`
}

const SURVEYS = {
  Morning: [
    { type: 'single', q: 'When do you wake up?', opts: ['5–6 AM', '6–7 AM', '7–8 AM', '8–9 AM', 'Later'] },
    { type: 'single', q: 'How much time do you have?', opts: ['15 min', '30 min', '45 min', '1 hour', '1.5+ hours'] },
    { type: 'multi', q: 'What matters most to you in the morning?', opts: ['Mental clarity', 'Physical energy', 'Nutrition', 'Mindfulness', 'Productivity', 'Skincare'] },
    { type: 'text', q: 'Anything specific to include?', placeholder: 'e.g. cold shower, journaling… (optional)', optional: true },
  ],
  Night: [
    { type: 'single', q: 'What time do you go to bed?', opts: ['8–9 PM', '9–10 PM', '10–11 PM', '11 PM–midnight', 'After midnight'] },
    { type: 'single', q: 'How much time to wind down?', opts: ['15 min', '30 min', '45 min', '1 hour+'] },
    { type: 'multi', q: 'What matters most at night?', opts: ['Better sleep', 'Skincare', 'Reading', 'Planning tomorrow', 'Stress relief', 'Gratitude'] },
    { type: 'text', q: 'Any sleep issues or habits?', placeholder: 'e.g. trouble falling asleep, want to meditate… (optional)', optional: true },
  ],
  Fitness: [
    { type: 'single', q: 'How long is your workout?', opts: ['30 min', '45 min', '1 hour', '1.5 hours', '2+ hours'] },
    { type: 'single', q: 'What is your fitness goal?', opts: ['Build muscle', 'Lose weight', 'Improve endurance', 'General health'] },
    { type: 'single', q: 'Experience level?', opts: ['Beginner', 'Intermediate', 'Advanced'] },
    { type: 'text', q: 'Any injuries or limitations?', placeholder: 'e.g. bad knees, no equipment… (optional)', optional: true },
  ],
}

function getSurvey(name) {
  return SURVEYS[name] ?? [
    { type: 'single', q: 'How much time do you have?', opts: ['15 min', '30 min', '45 min', '1 hour', '1.5+ hours'] },
    { type: 'multi', q: 'What are your main goals?', opts: ['Consistency', 'Energy', 'Productivity', 'Health', 'Mindfulness'] },
    { type: 'text', q: 'Anything specific to include?', placeholder: 'e.g. specific habits or constraints… (optional)', optional: true },
  ]
}

export default function AIRoutineModal({ visible, onClose, routineName, existingTasks, onApplyTasks, theme, color }) {
  const { user } = useAuth()
  const [phase, setPhase] = useState('choice')
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState({})
  const [multiSel, setMultiSel] = useState([])
  const [textVal, setTextVal] = useState('')
  const [adviceText, setAdviceText] = useState('')

  const survey = getSurvey(routineName)
  const hasExisting = (existingTasks?.length ?? 0) > 0
  const currentQ = survey[step]
  const totalSteps = survey.length

  useEffect(() => {
    if (visible) {
      setPhase(hasExisting ? 'choice' : 'survey')
      setStep(0)
      setAnswers({})
      setMultiSel([])
      setTextVal('')
      setAdviceText('')
    }
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  function goToSurvey() {
    setStep(0)
    setAnswers({})
    setMultiSel([])
    setTextVal('')
    setPhase('survey')
  }

  function advance(value) {
    const newAnswers = { ...answers, [step]: value }
    setAnswers(newAnswers)
    if (step < totalSteps - 1) {
      setStep(s => s + 1)
      setMultiSel([])
      setTextVal('')
    } else {
      submitCreate(newAnswers)
    }
  }

  function goBack() {
    if (step > 0) {
      setStep(s => s - 1)
      setMultiSel([])
      setTextVal('')
    }
  }

  async function submitCreate(finalAnswers) {
    setPhase('loading')
    const surveyQA = survey.map((q, i) => ({ q: q.q, answer: String(finalAnswers[i] ?? 'not specified') }))
    try {
      const { data, error } = await supabase.functions.invoke('openai-proxy', {
        body: { action: 'create_routine', routineName, surveyQA },
      })
      if (error) throw new Error(error.message ?? 'Request failed')
      if (data?.error === 'daily_limit') {
        setPhase('survey')
        Alert.alert('Daily limit reached', data.reason)
        return
      }
      if (data?.error === 'flagged') {
        setPhase('survey')
        Alert.alert('Inappropriate content', 'Your input contains harmful content. Please keep your routine goals safe and healthy.')
        return
      }
      const tasks = data?.tasks ?? []
      if (!tasks.length) throw new Error('No tasks were generated')
      onApplyTasks(tasks)
      onClose()
    } catch (e) {
      setPhase('survey')
      Alert.alert('Something went wrong', e.message ?? 'Please try again.')
    }
  }

  async function getAdvice() {
    setPhase('loading')
    const tasks = (existingTasks ?? []).map(t => ({ text: t.text }))
    try {
      const { data, error } = await supabase.functions.invoke('openai-proxy', {
        body: { action: 'advise_routine', routineName, tasks },
      })
      if (error) throw new Error(error.message ?? 'Request failed')
      if (data?.error === 'daily_limit') {
        setPhase('choice')
        Alert.alert('Daily limit reached', data.reason)
        return
      }
      const advice = data?.advice?.trim()
      if (!advice) throw new Error('No response received')
      setAdviceText(advice)
      setPhase('advice')
    } catch (e) {
      setPhase('choice')
      Alert.alert('Something went wrong', e.message ?? 'Please try again.')
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={m.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={m.bg} onPress={onClose} />
        <View style={[m.sheet, { backgroundColor: theme.card }]}>
          <Pressable onPress={onClose} hitSlop={16}>
            <View style={[m.handle, { backgroundColor: theme.divider }]} />
          </Pressable>

          {/* ── Choice ── */}
          {phase === 'choice' && (
            <View>
              <Text style={[m.title, { color: theme.text }]}>✦ AI Routine Helper</Text>
              <Text style={[m.sub, { color: theme.subtext, marginBottom: 20 }]}>
                You have {existingTasks?.length ?? 0} task{(existingTasks?.length ?? 0) !== 1 ? 's' : ''} in your {routineName} routine.
              </Text>

              <Pressable style={[m.optCard, { borderColor: color + '55', backgroundColor: color + '0d' }]} onPress={getAdvice}>
                <Text style={{ fontSize: 22 }}>💡</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[m.optTitle, { color: theme.text }]}>Advise on this routine</Text>
                  <Text style={[m.optSub, { color: theme.subtext }]}>AI reviews your tasks and tells you what to keep, add, or change</Text>
                </View>
                <Text style={{ color, fontSize: 20, fontWeight: '300' }}>›</Text>
              </Pressable>

              <Pressable
                style={[m.optCard, { borderColor: theme.cardBorder, backgroundColor: theme.isDark ? '#1e1e38' : '#f8f7ff' }]}
                onPress={goToSurvey}
              >
                <Text style={{ fontSize: 22 }}>✨</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[m.optTitle, { color: theme.text }]}>Build me a new routine</Text>
                  <Text style={[m.optSub, { color: theme.subtext }]}>Answer a few questions and AI creates a personalized task list</Text>
                </View>
                <Text style={{ color: theme.muted, fontSize: 20, fontWeight: '300' }}>›</Text>
              </Pressable>
            </View>
          )}

          {/* ── Survey ── */}
          {phase === 'survey' && currentQ && (
            <View>
              <View style={m.progressRow}>
                <Text style={[m.progressLabel, { color: theme.muted }]}>Question {step + 1} of {totalSteps}</Text>
                <View style={[m.progressTrack, { backgroundColor: theme.isDark ? '#28284a' : '#e5e7eb' }]}>
                  <View style={[m.progressFill, { width: `${((step + 1) / totalSteps) * 100}%`, backgroundColor: color }]} />
                </View>
              </View>

              <Text style={[m.question, { color: theme.text }]}>{currentQ.q}</Text>

              {currentQ.type === 'single' && (
                <View style={m.pillWrap}>
                  {currentQ.opts.map(opt => (
                    <Pressable
                      key={opt}
                      style={[m.pill, { borderColor: theme.cardBorder, backgroundColor: theme.isDark ? '#1e1e38' : '#f8f7ff' }]}
                      onPress={() => advance(opt)}
                    >
                      <Text style={[m.pillText, { color: theme.text }]}>{opt}</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {currentQ.type === 'multi' && (
                <>
                  <Text style={[m.hint, { color: theme.muted }]}>Select all that apply</Text>
                  <View style={m.pillWrap}>
                    {currentQ.opts.map(opt => {
                      const sel = multiSel.includes(opt)
                      return (
                        <Pressable
                          key={opt}
                          style={[m.pill, { borderColor: sel ? color : theme.cardBorder, backgroundColor: sel ? color : (theme.isDark ? '#1e1e38' : '#f8f7ff') }]}
                          onPress={() => setMultiSel(p => p.includes(opt) ? p.filter(o => o !== opt) : [...p, opt])}
                        >
                          <Text style={[m.pillText, { color: sel ? '#fff' : theme.text }]}>{opt}</Text>
                        </Pressable>
                      )
                    })}
                  </View>
                  <Pressable
                    style={[m.nextBtn, { backgroundColor: color }, multiSel.length === 0 && { opacity: 0.4 }]}
                    onPress={() => multiSel.length > 0 && advance(multiSel.join(', '))}
                  >
                    <Text style={m.nextBtnText}>Next →</Text>
                  </Pressable>
                </>
              )}

              {currentQ.type === 'text' && (
                <>
                  <TextInput
                    style={[m.textInput, { color: theme.text, borderColor: theme.cardBorder, backgroundColor: theme.isDark ? '#1e1e38' : '#f8f7ff' }]}
                    placeholder={currentQ.placeholder}
                    placeholderTextColor={theme.muted}
                    value={textVal}
                    onChangeText={setTextVal}
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                    maxLength={300}
                  />
                  <Pressable style={[m.nextBtn, { backgroundColor: color }]} onPress={() => advance(textVal.trim() || 'none')}>
                    <Text style={m.nextBtnText}>{currentQ.optional && !textVal.trim() ? 'Skip →' : 'Done →'}</Text>
                  </Pressable>
                </>
              )}

              {step > 0 && (
                <Pressable style={m.backLink} onPress={goBack}>
                  <Text style={[m.backLinkText, { color: theme.muted }]}>← Back</Text>
                </Pressable>
              )}
            </View>
          )}

          {/* ── Loading ── */}
          {phase === 'loading' && (
            <View style={m.loadingBlock}>
              <ActivityIndicator size="large" color={color} />
              <Text style={[m.loadingText, { color: theme.subtext }]}>AI is working on it…</Text>
            </View>
          )}

          {/* ── Advice ── */}
          {phase === 'advice' && (
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 440 }}>
              <Text style={[m.title, { color: theme.text }]}>AI Feedback</Text>
              <View style={[m.adviceBox, { backgroundColor: color + '0d', borderColor: color + '35' }]}>
                <Text style={{ fontSize: 18, marginBottom: 10 }}>💡</Text>
                <Text style={[m.adviceText, { color: theme.text }]}>{adviceText}</Text>
              </View>
              <Pressable style={[m.nextBtn, { backgroundColor: color, marginTop: 20 }]} onPress={onClose}>
                <Text style={m.nextBtnText}>Got it  ✓</Text>
              </Pressable>
            </ScrollView>
          )}

        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const m = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  bg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 10, paddingHorizontal: 22, paddingBottom: 44,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 20,
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  title: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, marginBottom: 6 },
  sub: { fontSize: 14, fontWeight: '500' },

  optCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 16, borderWidth: 1.5,
    paddingHorizontal: 16, paddingVertical: 14, marginBottom: 12,
  },
  optTitle: { fontSize: 15, fontWeight: '700', marginBottom: 3 },
  optSub: { fontSize: 13, lineHeight: 18 },

  progressRow: { marginBottom: 18 },
  progressLabel: { fontSize: 12, fontWeight: '600', marginBottom: 7 },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },

  question: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3, marginBottom: 18, lineHeight: 24 },
  hint: { fontSize: 12, fontWeight: '600', marginBottom: 10, marginTop: -6 },

  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
  pill: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22, borderWidth: 1.5 },
  pillText: { fontSize: 14, fontWeight: '600' },

  textInput: {
    borderRadius: 14, borderWidth: 1.5,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, fontWeight: '500', marginBottom: 14, minHeight: 80,
  },

  nextBtn: { borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  nextBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  backLink: { alignItems: 'center', paddingVertical: 14 },
  backLinkText: { fontSize: 14, fontWeight: '600' },

  loadingBlock: { paddingVertical: 48, alignItems: 'center', gap: 16 },
  loadingText: { fontSize: 15, fontWeight: '500' },

  adviceBox: { borderRadius: 16, borderWidth: 1, padding: 16 },
  adviceText: { fontSize: 14, lineHeight: 22, fontWeight: '500' },
})
