import { useState, useMemo } from 'react'
import {
  View, Text, Pressable, StyleSheet, ScrollView, TextInput,
  KeyboardAvoidingView, Platform, SafeAreaView,
} from 'react-native'
import { router } from 'expo-router'
import { useAuth } from '../lib/AuthContext'
import { useTheme } from '../lib/ThemeContext'
import {
  calculateGoals, generateGymSplit,
  ACTIVITY_LABELS, GOAL_LABELS,
} from '../lib/goals'
import { saveUserGoals } from '../lib/goalsStorage'
import { saveGymSplit } from '../lib/storage'
import { saveSections, FOCUS_PRESETS } from '../lib/sectionsStorage'
import { seedStarterWorkouts } from '../lib/starterWorkouts'
import { muscleColor, muscleTextColor } from '../lib/splitData'

const ACCENT = '#6366f1'
const TOTAL_STEPS = 6  // steps 1–6; step 0 = welcome (no bar)
const DAY_ABBR = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// ── Sub-components ────────────────────────────────────────────────────────────

function ProgressBar({ current }) {
  return (
    <View style={ob.progressRow}>
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <View key={i} style={[ob.progressSeg, { backgroundColor: i < current ? ACCENT : '#e5e7eb' }]} />
      ))}
    </View>
  )
}

function OptionCard({ emoji, label, sub, selected, onPress, theme }) {
  return (
    <Pressable
      style={[ob.optCard, {
        backgroundColor: selected ? ACCENT + '12' : theme.card,
        borderColor: selected ? ACCENT : theme.cardBorder,
        borderWidth: selected ? 2 : 1,
      }]}
      onPress={onPress}
    >
      {emoji ? <Text style={ob.optEmoji}>{emoji}</Text> : null}
      <View style={{ flex: 1 }}>
        <Text style={[ob.optLabel, { color: theme.text }]}>{label}</Text>
        {sub ? <Text style={[ob.optSub, { color: theme.subtext }]}>{sub}</Text> : null}
      </View>
      <View style={[ob.optRadio, { borderColor: selected ? ACCENT : theme.muted }]}>
        {selected && <View style={[ob.optRadioFill, { backgroundColor: ACCENT }]} />}
      </View>
    </Pressable>
  )
}

function UnitToggle({ value, options, onChange, theme }) {
  return (
    <View style={[ob.unitToggle, { backgroundColor: theme.isDark ? theme.input : '#f0f0f8', borderColor: theme.inputBorder }]}>
      {options.map(opt => (
        <Pressable
          key={opt}
          style={[ob.unitBtn, value === opt && { backgroundColor: ACCENT, borderRadius: 8 }]}
          onPress={() => onChange(opt)}
        >
          <Text style={[ob.unitBtnText, { color: value === opt ? '#fff' : theme.subtext }]}>{opt}</Text>
        </Pressable>
      ))}
    </View>
  )
}

