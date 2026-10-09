import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import {
  View, Text, Pressable, ScrollView, TextInput,
  StyleSheet, Alert, ActivityIndicator, Switch,
  KeyboardAvoidingView, Platform, Share, Modal,
} from 'react-native'
import { Image } from 'expo-image'
import { useFocusEffect, router } from 'expo-router'
import { useAuth } from '../../lib/AuthContext'
import { useTheme } from '../../lib/ThemeContext'
import { getUserGoals, saveUserGoals } from '../../lib/goalsStorage'
import {
  saveGymSplit, getRoutineNames, getRoutineTemplate, getHistory,
  getWorkoutRoutineList, getWorkoutPlan, getAllWorkoutLogs,
  getRecentMealHistory, getJournalEntries,
} from '../../lib/storage'
import { getBlockedIds, unblockUser } from '../../lib/blockedStorage'
import { supabase } from '../../lib/supabase'
import {
  calculateGoals, generateGymSplit,
  ACTIVITY_LABELS, GOAL_LABELS,
} from '../../lib/goals'
import { muscleColor, muscleTextColor } from '../../lib/splitData'
import {
  checkUsernameAvailable, upsertProfile, pickAndUploadAvatar,
  updateAvatarUrl, updateVisibility,
} from '../../lib/profileStorage'
import { getSections, saveSections, DEFAULT_SECTIONS } from '../../lib/sectionsStorage'
import { getRoutinePrefs, saveRoutinePrefs, DEFAULT_ROUTINE_PREFS } from '../../lib/routinePrefs'
import {
  getLogSettings, saveLogSettings, slotStarts, timeLabel,
  LOG_INTERVALS, DEFAULT_LOG_SETTINGS,
} from '../../lib/timeLogging'

const ACCENT = '#6366f1'
const DAY_ABBR = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// The daily targets the Meals tab measures against.
const GOAL_FIELDS = [
  { key: 'calories', label: 'Calories', unit: 'kcal' },
  { key: 'protein',  label: 'Protein',  unit: 'g' },
  { key: 'carbs',    label: 'Carbs',    unit: 'g' },
  { key: 'fat',      label: 'Fat',      unit: 'g' },
]

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

// Postgres RAISE EXCEPTION puts the code in `message` and the readable text in `hint`.
const FRIENDLY_DB_ERRORS = {
  inappropriate_content: "That contains a word we don't allow. Please edit it and try again.",
  name_too_long: 'Your name is too long — please keep it under 40 characters.',
  username_too_long: 'That username is too long — please keep it under 30 characters.',
  bio_too_long: 'Your bio is too long — please keep it under 200 characters.',
  invalid_avatar_url: 'Please upload your photo through the app.',
}

function friendlyError(e, fallback = 'Something went wrong. Please try again.') {
  return FRIENDLY_DB_ERRORS[e?.message] ?? e?.hint ?? e?.message ?? fallback
}

// A typed weight in the other unit, or the text as it was when it isn't one.
// Switching units converts what is typed: 75 kg used to become "75 lbs".
function convertWeight(text, toUnit) {
  const w = parseFloat(text)
  if (!(w > 0)) return text
  return String(toUnit === 'kg' ? +(w * 0.453592).toFixed(1) : +(w / 0.453592).toFixed(1))
}

