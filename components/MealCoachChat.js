import { useState, useEffect, useRef } from 'react'
import {
  Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  SafeAreaView, Keyboard, Platform, Dimensions, ActivityIndicator, Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

// Extra bottom padding so the keyboard never covers the message box. Both
// KeyboardAvoidingView and a measured layout come up short inside an iOS
// page-sheet modal, because positions are reported relative to the sheet,
// not the screen. The sheet's bottom IS the screen's bottom, so the keyboard
// height itself is the right amount, less the home-indicator inset the
// SafeAreaView already pads (the keyboard sits over that area).
function useKeyboardInset(active, safeBottom) {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    if (!active) { setInset(0); return }
    const screenH = Dimensions.get('window').height
    const onFrame = e => {
      const kb = e?.endCoordinates
      if (!kb) return
      // A frame at or below the screen bottom means the keyboard is gone.
      const hidden = typeof kb.screenY === 'number' && kb.screenY >= screenH - 1
      setInset(hidden ? 0 : Math.max(0, Math.round((kb.height || 0) - safeBottom)))
    }
    const onHide = () => setInset(0)
    const subs = Platform.OS === 'ios'
      ? [
          Keyboard.addListener('keyboardWillShow', onFrame),
          Keyboard.addListener('keyboardWillChangeFrame', onFrame),
          Keyboard.addListener('keyboardWillHide', onHide),
        ]
      : [Keyboard.addListener('keyboardDidShow', onFrame), Keyboard.addListener('keyboardDidHide', onHide)]
    return () => subs.forEach(s => s.remove())
  }, [active, safeBottom])
  return inset
}
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTheme } from '../lib/ThemeContext'
import { askMealCoach } from '../lib/aiMealPlan'
import { getUserGoals } from '../lib/goalsStorage'
import { getMealPlan } from '../lib/mealPlanStorage'
import { compactPlan, planMealCount, dayKeyOf, sumPlanMacros } from '../lib/mealPlan'
import { getMeals, getRecentNutritionSummary, getRecentLoggedMeals, today } from '../lib/storage'
import { derivedSource } from '../lib/foodSource'

// The meal coach: a chat about the user's plan and what they eat. Every
// message goes to the proxy with fresh context (targets, the weekly plan,
// today's log, the last seven days), so the coach always answers from the
// current numbers. The conversation is kept on this device.

const STARTERS = [
  'Is my plan good?',
  'Am I hitting my targets?',
  'What should I add next?',
  'How healthy is this week?',
  'What am I missing?',
]
const MAX_KEPT = 30
const storageKey = uid => `@meal_coach_${uid}`
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2)

