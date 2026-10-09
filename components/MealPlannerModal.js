import { useState, useEffect, useRef } from 'react'
import {
  View, Text, Pressable, StyleSheet, Modal, ScrollView, TextInput,
  ActivityIndicator, Alert, Platform, KeyboardAvoidingView, Animated,
} from 'react-native'
import { useSheetDrag } from '../lib/useSheetDrag'
import { useTheme } from '../lib/ThemeContext'
import { generateMealPlan, reviseMealPlan } from '../lib/aiMealPlan'
import { expandAiPlan, compactPlan, sumPlanMacros, PLAN_DAYS } from '../lib/mealPlan'
import { getMealPlanPrefs, saveMealPlanPrefs } from '../lib/mealPlanStorage'

// The AI meal planner: reads the user's targets, asks about restrictions,
// time, kitchen and preferences, then builds a week they can review, ask to
// change, and add to the Plan tab.

const ACCENT = '#10b981'

const SURVEY = [
  { key: 'style', type: 'single', q: 'How do you eat?',
    opts: ['Omnivore', 'Vegetarian', 'Vegan', 'Pescatarian', 'Halal', 'Kosher', 'Mostly plant-based'] },
  { key: 'allergies', type: 'multi', q: 'Any allergies or intolerances?',
    opts: ['None', 'Dairy / lactose', 'Gluten', 'Tree nuts', 'Peanuts', 'Eggs', 'Soy', 'Shellfish', 'Sesame'], none: 'None' },
  { key: 'dislikes', type: 'text', q: 'Foods you never want to see?',
    placeholder: 'e.g. mushrooms, cilantro, tofu… (optional)', optional: true },
  { key: 'time', type: 'single', q: 'Cooking time on a typical weekday?',
    opts: ['Under 15 min', '15 to 30 min', '30 to 45 min', '45 min or more'] },
  { key: 'prep', type: 'single', q: 'How do you like to prep?',
    opts: ['Batch cook 1 or 2 days a week', 'Cook a little each day', 'Mostly no-cook, quick assembly', 'A mix'] },
  { key: 'kitchen', type: 'single', q: 'What kitchen do you have?',
    opts: ['Full kitchen', 'Stove and microwave only', 'Microwave only (dorm)', 'Mostly campus food or eating out'] },
  { key: 'budget', type: 'single', q: 'Grocery budget?', opts: ['Tight', 'Moderate', 'Flexible'] },
  { key: 'mealsPerDay', type: 'single', q: 'How many meals a day?',
    opts: ['3 meals', '3 meals + snacks', '2 bigger meals + a snack', '4 or more small meals'] },
  { key: 'variety', type: 'single', q: 'Same meals or variety?',
    opts: ['Repeat meals, keep it simple', 'Some variety', 'Different every day'] },
  { key: 'health', type: 'text', q: 'Anything else for your health?',
    placeholder: 'Supplements you take, conditions, training days, foods you love… (optional)', optional: true },
]

const LOADING_LINES = [
  'Reading your targets…',
  'Balancing protein, carbs and fat…',
  'Checking vitamins and minerals…',
  'Fitting meals to your time and kitchen…',
  'Writing the prep plan and grocery list…',
  'Almost there, this takes a minute…',
]

const SECTION_META = {
  morning: { label: 'Morning', emoji: '🌅', color: '#f97316' },
  lunch:   { label: 'Lunch',   emoji: '☀️',  color: '#10b981' },
  dinner:  { label: 'Dinner',  emoji: '🌙',  color: '#6366f1' },
  snacks:  { label: 'Snacks',  emoji: '🍎',  color: '#ec4899' },
}

const REVISE_HINTS = ['Less dairy', 'More variety', 'Cheaper', 'Faster breakfasts', 'More protein', 'Swap the dinners']

const DISCLAIMER =
  'Made by AI from what you shared. It is general guidance, not medical advice. ' +
  'For supplements, a health condition or symptoms that persist, speak to a doctor or registered dietitian.'

function fmtNum(v) {
  const n = Number(v) || 0
  return n % 1 === 0 ? String(Math.round(n)) : n.toFixed(1)
}