function FieldLabel({ children, theme }) {
  return <Text style={[ob.fieldLabel, { color: theme.subtext }]}>{children}</Text>
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Onboarding() {
  const { user } = useAuth()
  const { theme, unit: appUnit } = useTheme()

  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)

  // Step 1: focus (controls which app sections are visible)
  const [focus, setFocus] = useState(null)

  // Step 2: body stats
  const [weightVal, setWeightVal]   = useState('')
  const [weightUnit, setWeightUnit] = useState(appUnit === 'kg' ? 'kg' : 'lbs')
  const [heightMode, setHeightMode] = useState('ft')  // 'ft' | 'cm'
  const [heightFt, setHeightFt]     = useState('')
  const [heightIn, setHeightIn]     = useState('')
  const [heightCm, setHeightCm]     = useState('')
  const [age, setAge]               = useState('')
  const [sex, setSex]               = useState(null)

  // Step 2: goal
  const [fitnessGoal, setFitnessGoal] = useState(null)
  const [targetWeightVal, setTargetWeightVal] = useState('')
  const [targetWeightUnit, setTargetWeightUnit] = useState(appUnit === 'kg' ? 'kg' : 'lbs')

  // Step 3: activity
  const [activityLevel, setActivityLevel] = useState(null)

  // Step 4: workout days
  const [workoutDays, setWorkoutDays] = useState(null)

  // Step 5: custom override
  const [isCustom, setIsCustom]         = useState(false)
  const [customCals, setCustomCals]     = useState('')
  const [customProtein, setCustomProtein] = useState('')
  const [customCarbs, setCustomCarbs]   = useState('')
  const [customFat, setCustomFat]       = useState('')

  // Derived values
  const weightKg = useMemo(() => {
    const w = parseFloat(weightVal)
    if (!w || w <= 0) return null
    return weightUnit === 'lbs' ? +(w * 0.453592).toFixed(1) : w
  }, [weightVal, weightUnit])

  const heightCmVal = useMemo(() => {
    if (heightMode === 'cm') return parseFloat(heightCm) || null
    const ft = parseFloat(heightFt) || 0
    const inches = parseFloat(heightIn) || 0
    const total = ft * 30.48 + inches * 2.54
    return total > 10 ? +total.toFixed(1) : null
  }, [heightMode, heightCm, heightFt, heightIn])

  const targetWeightKg = useMemo(() => {
    if (!fitnessGoal || fitnessGoal === 'maintain') return null
    const w = parseFloat(targetWeightVal)
    if (!w || w <= 0) return null
    return targetWeightUnit === 'lbs' ? +(w * 0.453592).toFixed(1) : w
  }, [targetWeightVal, targetWeightUnit, fitnessGoal])

  const calculated = useMemo(() => {
    if (!weightKg || !heightCmVal || !age || !sex || !fitnessGoal || !activityLevel) return null
    return calculateGoals(weightKg, heightCmVal, parseInt(age), sex, fitnessGoal, activityLevel, targetWeightKg)
  }, [weightKg, heightCmVal, age, sex, fitnessGoal, activityLevel, targetWeightKg])

  const split = useMemo(() => {
    if (!workoutDays) return null
    return generateGymSplit(workoutDays)
  }, [workoutDays])

  // What actually gets saved (calculated or custom)
  const finalCals    = isCustom ? (parseInt(customCals)    || 0) : calculated?.calories
  const finalProtein = isCustom ? (parseInt(customProtein) || 0) : calculated?.protein
  const finalCarbs   = isCustom ? (parseInt(customCarbs)   || 0) : calculated?.carbs
  const finalFat     = isCustom ? (parseInt(customFat)     || 0) : calculated?.fat

  function enableCustom() {
    if (!isCustom) {
      setCustomCals(String(calculated?.calories ?? ''))
      setCustomProtein(String(calculated?.protein ?? ''))
      setCustomCarbs(String(calculated?.carbs ?? ''))
      setCustomFat(String(calculated?.fat ?? ''))
    }
    setIsCustom(v => !v)
  }

  // Navigation
  function next() { setStep(s => s + 1) }
  function back() { setStep(s => s - 1) }

  async function handleSkip() {
    if (!user || saving) return
    setSaving(true)
    await saveSections(user.id, FOCUS_PRESETS[focus ?? 'all'])
    await saveUserGoals(user.id, { onboardingDone: true, fitnessGoal: 'none', skipped: true })
    setSaving(false)
    router.replace('/(tabs)')
  }

  async function handleNoGoal() {
    if (!user || saving) return
    setSaving(true)
    await saveSections(user.id, FOCUS_PRESETS[focus ?? 'all'])
    await saveUserGoals(user.id, { onboardingDone: true, fitnessGoal: 'none' })
    setSaving(false)
    router.replace('/(tabs)')
  }

  async function handleFinish() {
    if (!user || saving) return
    setSaving(true)
    const goals = {
      weightKg, heightCm: heightCmVal,
      age: parseInt(age), sex,
      fitnessGoal, activityLevel,
      targetWeightKg,
      workoutDaysPerWeek: workoutDays,
      gymSplit: split,
      calories: finalCals, protein: finalProtein,
      carbs: finalCarbs, fat: finalFat,
      isCustom, onboardingDone: true,
    }
    await saveSections(user.id, FOCUS_PRESETS[focus ?? 'all'])
    await saveUserGoals(user.id, goals)
    if (split) {
      await saveGymSplit(user.id, split).catch(() => {})
      // Pre-build starter workout plans matched to their goal, then land
      // the new user directly on the Fitness routine to see them.
      await seedStarterWorkouts(user.id, split, fitnessGoal)
      setSaving(false)
      router.replace('/routine/Fitness')
      return
    }
    setSaving(false)
    router.replace('/(tabs)')
  }

  const step1Valid = weightKg && heightCmVal && parseInt(age) >= 13 && parseInt(age) < 120 && sex

  // ── Render helpers ──────────────────────────────────────────────────────────

  function renderWelcome() {
    return (
      <View style={ob.welcomeWrap}>
        <View style={[ob.welcomeTop, { backgroundColor: ACCENT }]}>
          <Text style={ob.welcomeEmoji}>🏋️</Text>
          <Text style={ob.welcomeTitle}>Set up your fitness plan</Text>
          <Text style={ob.welcomeSub}>Answer a few quick questions and we'll calculate your calorie goals and suggest a workout split.</Text>
        </View>
        <View style={ob.welcomeBody}>
          <View style={ob.welcomeFeatureRow}>
            {[['🔥','Calorie goal'],['🥗','Macro targets'],['💪','Workout split']].map(([e,l]) => (
              <View key={l} style={ob.welcomeFeature}>
                <Text style={ob.welcomeFeatureEmoji}>{e}</Text>
                <Text style={[ob.welcomeFeatureLabel, { color: theme.subtext }]}>{l}</Text>
              </View>
            ))}
          </View>
          <Pressable style={[ob.primaryBtn, { backgroundColor: ACCENT }]} onPress={next}>
            <Text style={ob.primaryBtnText}>Get Started  →</Text>
          </Pressable>
          <Pressable style={ob.skipBtn} onPress={handleSkip}>
            <Text style={[ob.skipBtnText, { color: theme.muted }]}>Skip for now</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  function renderFocus() {
    const opts = [
      { key: 'habits',       emoji: '🎯', label: 'Routines & habits',     sub: 'Daily routines, habit tracking, weekly goals' },
      { key: 'fitness',      emoji: '💪', label: 'Fitness & nutrition',   sub: 'Workouts, gym splits, meals and macros' },
      { key: 'productivity', emoji: '📚', label: 'Productivity',          sub: 'Deep work sessions, planning, weekly goals' },
      { key: 'all',          emoji: '✨', label: 'A bit of everything',   sub: 'Show me all the features' },
    ]
    return (
      <ScrollView contentContainerStyle={ob.stepContent}>
        <Text style={[ob.stepTitle, { color: theme.text }]}>What do you want to focus on?</Text>
        <Text style={[ob.stepSub, { color: theme.subtext }]}>
          We'll start you with just the sections that matter to you. You can turn anything on later in settings.
        </Text>
        <View style={{ gap: 10, marginTop: 8 }}>
          {opts.map(opt => (
            <OptionCard
              key={opt.key}
              emoji={opt.emoji}
              label={opt.label}
              sub={opt.sub}
              selected={focus === opt.key}
              onPress={() => setFocus(opt.key)}
              theme={theme}
            />
          ))}
        </View>
        <Pressable
          style={[ob.primaryBtn, { backgroundColor: ACCENT, marginTop: 24 }, !focus && { opacity: 0.4 }]}
          onPress={() => focus && next()}
        >
          <Text style={ob.primaryBtnText}>Continue  →</Text>
        </Pressable>
      </ScrollView>
    )
  }

  function renderBodyStats() {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={ob.stepContent} keyboardShouldPersistTaps="handled">
          <Text style={[ob.stepTitle, { color: theme.text }]}>Your body stats</Text>
          <Text style={[ob.stepSub, { color: theme.subtext }]}>Used to calculate your calorie needs.</Text>

          {/* Weight */}
          <FieldLabel theme={theme}>Weight</FieldLabel>
          <View style={ob.inputRow}>
            <TextInput
              style={[ob.textInput, { flex: 1, color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder }]}
              placeholder={weightUnit === 'lbs' ? 'e.g. 165' : 'e.g. 75'}
              placeholderTextColor={theme.muted}
              value={weightVal}
              onChangeText={setWeightVal}
              keyboardType="decimal-pad"
            />
            <UnitToggle value={weightUnit} options={['lbs','kg']} onChange={setWeightUnit} theme={theme} />
          </View>

          {/* Height */}
          <FieldLabel theme={theme}>Height</FieldLabel>
          <View style={[ob.inputRow, { marginBottom: 4 }]}>
            <UnitToggle value={heightMode} options={['ft','cm']} onChange={setHeightMode} theme={theme} />
          </View>
          {heightMode === 'ft' ? (
            <View style={ob.inputRow}>
              <View style={{ flex: 1 }}>
                <TextInput
                  style={[ob.textInput, { color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder }]}
                  placeholder="ft"
                  placeholderTextColor={theme.muted}
                  value={heightFt}
                  onChangeText={setHeightFt}
                  keyboardType="number-pad"
                  maxLength={1}
                />
              </View>
              <Text style={[ob.unitSeparator, { color: theme.muted }]}>ft</Text>
              <View style={{ flex: 1 }}>
                <TextInput
                  style={[ob.textInput, { color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder }]}
                  placeholder="in"
                  placeholderTextColor={theme.muted}
                  value={heightIn}
                  onChangeText={setHeightIn}
                  keyboardType="number-pad"
                  maxLength={2}
                />
              </View>
              <Text style={[ob.unitSeparator, { color: theme.muted }]}>in</Text>
            </View>
          ) : (
            <TextInput
              style={[ob.textInput, { color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder }]}
              placeholder="e.g. 175"
              placeholderTextColor={theme.muted}
              value={heightCm}
              onChangeText={setHeightCm}
              keyboardType="decimal-pad"
            />
          )}

          {/* Age */}
          <FieldLabel theme={theme}>Age</FieldLabel>
          <TextInput
            style={[ob.textInput, { color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder }]}
            placeholder="e.g. 24"
            placeholderTextColor={theme.muted}
            value={age}
            onChangeText={setAge}
            keyboardType="number-pad"
            maxLength={3}
          />
          <Text style={[ob.ageHint, { color: age && parseInt(age) < 13 ? '#ef4444' : theme.muted }]}>
            You must be 13 or older to use this app.
          </Text>

          {/* Sex */}
          <FieldLabel theme={theme}>Biological sex</FieldLabel>
          <View style={ob.inputRow}>
            {[['male','♂ Male'],['female','♀ Female']].map(([val, label]) => (
              <Pressable
                key={val}
                style={[ob.sexBtn, {
                  flex: 1,
                  backgroundColor: sex === val ? ACCENT + '14' : theme.card,
                  borderColor: sex === val ? ACCENT : theme.cardBorder,
                  borderWidth: sex === val ? 2 : 1,
                }]}
                onPress={() => setSex(val)}
              >
                <Text style={[ob.sexBtnText, { color: sex === val ? ACCENT : theme.text }]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[ob.disclaimer, { color: theme.muted }]}>
            Used only for calorie calculations. Not stored or shared.
          </Text>
        </ScrollView>

        <View style={[ob.navRow, { borderTopColor: theme.divider, backgroundColor: theme.bg }]}>
          <Pressable style={ob.backPressable} onPress={back}>
            <Text style={[ob.backPressableText, { color: theme.subtext }]}>← Back</Text>
          </Pressable>
          <Pressable
            style={[ob.primaryBtn, { backgroundColor: step1Valid ? ACCENT : theme.cardBorder }]}
            onPress={next}
            disabled={!step1Valid}
          >
            <Text style={ob.primaryBtnText}>Next  →</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    )
  }

  function renderFitnessGoal() {
    return (
      <ScrollView contentContainerStyle={ob.stepContent}>
        <Text style={[ob.stepTitle, { color: theme.text }]}>What's your fitness goal?</Text>
        <Text style={[ob.stepSub, { color: theme.subtext }]}>We'll adjust your calorie target and workout plan to match.</Text>

        {[
          { key: 'lose',     ...GOAL_LABELS.lose,     sub: 'Calorie deficit · higher protein' },
          { key: 'gain',     ...GOAL_LABELS.gain,     sub: 'Calorie surplus · strength focus' },
          { key: 'maintain', ...GOAL_LABELS.maintain, sub: 'Balanced nutrition · steady progress' },
        ].map(opt => (
          <OptionCard
            key={opt.key}
            emoji={opt.emoji}
            label={opt.label}
            sub={opt.sub}
            selected={fitnessGoal === opt.key}
            onPress={() => setFitnessGoal(opt.key)}
            theme={theme}
          />
        ))}

        <View style={[ob.navRow, { borderTopColor: theme.divider }]}>
          <Pressable style={ob.backPressable} onPress={back}>
            <Text style={[ob.backPressableText, { color: theme.subtext }]}>← Back</Text>
          </Pressable>
          <Pressable
            style={[ob.primaryBtn, { backgroundColor: fitnessGoal ? ACCENT : theme.cardBorder }]}
            onPress={next}
            disabled={!fitnessGoal}
          >
            <Text style={ob.primaryBtnText}>Next  →</Text>
          </Pressable>
        </View>

        {(fitnessGoal === 'lose' || fitnessGoal === 'gain') && (
          <View style={[ob.targetWrap, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <Text style={[ob.targetLabel, { color: theme.subtext }]}>
              Target weight{'  '}<Text style={{ color: theme.muted, fontWeight: '500' }}>(optional)</Text>
            </Text>
            <View style={ob.inputRow}>
              <TextInput
                style={[ob.textInput, { flex: 1, color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder }]}
                placeholder={targetWeightUnit === 'lbs' ? 'e.g. 150' : 'e.g. 68'}
                placeholderTextColor={theme.muted}
                value={targetWeightVal}
                onChangeText={setTargetWeightVal}
                keyboardType="decimal-pad"
              />
              <UnitToggle value={targetWeightUnit} options={['lbs', 'kg']} onChange={setTargetWeightUnit} theme={theme} />
            </View>
            {targetWeightKg ? (
              <Text style={[ob.targetNote, { color: theme.muted }]}>
                Protein target will be based on your goal weight.
              </Text>
            ) : (
              <Text style={[ob.targetNote, { color: theme.muted }]}>
                Leave blank to calculate based on your current weight.
              </Text>
            )}
          </View>
        )}

        <Pressable style={ob.skipBtn} onPress={handleNoGoal}>
          <Text style={[ob.skipBtnText, { color: theme.muted }]}>No goal right now  →</Text>
        </Pressable>
      </ScrollView>
    )
  }

  function renderActivityLevel() {
    return (
      <ScrollView contentContainerStyle={ob.stepContent}>
        <Text style={[ob.stepTitle, { color: theme.text }]}>How active are you?</Text>
        <Text style={[ob.stepSub, { color: theme.subtext }]}>This adjusts your total daily calorie burn (TDEE).</Text>

        {['low', 'moderate', 'high'].map(lvl => (
          <OptionCard
            key={lvl}
            emoji={lvl === 'low' ? '🚶' : lvl === 'moderate' ? '🏃' : '⚡'}
            label={ACTIVITY_LABELS[lvl].short}
            sub={ACTIVITY_LABELS[lvl].long}
            selected={activityLevel === lvl}
            onPress={() => setActivityLevel(lvl)}
            theme={theme}
          />
        ))}

        <View style={[ob.navRow, { borderTopColor: theme.divider }]}>
          <Pressable style={ob.backPressable} onPress={back}>
            <Text style={[ob.backPressableText, { color: theme.subtext }]}>← Back</Text>
          </Pressable>
          <Pressable
            style={[ob.primaryBtn, { backgroundColor: activityLevel ? ACCENT : theme.cardBorder }]}
            onPress={next}
            disabled={!activityLevel}
          >
            <Text style={ob.primaryBtnText}>Next  →</Text>
          </Pressable>
        </View>
      </ScrollView>
    )
  }

  function renderWorkoutDays() {
    return (
      <ScrollView contentContainerStyle={ob.stepContent}>
        <Text style={[ob.stepTitle, { color: theme.text }]}>How many days can you train?</Text>
        <Text style={[ob.stepSub, { color: theme.subtext }]}>We'll generate a beginner-friendly split for you.</Text>

        <View style={ob.pillRow}>
          {[2, 3, 4, 5, 6].map(d => (
            <Pressable
              key={d}
              style={[ob.dayPill, {
                backgroundColor: workoutDays === d ? ACCENT : theme.card,
                borderColor: workoutDays === d ? ACCENT : theme.cardBorder,
              }]}
              onPress={() => setWorkoutDays(d)}
            >
              <Text style={[ob.dayPillNum, { color: workoutDays === d ? '#fff' : theme.text }]}>{d}</Text>
              <Text style={[ob.dayPillSub, { color: workoutDays === d ? '#ffffffaa' : theme.muted }]}>days</Text>
            </Pressable>
          ))}
        </View>

        {workoutDays && (
          <View style={[ob.infoBox, { backgroundColor: ACCENT + '0e', borderColor: ACCENT + '33' }]}>
            <Text style={[ob.infoBoxText, { color: ACCENT }]}>
              {workoutDays <= 3
                ? 'Great for building consistency and recovery.'
                : workoutDays <= 4
                  ? 'A balanced frequency for steady progress.'
                  : 'High frequency — make sure to prioritize sleep and recovery.'}
            </Text>
          </View>
        )}

        <View style={[ob.navRow, { borderTopColor: theme.divider }]}>
          <Pressable style={ob.backPressable} onPress={back}>
            <Text style={[ob.backPressableText, { color: theme.subtext }]}>← Back</Text>
          </Pressable>
          <Pressable
            style={[ob.primaryBtn, { backgroundColor: workoutDays ? ACCENT : theme.cardBorder }]}
            onPress={next}
            disabled={!workoutDays}
          >
            <Text style={ob.primaryBtnText}>See my plan  →</Text>
          </Pressable>
        </View>
      </ScrollView>
    )
  }

  function renderResults() {
    const goalLabel = GOAL_LABELS[fitnessGoal]

    return (
      <ScrollView contentContainerStyle={ob.stepContent}>
        <View style={ob.resultsHeader}>
          <Text style={ob.resultsHeaderEmoji}>🎉</Text>
          <Text style={[ob.resultsHeaderTitle, { color: theme.text }]}>Your plan is ready!</Text>
          <Text style={[ob.resultsHeaderSub, { color: theme.subtext }]}>
            {goalLabel?.emoji}  {goalLabel?.label}
          </Text>
        </View>

        {/* Nutrition card */}
        <View style={[ob.resultsCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <Text style={[ob.resultsCardLabel, { color: theme.subtext }]}>DAILY NUTRITION TARGETS</Text>
          {isCustom ? (
            <>
              <Text style={[ob.customNote, { color: ACCENT }]}>Custom values</Text>
              <View style={ob.customGrid}>
                {[
                  { label: 'Calories', val: customCals, set: setCustomCals, unit: 'kcal' },
                  { label: 'Protein',  val: customProtein, set: setCustomProtein, unit: 'g' },
                  { label: 'Carbs',    val: customCarbs, set: setCustomCarbs, unit: 'g' },
                  { label: 'Fat',      val: customFat, set: setCustomFat, unit: 'g' },
                ].map(f => (
                  <View key={f.label} style={ob.customField}>
                    <Text style={[ob.customFieldLabel, { color: theme.subtext }]}>{f.label}</Text>
                    <View style={ob.customFieldInputWrap}>
                      <TextInput
                        style={[ob.customFieldInput, { color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder }]}
                        value={f.val}
                        onChangeText={f.set}
                        keyboardType="number-pad"
                        selectTextOnFocus
                      />
                      <Text style={[ob.customFieldUnit, { color: theme.muted }]}>{f.unit}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <>
              <View style={ob.calRow}>
                <Text style={[ob.calNum, { color: theme.text }]}>{(calculated?.calories ?? 0).toLocaleString()}</Text>
                <Text style={[ob.calUnit, { color: theme.subtext }]}>kcal / day</Text>
              </View>
              <View style={ob.macroRow}>
                {[
                  { label: 'Protein', val: calculated?.protein, color: '#ef4444' },
                  { label: 'Carbs',   val: calculated?.carbs,   color: '#f59e0b' },
                  { label: 'Fat',     val: calculated?.fat,     color: '#3b82f6' },
                ].map(m => (
                  <View key={m.label} style={ob.macroBox}>
                    <Text style={[ob.macroVal, { color: m.color }]}>{m.val}g</Text>
                    <Text style={[ob.macroLabel, { color: theme.muted }]}>{m.label}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
          <Pressable style={ob.customToggle} onPress={enableCustom}>
            <Text style={[ob.customToggleText, { color: ACCENT }]}>
              {isCustom ? '← Use calculated values' : 'Use my own numbers  →'}
            </Text>
          </Pressable>
        </View>

        {/* Split card */}
        {split && (
          <View style={[ob.resultsCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <Text style={[ob.resultsCardLabel, { color: theme.subtext }]}>WORKOUT SPLIT</Text>
            <Text style={[ob.splitPreset, { color: theme.text }]}>{split.preset}</Text>
            <Text style={[ob.splitDaysNote, { color: theme.subtext }]}>{workoutDays} days / week</Text>
            <View style={ob.splitGrid}>
              {DAY_ABBR.map((abbr, i) => {
                const muscle = (split.days[i] ?? ['Rest'])[0]
                const isRest = muscle === 'Rest'
                return (
                  <View key={i} style={ob.splitDayCol}>
                    <Text style={[ob.splitDayAbbr, { color: theme.muted }]}>{abbr}</Text>
                    <View style={[ob.splitDayChip, {
                      backgroundColor: isRest ? (theme.isDark ? '#ffffff0a' : '#0000000a') : muscleColor(muscle),
                    }]}>
                      <Text style={[ob.splitDayChipText, {
                        color: isRest ? theme.muted : muscleTextColor(muscle),
                      }]} numberOfLines={1}>
                        {isRest ? '—' : muscle.length > 5 ? muscle.slice(0, 4) + '.' : muscle}
                      </Text>
                    </View>
                  </View>
                )
              })}
            </View>

            {/* Goal-specific tips */}
            {fitnessGoal === 'lose' && (
              <View style={[ob.tipBox, { backgroundColor: '#fef3c7', borderColor: '#fcd34d' }]}>
                <Text style={ob.tipText}>💡 Consider adding 2–4 light cardio sessions/week for best results. Focus on consistency over intensity.</Text>
              </View>
            )}
            {fitnessGoal === 'gain' && (
              <View style={[ob.tipBox, { backgroundColor: '#ecfdf5', borderColor: '#6ee7b7' }]}>
                <Text style={ob.tipText}>💡 Prioritize compound lifts and progressive overload. Keep cardio light to preserve your calorie surplus.</Text>
              </View>
            )}
            {fitnessGoal === 'maintain' && (
              <View style={[ob.tipBox, { backgroundColor: '#eef2ff', borderColor: '#c7d2fe' }]}>
                <Text style={ob.tipText}>💡 Balance strength training with optional cardio and mobility work. Consistency is your best tool.</Text>
              </View>
            )}
          </View>
        )}

        <Text style={[ob.finePrint, { color: theme.muted }]}>
          These are suggested starting targets, not medical advice. Adjust them anytime in Profile → Goals as you progress.
        </Text>

        <Pressable
          style={[ob.primaryBtn, { backgroundColor: ACCENT, marginTop: 8 }]}
          onPress={handleFinish}
          disabled={saving}
        >
          <Text style={ob.primaryBtnText}>{saving ? 'Building your starter workouts…' : 'Start Using the App  →'}</Text>
        </Pressable>

        <Pressable style={ob.editGoalsBtn} onPress={() => setStep(2)}>
          <Text style={[ob.editGoalsBtnText, { color: theme.subtext }]}>← Edit my goals</Text>
        </Pressable>
      </ScrollView>
    )
  }

  // ── Root render ─────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[ob.page, { backgroundColor: theme.bg }]}>
      {step > 0 && (
        <View style={[ob.header, { borderBottomColor: theme.divider }]}>
          <ProgressBar current={step} />
          <Text style={[ob.stepCounter, { color: theme.muted }]}>Step {step} of {TOTAL_STEPS}</Text>
        </View>
      )}
      {step === 0 && renderWelcome()}
      {step === 1 && renderFocus()}
      {step === 2 && renderBodyStats()}
      {step === 3 && renderFitnessGoal()}
      {step === 4 && renderActivityLevel()}
      {step === 5 && renderWorkoutDays()}
      {step === 6 && renderResults()}
    </SafeAreaView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const ob = StyleSheet.create({
  page: { flex: 1 },

  // Header / progress
  header: { paddingTop: 16, paddingBottom: 10, borderBottomWidth: 1 },
  progressRow: { flexDirection: 'row', gap: 5, paddingHorizontal: 20, marginBottom: 6 },
  progressSeg: { flex: 1, height: 4, borderRadius: 2 },
  stepCounter: { textAlign: 'center', fontSize: 11, fontWeight: '600' },

  // Welcome
  welcomeWrap: { flex: 1 },
  welcomeTop: { alignItems: 'center', paddingTop: 60, paddingBottom: 40, paddingHorizontal: 28 },
  welcomeEmoji: { fontSize: 64, marginBottom: 20 },
  welcomeTitle: { fontSize: 26, fontWeight: '800', color: '#fff', textAlign: 'center', marginBottom: 10, letterSpacing: -0.5 },
  welcomeSub: { fontSize: 15, color: '#ffffffcc', textAlign: 'center', lineHeight: 22 },
  welcomeBody: { flex: 1, padding: 28, paddingTop: 32 },
  welcomeFeatureRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 36 },
  welcomeFeature: { alignItems: 'center', gap: 8 },
  welcomeFeatureEmoji: { fontSize: 30 },
  welcomeFeatureLabel: { fontSize: 12, fontWeight: '600', textAlign: 'center' },

  // Step layout
  stepContent: { padding: 24, paddingBottom: 32 },
  stepTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4, marginBottom: 6 },
  stepSub: { fontSize: 14, lineHeight: 20, marginBottom: 24 },

  // Fields
  fieldLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4, marginBottom: 8, marginTop: 16 },
  textInput: {
    borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 16, fontWeight: '500', marginBottom: 4,
  },
  inputRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 4 },
  ageHint: { fontSize: 12, fontWeight: '600', marginTop: 4, marginBottom: 4, marginLeft: 2 },
  unitSeparator: { fontSize: 13, fontWeight: '600' },

  unitToggle: {
    flexDirection: 'row', borderRadius: 10, borderWidth: 1,
    padding: 3, gap: 2,
  },
  unitBtn: { paddingHorizontal: 14, paddingVertical: 7 },
  unitBtnText: { fontSize: 13, fontWeight: '700' },

  sexBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  sexBtnText: { fontSize: 15, fontWeight: '700' },

  disclaimer: { fontSize: 11, marginTop: 20, textAlign: 'center', lineHeight: 16 },

  // Option cards
  optCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 18, padding: 18, marginBottom: 10,
  },
  optEmoji: { fontSize: 26, width: 32, textAlign: 'center' },
  optLabel: { fontSize: 16, fontWeight: '700' },
  optSub: { fontSize: 13, marginTop: 2 },
  optRadio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  optRadioFill: { width: 11, height: 11, borderRadius: 6 },

  // Pill row (workout days)
  pillRow: { flexDirection: 'row', gap: 10, justifyContent: 'center', marginBottom: 20 },
  dayPill: {
    width: 60, paddingVertical: 16, borderRadius: 18, borderWidth: 1.5,
    alignItems: 'center',
  },
  dayPillNum: { fontSize: 22, fontWeight: '800' },
  dayPillSub: { fontSize: 10, fontWeight: '600', marginTop: 2 },

  infoBox: { borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 4 },
  infoBoxText: { fontSize: 13, fontWeight: '600', lineHeight: 18 },

  // Navigation row
  navRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 16, marginTop: 20, borderTopWidth: 1,
  },
  backPressable: { padding: 10 },
  backPressableText: { fontSize: 15, fontWeight: '600' },

  // Buttons
  primaryBtn: {
    borderRadius: 18, padding: 17, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15, shadowRadius: 8, elevation: 4,
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 17 },
  skipBtn: { alignItems: 'center', padding: 14, marginTop: 6 },
  skipBtnText: { fontSize: 14, fontWeight: '600' },
  editGoalsBtn: { alignItems: 'center', padding: 14, marginTop: 4 },
  editGoalsBtnText: { fontSize: 14, fontWeight: '600' },

  // Results
  resultsHeader: { alignItems: 'center', marginBottom: 20 },
  resultsHeaderEmoji: { fontSize: 48, marginBottom: 10 },
  resultsHeaderTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  resultsHeaderSub: { fontSize: 14, marginTop: 4 },

  resultsCard: {
    borderRadius: 20, borderWidth: 1, padding: 20, marginBottom: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  resultsCardLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 14 },

  calRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 16 },
  calNum: { fontSize: 48, fontWeight: '800', letterSpacing: -1 },
  calUnit: { fontSize: 15, fontWeight: '600' },

  macroRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 16 },
  macroBox: { alignItems: 'center' },
  macroVal: { fontSize: 22, fontWeight: '800' },
  macroLabel: { fontSize: 11, fontWeight: '600', marginTop: 2 },

  customNote: { fontSize: 12, fontWeight: '700', marginBottom: 12 },
  customGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  customField: { width: '47%' },
  customFieldLabel: { fontSize: 11, fontWeight: '700', marginBottom: 6 },
  customFieldInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  customFieldInput: {
    flex: 1, borderRadius: 10, borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 9,
    fontSize: 16, fontWeight: '700', textAlign: 'center',
  },
  customFieldUnit: { fontSize: 12, fontWeight: '600' },
  customToggle: { alignItems: 'center', paddingTop: 10 },
  customToggleText: { fontSize: 13, fontWeight: '700' },

  // Split grid
  splitPreset: { fontSize: 17, fontWeight: '700', marginBottom: 2 },
  splitDaysNote: { fontSize: 12, marginBottom: 14 },
  splitGrid: { flexDirection: 'row', gap: 4 },
  splitDayCol: { flex: 1, alignItems: 'center', gap: 5 },
  splitDayAbbr: { fontSize: 10, fontWeight: '700' },
  splitDayChip: { width: '100%', borderRadius: 8, paddingVertical: 6, alignItems: 'center' },
  splitDayChipText: { fontSize: 9, fontWeight: '700' },

  tipBox: { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 14 },
  tipText: { fontSize: 12, lineHeight: 17, color: '#555' },

  finePrint: { fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 8, marginBottom: 12 },

  targetWrap: { borderRadius: 16, borderWidth: 1, padding: 16, marginTop: 4, marginBottom: 8 },
  targetLabel: { fontSize: 13, fontWeight: '700', marginBottom: 10 },
  targetNote: { fontSize: 12, marginTop: 8, lineHeight: 17 },
})
