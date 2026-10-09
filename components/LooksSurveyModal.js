import { useState } from 'react'
import { Modal, View, Text, Pressable, ScrollView, StyleSheet, Animated } from 'react-native'
import { useSheetDrag } from '../lib/useSheetDrag'
import { useTheme } from '../lib/ThemeContext'

const ACCENT = '#ec4899'

const QUESTIONS = [
  {
    key: 'skinType',
    question: "What's your skin type?",
    options: [
      { value: 'oily',    label: 'Oily',        sub: 'Shiny by midday, prone to breakouts' },
      { value: 'dry',     label: 'Dry',         sub: 'Feels tight, can be flaky' },
      { value: 'combo',   label: 'Combination', sub: 'Oily T-zone, dry cheeks' },
      { value: 'normal',  label: 'Normal',      sub: 'Balanced, rarely a problem' },
      { value: 'unknown', label: "I don't know", sub: '' },
    ],
  },
  {
    key: 'concern',
    question: 'Main skin concern?',
    options: [
      { value: 'acne',         label: 'Acne / Breakouts',        sub: '' },
      { value: 'dryness',      label: 'Dryness / Dehydration',   sub: '' },
      { value: 'uneven_tone',  label: 'Uneven tone / Dark spots', sub: '' },
      { value: 'aging',        label: 'Fine lines / Aging',       sub: '' },
      { value: 'none',         label: "I don't know / None",      sub: '' },
    ],
  },
  {
    key: 'timeMinutes',
    question: 'How much time in the morning?',
    options: [
      { value: 'under5',  label: 'Under 5 minutes', sub: 'Quick and minimal' },
      { value: '5to10',   label: '5–10 minutes',    sub: 'Room for a few steps' },
      { value: '10to20',  label: '10–20 minutes',   sub: 'Full routine' },
      { value: 'unknown', label: "I don't know",    sub: 'Give me a balanced routine' },
    ],
  },
  {
    key: 'hair',
    question: 'Do you style your hair?',
    options: [
      { value: 'long',    label: 'Yes — needs styling',     sub: 'Long, wavy, or takes effort' },
      { value: 'short',   label: 'Short / low maintenance', sub: 'Just a quick fix' },
      { value: 'none',    label: 'No hair routine needed',  sub: '' },
      { value: 'unknown', label: "I don't know",            sub: '' },
    ],
  },
]

function buildTasks({ skinType, concern, timeMinutes, hair }) {
  const tasks = []
  let id = 1

  const quick = timeMinutes === 'under5'
  const hasMoreTime = timeMinutes === '10to20'

  tasks.push({ id: id++, text: 'Brush teeth', subTasks: [] })
  tasks.push({ id: id++, text: 'Wash face', subTasks: [] })

  if ((skinType === 'oily' || skinType === 'combo') && !quick) {
    tasks.push({ id: id++, text: 'Apply toner', subTasks: [] })
  }

  if (hasMoreTime) {
    if (concern === 'acne')        tasks.push({ id: id++, text: 'Apply spot treatment', subTasks: [] })
    if (concern === 'dryness')     tasks.push({ id: id++, text: 'Apply hydrating serum', subTasks: [] })
    if (concern === 'uneven_tone') tasks.push({ id: id++, text: 'Apply vitamin C serum', subTasks: [] })
    if (concern === 'aging')       tasks.push({ id: id++, text: 'Apply eye cream', subTasks: [] })
  }

  tasks.push({ id: id++, text: 'Moisturize', subTasks: [] })

  if (!quick) {
    tasks.push({ id: id++, text: 'Apply SPF', subTasks: [] })
  }

  if (hair === 'long')  tasks.push({ id: id++, text: 'Style hair', subTasks: [] })
  if (hair === 'short') tasks.push({ id: id++, text: 'Quick hair fix', subTasks: [] })

  return tasks
}