// Within 10% of the target reads as on track.
function fitColor(actual, goal) {
  if (!goal) return null
  const r = actual / goal
  if (r >= 0.9 && r <= 1.1) return '#10b981'
  if (r >= 0.8 && r <= 1.2) return '#f59e0b'
  return '#ef4444'
}

export default function MealPlannerModal({ visible, onClose, userId, goals, onApply }) {
  const { theme } = useTheme()
  const [phase, setPhase] = useState('intro')      // intro | survey | loading | review | revise
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState({})
  const [prefs, setPrefs] = useState(null)         // last answers, from this device
  const [multiSel, setMultiSel] = useState([])
  const [textVal, setTextVal] = useState('')
  const [result, setResult] = useState(null)       // the proxy's reply
  const [week, setWeek] = useState(null)           // expandAiPlan(result)
  const [openDays, setOpenDays] = useState({})
  const [groceryOpen, setGroceryOpen] = useState(false)
  const [request, setRequest] = useState('')
  const [loadingLine, setLoadingLine] = useState(0)
  // Bumped when the sheet closes so a reply from a run the user abandoned is ignored.
  const runRef = useRef(0)
  // The request in flight, cancelled when the sheet closes or unmounts.
  const abortRef = useRef(null)

  const currentQ = SURVEY[step]

  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    if (!visible) { runRef.current++; abortRef.current?.abort(); return }
    setPhase('intro')
    setStep(0)
    setAnswers({})
    setMultiSel([])
    setTextVal('')
    setResult(null)
    setWeek(null)
    setOpenDays({})
    setGroceryOpen(false)
    setRequest('')
    getMealPlanPrefs(userId).then(p => setPrefs(p && typeof p === 'object' ? p : null))
  }, [visible, userId])

  useEffect(() => {
    if (phase !== 'loading') return
    setLoadingLine(0)
    const id = setInterval(() => setLoadingLine(i => Math.min(i + 1, LOADING_LINES.length - 1)), 5000)
    return () => clearInterval(id)
  }, [phase])

  function startSurvey(fromPrefs) {
    setStep(0)
    setAnswers(fromPrefs && prefs ? { ...prefs } : {})
    setMultiSel([])
    setTextVal('')
    setPhase('survey')
  }

  // Multi and text steps keep their previous answer on screen when the user
  // steps back, or when the survey was pre-filled from last time.
  useEffect(() => {
    if (phase !== 'survey' || !currentQ) return
    const prev = answers[currentQ.key]
    if (currentQ.type === 'multi') setMultiSel(prev ? String(prev).split(', ').filter(Boolean) : [])
    if (currentQ.type === 'text') setTextVal(prev && prev !== 'none' ? String(prev) : '')
  }, [phase, step])   // eslint-disable-line react-hooks/exhaustive-deps

  function advance(value) {
    const next = { ...answers, [currentQ.key]: value }
    setAnswers(next)
    if (step < SURVEY.length - 1) setStep(s => s + 1)
    else submit(next)
  }

  function goBack() {
    if (step > 0) setStep(s => s - 1)
    else setPhase('intro')
  }

  function toggleMulti(opt) {
    setMultiSel(prev => {
      if (currentQ.none && opt === currentQ.none) return [opt]
      const without = prev.filter(o => o !== opt && o !== currentQ.none)
      return prev.includes(opt) ? without : [...without, opt]
    })
  }

  const toQA = ans => SURVEY.map(q => ({ q: q.q, a: String(ans[q.key] ?? 'not specified') }))

  async function submit(finalAnswers) {
    const run = ++runRef.current
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPhase('loading')
    try {
      const data = await generateMealPlan({ goals, answers: toQA(finalAnswers) }, { signal: ctrl.signal })
      if (run !== runRef.current) return
      saveMealPlanPrefs(userId, finalAnswers)
      setPrefs(finalAnswers)
      showResult(data)
    } catch (e) {
      // Cancelled because the sheet went away: nothing to tell anyone.
      if (run !== runRef.current || e?.name === 'AbortError') return
      setPhase('survey')
      setStep(SURVEY.length - 1)
      Alert.alert('Could not build a plan', e.message ?? 'Please try again.')
    }
  }

  async function submitRevision() {
    const text = request.trim()
    if (!text || !result) return
    const run = ++runRef.current
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPhase('loading')
    try {
      const data = await reviseMealPlan({
        goals, answers: toQA(answers), plan: compactPlan(week), request: text,
      }, { signal: ctrl.signal })
      if (run !== runRef.current) return
      setRequest('')
      showResult(data)
    } catch (e) {
      if (run !== runRef.current || e?.name === 'AbortError') return
      setPhase('revise')
      Alert.alert('Could not update the plan', e.message ?? 'Please try again.')
    }
  }

  function showResult(data) {
    const expanded = expandAiPlan(data)
    const count = PLAN_DAYS.reduce((n, d) => n + expanded.days[d].length, 0)
    if (!count) throw new Error('The planner came back empty. Please try again.')
    setResult(data)
    setWeek(expanded)
    setOpenDays({ [PLAN_DAYS[0]]: true })
    setPhase('review')
  }

  function apply() {
    if (!week) return
    onApply(week)
  }

  // A week being built has already used one of today's plans. A stray tap on
  // the backdrop can't throw it away, and a pull or the back button asks
  // first (the sheet springs back if the user keeps waiting).
  function requestClose() {
    if (phase !== 'loading') { onClose(); return }
    Alert.alert('Stop building the plan?', "It still counts toward today's meal plan limit.", [
      { text: 'Keep waiting', style: 'cancel' },
      { text: 'Stop', style: 'destructive', onPress: onClose },
    ])
  }

  const drag = useSheetDrag(requestClose, { visible })
  const hasGoals = goals?.calories > 0
  const canGoBack = phase === 'survey'

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={drag.close}>
      <KeyboardAvoidingView style={m.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View pointerEvents="none" style={[m.bg, { opacity: drag.backdrop }]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={drag.close} disabled={phase === 'loading'} />
        <Animated.View style={[m.sheet, { backgroundColor: theme.card, transform: [{ translateY: drag.dragY }] }]}>
          <View {...drag.handlePan.panHandlers} style={[m.grab, drag.grabStyle]}>
            <View style={[m.handle, { backgroundColor: theme.divider }]} />
            <View style={m.headerRow}>
              {canGoBack ? (
                <Pressable onPress={goBack} hitSlop={10} style={m.headerBtn}>
                  <Text style={[m.headerBtnText, { color: theme.accent }]}>‹ Back</Text>
                </Pressable>
              ) : <View style={m.headerBtn} />}
              <Text style={[m.headerTitle, { color: theme.text }]}>✦ AI Meal Planner</Text>
              <View style={m.headerBtn} />
            </View>
          </View>

          <View {...drag.bodyPan.panHandlers} style={{ flexShrink: 1 }}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces={false}
            scrollEventThrottle={16}
            onScroll={drag.onScroll}
            contentContainerStyle={{ paddingBottom: 8 }}
          >

            {/* ── Intro: the targets the plan will be built around ── */}
            {phase === 'intro' && (
              <View>
                <Text style={[m.lead, { color: theme.subtext }]}>
                  A week of meals built around your targets and how you actually eat, cook and shop.
                  It repeats every week until you change it, and you review it before anything is added.
                </Text>

                <View style={[m.goalsCard, { backgroundColor: theme.input, borderColor: theme.inputBorder }]}>
                  <Text style={[m.goalsTitle, { color: theme.muted }]}>YOUR DAILY TARGETS</Text>
                  {hasGoals ? (
                    <View style={m.goalsRow}>
                      {[
                        { label: 'kcal',    val: goals.calories, color: theme.text },
                        { label: 'protein', val: `${goals.protein}g`, color: '#ef4444' },
                        { label: 'carbs',   val: `${goals.carbs}g`, color: '#f59e0b' },
                        { label: 'fat',     val: `${goals.fat}g`, color: '#3b82f6' },
                      ].map(g => (
                        <View key={g.label} style={m.goalBox}>
                          <Text style={[m.goalVal, { color: g.color }]}>{g.val}</Text>
                          <Text style={[m.goalLabel, { color: theme.muted }]}>{g.label}</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={[m.goalsEmpty, { color: theme.subtext }]}>
                      No targets set yet. The planner will estimate maintenance for you. Set your goals in Settings for a closer fit.
                    </Text>
                  )}
                </View>

                <Text style={[m.stepsText, { color: theme.subtext }]}>
                  Next: {SURVEY.length} quick questions on restrictions, cooking time, meal prep, kitchen, budget and variety.
                </Text>

                <Pressable style={[m.primaryBtn, { backgroundColor: ACCENT }]} onPress={() => startSurvey(false)}>
                  <Text style={m.primaryBtnText}>Answer the questions →</Text>
                </Pressable>
                {prefs && (
                  <Pressable style={[m.secondaryBtn, { borderColor: theme.cardBorder }]} onPress={() => startSurvey(true)}>
                    <Text style={[m.secondaryBtnText, { color: theme.text }]}>Start from my last answers</Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* ── Survey ── */}
            {phase === 'survey' && currentQ && (
              <View>
                <View style={m.progressRow}>
                  <Text style={[m.progressLabel, { color: theme.muted }]}>Question {step + 1} of {SURVEY.length}</Text>
                  <View style={[m.progressTrack, { backgroundColor: theme.isDark ? '#28284a' : '#e5e7eb' }]}>
                    <View style={[m.progressFill, { width: `${((step + 1) / SURVEY.length) * 100}%`, backgroundColor: ACCENT }]} />
                  </View>
                </View>

                <Text style={[m.question, { color: theme.text }]}>{currentQ.q}</Text>

                {currentQ.type === 'single' && (
                  <View style={m.pillWrap}>
                    {currentQ.opts.map(opt => {
                      const sel = answers[currentQ.key] === opt
                      return (
                        <Pressable
                          key={opt}
                          style={[m.pill, {
                            borderColor: sel ? ACCENT : theme.cardBorder,
                            backgroundColor: sel ? ACCENT + '1a' : (theme.isDark ? '#1e1e38' : '#f8f7ff'),
                          }]}
                          onPress={() => advance(opt)}
                        >
                          <Text style={[m.pillText, { color: theme.text }]}>{opt}</Text>
                        </Pressable>
                      )
                    })}
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
                            style={[m.pill, {
                              borderColor: sel ? ACCENT : theme.cardBorder,
                              backgroundColor: sel ? ACCENT : (theme.isDark ? '#1e1e38' : '#f8f7ff'),
                            }]}
                            onPress={() => toggleMulti(opt)}
                          >
                            <Text style={[m.pillText, { color: sel ? '#fff' : theme.text }]}>{opt}</Text>
                          </Pressable>
                        )
                      })}
                    </View>
                    <Pressable
                      style={[m.primaryBtn, { backgroundColor: ACCENT }, multiSel.length === 0 && { opacity: 0.4 }]}
                      onPress={() => multiSel.length > 0 && advance(multiSel.join(', '))}
                    >
                      <Text style={m.primaryBtnText}>Next →</Text>
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
                      textAlignVertical="top"
                      maxLength={300}
                    />
                    <Pressable style={[m.primaryBtn, { backgroundColor: ACCENT }]} onPress={() => advance(textVal.trim() || 'none')}>
                      <Text style={m.primaryBtnText}>
                        {step === SURVEY.length - 1
                          ? (textVal.trim() ? 'Build my week ✦' : 'Skip and build my week ✦')
                          : (currentQ.optional && !textVal.trim() ? 'Skip →' : 'Next →')}
                      </Text>
                    </Pressable>
                  </>
                )}
              </View>
            )}

            {/* ── Loading ── */}
            {phase === 'loading' && (
              <View style={m.loadingBlock}>
                <ActivityIndicator size="large" color={ACCENT} />
                <Text style={[m.loadingText, { color: theme.text }]}>{LOADING_LINES[loadingLine]}</Text>
                <Text style={[m.loadingSub, { color: theme.muted }]}>Planning a full week usually takes 30 to 90 seconds.</Text>
              </View>
            )}

            {/* ── Review ── */}
            {phase === 'review' && week && (
              <View>
                {!!week.notes.summary && (
                  <View style={[m.summaryBox, { backgroundColor: ACCENT + '12', borderColor: ACCENT + '40' }]}>
                    <Text style={[m.summaryText, { color: theme.text }]}>{week.notes.summary}</Text>
                  </View>
                )}

                <Text style={[m.sectionTitle, { color: theme.muted }]}>YOUR WEEK</Text>
                {PLAN_DAYS.map(day => {
                  const meals = week.days[day]
                  const totals = sumPlanMacros(meals)
                  const open = !!openDays[day]
                  const calColor = fitColor(totals.calories || 0, goals?.calories)
                  return (
                    <View key={day} style={[m.dayCard, { backgroundColor: theme.input, borderColor: theme.inputBorder }]}>
                      <Pressable style={m.dayHeader} onPress={() => setOpenDays(p => ({ ...p, [day]: !p[day] }))}>
                        <Text style={[m.dayName, { color: theme.text }]}>{day}</Text>
                        <Text style={[m.dayKcal, { color: calColor ?? theme.text }]}>
                          {Math.round(totals.calories || 0)}<Text style={[m.dayKcalUnit, { color: theme.muted }]}> kcal</Text>
                        </Text>
                        <Text style={[m.dayMacros, { color: theme.subtext }]}>
                          P {fmtNum(totals.protein)} · C {fmtNum(totals.carbs)} · F {fmtNum(totals.fat)}
                        </Text>
                        <Text style={[m.dayArrow, { color: theme.muted }]}>{open ? '▲' : '▼'}</Text>
                      </Pressable>
                      {open && (
                        <View style={m.dayMeals}>
                          {meals.length === 0 && (
                            <Text style={[m.dayEmpty, { color: theme.muted }]}>Nothing planned</Text>
                          )}
                          {meals.map(meal => {
                            const sec = SECTION_META[meal.section] ?? SECTION_META.snacks
                            return (
                              <View key={meal.id} style={[m.mealRow, { borderLeftColor: sec.color }]}>
                                <View style={{ flex: 1 }}>
                                  <Text style={[m.mealSection, { color: sec.color }]}>{sec.emoji} {sec.label.toUpperCase()}{meal.prepMinutes ? `  ·  ${meal.prepMinutes} min` : ''}</Text>
                                  <Text style={[m.mealName, { color: theme.text }]}>{meal.name}</Text>
                                  {!!meal.contents && <Text style={[m.mealContents, { color: theme.subtext }]}>{meal.contents}</Text>}
                                  {!!meal.prepNote && <Text style={[m.mealPrep, { color: theme.muted }]}>Prep: {meal.prepNote}</Text>}
                                </View>
                                <View style={m.mealCalBox}>
                                  <Text style={[m.mealCal, { color: sec.color }]}>{Math.round(meal.macros?.calories || 0)}</Text>
                                  <Text style={[m.mealCalUnit, { color: theme.muted }]}>kcal</Text>
                                  <Text style={[m.mealProtein, { color: theme.subtext }]}>{fmtNum(meal.macros?.protein)}g P</Text>
                                </View>
                              </View>
                            )
                          })}
                        </View>
                      )}
                    </View>
                  )
                })}

                {week.notes.nutrition.length > 0 && (
                  <>
                    <Text style={[m.sectionTitle, { color: theme.muted, marginTop: 18 }]}>NUTRITION CHECK</Text>
                    <View style={[m.noteBox, { backgroundColor: theme.input, borderColor: theme.inputBorder }]}>
                      {week.notes.nutrition.map((n, i) => (
                        <View key={i} style={m.noteRow}>
                          <Text style={[m.noteBullet, { color: ACCENT }]}>•</Text>
                          <Text style={[m.noteText, { color: theme.text }]}>{n}</Text>
                        </View>
                      ))}
                    </View>
                  </>
                )}

                {week.notes.prep.length > 0 && (
                  <>
                    <Text style={[m.sectionTitle, { color: theme.muted, marginTop: 18 }]}>MEAL PREP</Text>
                    <View style={[m.noteBox, { backgroundColor: theme.input, borderColor: theme.inputBorder }]}>
                      {week.notes.prep.map((n, i) => (
                        <View key={i} style={m.noteRow}>
                          <Text style={[m.noteNum, { color: ACCENT }]}>{i + 1}.</Text>
                          <Text style={[m.noteText, { color: theme.text }]}>{n}</Text>
                        </View>
                      ))}
                    </View>
                  </>
                )}

                {week.notes.grocery.length > 0 && (
                  <>
                    <Pressable style={m.groceryToggle} onPress={() => setGroceryOpen(v => !v)}>
                      <Text style={[m.sectionTitle, { color: theme.muted, marginBottom: 0 }]}>GROCERY LIST · {week.notes.grocery.length}</Text>
                      <Text style={[m.dayArrow, { color: theme.muted }]}>{groceryOpen ? '▲' : '▼'}</Text>
                    </Pressable>
                    {groceryOpen && (
                      <View style={[m.noteBox, { backgroundColor: theme.input, borderColor: theme.inputBorder }]}>
                        {week.notes.grocery.map((g, i) => (
                          <View key={i} style={m.groceryRow}>
                            <Text style={[m.groceryItem, { color: theme.text }]}>{g.item}</Text>
                            <Text style={[m.groceryAmount, { color: theme.subtext }]}>{g.amount}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </>
                )}

                <Text style={[m.disclaimer, { color: theme.muted }]}>{DISCLAIMER}</Text>

                <Pressable style={[m.primaryBtn, { backgroundColor: ACCENT, marginTop: 18 }]} onPress={apply}>
                  <Text style={m.primaryBtnText}>Use this plan ✓</Text>
                </Pressable>
                <Pressable style={[m.secondaryBtn, { borderColor: theme.cardBorder }]} onPress={() => setPhase('revise')}>
                  <Text style={[m.secondaryBtnText, { color: theme.text }]}>Ask for changes</Text>
                </Pressable>
                <Pressable style={m.backLink} onPress={() => startSurvey(true)}>
                  <Text style={[m.backLinkText, { color: theme.muted }]}>Start over</Text>
                </Pressable>
              </View>
            )}

            {/* ── Revise ── */}
            {phase === 'revise' && (
              <View>
                <Text style={[m.question, { color: theme.text }]}>What should change?</Text>
                <View style={m.pillWrap}>
                  {REVISE_HINTS.map(h => (
                    <Pressable
                      key={h}
                      style={[m.pill, m.pillSmall, { borderColor: theme.cardBorder, backgroundColor: theme.isDark ? '#1e1e38' : '#f8f7ff' }]}
                      onPress={() => setRequest(r => (r.trim() ? `${r.trim()}, ${h.toLowerCase()}` : h))}
                    >
                      <Text style={[m.pillText, m.pillSmallText, { color: theme.text }]}>{h}</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  style={[m.textInput, { color: theme.text, borderColor: theme.cardBorder, backgroundColor: theme.isDark ? '#1e1e38' : '#f8f7ff' }]}
                  placeholder="e.g. I don't like oats, swap the breakfasts. Make Friday dinner something I can cook with friends."
                  placeholderTextColor={theme.muted}
                  value={request}
                  onChangeText={setRequest}
                  multiline
                  textAlignVertical="top"
                  maxLength={600}
                  autoFocus
                />
                <Pressable
                  style={[m.primaryBtn, { backgroundColor: ACCENT }, !request.trim() && { opacity: 0.4 }]}
                  onPress={submitRevision}
                >
                  <Text style={m.primaryBtnText}>Update the plan ✦</Text>
                </Pressable>
                <Pressable style={m.backLink} onPress={() => setPhase('review')}>
                  <Text style={[m.backLinkText, { color: theme.muted }]}>← Back to the plan</Text>
                </Pressable>
              </View>
            )}

          </ScrollView>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const m = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  bg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 10, paddingHorizontal: 22, paddingBottom: 36,
    maxHeight: '92%',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 20,
  },
  grab: { marginHorizontal: -22, paddingHorizontal: 22 },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  headerBtn: { width: 64 },
  headerBtnText: { fontSize: 15, fontWeight: '700' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },

  lead: { fontSize: 14.5, lineHeight: 21, fontWeight: '500', marginBottom: 16 },
  goalsCard: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 14 },
  goalsTitle: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.2, marginBottom: 10 },
  goalsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  goalBox: { alignItems: 'center', flex: 1 },
  goalVal: { fontSize: 18, fontWeight: '800' },
  goalLabel: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  goalsEmpty: { fontSize: 13, lineHeight: 19, fontWeight: '500' },
  stepsText: { fontSize: 13, lineHeight: 19, fontWeight: '500', marginBottom: 16 },

  progressRow: { marginBottom: 18 },
  progressLabel: { fontSize: 12, fontWeight: '600', marginBottom: 7 },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },
  question: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3, marginBottom: 16, lineHeight: 24 },
  hint: { fontSize: 12, fontWeight: '600', marginBottom: 10, marginTop: -6 },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  pill: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22, borderWidth: 1.5 },
  pillText: { fontSize: 14, fontWeight: '600' },
  pillSmall: { paddingHorizontal: 12, paddingVertical: 7 },
  pillSmallText: { fontSize: 13 },
  textInput: {
    borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, fontWeight: '500', marginBottom: 14, minHeight: 90,
  },

  primaryBtn: { borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondaryBtn: { borderRadius: 16, paddingVertical: 14, alignItems: 'center', borderWidth: 1.5, marginTop: 10 },
  secondaryBtnText: { fontWeight: '700', fontSize: 15 },
  backLink: { alignItems: 'center', paddingVertical: 14 },
  backLinkText: { fontSize: 14, fontWeight: '600' },

  loadingBlock: { paddingVertical: 48, alignItems: 'center', gap: 14 },
  loadingText: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  loadingSub: { fontSize: 13, fontWeight: '500', textAlign: 'center' },

  summaryBox: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 16 },
  summaryText: { fontSize: 14, lineHeight: 21, fontWeight: '500' },
  sectionTitle: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 },

  dayCard: { borderRadius: 16, borderWidth: 1, marginBottom: 8, overflow: 'hidden' },
  dayHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  dayName: { fontSize: 15, fontWeight: '800', width: 38 },
  dayKcal: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  dayKcalUnit: { fontSize: 11, fontWeight: '600' },
  dayMacros: { flex: 1, fontSize: 12, fontWeight: '600', textAlign: 'right', fontVariant: ['tabular-nums'] },
  dayArrow: { fontSize: 11, fontWeight: '700' },
  dayMeals: { paddingHorizontal: 12, paddingBottom: 12, gap: 8 },
  dayEmpty: { fontSize: 13, fontStyle: 'italic', paddingVertical: 6 },
  mealRow: { flexDirection: 'row', gap: 10, borderLeftWidth: 3, paddingLeft: 10, paddingVertical: 2 },
  mealSection: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, marginBottom: 2 },
  mealName: { fontSize: 14.5, fontWeight: '700', marginBottom: 2 },
  mealContents: { fontSize: 12.5, lineHeight: 17, fontWeight: '500' },
  mealPrep: { fontSize: 12, lineHeight: 16, fontWeight: '500', marginTop: 3, fontStyle: 'italic' },
  mealCalBox: { alignItems: 'flex-end', minWidth: 48 },
  mealCal: { fontSize: 17, fontWeight: '800', lineHeight: 20 },
  mealCalUnit: { fontSize: 10, fontWeight: '700' },
  mealProtein: { fontSize: 11, fontWeight: '600', marginTop: 4 },

  noteBox: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 8 },
  noteRow: { flexDirection: 'row', gap: 8 },
  noteBullet: { fontSize: 14, fontWeight: '800', lineHeight: 20 },
  noteNum: { fontSize: 13, fontWeight: '800', lineHeight: 20, minWidth: 18 },
  noteText: { flex: 1, fontSize: 13.5, lineHeight: 20, fontWeight: '500' },
  groceryToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 8 },
  groceryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  groceryItem: { flex: 1, fontSize: 13.5, fontWeight: '600' },
  groceryAmount: { fontSize: 13, fontWeight: '500' },
  disclaimer: { fontSize: 12, lineHeight: 17, fontWeight: '500', marginTop: 16 },
})