export default function MealCoachChat({ visible, onClose, userId }) {
  const { theme } = useTheme()
  const [messages, setMessages] = useState([])   // { id, role, content }
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // The numbers the coach is answering from, shown above the thread so a
  // reply can be checked against them: { logged, planned, target, dayKey }
  const [snapshot, setSnapshot] = useState(null)
  const scrollRef = useRef(null)
  const insets = useSafeAreaInsets()
  const keyboardInset = useKeyboardInset(visible, insets.bottom)
  // Bumped when the sheet closes so a reply to an abandoned question is ignored.
  const runRef = useRef(0)

  useEffect(() => {
    if (!visible) { runRef.current++; return }
    setBusy(false)
    AsyncStorage.getItem(storageKey(userId))
      .then(raw => {
        try {
          const list = raw ? JSON.parse(raw) : []
          setMessages(Array.isArray(list) ? list : [])
        } catch { setMessages([]) }
      })
      .catch(() => setMessages([]))
    const run = runRef.current
    gatherContext().then(ctx => { if (run === runRef.current) setSnapshot(summarize(ctx)) }).catch(() => {})
  }, [visible, userId])   // eslint-disable-line react-hooks/exhaustive-deps

  // Today's logged calories, today's planned calories and the target, from
  // the same context the coach gets.
  function summarize(ctx) {
    const dayKey = dayKeyOf(today())
    const logged = Math.round(sumPlanMacros(ctx.today?.meals ?? []).calories || 0)
    let planned = null
    if (ctx.plan) {
      const byId = new Map(ctx.plan.meals.map(m => [m.id, m]))
      const ids = ctx.plan.days.find(d => d.day === dayKey)?.mealIds ?? []
      const meals = ids.map(id => byId.get(id)).filter(Boolean)
      planned = meals.length ? Math.round(sumPlanMacros(meals).calories || 0) : null
    }
    return { logged, planned, target: ctx.goals?.calories || null, dayKey }
  }

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60)
    return () => clearTimeout(t)
  }, [messages, busy, keyboardInset])

  const persist = list => AsyncStorage.setItem(storageKey(userId), JSON.stringify(list.slice(-MAX_KEPT))).catch(() => {})

  // Fresh numbers for every question. A source that fails is left out
  // rather than blocking the answer.
  async function gatherContext() {
    const todayStr = today()
    const [goals, plan, todayMeals, week, recentDays] = await Promise.all([
      getUserGoals(userId).catch(() => null),
      getMealPlan(userId).catch(() => null),
      getMeals(userId, todayStr).catch(() => []),
      getRecentNutritionSummary(userId).catch(() => []),
      getRecentLoggedMeals(userId).catch(() => []),
    ])
    // Every food goes across with everything tracked for it, so the coach can
    // answer about one specific food (its potassium, say), not just the day.
    const food = m => ({ name: m.name, section: m.section, contents: m.contents ?? '', macros: m.macros ?? {}, source: derivedSource(m) })
    return {
      goals,
      plan: plan && planMealCount(plan.days) > 0 ? compactPlan(plan) : null,
      today: {
        date: todayStr,
        meals: (todayMeals ?? []).map(food),
      },
      week,
      // Earlier days this week, per food. Today is sent above.
      recent: (recentDays ?? [])
        .filter(d => d.date !== todayStr && d.meals?.length)
        .map(d => ({ date: d.date, meals: d.meals.map(food) })),
    }
  }

  async function send(text) {
    const content = String(text ?? input).trim()
    if (!content || busy) return
    const run = ++runRef.current
    const withQuestion = [...messages, { id: newId(), role: 'user', content }]
    setMessages(withQuestion)
    setInput('')
    setBusy(true)
    try {
      const ctx = await gatherContext()
      setSnapshot(summarize(ctx))
      const { reply } = await askMealCoach({
        ...ctx,
        messages: withQuestion.slice(-12).map(m => ({ role: m.role, content: m.content })),
      })
      if (run !== runRef.current) return
      const done = [...withQuestion, { id: newId(), role: 'assistant', content: String(reply ?? '').trim() }]
      setMessages(done)
      persist(done)
    } catch (e) {
      if (run !== runRef.current) return
      // The question goes back into the box so it is not lost.
      setMessages(messages)
      setInput(content)
      Alert.alert('The coach could not answer', e?.message ?? 'Please try again.')
    } finally {
      if (run === runRef.current) setBusy(false)
    }
  }

  function clearChat() {
    Alert.alert('Clear this conversation?', 'The coach will start fresh.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => {
        setMessages([])
        AsyncStorage.removeItem(storageKey(userId)).catch(() => {})
      } },
    ])
  }

  const canSend = input.trim().length > 0 && !busy

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[c.page, { backgroundColor: theme.bg }]}>
        <View style={{ flex: 1, paddingBottom: keyboardInset }}>
          <View style={[c.header, { backgroundColor: theme.header, borderBottomColor: theme.divider }]}>
            <Pressable onPress={onClose} hitSlop={10} style={c.headerSide}>
              <Text style={[c.headerBtn, { color: theme.accent }]}>Done</Text>
            </Pressable>
            <Text style={[c.headerTitle, { color: theme.text }]}>✦ Meal Coach</Text>
            <Pressable onPress={clearChat} hitSlop={10} style={[c.headerSide, { alignItems: 'flex-end' }]} disabled={!messages.length}>
              <Text style={[c.headerBtn, { color: messages.length ? theme.muted : 'transparent' }]}>Clear</Text>
            </Pressable>
          </View>

          {snapshot && (
            <View style={[c.snapshot, { backgroundColor: theme.header, borderBottomColor: theme.divider }]}>
              <Text style={[c.snapshotLabel, { color: theme.muted }]}>THE COACH SEES</Text>
              <View style={c.snapshotRow}>
                <Text style={[c.snapshotItem, { color: theme.text }]}>
                  Logged today <Text style={c.snapshotNum}>{snapshot.logged.toLocaleString()}</Text> kcal
                </Text>
                <Text style={[c.snapshotItem, { color: theme.text }]}>
                  Plan ({snapshot.dayKey}) <Text style={c.snapshotNum}>{snapshot.planned == null ? 'none' : snapshot.planned.toLocaleString()}</Text>{snapshot.planned == null ? '' : ' kcal'}
                </Text>
                <Text style={[c.snapshotItem, { color: theme.text }]}>
                  Target <Text style={c.snapshotNum}>{snapshot.target ? snapshot.target.toLocaleString() : 'not set'}</Text>{snapshot.target ? ' kcal' : ''}
                </Text>
              </View>
            </View>
          )}

          <ScrollView
            ref={scrollRef}
            contentContainerStyle={c.thread}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {messages.length === 0 && (
              <View style={[c.intro, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
                <Text style={c.introIcon}>✦</Text>
                <Text style={[c.introTitle, { color: theme.text }]}>Ask me about your meals</Text>
                <Text style={[c.introText, { color: theme.subtext }]}>
                  I can see your targets, your weekly plan, what you logged today and your last seven days.
                  Ask whether the plan is good, what you are missing, what to add next, or run an idea past me.
                </Text>
              </View>
            )}

            {messages.map(m => (
              <View
                key={m.id}
                style={[
                  c.bubble,
                  m.role === 'user'
                    ? [c.userBubble, { backgroundColor: theme.accent }]
                    : [c.coachBubble, { backgroundColor: theme.card, borderColor: theme.cardBorder }],
                ]}
              >
                <Text style={[c.bubbleText, { color: m.role === 'user' ? '#fff' : theme.text }]}>{m.content}</Text>
              </View>
            ))}

            {busy && (
              <View style={[c.bubble, c.coachBubble, c.thinking, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
                <ActivityIndicator size="small" color={theme.accent} />
                <Text style={[c.thinkingText, { color: theme.subtext }]}>Looking at your numbers…</Text>
              </View>
            )}

            {(messages.length === 0 || messages[messages.length - 1].role === 'assistant') && !busy && (
              <View style={c.starters}>
                {STARTERS.map(q => (
                  <Pressable
                    key={q}
                    style={[c.starter, { borderColor: theme.accent + '55', backgroundColor: theme.accent + '12' }]}
                    onPress={() => send(q)}
                  >
                    <Text style={[c.starterText, { color: theme.accent }]}>{q}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <View style={{ height: 8 }} />
          </ScrollView>

          <View style={[c.inputBar, { backgroundColor: theme.header, borderTopColor: theme.divider }]}>
            <TextInput
              style={[c.input, { color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder }]}
              placeholder="Ask about your plan or what you ate…"
              placeholderTextColor={theme.muted}
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={1500}
              editable={!busy}
            />
            <Pressable
              style={[c.sendBtn, { backgroundColor: canSend ? theme.accent : theme.divider }]}
              onPress={() => send()}
              disabled={!canSend}
              hitSlop={6}
            >
              <Text style={[c.sendText, { color: canSend ? '#fff' : theme.muted }]}>↑</Text>
            </Pressable>
          </View>
          <Text style={[c.disclaimer, { color: theme.muted, backgroundColor: theme.header }]}>
            General guidance, not medical advice. For a condition or supplements, ask a doctor or dietitian.
          </Text>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const c = StyleSheet.create({
  page: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1,
  },
  headerSide: { width: 56 },
  headerBtn: { fontSize: 16, fontWeight: '600' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },

  snapshot: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, borderBottomWidth: 1 },
  snapshotLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1, marginBottom: 4 },
  snapshotRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 2 },
  snapshotItem: { fontSize: 12.5, fontWeight: '600' },
  snapshotNum: { fontWeight: '800', fontVariant: ['tabular-nums'] },
  thread: { padding: 16, paddingBottom: 12, gap: 10 },
  intro: { borderRadius: 20, borderWidth: 1, padding: 20, alignItems: 'center', marginBottom: 6 },
  introIcon: { fontSize: 26, color: '#10b981', marginBottom: 8 },
  introTitle: { fontSize: 18, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  introText: { fontSize: 14, lineHeight: 20, fontWeight: '500', textAlign: 'center' },

  bubble: { maxWidth: '86%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  userBubble: { alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  coachBubble: { alignSelf: 'flex-start', borderBottomLeftRadius: 6, borderWidth: 1 },
  bubbleText: { fontSize: 15, lineHeight: 21, fontWeight: '500' },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  thinkingText: { fontSize: 13.5, fontWeight: '600' },

  starters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  starter: { borderRadius: 18, borderWidth: 1.5, paddingHorizontal: 13, paddingVertical: 8 },
  starterText: { fontSize: 13.5, fontWeight: '700' },

  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 14, paddingTop: 10, borderTopWidth: 1 },
  input: {
    flex: 1, borderWidth: 1.5, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, fontWeight: '500', maxHeight: 120,
  },
  sendBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  sendText: { fontSize: 20, fontWeight: '800' },
  disclaimer: { fontSize: 11, lineHeight: 15, fontWeight: '500', textAlign: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 },
})