export default function LooksSurveyModal({ visible, onClose, onComplete }) {
  const { theme } = useTheme()
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState({})

  const q = QUESTIONS[step]
  const selected = answers[q.key]
  const isLast = step === QUESTIONS.length - 1

  function select(value) {
    setAnswers(prev => ({ ...prev, [q.key]: value }))
  }

  function next() {
    if (!selected) return
    if (!isLast) {
      setStep(s => s + 1)
    } else {
      finish(answers)
    }
  }

  function finish(ans) {
    const tasks = buildTasks({
      skinType:    ans.skinType    ?? 'unknown',
      concern:     ans.concern     ?? 'none',
      timeMinutes: ans.timeMinutes ?? 'unknown',
      hair:        ans.hair        ?? 'none',
    })
    onComplete(tasks)
    setStep(0)
    setAnswers({})
  }

  function skip() {
    finish({})
  }

  const drag = useSheetDrag(onClose, { visible })

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={drag.close}>
      <View style={ls.overlay}>
        <Animated.View pointerEvents="none" style={[ls.bg, { opacity: drag.backdrop }]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={drag.close} />
        <Animated.View style={[ls.sheet, { backgroundColor: theme.card, transform: [{ translateY: drag.dragY }] }]}>
          <View {...drag.handlePan.panHandlers} style={drag.grabStyle}>
            <View style={[ls.handle, { backgroundColor: theme.divider }]} />
          </View>

          <View style={ls.progressRow}>
            {QUESTIONS.map((_, i) => (
              <View
                key={i}
                style={[ls.dot, { backgroundColor: i <= step ? ACCENT : theme.isDark ? '#3a3a5c' : '#e5e7eb' }]}
              />
            ))}
          </View>

          <Text style={[ls.stepLabel, { color: theme.muted }]}>
            LOOKS SURVEY  {step + 1}/{QUESTIONS.length}
          </Text>
          <Text style={[ls.question, { color: theme.text }]}>{q.question}</Text>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 310 }}>
            {q.options.map(opt => (
              <Pressable
                key={opt.value}
                style={[ls.option, {
                  backgroundColor: selected === opt.value ? ACCENT + '14' : theme.isDark ? '#1e1e38' : '#fafafa',
                  borderColor: selected === opt.value ? ACCENT : theme.cardBorder,
                  borderWidth: selected === opt.value ? 2 : 1,
                }]}
                onPress={() => select(opt.value)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[ls.optLabel, { color: theme.text }]}>{opt.label}</Text>
                  {opt.sub ? <Text style={[ls.optSub, { color: theme.subtext }]}>{opt.sub}</Text> : null}
                </View>
                <View style={[ls.radio, { borderColor: selected === opt.value ? ACCENT : theme.muted }]}>
                  {selected === opt.value && <View style={[ls.radioFill, { backgroundColor: ACCENT }]} />}
                </View>
              </Pressable>
            ))}
          </ScrollView>

          <Pressable
            style={[ls.nextBtn, { backgroundColor: selected ? ACCENT : theme.isDark ? '#2a2a3e' : '#e0e0f0' }]}
            onPress={next}
            disabled={!selected}
          >
            <Text style={[ls.nextBtnText, { color: selected ? '#fff' : theme.muted }]}>
              {isLast ? 'Build My Routine →' : 'Next →'}
            </Text>
          </Pressable>

          <Pressable style={ls.skipBtn} onPress={skip}>
            <Text style={[ls.skipText, { color: theme.muted }]}>Skip — use a basic routine</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  )
}

const ls = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  bg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 10, paddingHorizontal: 24, paddingBottom: 44,
    maxHeight: '85%',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 20,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    alignSelf: 'center', marginBottom: 20,
  },
  progressRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 20,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  stepLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 0.9, marginBottom: 8,
  },
  question: {
    fontSize: 22, fontWeight: '800', letterSpacing: -0.4, marginBottom: 18, lineHeight: 28,
  },
  option: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 10,
  },
  optLabel: { fontSize: 16, fontWeight: '600' },
  optSub:   { fontSize: 13, marginTop: 2, fontWeight: '400' },
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', marginLeft: 10,
  },
  radioFill: { width: 10, height: 10, borderRadius: 5 },
  nextBtn: {
    borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 16,
  },
  nextBtnText: { fontWeight: '800', fontSize: 16 },
  skipBtn: { alignItems: 'center', paddingTop: 14 },
  skipText: { fontSize: 14, fontWeight: '500' },
})