export default function SettingsScreen() {
  const { user, profile, profileError, refreshProfile, signOut, deleteAccount } = useAuth()
  const { theme, toggleDark, unit: appUnit, toggleUnit } = useTheme()
  const userId = user?.id ?? null

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
  const [retryingProfile, setRetryingProfile] = useState(false)
  // Name, username or bio typed into since they were last loaded or saved.
  const profileTouched = useRef(false)
  const editProfile = set => v => { profileTouched.current = true; set(v) }
  const usernameTimerRef = useRef(null)
  // What is in the username box now. A slow answer about an earlier spelling
  // used to land late and mark the current one "available".
  const latestUsername = useRef('')
  // Only the newest privacy change may roll the switch back if it fails.
  const visibilityReq = useRef(0)
  const mounted = useRef(false)

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

  // App sections (drives the hidden SECTIONS / BOTTOM TABS toggle groups)
  const [sections, setSections] = useState({ ...DEFAULT_SECTIONS })

  // Time logging
  const [logSettings, setLogSettings] = useState(DEFAULT_LOG_SETTINGS)
  const [timePicking, setTimePicking] = useState(null) // 'activeStart' | 'activeEnd' | null

  // Privacy & data
  const [blockedOpen, setBlockedOpen]       = useState(false)
  const [blockedList, setBlockedList]       = useState([])
  const [blockedLoading, setBlockedLoading] = useState(false)
  const [exporting, setExporting]           = useState(false)

  // How routines run once started (step-by-step timer vs checklist)
  const [routinePrefs, setRoutinePrefs] = useState({ ...DEFAULT_ROUTINE_PREFS })

  // Goal fields changed since they were loaded or saved. Every visit to this
  // tab reloads the stored goals (they change on other devices too), but only
  // into fields the user hasn't touched: a reload used to put the spinner up,
  // jump back to the top and throw away whatever was being edited.
  const editedGoals = useRef(new Set())
  // The stored goals as last loaded or saved, so an unchanged reload is a no-op.
  const loadedGoals = useRef(null)
  const goalsReq = useRef(0)
  const markEdited = key => editedGoals.current.add(key)
  const edit = (key, set) => v => { markEdited(key); set(v) }

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useFocusEffect(useCallback(() => {
    if (userId) {
      getSections(userId).then(setSections)
      getLogSettings(userId).then(setLogSettings)
      getRoutinePrefs(userId).then(setRoutinePrefs)
    }
  }, [userId]))

  async function toggleSection(name) {
    const next = { ...sections, [name]: !sections[name] }
    setSections(next)
    await saveSections(user.id, next)
  }

  async function setChecklistDefault(on) {
    const runMode = on ? 'checklist' : 'steps'
    setRoutinePrefs(p => ({ ...p, runMode }))
    // Patch, not the whole object: hideWorkouts is owned by the Fitness screen.
    setRoutinePrefs(await saveRoutinePrefs(user.id, { runMode }))
  }

  async function updateLogSettings(patch) {
    const next = { ...logSettings, ...patch }
    setLogSettings(next)
    await saveLogSettings(user.id, next)
  }

  // Load the profile into the form, and again whenever it changes (a retry
  // that reached the account, a save), leaving name, username and bio alone
  // while they're being edited. Loading it only once kept a stale device copy
  // on screen after a retry, and Save Changes then wrote it back.
  useEffect(() => {
    if (!profile) return
    if (!profileTouched.current) {
      setLocalName(profile.name ?? '')
      setLocalUsername(profile.username ?? '')
      setLocalBio(profile.bio ?? '')
    }
    setVisibility(profile.visibility ?? 'friends')
    setAvatarUri(profile.avatar_url || null)
  }, [profile])

  // Username availability check
  useEffect(() => {
    const normalized = localUsername.toLowerCase().trim()
    latestUsername.current = normalized
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
      const ok = await checkUsernameAvailable(normalized, userId)
      if (latestUsername.current !== normalized) return
      setUsernameStatus(ok ? 'available' : 'taken')
    }, 500)
    return () => clearTimeout(usernameTimerRef.current)
  }, [localUsername, profile, userId])

  // The spinner is for the first load only; later visits refresh in place.
  useFocusEffect(useCallback(() => {
    if (!userId) return
    const req = ++goalsReq.current
    getUserGoals(userId).then(goals => {
      // A save since this load began has put newer values on screen.
      if (req !== goalsReq.current) return
      const json = JSON.stringify(goals ?? null)
      if (goals && json !== loadedGoals.current) {
        const keep = key => editedGoals.current.has(key)
        const kg = goals.weightKg
        if (kg && !keep('weight')) {
          const unit = appUnit === 'kg' ? 'kg' : 'lbs'
          setWeightUnit(unit)
          setWeightVal(String(unit === 'lbs' ? +(kg / 0.453592).toFixed(1) : kg))
        }
        if (goals.heightCm && !keep('height')) {
          setHeightMode('cm')
          setHeightCm(String(goals.heightCm))
        }
        if (goals.age && !keep('age')) setAge(String(goals.age))
        if (goals.sex && !keep('sex')) setSex(goals.sex)
        if (goals.fitnessGoal && goals.fitnessGoal !== 'none' && !keep('goal')) setFitnessGoal(goals.fitnessGoal)
        if (goals.targetWeightKg && !keep('target')) {
          const unit = appUnit === 'kg' ? 'kg' : 'lbs'
          setTargetWeightUnit(unit)
          setTargetWeightVal(String(unit === 'lbs' ? +(goals.targetWeightKg / 0.453592).toFixed(1) : goals.targetWeightKg))
        }
        if (goals.activityLevel && !keep('activity')) setActivityLevel(goals.activityLevel)
        if (goals.workoutDaysPerWeek && !keep('days')) {
          setWorkoutDays(goals.workoutDaysPerWeek)
          setOrigWorkoutDays(goals.workoutDaysPerWeek)
        }
        if (goals.gymSplit && !keep('split')) setCurrentSplit(goals.gymSplit)
        if (goals.isCustom && !keep('nutrition')) {
          setIsCustom(true)
          setCustomCals(String(goals.calories ?? ''))
          setCustomProtein(String(goals.protein ?? ''))
          setCustomCarbs(String(goals.carbs ?? ''))
          setCustomFat(String(goals.fat ?? ''))
        }
      }
      loadedGoals.current = json
      setLoading(false)
    })
  }, [userId]))

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
    markEdited('nutrition')
    if (!isCustom) {
      setCustomCals(String(calculated?.calories ?? ''))
      setCustomProtein(String(calculated?.protein ?? ''))
      setCustomCarbs(String(calculated?.carbs ?? ''))
      setCustomFat(String(calculated?.fat ?? ''))
    }
    setIsCustom(v => !v)
  }

  // The Nutrition Goals card shows the calculated numbers until one is edited;
  // the first edit takes over from the calculator, seeding the other three
  // fields with their calculated values so only the touched one changes.
  const goalSetters = { calories: setCustomCals, protein: setCustomProtein, carbs: setCustomCarbs, fat: setCustomFat }
  const goalValues  = { calories: customCals, protein: customProtein, carbs: customCarbs, fat: customFat }
  function goalFieldValue(key) {
    if (isCustom) return goalValues[key]
    const v = calculated?.[key]
    return v == null ? '' : String(v)
  }
  function editGoalField(key, v) {
    markEdited('nutrition')
    if (!isCustom) {
      setCustomCals(String(calculated?.calories ?? ''))
      setCustomProtein(String(calculated?.protein ?? ''))
      setCustomCarbs(String(calculated?.carbs ?? ''))
      setCustomFat(String(calculated?.fat ?? ''))
      setIsCustom(true)
    }
    goalSetters[key](v)
  }

  function handleWorkoutDaysChange(d) {
    markEdited('days')
    setWorkoutDays(d)
    setPendingRegen(d !== origWorkoutDays || !currentSplit)
  }

  function regenSplit() {
    if (!workoutDays) return
    markEdited('days')
    markEdited('split')
    const newSplit = generateGymSplit(workoutDays)
    setCurrentSplit(newSplit)
    setOrigWorkoutDays(workoutDays)
    setPendingRegen(false)
  }

  function switchWeightUnit(next) {
    if (next === weightUnit) return
    markEdited('weight')
    setWeightVal(v => convertWeight(v, next))
    setWeightUnit(next)
  }

  function switchTargetUnit(next) {
    if (next === targetWeightUnit) return
    markEdited('target')
    setTargetWeightVal(v => convertWeight(v, next))
    setTargetWeightUnit(next)
  }

  // Feet and inches are filled in from centimetres and back. Switching used
  // to show empty boxes, and saving from them wrote no height (and so no
  // calculated targets) at all.
  function switchHeightMode(next) {
    if (next === heightMode) return
    markEdited('height')
    if (next === 'ft') {
      const inches = Math.round((parseFloat(heightCm) || 0) / 2.54)
      setHeightFt(inches > 0 ? String(Math.floor(inches / 12)) : '')
      setHeightIn(inches > 0 ? String(inches % 12) : '')
    } else {
      setHeightCm(heightCmVal ? String(Math.round(heightCmVal)) : '')
    }
    setHeightMode(next)
  }

  async function handlePickAvatar() {
    if (!user || !profile) return
    setUploadingAvatar(true)
    try {
      const url = await pickAndUploadAvatar(user.id)
      if (!url) return
      // Only the photo. This used to save the whole profile from the form,
      // committing an unsaved (possibly invalid or taken) username with it.
      await updateAvatarUrl(user.id, url)
      setAvatarUri(url)
      await refreshProfile()
    } catch (e) {
      Alert.alert('Error', friendlyError(e, 'We could not update your photo. Please try again.'))
    } finally {
      setUploadingAvatar(false)
    }
  }

  // Saved the moment it is tapped, like the other switches on this screen.
  // It used to wait for a Save that never included it, while saying "Saved".
  async function changeVisibility(next) {
    if (!user || !profile || next === visibility) return
    const prev = visibility
    const req = ++visibilityReq.current
    setVisibility(next)
    try {
      await updateVisibility(user.id, next)
      if (req === visibilityReq.current) refreshProfile()
    } catch (e) {
      if (req !== visibilityReq.current) return
      setVisibility(prev)
      Alert.alert('Error', friendlyError(e, 'We could not change who can see your activity. Please try again.'))
    }
  }

  // Name, username and bio differ from the saved profile.
  function profileEdited() {
    if (!profile) return false
    return localName.trim() !== (profile.name ?? '').trim()
      || localUsername.toLowerCase().trim() !== (profile.username ?? '').toLowerCase()
      || localBio.trim() !== (profile.bio ?? '').trim()
  }

  // Why the profile fields can't be saved as they are, or null.
  function profileProblem() {
    if (!profile) return "Your profile hasn't loaded yet. Check your connection and try again."
    if (usernameStatus === 'checking') return 'Still checking that username. Try again in a moment.'
    if (usernameStatus !== 'available') return 'Please choose a valid, available username.'
    return null
  }

  async function writeProfile() {
    await upsertProfile(user.id, {
      username: localUsername.toLowerCase().trim(),
      bio: localBio.trim(),
      avatar_url: avatarUri ?? '',
      name: localName.trim(),
    })
    profileTouched.current = false
    await refreshProfile()
  }

  async function saveProfile() {
    if (!user || savingProfile || saving) return
    const problem = profileProblem()
    if (problem) {
      Alert.alert('Profile not saved', problem)
      return
    }
    setSavingProfile(true)
    try {
      await writeProfile()
      Alert.alert('Saved', 'Profile updated.')
    } catch (e) {
      Alert.alert('Error', friendlyError(e, 'We could not save your profile. Please try again.'))
    } finally {
      setSavingProfile(false)
    }
  }

  async function retryProfile() {
    setRetryingProfile(true)
    try { await refreshProfile() } finally { setRetryingProfile(false) }
  }

  async function loadBlocked() {
    if (!user) return
    setBlockedLoading(true)
    try {
      const ids = await getBlockedIds(user.id, { force: true })
      if (!ids.length) {
        setBlockedList([])
        return
      }
      const { data } = await supabase
        .from('public_profiles')
        .select('id, username, name')
        .in('id', ids)
      const byId = {}
      ;(data ?? []).forEach(p => { byId[p.id] = p })
      setBlockedList(ids.map(id => byId[id] ?? { id }))
    } finally {
      setBlockedLoading(false)
    }
  }

  function toggleBlockedList() {
    const next = !blockedOpen
    setBlockedOpen(next)
    if (next) loadBlocked()
  }

  function confirmUnblock(entry) {
    const label = entry.username ? `@${entry.username}` : 'This person'
    Alert.alert(
      'Unblock',
      `${label} will be able to see your profile and reach you in the community again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: async () => {
            try {
              await unblockUser(user.id, entry.id)
              setBlockedList(list => list.filter(b => b.id !== entry.id))
            } catch (e) {
              Alert.alert('Error', friendlyError(e, 'Could not unblock right now.'))
            }
          },
        },
      ]
    )
  }

  async function exportData() {
    if (!user || exporting) return
    setExporting(true)
    try {
      const [goals, routineNames, history, workoutList, workoutLogs, meals, journal] =
        await Promise.all([
          getUserGoals(user.id),
          getRoutineNames(user.id),
          getHistory(user.id, { sinceDays: null }), // export wants the full history, not the display window
          getWorkoutRoutineList(user.id),
          getAllWorkoutLogs(user.id),
          getRecentMealHistory(user.id, 3650),
          getJournalEntries(user.id),
        ])

      const routineTemplates = {}
      for (const name of routineNames) {
        routineTemplates[name] = await getRoutineTemplate(user.id, name)
      }
      const workouts = {}
      for (const w of workoutList) {
        workouts[w.name] = await getWorkoutPlan(user.id, w.name)
      }

      const payload = {
        exportedAt: new Date().toISOString(),
        account: {
          email: user.email ?? null,
          username: profile?.username ?? null,
          name: profile?.name ?? null,
        },
        goals,
        routines: routineTemplates,
        history,
        workouts,
        workoutLogs,
        meals,
        journal,
      }

      await Share.share({
        title: 'My LifeLayer data',
        message: JSON.stringify(payload, null, 2),
      })
    } catch (e) {
      Alert.alert('Export failed', friendlyError(e, 'We could not gather your data. Please try again.'))
    } finally {
      setExporting(false)
    }
  }

  // Returns false when the goals were not saved (and says why).
  async function saveGoals() {
    if (age && parseInt(age) < 13) {
      Alert.alert('Age requirement', 'You must be 13 or older to use this app.')
      return false
    }
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
    // What is on screen is now what is stored: a load still in flight is
    // older, and later visits may refresh every field again.
    goalsReq.current++
    loadedGoals.current = JSON.stringify(goals)
    editedGoals.current.clear()
    if (currentSplit) await saveGymSplit(user.id, currentSplit).catch(() => {})
    return true
  }

  // The Nutrition Goals card's button: goals only.
  async function save() {
    if (!user || saving) return
    setSaving(true)
    try {
      if (await saveGoals()) Alert.alert('Saved', 'Your goals have been updated.')
    } finally {
      setSaving(false)
    }
  }

  // Save Changes at the bottom saves everything on the screen that changed.
  // It used to save only the goals and still say "Saved", while a new name,
  // username or bio typed above was quietly left behind.
  async function saveChanges() {
    if (!user || saving || savingProfile) return
    const withProfile = profileEdited()
    // Checked before anything is written, so the tap doesn't half-save.
    const problem = withProfile ? profileProblem() : null
    if (problem) {
      Alert.alert('Profile not saved', problem)
      return
    }
    setSaving(true)
    try {
      if (!(await saveGoals())) return
      if (withProfile) {
        setSavingProfile(true)
        try {
          await writeProfile()
        } catch (e) {
          Alert.alert('Profile not saved', `Your goals were saved, but your profile wasn't. ${friendlyError(e, 'Please try again.')}`)
          return
        } finally {
          setSavingProfile(false)
        }
      }
      Alert.alert('Saved', withProfile ? 'Your profile and goals have been updated.' : 'Your goals have been updated.')
    } finally {
      setSaving(false)
    }
  }

  // Sign-out drops the offline write queue (deliberate — queued writes must
  // never replay into a different account), so when the flush can't land
  // everything, signOut refuses and reports what's at stake. Only an explicit
  // "anyway" from the user forces it through.
  async function handleSignOut(force = false) {
    const result = await signOut({ force })
    if (result?.error) {
      // Nothing was signed out or cleared; the app stays as it is.
      Alert.alert("Couldn't sign out", "You're still signed in. Check your connection and try again.")
      return
    }
    if (result?.pendingSync) {
      const n = result.pendingSync
      Alert.alert(
        'Unsynced changes',
        `${n} ${n === 1 ? "change hasn't" : "changes haven't"} synced yet — signing out will discard ${n === 1 ? 'it' : 'them'}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign out anyway', style: 'destructive', onPress: () => handleSignOut(true) },
        ]
      )
      return
    }
    // Signed out. The tabs send a signed-out user to the login screen as soon
    // as they re-render, and usually already have; this covers the moment
    // before they do.
    if (mounted.current) router.replace('/(auth)/login')
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
          {/* Nothing to edit until the profile is known: saving these fields
              blank over a profile that couldn't be read would wipe it. */}
          {!profile ? (
            profileError ? (
              <View style={st.profileMissing}>
                <Text style={[st.profileMissingTitle, { color: theme.text }]}>We couldn't load your profile</Text>
                <Text style={[st.profileMissingSub, { color: theme.muted }]}>
                  Check your connection and try again.
                </Text>
                <Pressable
                  style={[st.profileSaveBtn, { backgroundColor: ACCENT, alignSelf: 'stretch' }, retryingProfile && { opacity: 0.6 }]}
                  onPress={retryProfile}
                  disabled={retryingProfile}
                >
                  {retryingProfile
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={st.profileSaveBtnText}>Retry</Text>}
                </Pressable>
              </View>
            ) : (
              <ActivityIndicator color={ACCENT} style={{ marginVertical: 18 }} />
            )
          ) : (<>

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
            onChangeText={editProfile(setLocalName)}
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
            onChangeText={editProfile(setLocalUsername)}
            maxLength={20}
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
            onChangeText={editProfile(setLocalBio)}
            maxLength={200}
          />

          <FieldLabel theme={theme}>Who can see your activity</FieldLabel>
          <View style={[st.visRow, { backgroundColor: theme.isDark ? theme.input : '#f0f0f8', borderColor: theme.inputBorder }]}>
            {[
              ['everyone', 'Everyone'],
              ['friends', 'Friends'],
              ['none', 'No one'],
            ].map(([val, label]) => (
              <Pressable
                key={val}
                style={[st.visBtn, visibility === val && { backgroundColor: ACCENT }]}
                onPress={() => changeVisibility(val)}
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
          </>)}
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
              onChangeText={edit('weight', setWeightVal)}
              keyboardType="decimal-pad"
            />
            <UnitToggle value={weightUnit} options={['lbs', 'kg']} onChange={switchWeightUnit} theme={theme} />
          </View>

          <FieldLabel theme={theme}>Height</FieldLabel>
          <View style={[st.inputRow, { marginBottom: 6 }]}>
            <UnitToggle value={heightMode} options={['ft', 'cm']} onChange={switchHeightMode} theme={theme} />
          </View>
          {heightMode === 'ft' ? (
            <View style={st.inputRow}>
              <View style={{ flex: 1 }}>
                <TextInput
                  style={[st.textInput, { color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder }]}
                  placeholder="ft"
                  placeholderTextColor={theme.muted}
                  value={heightFt}
                  onChangeText={edit('height', setHeightFt)}
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
                  onChangeText={edit('height', setHeightIn)}
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
              onChangeText={edit('height', setHeightCm)}
              keyboardType="decimal-pad"
            />
          )}

          <FieldLabel theme={theme}>Age</FieldLabel>
          <TextInput
            style={[st.textInput, { color: theme.text, backgroundColor: theme.input, borderColor: theme.inputBorder }]}
            placeholder="e.g. 24"
            placeholderTextColor={theme.muted}
            value={age}
            onChangeText={edit('age', setAge)}
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
                onPress={edit('sex', () => setSex(val))}
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
              onPress={edit('goal', () => setFitnessGoal(opt.key))}
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
                onChangeText={edit('target', setTargetWeightVal)}
                keyboardType="decimal-pad"
              />
              <UnitToggle value={targetWeightUnit} options={['lbs', 'kg']} onChange={switchTargetUnit} theme={theme} />
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
              onPress={edit('activity', () => setActivityLevel(lvl))}
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

        {/* ── Nutrition Goals — the targets the Meals tab measures against ── */}
        <SectionHeader title="NUTRITION GOALS" theme={theme} />
        <View style={[st.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          {GOAL_FIELDS.map((f, i) => (
            <View key={f.key}>
              {i > 0 && <View style={[st.tlDivider, { backgroundColor: theme.divider, marginVertical: 8 }]} />}
              <View style={st.prefRow}>
                <Text style={[st.prefLabel, { color: theme.text }]}>{f.label}</Text>
                <View style={st.goalInputWrap}>
                  <TextInput
                    value={goalFieldValue(f.key)}
                    onChangeText={v => editGoalField(f.key, v)}
                    keyboardType="number-pad"
                    placeholder="—"
                    placeholderTextColor={theme.muted}
                    selectTextOnFocus
                    style={[st.goalInput, {
                      backgroundColor: theme.input,
                      borderColor: theme.inputBorder,
                      color: theme.text,
                    }]}
                  />
                  <Text style={[st.goalUnit, { color: theme.muted }]}>{f.unit}</Text>
                </View>
              </View>
            </View>
          ))}

          <Pressable
            onPress={save}
            disabled={saving}
            style={[st.saveGoalsBtn, { backgroundColor: ACCENT }, saving && { opacity: 0.6 }]}
          >
            <Text style={st.saveGoalsText}>{saving ? 'Saving…' : 'Save Goals'}</Text>
          </Pressable>

          <Text style={[st.tlFootnote, { color: theme.muted, marginTop: 10 }]}>
            {isCustom
              ? 'Your own numbers. Leave everything blank to track meals without targets.'
              : calculated
                ? 'Calculated from your stats above. Edit any number to set your own.'
                : 'Fill in your stats above for calculated targets, or type your own numbers.'}
          </Text>
          {isCustom && calculated && (
            <Pressable style={st.customToggle} onPress={enableCustom}>
              <Text style={[st.customToggleText, { color: ACCENT }]}>← Use calculated values</Text>
            </Pressable>
          )}
        </View>

        {/* ── Time Logging ──────────────────────────────────────────── */}
        <SectionHeader title="TIME LOGGING" theme={theme} />
        <View style={[st.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <View style={st.prefRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[st.prefLabel, { color: theme.text }]}>Log my day</Text>
              <Text style={[st.tlHint, { color: theme.muted }]}>
                Adds a Time log tab under Calendar → Week
              </Text>
            </View>
            <Switch
              value={logSettings.enabled}
              onValueChange={v => updateLogSettings({ enabled: v })}
              trackColor={{ false: '#e0e0f0', true: ACCENT }}
              thumbColor="#ffffff"
              ios_backgroundColor="#e0e0f0"
            />
          </View>

          {logSettings.enabled && (<>
            <View style={[st.tlDivider, { backgroundColor: theme.divider }]} />
            <View style={st.prefRow}>
              <Text style={[st.prefLabel, { color: theme.text }]}>Remind me to log</Text>
              <Switch
                value={logSettings.remind}
                onValueChange={v => updateLogSettings({ remind: v })}
                trackColor={{ false: '#e0e0f0', true: ACCENT }}
                thumbColor="#ffffff"
                ios_backgroundColor="#e0e0f0"
              />
            </View>

            <View style={[st.tlDivider, { backgroundColor: theme.divider }]} />
            <View style={st.prefRow}>
              <Text style={[st.prefLabel, { color: theme.text }]}>Log every</Text>
              <View style={st.tlSegment}>
                {LOG_INTERVALS.map(iv => {
                  const active = logSettings.interval === iv
                  return (
                    <Pressable
                      key={iv}
                      onPress={() => updateLogSettings({ interval: iv })}
                      style={[st.tlSegmentBtn, {
                        backgroundColor: active ? ACCENT : (theme.isDark ? '#1c1c32' : '#f0f0f8'),
                      }]}
                    >
                      <Text style={[st.tlSegmentText, { color: active ? '#fff' : theme.subtext }]}>{iv}m</Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>

            <View style={[st.tlDivider, { backgroundColor: theme.divider }]} />
            <Pressable style={st.prefRow} onPress={() => setTimePicking('activeStart')}>
              <Text style={[st.prefLabel, { color: theme.text }]}>Day starts</Text>
              <Text style={[st.tlValue, { color: theme.accent }]}>
                {timeLabel(logSettings.activeStart)}  ›
              </Text>
            </Pressable>

            <View style={[st.tlDivider, { backgroundColor: theme.divider }]} />
            <Pressable style={st.prefRow} onPress={() => setTimePicking('activeEnd')}>
              <Text style={[st.prefLabel, { color: theme.text }]}>Day ends</Text>
              <Text style={[st.tlValue, { color: theme.accent }]}>
                {timeLabel(logSettings.activeEnd)}  ›
              </Text>
            </Pressable>

            <Text style={[st.tlFootnote, { color: theme.muted }]}>
              {slotStarts(logSettings).length} slots per day
              {logSettings.remind ? ', with a reminder at the end of each one' : ''}
            </Text>
          </>)}
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

          <View style={[st.prefRow, { marginTop: 14 }]}>
            <Text style={[st.prefLabel, { color: theme.text }]}>Weight Unit</Text>
            <Pressable
              onPress={toggleUnit}
              style={[st.unitPill, { backgroundColor: theme.isDark ? '#28284a' : '#ebebf5' }]}
            >
              <Text style={[st.unitPillText, { color: theme.accent }]}>{appUnit.toUpperCase()}</Text>
            </Pressable>
          </View>

          <View style={[st.prefRow, { marginTop: 14 }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[st.prefLabel, { color: theme.text }]}>Checklist by default</Text>
              <Text style={[st.tlHint, { color: theme.muted }]}>
                Open routines as a tick-off list with a total timer, instead of one task at a time
              </Text>
            </View>
            <Switch
              value={routinePrefs.runMode === 'checklist'}
              onValueChange={setChecklistDefault}
              trackColor={{ false: '#e0e0f0', true: ACCENT }}
              thumbColor="#ffffff"
              ios_backgroundColor="#e0e0f0"
            />
          </View>

          {/* SECTIONS + BOTTOM TABS toggle groups — HIDDEN for now via `false &&` (not deleted) */}
          {false && (<>
          <Text style={[st.prefGroupLabel, { color: theme.muted }]}>SECTIONS</Text>
          {[
            ['weekly', '🗓️', 'Weekly tab'],
          ].map(([key, icon, label]) => (
            <View key={key} style={st.prefRow}>
              <Text style={[st.prefLabel, { color: theme.text }]}>{icon}  {label}</Text>
              <Switch
                value={sections[key]}
                onValueChange={() => toggleSection(key)}
                trackColor={{ false: '#e0e0f0', true: '#5c5ef0' }}
                thumbColor="#ffffff"
                ios_backgroundColor="#e0e0f0"
              />
            </View>
          ))}

          <Text style={[st.prefGroupLabel, { color: theme.muted }]}>BOTTOM TABS</Text>
          {[
            ['tabMeals', '🍽️', 'Meals'],
            ['tabCalendar', '📅', 'Calendar'],
            ['tabExplore', '🧭', 'Explore'],
          ].map(([key, icon, label]) => (
            <View key={key} style={st.prefRow}>
              <Text style={[st.prefLabel, { color: theme.text }]}>{icon}  {label}</Text>
              <Switch
                value={sections[key] !== false}
                onValueChange={() => toggleSection(key)}
                trackColor={{ false: '#e0e0f0', true: '#5c5ef0' }}
                thumbColor="#ffffff"
                ios_backgroundColor="#e0e0f0"
              />
            </View>
          ))}
          </>)}
        </View>

        {/* ── Privacy & Data ────────────────────────────────────────── */}
        <SectionHeader title="PRIVACY & DATA" theme={theme} />
        <View style={[st.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <Pressable style={st.prefRow} onPress={toggleBlockedList}>
            <Text style={[st.prefLabel, { color: theme.text }]}>Blocked users</Text>
            <Text style={[st.prefChevron, { color: theme.muted }]}>{blockedOpen ? '⌄' : '›'}</Text>
          </Pressable>

          {blockedOpen && (
            <View style={st.blockedList}>
              {blockedLoading ? (
                <ActivityIndicator size="small" color={ACCENT} style={{ marginVertical: 14 }} />
              ) : blockedList.length === 0 ? (
                <Text style={[st.blockedEmpty, { color: theme.muted }]}>
                  You haven't blocked anyone. Blocked people can't see your profile or reach you in the community.
                </Text>
              ) : blockedList.map(entry => (
                <View key={entry.id} style={[st.blockedRow, { borderTopColor: theme.divider }]}>
                  <Text style={[st.blockedName, { color: theme.text }]} numberOfLines={1}>
                    {entry.username ? `@${entry.username}` : 'Deleted account'}
                  </Text>
                  <Pressable
                    style={[st.unblockBtn, { borderColor: ACCENT }]}
                    onPress={() => confirmUnblock(entry)}
                    hitSlop={6}
                  >
                    <Text style={[st.unblockBtnText, { color: ACCENT }]}>Unblock</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <Pressable style={[st.prefRow, { marginTop: 16 }]} onPress={exportData} disabled={exporting}>
            <Text style={[st.prefLabel, { color: theme.text }]}>Export my data</Text>
            {exporting
              ? <ActivityIndicator size="small" color={ACCENT} />
              : <Text style={[st.prefChevron, { color: theme.muted }]}>›</Text>}
          </Pressable>
          <Text style={[st.prefHint, { color: theme.muted }]}>
            Sends a copy of your goals, routines, history, workouts, meals, journal, and focus sessions so you can keep it.
          </Text>
        </View>

        {/* ── Save ──────────────────────────────────────────────────── */}
        <Pressable
          style={[st.saveBtn, { backgroundColor: ACCENT }, saving && { opacity: 0.6 }]}
          onPress={saveChanges}
          disabled={saving}
        >
          <Text style={st.saveBtnText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
        </Pressable>

        <Pressable
          style={[st.signOutBtn, { borderColor: theme.cardBorder }]}
          onPress={() => Alert.alert('Sign out', 'Are you sure?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: () => handleSignOut() },
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
                          Alert.alert('Error', friendlyError(e, 'We could not delete your account. Please try again.'))
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

      {/* Day start / end picker for time logging */}
      <Modal visible={timePicking !== null} transparent animationType="fade" onRequestClose={() => setTimePicking(null)}>
        <Pressable style={st.tlBackdrop} onPress={() => setTimePicking(null)}>
          <View style={[st.tlPickerCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <Text style={[st.tlPickerTitle, { color: theme.text }]}>
              {timePicking === 'activeStart' ? 'Day starts at' : 'Day ends at'}
            </Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {(timePicking === 'activeStart'
                ? Array.from({ length: 48 }, (_, i) => i * 30).filter(m => m < logSettings.activeEnd)
                : Array.from({ length: 48 }, (_, i) => (i + 1) * 30).filter(m => m > logSettings.activeStart)
              ).map(m => {
                const sel = logSettings[timePicking] === m
                return (
                  <Pressable
                    key={m}
                    onPress={() => { updateLogSettings({ [timePicking]: m }); setTimePicking(null) }}
                    style={[st.tlPickerRow, sel && { backgroundColor: ACCENT + '22' }]}
                  >
                    <Text style={{ color: sel ? ACCENT : theme.text, fontWeight: sel ? '700' : '500', fontSize: 14 }}>
                      {timeLabel(m)}
                    </Text>
                    {sel && <Text style={{ color: ACCENT, fontWeight: '800' }}>✓</Text>}
                  </Pressable>
                )
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
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

  // Time logging
  tlHint: { fontSize: 11.5, fontWeight: '500', marginTop: 3, lineHeight: 16 },
  tlDivider: { height: StyleSheet.hairlineWidth, marginVertical: 13 },
  tlSegment: { flexDirection: 'row', gap: 6 },
  tlSegmentBtn: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 10 },
  tlSegmentText: { fontSize: 12, fontWeight: '800' },
  tlValue: { fontSize: 13.5, fontWeight: '700' },
  tlFootnote: { fontSize: 11.5, fontWeight: '500', marginTop: 14, lineHeight: 16 },
  tlBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  tlPickerCard: { alignSelf: 'stretch', borderWidth: 1, borderRadius: 20, padding: 18 },
  tlPickerTitle: { fontSize: 16, fontWeight: '800', marginBottom: 10 },
  tlPickerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 11, paddingHorizontal: 10, borderRadius: 10,
  },

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

  // Nutrition Goals card (same layout as HabitLog's editor)
  goalInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  goalInput: {
    minWidth: 84, borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 7,
    fontSize: 14, fontWeight: '600', textAlign: 'right',
  },
  goalUnit: { fontSize: 12, fontWeight: '600', width: 30 },
  saveGoalsBtn: { borderRadius: 12, paddingVertical: 11, alignItems: 'center', marginTop: 14 },
  saveGoalsText: { color: '#ffffff', fontWeight: '700', fontSize: 14 },

  prefRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingVertical: 4,
  },
  prefLabel: { fontSize: 15, fontWeight: '600' },
  prefChevron: { fontSize: 18, fontWeight: '600' },
  prefHint: { fontSize: 12, fontWeight: '500', marginTop: 6, lineHeight: 16 },
  prefGroupLabel: {
    fontSize: 11, fontWeight: '800', letterSpacing: 1.2,
    marginTop: 18, marginBottom: 6,
  },
  unitPill: {
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7,
  },
  unitPillText: { fontSize: 14, fontWeight: '800', letterSpacing: 1 },
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
  profileMissing: { alignItems: 'center', paddingVertical: 6 },
  profileMissingTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  profileMissingSub: { fontSize: 13, fontWeight: '500', textAlign: 'center', marginTop: 4, lineHeight: 18 },

  visRow: { flexDirection: 'row', borderRadius: 12, borderWidth: 1, padding: 3, gap: 3 },
  visBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  visBtnText: { fontSize: 13, fontWeight: '700' },
  visHint: { fontSize: 12, fontWeight: '500', marginTop: 8, lineHeight: 16 },

  blockedList: { marginTop: 6 },
  blockedEmpty: { fontSize: 12, fontWeight: '500', lineHeight: 17, paddingVertical: 10 },
  blockedRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth,
  },
  blockedName: { flex: 1, fontSize: 14, fontWeight: '600' },
  unblockBtn: { borderRadius: 10, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 6 },
  unblockBtnText: { fontSize: 12, fontWeight: '700' },

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
