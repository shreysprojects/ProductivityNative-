import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import {
  View, Text, Pressable, ScrollView, TextInput,
  StyleSheet, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native'
import { Image } from 'expo-image'
import { useFocusEffect } from 'expo-router'
import { useAuth } from '../../lib/AuthContext'
import { useTheme } from '../../lib/ThemeContext'
import { getUserGoals, saveUserGoals } from '../../lib/goalsStorage'
import { saveGymSplit } from '../../lib/storage'
import {
  calculateGoals, generateGymSplit,
  ACTIVITY_LABELS, GOAL_LABELS,
} from '../../lib/goals'
import { muscleColor, muscleTextColor } from '../../lib/splitData'
import {
  checkUsernameAvailable, upsertProfile, pickAndUploadAvatar,
} from '../../lib/profileStorage'

const ACCENT = '#6366f1'
const DAY_ABBR = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function SectionHeader({ title, theme }) {
  return (
    <Text style={[st.sectionHeader, { color: theme.muted }]}>{title}</Text>
  )
}

function FieldLabel({ children, theme }) {
  return <Text style={[st.fieldLabel, { color: theme.subtext }]}>{children}</Text>
}

function UnitToggle({ value, options, onChange, theme }) {
  return (
    <View style={[st.unitToggle, { backgroundColor: theme.isDark ? theme.input : '#f0f0f8', borderColor: theme.inputBorder }]}>
      {options.map(opt => (
        <Pressable
          key={opt}
          style={[st.unitBtn, value === opt && { backgroundColor: ACCENT, borderRadius: 8 }]}
          onPress={() => onChange(opt)}
        >
          <Text style={[st.unitBtnText, { color: value === opt ? '#fff' : theme.subtext }]}>{opt}</Text>
        </Pressable>
      ))}
    </View>
  )
}

function OptionCard({ emoji, label, sub, selected, onPress, theme }) {
  return (
    <Pressable
      style={[st.optCard, {
        backgroundColor: selected ? ACCENT + '12' : theme.card,
        borderColor: selected ? ACCENT : theme.cardBorder,
        borderWidth: selected ? 2 : 1,
      }]}
      onPress={onPress}
    >
      {emoji ? <Text style={st.optEmoji}>{emoji}</Text> : null}
      <View style={{ flex: 1 }}>
        <Text style={[st.optLabel, { color: theme.text }]}>{label}</Text>
        {sub ? <Text style={[st.optSub, { color: theme.subtext }]}>{sub}</Text> : null}
      </View>
      <View style={[st.optRadio, { borderColor: selected ? ACCENT : theme.muted }]}>
        {selected && <View style={[st.optRadioFill, { backgroundColor: ACCENT }]} />}
      </View>
    </Pressable>
  )
}

function validateUsernameFormat(u) {
  if (!u || u.length < 3) return 'too_short'
  if (u.length > 20) return 'too_long'
  if (!/^[a-z0-9_]+$/.test(u)) return 'invalid_chars'
  return 'valid'
}

export default function SettingsScreen() {
  const { user, profile, refreshProfile, signOut, deleteAccount } = useAuth()
  const { theme, toggleDark, unit: appUnit } = useTheme()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Profile fields
  const [localName, setLocalName] = useState('')
  const [localUsername, setLocalUsername] = useState('')
  const [localBio, setLocalBio] = useState('')
  const [visibility, setVisibility] = useState('friends')
  const [avatarUri, setAvatarUri] = useState(null)
  const [usernameStatus, setUsernameStatus] = useState(null)
  const [savingProfile, setSavingProfile] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const profileInitialized = useRef(false)
  const usernameTimerRef = useRef(null)

  // Body stats
  const [weightVal, setWeightVal]   = useState('')
  const [weightUnit, setWeightUnit] = useState('lbs')
  const [heightMode, setHeightMode] = useState('cm')
  const [heightFt, setHeightFt]     = useState('')
  const [heightIn, setHeightIn]     = useState('')
  const [heightCm, setHeightCm]     = useState('')
  const [age, setAge]               = useState('')
  const [sex, setSex]               = useState(null)

  // Goal + activity
  const [fitnessGoal, setFitnessGoal]         = useState(null)
  const [targetWeightVal, setTargetWeightVal] = useState('')
  const [targetWeightUnit, setTargetWeightUnit] = useState('lbs')
  const [activityLevel, setActivityLevel]     = useState(null)
  const [workoutDays, setWorkoutDays]         = useState(null)

  // Split
  const [currentSplit, setCurrentSplit]       = useState(null)
  const [origWorkoutDays, setOrigWorkoutDays] = useState(null)
  const [pendingRegen, setPendingRegen]       = useState(false)

  // Custom nutrition
  const [isCustom, setIsCustom]           = useState(false)
  const [customCals, setCustomCals]       = useState('')
  const [customProtein, setCustomProtein] = useState('')
  const [customCarbs, setCustomCarbs]     = useState('')
  const [customFat, setCustomFat]         = useState('')

  // Load profile into local state once per session
  useEffect(() => {
    if (profile && !profileInitialized.current) {
      setLocalName(profile.name ?? '')
      setLocalUsername(profile.username ?? '')
      setLocalBio(profile.bio ?? '')
      setVisibility(profile.visibility ?? 'friends')
      setAvatarUri(profile.avatar_url || null)
      profileInitialized.current = true
    }
  }, [profile])

  // Username availability check
  useEffect(() => {
    const normalized = localUsername.toLowerCase().trim()
    if (!normalized || (profile && normalized === profile.username?.toLowerCase())) {
      setUsernameStatus(profile && normalized === profile.username?.toLowerCase() ? 'available' : null)
      return
    }
    if (validateUsernameFormat(normalized) !== 'valid') {
      setUsernameStatus('invalid')
      return
    }
    setUsernameStatus('checking')
    clearTimeout(usernameTimerRef.current)
    usernameTimerRef.current = setTimeout(async () => {
      const ok = await checkUsernameAvailable(normalized, user?.id)
      setUsernameStatus(ok ? 'available' : 'taken')
    }, 500)
    return () => clearTimeout(usernameTimerRef.current)
  }, [localUsername, profile, user])

  useFocusEffect(useCallback(() => {
    if (!user) return
    setLoading(true)
    getUserGoals(user.id).then(goals => {
      if (goals) {
        const kg = goals.weightKg
        if (kg) {
          const unit = appUnit === 'kg' ? 'kg' : 'lbs'
          setWeightUnit(unit)
          setWeightVal(String(unit === 'lbs' ? +(kg / 0.453592).toFixed(1) : kg))
        }
        if (goals.heightCm) {
          setHeightMode('cm')
          setHeightCm(String(goals.heightCm))
        }
        if (goals.age)           setAge(String(goals.age))
        if (goals.sex)           setSex(goals.sex)
        if (goals.fitnessGoal && goals.fitnessGoal !== 'none') setFitnessGoal(goals.fitnessGoal)
        if (goals.targetWeightKg) {
          const unit = appUnit === 'kg' ? 'kg' : 'lbs'
          setTargetWeightUnit(unit)
          setTargetWeightVal(String(unit === 'lbs' ? +(goals.targetWeightKg / 0.453592).toFixed(1) : goals.targetWeightKg))
        }
        if (goals.activityLevel) setActivityLevel(goals.activityLevel)
        if (goals.workoutDaysPerWeek) {
          setWorkoutDays(goals.workoutDaysPerWeek)
          setOrigWorkoutDays(goals.workoutDaysPerWeek)
        }
        if (goals.gymSplit) setCurrentSplit(goals.gymSplit)
        if (goals.isCustom) {
          setIsCustom(true)
          setCustomCals(String(goals.calories ?? ''))
          setCustomProtein(String(goals.protein ?? ''))
          setCustomCarbs(String(goals.carbs ?? ''))
          setCustomFat(String(goals.fat ?? ''))
        }
      }
      setLoading(false)
    })
  }, [user]))

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

  const finalCals    = isCustom ? (parseInt(customCals)    || null) : (calculated?.calories ?? null)
  const finalProtein = isCustom ? (parseInt(customProtein) || null) : (calculated?.protein ?? null)
  const finalCarbs   = isCustom ? (parseInt(customCarbs)   || null) : (calculated?.carbs ?? null)
  const finalFat     = isCustom ? (parseInt(customFat)     || null) : (calculated?.fat ?? null)

  function enableCustom() {
    if (!isCustom) {
      setCustomCals(String(calculated?.calories ?? ''))
      setCustomProtein(String(calculated?.protein ?? ''))
      setCustomCarbs(String(calculated?.carbs ?? ''))
      setCustomFat(String(calculated?.fat ?? ''))
    }
    setIsCustom(v => !v)
  }

  function handleWorkoutDaysChange(d) {
    setWorkoutDays(d)
    setPendingRegen(d !== origWorkoutDays || !currentSplit)
  }

  function regenSplit() {
    if (!workoutDays) return
    const newSplit = generateGymSplit(workoutDays)
    setCurrentSplit(newSplit)
    setOrigWorkoutDays(workoutDays)
    setPendingRegen(false)
  }

  async function handlePickAvatar() {
    if (!user) return
    setUploadingAvatar(true)
    try {
      const url = await pickAndUploadAvatar(user.id)
      if (!url) return
      setAvatarUri(url)
      await upsertProfile(user.id, {
        username: localUsername || profile?.username || '',
        bio: localBio,
        avatar_url: url,
        name: localName,
      })
      await refreshProfile()
    } catch (e) {
      Alert.alert('Error', e.message)
    } finally {
      setUploadingAvatar(false)
    }
  }

  async function saveProfile() {
    if (!user || savingProfile) return
    if (usernameStatus !== 'available') {
      Alert.alert('Invalid username', 'Please choose a valid, available username.')
      return
    }
    setSavingProfile(true)
    try {
      await upsertProfile(user.id, {
        username: localUsername.toLowerCase().trim(),
        bio: localBio.trim(),
        avatar_url: avatarUri ?? '',
        name: localName.trim(),
        visibility,
      })
      await refreshProfile()
      Alert.alert('Saved', 'Profile updated.')
    } catch (e) {
      Alert.alert('Error', e.message)
    } finally {
      setSavingProfile(false)
    }
  }

  async function save() {
    if (!user || saving) return
    if (age && parseInt(age) < 13) {
      Alert.alert('Age requirement', 'You must be 13 or older to use this app.')
      return
    }
    setSaving(true)
    const goals = {
      weightKg,
      heightCm: heightCmVal,
      age: parseInt(age) || null,
      sex,
      fitnessGoal: fitnessGoal || 'none',
      targetWeightKg,
      activityLevel,
      workoutDaysPerWeek: workoutDays,
      gymSplit: currentSplit,
      calories: finalCals,
      protein: finalProtein,
      carbs: finalCarbs,
      fat: finalFat,
      isCustom,
      onboardingDone: true,
    }
    await saveUserGoals(user.id, goals)
    if (currentSplit) await saveGymSplit(user.id, currentSplit).catch(() => {})
    setSaving(false)
    Alert.alert('Saved', 'Your goals have been updated.')
  }

  if (loading) {
    return (
      <View style={[st.page, { backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={ACCENT} size="large" />
      </View>
    )
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={[st.page, { backgroundColor: theme.bg }]}
        contentContainerStyle={st.content}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Profile ───────────────────────────────────────────────── */}
        <SectionHeader title="PROFILE" theme={theme} />
        <View style={[st.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>

          {/* Avatar */}
          <Pressable style={st.avatarWrap} onPress={handlePickAvatar} disabled={uploadingAvatar}>
            {avatarUri ? (
              <Image
                source={{ uri: avatarUri }}
                style={st.avatarImage}
                contentFit="cover"
              />
            ) : (
              <View style={[st.avatarPlaceholder, { backgroundColor: ACCENT }]}>
                <Text style={st.avatarInitial}>
                  {(localUsername?.[0] ?? user?.name?.[0] ?? '?').toUpperCase()}
                </Text>
              </View>
            )}
            <View style={[st.avatarBadge, { backgroundColor: theme.card }]}>
              {uploadingAvatar
                ? <ActivityIndicator size="small" color={ACCENT} />
                : <Text style={{ fontSize: 12 }}>📷</Text>}
            </View>
          </Pressable>

          <FieldLabel theme={theme}>Name</FieldLabel>
          <TextInput
            style={[st.textInput, {
              color: theme.text,
              backgroundColor: theme.input,
              borderColor: theme.inputBorder,
            }]}
            placeholder="Your name"
            placeholderTextColor={theme.muted}
            autoCapitalize="words"
            value={localName}
            onChangeText={setLocalName}
            maxLength={40}
          />

          <FieldLabel theme={theme}>Username</FieldLabel>
          <TextInput
            style={[st.textInput, {
              color: theme.text,
              backgroundColor: theme.input,
              borderColor: usernameStatus === 'taken' ? '#ef4444'
                : usernameStatus === 'available' ? '#22c55e'
                : theme.inputBorder,
              marginBottom: 4,
            }]}
            placeholder="username"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoCorrect={false}
            value={localUsername}
            onChangeText={setLocalUsername}
          />
          {localUsername ? (
            <Text style={[st.usernameHint, {
              color: usernameStatus === 'available' ? '#22c55e'
                : usernameStatus === 'taken' ? '#ef4444'
                : usernameStatus === 'invalid' ? '#f59e0b'
                : theme.muted,
            }]}>
              {usernameStatus === 'available' ? `@${localUsername.toLowerCase()} ✓`
                : usernameStatus === 'taken' ? 'Username already taken'
                : usernameStatus === 'checking' ? 'Checking…'
                : usernameStatus === 'invalid' ? 'Use 3–20 letters, numbers, or underscores'
                : ''}
            </Text>
          ) : null}

          <FieldLabel theme={theme}>Email</FieldLabel>
          <View style={[st.emailRow, { backgroundColor: theme.input, borderColor: theme.inputBorder }]}>
            <Text style={[st.emailText, { color: theme.subtext }]}>{user?.email ?? '—'}</Text>
          </View>

          <FieldLabel theme={theme}>Bio</FieldLabel>
          <TextInput
            style={[st.textInput, st.bioInput, {
              color: theme.text,
              backgroundColor: theme.input,
              borderColor: theme.inputBorder,
            }]}
            placeholder="Tell the community about yourself…"
            placeholderTextColor={theme.muted}
            multiline
            value={localBio}
            onChangeText={setLocalBio}
          />

          <FieldLabel theme={theme}>Show full data to</FieldLabel>
          <View style={[st.visRow, { backgroundColor: theme.isDark ? theme.input : '#f0f0f8', borderColor: theme.inputBorder }]}>
            {[
              ['everyone', 'Everyone'],
              ['friends', 'Friends'],
              ['none', 'No one'],
            ].map(([val, label]) => (
              <Pressable
                key={val}
                style={[st.visBtn, visibility === val && { backgroundColor: ACCENT }]}
                onPress={() => setVisibility(val)}
              >
                <Text style={[st.visBtnText, { color: visibility === val ? '#fff' : theme.subtext }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[st.visHint, { color: theme.muted }]}>
            {visibility === 'everyone'
              ? 'Anyone who opens your profile can see your calendar, routines, and workouts.'
              : visibility === 'friends'
              ? 'Only accepted friends can see your calendar, routines, and workouts.'
              : 'No one can see your activity — your profile shows only your name and bio.'}
          </Text>

          <Pressable
            style={[st.profileSaveBtn, { backgroundColor: ACCENT }, savingProfile && { opacity: 0.6 }]}
            onPress={saveProfile}
            disabled={savingProfile}
          >
            {savingProfile
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={st.profileSaveBtnText}>Save Profile</Text>}
          </Pressable>
        </View>

        {/* ── Body Stats ─────────────────────────────────────────────── */}
        <SectionHeader title="BODY STATS" theme={theme} />
        <View style={[st.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>

          <FieldLabel theme={theme}>Weight</FieldLabel>
          <View style={st.inputRow}>
            <TextInput
              style={[st.textInput, { flex: 1, color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder }]}
              placeholder={weightUnit === 'lbs' ? 'e.g. 165' : 'e.g. 75'}
              placeholderTextColor={theme.muted}
              value={weightVal}
              onChangeText={setWeightVal}
              keyboardType="decimal-pad"
            />
            <UnitToggle value={weightUnit} options={['lbs', 'kg']} onChange={setWeightUnit} theme={theme} />
          </View>

          <FieldLabel theme={theme}>Height</FieldLabel>
          <View style={[st.inputRow, { marginBottom: 6 }]}>
            <UnitToggle value={heightMode} options={['ft', 'cm']} onChange={setHeightMode} theme={theme} />
          </View>
          {heightMode === 'ft' ? (
            <View style={st.inputRow}>
              <View style={{ flex: 1 }}>
                <TextInput
                  style={[st.textInput, { color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder }]}
                  placeholder="ft"
                  placeholderTextColor={theme.muted}
                  value={heightFt}
                  onChangeText={setHeightFt}
                  keyboardType="number-pad"
                  maxLength={1}
                />
              </View>
              <Text style={[st.unitSep, { color: theme.muted }]}>ft</Text>
              <View style={{ flex: 1 }}>
                <TextInput
                  style={[st.textInput, { color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder }]}
                  placeholder="in"
                  placeholderTextColor={theme.muted}
                  value={heightIn}
                  onChangeText={setHeightIn}
                  keyboardType="number-pad"
                  maxLength={2}
                />
              </View>
              <Text style={[st.unitSep, { color: theme.muted }]}>in</Text>
            </View>
          ) : (
            <TextInput
              style={[st.textInput, { color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder }]}
              placeholder="e.g. 175"
              placeholderTextColor={theme.muted}
              value={heightCm}
              onChangeText={setHeightCm}
              keyboardType="decimal-pad"
            />
          )}

          <FieldLabel theme={theme}>Age</FieldLabel>
          <TextInput
            style={[st.textInput, { color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder }]}
            placeholder="e.g. 24"
            placeholderTextColor={theme.muted}
            value={age}
            onChangeText={setAge}
            keyboardType="number-pad"
            maxLength={3}
          />
          <Text style={[st.ageHint, { color: age && parseInt(age) < 13 ? '#ef4444' : theme.muted }]}>
            You must be 13 or older to use this app.
          </Text>

          <FieldLabel theme={theme}>Biological sex</FieldLabel>
          <View style={st.inputRow}>
            {[['male', '♂ Male'], ['female', '♀ Female']].map(([val, label]) => (
              <Pressable
                key={val}
                style={[st.sexBtn, {
                  flex: 1,
                  backgroundColor: sex === val ? ACCENT + '14' : theme.input,
                  borderColor: sex === val ? ACCENT : theme.inputBorder,
                  borderWidth: sex === val ? 2 : 1,
                }]}
                onPress={() => setSex(val)}
              >
                <Text style={[st.sexBtnText, { color: sex === val ? ACCENT : theme.text }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ── Fitness Goal ───────────────────────────────────────────── */}
        <SectionHeader title="FITNESS GOAL" theme={theme} />
        <View style={{ gap: 8, marginBottom: 4 }}>
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
        </View>

        {(fitnessGoal === 'lose' || fitnessGoal === 'gain') && (
          <View style={[st.targetWrap, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <Text style={[st.targetLabel, { color: theme.subtext }]}>
              Target weight{'  '}<Text style={{ color: theme.muted, fontWeight: '500' }}>(optional)</Text>
            </Text>
            <View style={st.inputRow}>
              <TextInput
                style={[st.textInput, { flex: 1, color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder }]}
                placeholder={targetWeightUnit === 'lbs' ? 'e.g. 150' : 'e.g. 68'}
                placeholderTextColor={theme.muted}
                value={targetWeightVal}
                onChangeText={setTargetWeightVal}
                keyboardType="decimal-pad"
              />
              <UnitToggle value={targetWeightUnit} options={['lbs', 'kg']} onChange={setTargetWeightUnit} theme={theme} />
            </View>
            {targetWeightKg ? (
              <Text style={[st.targetNote, { color: theme.muted }]}>
                Protein target will be based on your goal weight.
              </Text>
            ) : (
              <Text style={[st.targetNote, { color: theme.muted }]}>
                Leave blank to calculate based on your current weight.
              </Text>
            )}
          </View>
        )}

        {/* ── Activity Level ─────────────────────────────────────────── */}
        <SectionHeader title="ACTIVITY LEVEL" theme={theme} />
        <View style={{ gap: 8, marginBottom: 4 }}>
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
        </View>

        {/* ── Workout Schedule ───────────────────────────────────────── */}
        <SectionHeader title="WORKOUT SCHEDULE" theme={theme} />
        <View style={[st.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <Text style={[st.cardSubLabel, { color: theme.subtext }]}>Days per week</Text>
          <View style={st.pillRow}>
            {[2, 3, 4, 5, 6].map(d => (
              <Pressable
                key={d}
                style={[st.dayPill, {
                  backgroundColor: workoutDays === d ? ACCENT : theme.input,
                  borderColor: workoutDays === d ? ACCENT : theme.inputBorder,
                }]}
                onPress={() => handleWorkoutDaysChange(d)}
              >
                <Text style={[st.dayPillNum, { color: workoutDays === d ? '#fff' : theme.text }]}>{d}</Text>
                <Text style={[st.dayPillSub, { color: workoutDays === d ? '#ffffffaa' : theme.muted }]}>days</Text>
              </Pressable>
            ))}
          </View>

          {pendingRegen && workoutDays && (
            <Pressable
              style={[st.regenBtn, { backgroundColor: ACCENT + '14', borderColor: ACCENT + '44' }]}
              onPress={regenSplit}
            >
              <Text style={[st.regenBtnText, { color: ACCENT }]}>
                {currentSplit ? `Regenerate split for ${workoutDays} days  →` : `Generate a split  →`}
              </Text>
            </Pressable>
          )}

          {currentSplit && (
            <View style={{ marginTop: 16 }}>
              <View style={st.splitRow}>
                <Text style={[st.splitPreset, { color: theme.text }]}>{currentSplit.preset}</Text>
                <Pressable onPress={regenSplit}>
                  <Text style={[st.shuffleBtn, { color: ACCENT }]}>Shuffle</Text>
                </Pressable>
              </View>
              <View style={st.splitGrid}>
                {DAY_ABBR.map((abbr, i) => {
                  const muscle = (currentSplit.days[i] ?? ['Rest'])[0]
                  const isRest = muscle === 'Rest'
                  return (
                    <View key={i} style={st.splitDayCol}>
                      <Text style={[st.splitDayAbbr, { color: theme.muted }]}>{abbr}</Text>
                      <View style={[st.splitDayChip, {
                        backgroundColor: isRest
                          ? (theme.isDark ? '#ffffff0a' : '#0000000a')
                          : muscleColor(muscle),
                      }]}>
                        <Text
                          style={[st.splitDayChipText, { color: isRest ? theme.muted : muscleTextColor(muscle) }]}
                          numberOfLines={1}
                        >
                          {isRest ? '—' : muscle.length > 5 ? muscle.slice(0, 4) + '.' : muscle}
                        </Text>
                      </View>
                    </View>
                  )
                })}
              </View>
            </View>
          )}
        </View>

        {/* ── Nutrition Targets ──────────────────────────────────────── */}
        <SectionHeader title="NUTRITION TARGETS" theme={theme} />
        <View style={[st.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          {isCustom ? (
            <>
              <Text style={[st.customNote, { color: ACCENT }]}>Custom values</Text>
              <View style={st.customGrid}>
                {[
                  { label: 'Calories', val: customCals,    set: setCustomCals,    unit: 'kcal' },
                  { label: 'Protein',  val: customProtein, set: setCustomProtein, unit: 'g' },
                  { label: 'Carbs',    val: customCarbs,   set: setCustomCarbs,   unit: 'g' },
                  { label: 'Fat',      val: customFat,     set: setCustomFat,     unit: 'g' },
                ].map(f => (
                  <View key={f.label} style={st.customField}>
                    <Text style={[st.customFieldLabel, { color: theme.subtext }]}>{f.label}</Text>
                    <View style={st.customFieldRow}>
                      <TextInput
                        style={[st.customFieldInput, { color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder }]}
                        value={f.val}
                        onChangeText={f.set}
                        keyboardType="number-pad"
                        selectTextOnFocus
                      />
                      <Text style={[st.customFieldUnit, { color: theme.muted }]}>{f.unit}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : calculated ? (
            <>
              <View style={st.calRow}>
                <Text style={[st.calNum, { color: theme.text }]}>{calculated.calories.toLocaleString()}</Text>
                <Text style={[st.calUnit, { color: theme.subtext }]}>kcal / day</Text>
              </View>
              <View style={st.macroRow}>
                {[
                  { label: 'Protein', val: calculated.protein, color: '#ef4444' },
                  { label: 'Carbs',   val: calculated.carbs,   color: '#f59e0b' },
                  { label: 'Fat',     val: calculated.fat,     color: '#3b82f6' },
                ].map(m => (
                  <View key={m.label} style={st.macroBox}>
                    <Text style={[st.macroVal, { color: m.color }]}>{m.val}g</Text>
                    <Text style={[st.macroLabel, { color: theme.muted }]}>{m.label}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <Text style={[st.noCalcNote, { color: theme.muted }]}>
              Fill in your stats, goal, and activity level above to get auto-calculated targets.
            </Text>
          )}

          <Pressable style={st.customToggle} onPress={enableCustom}>
            <Text style={[st.customToggleText, { color: ACCENT }]}>
              {isCustom ? '← Use calculated values' : 'Use my own numbers  →'}
            </Text>
          </Pressable>
        </View>

        {/* ── App Preferences ───────────────────────────────────────── */}
        <SectionHeader title="APP PREFERENCES" theme={theme} />
        <View style={[st.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <Pressable style={st.prefRow} onPress={toggleDark}>
            <Text style={[st.prefLabel, { color: theme.text }]}>Dark Mode</Text>
            <View style={[st.toggle, { backgroundColor: theme.isDark ? ACCENT : theme.inputBorder }]}>
              <View style={[st.toggleKnob, { alignSelf: theme.isDark ? 'flex-end' : 'flex-start' }]} />
            </View>
          </Pressable>
        </View>

        {/* ── Save ──────────────────────────────────────────────────── */}
        <Pressable
          style={[st.saveBtn, { backgroundColor: ACCENT }, saving && { opacity: 0.6 }]}
          onPress={save}
          disabled={saving}
        >
          <Text style={st.saveBtnText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
        </Pressable>

        <Pressable
          style={[st.signOutBtn, { borderColor: theme.cardBorder }]}
          onPress={() => Alert.alert('Sign out', 'Are you sure?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: signOut },
          ])}
        >
          <Text style={[st.signOutText, { color: '#ef4444' }]}>Sign Out</Text>
        </Pressable>

        <Pressable
          style={st.deleteBtn}
          onPress={() => Alert.alert(
            'Delete account',
            'This permanently deletes your account and all your data. This cannot be undone.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete my account',
                style: 'destructive',
                onPress: () => Alert.alert(
                  'Are you absolutely sure?',
                  'Your routines, nutrition logs, and profile will be gone forever.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Yes, delete everything',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          await deleteAccount()
                        } catch (e) {
                          Alert.alert('Error', e.message)
                        }
                      },
                    },
                  ]
                ),
              },
            ]
          )}
        >
          <Text style={st.deleteBtnText}>Delete Account</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const st = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: 16, paddingBottom: 52 },

  sectionHeader: {
    fontSize: 11, fontWeight: '800', letterSpacing: 1.4,
    marginTop: 22, marginBottom: 10, marginLeft: 4,
  },

  card: {
    borderRadius: 20, borderWidth: 1, padding: 18, marginBottom: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  cardSubLabel: { fontSize: 13, fontWeight: '600', marginBottom: 12 },

  fieldLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4, marginBottom: 8, marginTop: 14 },
  textInput: {
    borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 16, fontWeight: '500', marginBottom: 4,
  },
  inputRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 4 },
  unitSep: { fontSize: 13, fontWeight: '600' },

  unitToggle: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 3, gap: 2 },
  unitBtn: { paddingHorizontal: 14, paddingVertical: 7 },
  unitBtnText: { fontSize: 13, fontWeight: '700' },

  sexBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  sexBtnText: { fontSize: 15, fontWeight: '700' },

  optCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 18, padding: 18,
  },
  optEmoji: { fontSize: 26, width: 32, textAlign: 'center' },
  optLabel: { fontSize: 16, fontWeight: '700' },
  optSub: { fontSize: 13, marginTop: 2 },
  optRadio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  optRadioFill: { width: 11, height: 11, borderRadius: 6 },

  pillRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  dayPill: {
    width: 56, paddingVertical: 14, borderRadius: 16, borderWidth: 1.5,
    alignItems: 'center',
  },
  dayPillNum: { fontSize: 20, fontWeight: '800' },
  dayPillSub: { fontSize: 10, fontWeight: '600', marginTop: 2 },

  regenBtn: { borderRadius: 12, borderWidth: 1, padding: 12, alignItems: 'center', marginTop: 12 },
  regenBtnText: { fontSize: 14, fontWeight: '700' },

  splitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  splitPreset: { fontSize: 15, fontWeight: '700' },
  shuffleBtn: { fontSize: 13, fontWeight: '700' },
  splitGrid: { flexDirection: 'row', gap: 4 },
  splitDayCol: { flex: 1, alignItems: 'center', gap: 5 },
  splitDayAbbr: { fontSize: 10, fontWeight: '700' },
  splitDayChip: { width: '100%', borderRadius: 8, paddingVertical: 6, alignItems: 'center' },
  splitDayChipText: { fontSize: 9, fontWeight: '700' },

  calRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 14 },
  calNum: { fontSize: 40, fontWeight: '800', letterSpacing: -1 },
  calUnit: { fontSize: 14, fontWeight: '600' },
  macroRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 10 },
  macroBox: { alignItems: 'center' },
  macroVal: { fontSize: 20, fontWeight: '800' },
  macroLabel: { fontSize: 11, fontWeight: '600', marginTop: 2 },

  noCalcNote: { fontSize: 13, lineHeight: 18, textAlign: 'center', paddingVertical: 10 },

  targetWrap: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 4 },
  targetLabel: { fontSize: 13, fontWeight: '700', marginBottom: 10 },
  targetNote: { fontSize: 12, marginTop: 8, lineHeight: 17 },

  customNote: { fontSize: 12, fontWeight: '700', marginBottom: 12 },
  customGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  customField: { width: '47%' },
  customFieldLabel: { fontSize: 11, fontWeight: '700', marginBottom: 6 },
  customFieldRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  customFieldInput: {
    flex: 1, borderRadius: 10, borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 9,
    fontSize: 16, fontWeight: '700', textAlign: 'center',
  },
  customFieldUnit: { fontSize: 12, fontWeight: '600' },
  customToggle: { alignItems: 'center', paddingTop: 12 },
  customToggleText: { fontSize: 13, fontWeight: '700' },

  prefRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingVertical: 4,
  },
  prefLabel: { fontSize: 15, fontWeight: '600' },
  toggle: { width: 44, height: 24, borderRadius: 12, padding: 3, justifyContent: 'center' },
  toggleKnob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },

  saveBtn: {
    borderRadius: 18, padding: 18, alignItems: 'center', marginTop: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12, shadowRadius: 8, elevation: 4,
  },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 17 },

  // Profile section
  avatarWrap: {
    alignSelf: 'center', marginBottom: 20, marginTop: 4,
  },
  avatarImage: {
    width: 80, height: 80, borderRadius: 40,
  },
  avatarPlaceholder: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: 32, fontWeight: '800', color: '#fff' },
  avatarBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#6366f1',
  },
  usernameHint: { fontSize: 12, fontWeight: '600', marginBottom: 10, marginLeft: 2 },
  emailRow: {
    borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 13,
    marginBottom: 4,
  },
  emailText: { fontSize: 16, fontWeight: '500' },
  bioInput: { height: 88, textAlignVertical: 'top', paddingTop: 12 },
  profileSaveBtn: {
    borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginTop: 12,
  },
  profileSaveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  visRow: { flexDirection: 'row', borderRadius: 12, borderWidth: 1, padding: 3, gap: 3 },
  visBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  visBtnText: { fontSize: 13, fontWeight: '700' },
  visHint: { fontSize: 12, fontWeight: '500', marginTop: 8, lineHeight: 16 },
  ageHint: { fontSize: 12, fontWeight: '600', marginTop: 6, marginBottom: 2, marginLeft: 2 },

  signOutBtn: {
    borderRadius: 18, padding: 16, alignItems: 'center',
    marginTop: 12, marginBottom: 8, borderWidth: 1.5,
  },
  signOutText: { fontWeight: '700', fontSize: 16 },

  deleteBtn: {
    alignItems: 'center', paddingVertical: 14, marginBottom: 32,
  },
  deleteBtnText: { color: '#ef444488', fontSize: 14, fontWeight: '600' },
})
