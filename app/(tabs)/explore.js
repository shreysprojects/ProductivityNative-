import { useState, useCallback, useLayoutEffect, useEffect } from 'react'
import {
  View, Text, Pressable, StyleSheet, FlatList, Modal,
  Alert, ActivityIndicator, ScrollView, TextInput, Switch, Share,
  KeyboardAvoidingView, Platform,
} from 'react-native'
import { Image } from 'expo-image'
import { router, useFocusEffect, useNavigation } from 'expo-router'
import { useAuth } from '../../lib/AuthContext'
import { useTheme } from '../../lib/ThemeContext'
import { supabase } from '../../lib/supabase'
import { getRoutineNames, getRoutineTemplate } from '../../lib/storage'
import { routineTheme } from '../../lib/themes'
import { updateBio } from '../../lib/profileStorage'
import { getUserGoals } from '../../lib/goalsStorage'
import { consumeRateLimit } from '../../lib/rateLimit'
import { findBlockedWord } from '../../lib/contentFilter'
import { getBlockedIds, blockUser } from '../../lib/blockedStorage'
import {
  getMyFriendCode, getFriends, getPendingRequests,
  addFriendByCode, acceptFriendRequest, declineFriendRequest, removeFriend,
} from '../../lib/friendsStorage'

const BIO_MAX = 120

const MEAL_SECTIONS = [
  { key: 'morning', label: 'Morning', emoji: '🌅' },
  { key: 'lunch',   label: 'Lunch',   emoji: '☀️' },
  { key: 'dinner',  label: 'Dinner',  emoji: '🌙' },
  { key: 'snacks',  label: 'Snacks',  emoji: '🍎' },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

function fmtDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function authorLabel(email) {
  return email?.split('@')[0] ?? 'user'
}

// Maps a Supabase insert error to a user-facing alert. RLS rate-limit rejections
// come back as code 42501 ("violates row-level security policy").
function postError(e, fallback) {
  if (e?.code === '42501') {
    return { title: 'Posting limit reached', msg: "You can share up to 5 posts per day, with a short wait between each. Please try again later." }
  }
  return { title: 'Error', msg: fallback }
}

function getTaskName(task) {
  return task.name || task.text || task.task || task.title || ''
}

function fmtDur(mins) {
  if (!mins) return null
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60), m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function splitEmoji(name) {
  if (!name) return { emoji: null, text: name }
  const cp = name.codePointAt(0)
  const charLen = cp > 0xFFFF ? 2 : 1
  if ((cp >= 0x1F300 || (cp >= 0x2600 && cp <= 0x27BF)) && name[charLen] === ' ') {
    return { emoji: name.slice(0, charLen), text: name.slice(charLen + 1) }
  }
  return { emoji: null, text: name }
}

function resolveTask(task) {
  if (task.emoji) return { emoji: task.emoji, name: task.name }
  const { emoji, text } = splitEmoji(task.name ?? '')
  return { emoji, name: text || task.name }
}

function fmtExerciseSet(ex, unit) {
  if (ex.inputType === 'time' && ex.time) {
    return `${ex.sets}× ${ex.time}s`
  }
  if (ex.reps && ex.weight) {
    return `${ex.sets}×${ex.reps} @ ${ex.weight}${unit ?? ''}`
  }
  if (ex.reps) return `${ex.sets}×${ex.reps}`
  return `${ex.sets} sets`
}

function buildWorkoutContent(log, unit) {
  const durationMins = log.startedAt && log.completedAt
    ? Math.round((log.completedAt - log.startedAt) / 60000)
    : null
  const exercises = (log.exercises ?? [])
    .filter(ex => !ex.skipped && (ex.sets ?? []).length > 0)
    .map(ex => {
      const completed = (ex.sets ?? []).filter(s => s.reps !== undefined || s.time !== undefined)
      if (!completed.length) return null
      const first = completed[0]
      return {
        name: ex.name,
        inputType: ex.inputType ?? 'reps',
        gifUrl: ex.gifUrl ?? null,
        sets: completed.length,
        reps: first.reps ?? null,
        time: first.time ?? null,
        weight: first.weight ?? null,
      }
    })
    .filter(Boolean)
  return { muscleGroup: log.muscleGroup, date: log.date, durationMins, unit: unit ?? 'lbs', exercises }
}

function buildMealContent(date, meals) {
  const sections = MEAL_SECTIONS.map(s => ({
    ...s,
    items: (meals ?? [])
      .filter(m => m.section === s.key)
      .map(m => ({ name: m.name, calories: m.macros?.calories ?? 0, protein: m.macros?.protein ?? 0, carbs: m.macros?.carbs ?? 0, fat: m.macros?.fat ?? 0 })),
  })).filter(s => s.items.length > 0)
  const totals = (meals ?? []).reduce(
    (acc, m) => ({
      calories: acc.calories + (m.macros?.calories ?? 0),
      protein: acc.protein + (m.macros?.protein ?? 0),
      carbs: acc.carbs + (m.macros?.carbs ?? 0),
      fat: acc.fat + (m.macros?.fat ?? 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  )
  return { date, totals, sections }
}

// ── Content safety ────────────────────────────────────────────────────────────

const EMAIL_RE = /\S+@\S+\.\S+/
const PHONE_RE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/
const SPAM_RE = /(.)\1{9,}/
// Links / websites and social-media handles & payment apps (esp. for minors' safety).
const URL_RE = /(https?:\/\/|www\.)\S+|\b[\w-]+\.(com|net|org|io|co|gg|me|tv|ly|app|link|xyz|info|biz)\b/i
const SOCIAL_RE = /\b(instagram|tiktok|snapchat|onlyfans|telegram|venmo|cashapp|cash app|paypal|whatsapp|twitch|linktr|kik|discord)\b|@[a-z0-9._]{3,}/i
const TITLE_MAX = 80

function checkText(text, maxLen = TITLE_MAX) {
  const t = text.trim()
  if (!t) return { issue: 'empty' }
  if (t.length > maxLen) return { issue: 'too_long' }
  if (SPAM_RE.test(t)) return { issue: 'spam' }
  if (EMAIL_RE.test(t)) return { issue: 'email' }
  if (PHONE_RE.test(t)) return { issue: 'phone' }
  if (URL_RE.test(t)) return { issue: 'url' }
  if (SOCIAL_RE.test(t)) return { issue: 'social' }
  const word = findBlockedWord(t)
  if (word) return { issue: 'word', word }
  return null
}

function checkBio(bio) {
  const t = bio.trim()
  if (!t) return null
  return checkText(t, BIO_MAX)
}

function buildMessage({ issue, word }, where) {
  const isBio = where === 'bio'
  if (issue === 'word') return `The word "${word}" is not allowed in public ${isBio ? 'profiles' : 'content'}. Please remove it from your ${where} before sharing.`
  if (issue === 'email') return `Your ${where} contains an email address. Please remove it before sharing.`
  if (issue === 'phone') return `Your ${where} contains a phone number. Please remove it before sharing.`
  if (issue === 'url') return `Your ${where} contains a link or website, which isn't allowed in public content. Please remove it before sharing.`
  if (issue === 'social') return `Your ${where} contains a social media handle or payment app, which isn't allowed in public content. Please remove it before sharing.`
  if (issue === 'spam') return `Your ${where} contains repeated characters. Please fix it before sharing.`
  if (issue === 'too_long') return `Your ${where} is too long (max ${isBio ? BIO_MAX : TITLE_MAX} characters).`
  if (issue === 'empty') return 'Title cannot be empty.'
  return 'Please edit your content before sharing.'
}

function validateRoutineContent(routineName, tasks, bio = '') {
  const nr = checkText(routineName)
  if (nr) return buildMessage(nr, 'routine title')
  const br = checkBio(bio)
  if (br) return buildMessage(br, 'bio')
  for (const t of tasks) {
    if (!t.name) continue
    const r = checkText(t.name)
    if (r) return buildMessage(r, 'task name')
  }
  return null
}

function validateWorkoutContent(muscleGroup, exercises, bio = '') {
  const br = checkBio(bio)
  if (br) return buildMessage(br, 'bio')
  if (muscleGroup?.trim()) {
    const r = checkText(muscleGroup)
    if (r) return buildMessage(r, 'workout name')
  }
  for (const ex of exercises) {
    if (!ex.name) continue
    const r = checkText(ex.name)
    if (r) return buildMessage(r, 'exercise name')
  }
  return null
}

function validateMealContent(mealNames, bio = '') {
  const br = checkBio(bio)
  if (br) return buildMessage(br, 'bio')
  for (const n of mealNames) {
    if (!n) continue
    const r = checkText(n)
    if (r) return buildMessage(r, 'meal name')
  }
  return null
}

async function moderateProfilePicture(avatarUrl) {
  if (!avatarUrl) return { allowed: true }
  try {
    const { data } = await supabase.functions.invoke('openai-proxy', {
      body: { action: 'moderate_profile_picture', avatarUrl },
    })
    return { allowed: data?.allowed !== false, reason: data?.reason ?? null }
  } catch { return { allowed: true } }
}

async function aiModerateTexts(texts, bio = '') {
  try {
    const { data } = await supabase.functions.invoke('openai-proxy', {
      body: { action: 'moderate_texts', texts, bio },
    })
    return { allowed: data?.allowed !== false, reason: data?.reason ?? null }
  } catch { return { allowed: true } }
}

async function aiModerationCheck(routineName, tasks, bio = '') {
  try {
    const { data } = await supabase.functions.invoke('openai-proxy', {
      body: { action: 'moderate_routine', routineName, tasks, bio },
    })
    return { allowed: data?.allowed !== false, reason: data?.reason ?? null }
  } catch { return { allowed: true } }
}

// ── Visibility toggle row ─────────────────────────────────────────────────────

function VisibilityRow({ label, value, onChange, theme }) {
  return (
    <View style={ec.visRow}>
      <Text style={[ec.visLabel, { color: theme.text }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: theme.divider, true: '#6366f180' }}
        thumbColor={value ? '#6366f1' : (theme.isDark ? '#555' : '#ccc')}
        ios_backgroundColor={theme.divider}
      />
    </View>
  )
}

// ── Under review badge (shared by all card types) ─────────────────────────────

function ReviewBadge({ item, theme }) {
  if ((item.report_count ?? 0) < 5) return null
  return (
    <View style={[ec.reviewRow, { borderTopColor: theme.divider }]}>
      <View style={ec.reviewBadge}><Text style={ec.reviewBadgeText}>Under Review</Text></View>
    </View>
  )
}

// ── Author header (shared by all card types) ──────────────────────────────────

function CardAuthorHeader({ item, theme, isOwn, onDelete, onReport, onBlock }) {
  const initials = (item.author_name?.[0] ?? '?').toUpperCase()
  const handle = item.author_username ?? item.author_name ?? 'user'

  function openActions() {
    Alert.alert('Post options', `Posted by @${handle}`, [
      { text: 'Report post', onPress: () => onReport(item) },
      { text: `Block @${handle}`, style: 'destructive', onPress: () => onBlock(item) },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  return (
    <View style={ec.cardHeader}>
      {item.author_avatar_url ? (
        <Image source={{ uri: item.author_avatar_url }} style={ec.avatar} contentFit="cover" />
      ) : (
        <View style={[ec.avatar, ec.avatarFallback, { backgroundColor: theme.isDark ? '#1e1e38' : '#eef2ff' }]}>
          <Text style={ec.avatarInitial}>{initials}</Text>
        </View>
      )}
      <View style={ec.authorBlock}>
        <Text style={[ec.authorName, { color: theme.text }]} numberOfLines={1}>{item.author_name}</Text>
        <Text style={[ec.authorMeta, { color: theme.subtext }]} numberOfLines={1}>
          {'@'}{item.author_username ?? item.author_name}
          {item.author_gender ? `  ·  ${item.author_gender.charAt(0).toUpperCase() + item.author_gender.slice(1)}` : ''}
          {item.author_age ? `  ·  ${item.author_age}` : ''}
          {'  ·  '}{timeAgo(item.created_at)}
        </Text>
        {!!item.author_bio && (
          <Text style={[ec.authorBio, { color: theme.muted }]} numberOfLines={2}>{item.author_bio}</Text>
        )}
      </View>
      {isOwn ? (
        <Pressable onPress={() => onDelete(item)} hitSlop={12} style={ec.actionBtn}>
          <Text style={{ fontSize: 16 }}>🗑</Text>
        </Pressable>
      ) : (
        <Pressable onPress={openActions} hitSlop={12} style={ec.actionBtn} accessibilityLabel="Post options">
          <Text style={[ec.actionGlyph, { color: theme.subtext }]}>⋯</Text>
        </Pressable>
      )}
    </View>
  )
}

// ── Routine card ──────────────────────────────────────────────────────────────

function RoutineCard({ item, currentUserId, theme, onDelete, onReport, onBlock }) {
  const tasks = item.tasks ?? []
  const isOwn = item.user_id === currentUserId
  const totalMins = tasks.reduce((sum, t) => sum + (Number(t.time) || 0), 0)
  const durStr = fmtDur(totalMins)

  return (
    <View style={[ec.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <CardAuthorHeader item={item} theme={theme} isOwn={isOwn} onDelete={onDelete} onReport={onReport} onBlock={onBlock} />

      <View style={[ec.routineSection, { borderTopColor: theme.divider }]}>
        <View style={[ec.routinePill, { backgroundColor: theme.isDark ? 'rgba(99,102,241,0.18)' : '#eef2ff' }]}>
          <Text style={ec.routinePillText}>{routineTheme(item.routine_name).emoji}  {item.routine_name}</Text>
        </View>
        <View style={ec.routineMeta}>
          {durStr && <Text style={[ec.routineMetaText, { color: theme.subtext }]}>⏱  {durStr}</Text>}
          {durStr && <Text style={[ec.routineMetaDot, { color: theme.muted }]}>·</Text>}
          <Text style={[ec.routineMetaText, { color: theme.muted }]}>
            {tasks.length} task{tasks.length !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>

      {tasks.length > 0 && (
        <View style={[ec.taskList, { borderTopColor: theme.divider }]}>
          {tasks.map((task, i) => {
            const { emoji, name: displayName } = resolveTask(task)
            const taskTime = fmtDur(Number(task.time) || 0)
            const isLast = i === tasks.length - 1
            return (
              <View key={i} style={[ec.taskRow, !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider }]}>
                {emoji
                  ? <Text style={ec.taskEmoji}>{emoji}</Text>
                  : <View style={[ec.taskBullet, { backgroundColor: '#6366f1' }]} />}
                <Text style={[ec.taskName, { color: theme.text }]} numberOfLines={1}>{displayName}</Text>
                {taskTime && <Text style={[ec.taskTime, { color: theme.muted }]}>{taskTime}</Text>}
              </View>
            )
          })}
        </View>
      )}

      <ReviewBadge item={item} theme={theme} />
    </View>
  )
}

// ── Workout card ──────────────────────────────────────────────────────────────

function WorkoutCard({ item, currentUserId, theme, onDelete, onReport, onBlock }) {
  const isOwn = item.user_id === currentUserId
  const c = item.content ?? {}
  const exercises = c.exercises ?? []
  const durStr = fmtDur(c.durationMins)
  const unit = c.unit ?? ''

  return (
    <View style={[ec.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <CardAuthorHeader item={item} theme={theme} isOwn={isOwn} onDelete={onDelete} onReport={onReport} onBlock={onBlock} />

      <View style={[ec.routineSection, { borderTopColor: theme.divider }]}>
        <View style={[ec.routinePill, { backgroundColor: theme.isDark ? 'rgba(99,102,241,0.18)' : '#eef2ff' }]}>
          <Text style={ec.routinePillText}>🏋️ {c.muscleGroup ?? 'Workout'}</Text>
        </View>
        <View style={ec.routineMeta}>
          {durStr && <Text style={[ec.routineMetaText, { color: theme.subtext }]}>⏱  {durStr}</Text>}
          {durStr && exercises.length > 0 && <Text style={[ec.routineMetaDot, { color: theme.muted }]}>·</Text>}
          {exercises.length > 0 && (
            <Text style={[ec.routineMetaText, { color: theme.muted }]}>
              {exercises.length} exercise{exercises.length !== 1 ? 's' : ''}
            </Text>
          )}
        </View>
      </View>

      {exercises.length > 0 && (
        <View style={[ec.taskList, { borderTopColor: theme.divider }]}>
          {exercises.map((ex, i) => {
            const isLast = i === exercises.length - 1
            const setStr = fmtExerciseSet(ex, unit)
            return (
              <View key={i} style={[ec.taskRow, !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider }]}>
                {ex.gifUrl ? (
                  <Image source={{ uri: ex.gifUrl }} style={ec.exerciseThumb} contentFit="cover" />
                ) : (
                  <View style={[ec.taskBullet, { backgroundColor: '#6366f1' }]} />
                )}
                <Text style={[ec.taskName, { color: theme.text }]} numberOfLines={1}>{ex.name}</Text>
                {setStr && <Text style={[ec.taskTime, { color: theme.muted }]}>{setStr}</Text>}
              </View>
            )
          })}
        </View>
      )}

      <ReviewBadge item={item} theme={theme} />
    </View>
  )
}

// ── Meal day card ─────────────────────────────────────────────────────────────

function MealDayCard({ item, currentUserId, theme, onDelete, onReport, onBlock }) {
  const isOwn = item.user_id === currentUserId
  const c = item.content ?? {}
  const totals = c.totals ?? {}
  const sections = c.sections ?? []

  return (
    <View style={[ec.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <CardAuthorHeader item={item} theme={theme} isOwn={isOwn} onDelete={onDelete} onReport={onReport} onBlock={onBlock} />

      <View style={[ec.routineSection, { borderTopColor: theme.divider }]}>
        <View style={[ec.routinePill, { backgroundColor: theme.isDark ? 'rgba(99,102,241,0.18)' : '#eef2ff' }]}>
          <Text style={ec.routinePillText}>🍽 Meal Day</Text>
        </View>
        <View style={ec.routineMeta}>
          {c.date && <Text style={[ec.routineMetaText, { color: theme.subtext }]}>📅 {fmtDate(c.date)}</Text>}
          {c.date && totals.calories > 0 && <Text style={[ec.routineMetaDot, { color: theme.muted }]}>·</Text>}
          {totals.calories > 0 && <Text style={[ec.routineMetaText, { color: theme.muted }]}>{Math.round(totals.calories)} kcal</Text>}
        </View>
      </View>

      {(totals.protein > 0 || totals.carbs > 0 || totals.fat > 0) && (
        <View style={[ec.macroRow, { borderTopColor: theme.divider }]}>
          <MacroChip label="P" value={Math.round(totals.protein)} unit="g" color="#6366f1" theme={theme} />
          <MacroChip label="C" value={Math.round(totals.carbs)} unit="g" color="#10b981" theme={theme} />
          <MacroChip label="F" value={Math.round(totals.fat)} unit="g" color="#f59e0b" theme={theme} />
        </View>
      )}

      {sections.length > 0 && (
        <View style={[ec.taskList, { borderTopColor: theme.divider }]}>
          {sections.map((sec, si) => (
            <View key={sec.key}>
              <View style={[ec.mealSectionHeader, si > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider }]}>
                <Text style={[ec.mealSectionLabel, { color: theme.subtext }]}>{sec.emoji} {sec.label}</Text>
              </View>
              {sec.items.map((m, mi) => {
                const isLast = si === sections.length - 1 && mi === sec.items.length - 1
                return (
                  <View key={mi} style={[ec.taskRow, !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider }]}>
                    <View style={[ec.taskBullet, { backgroundColor: '#10b981' }]} />
                    <Text style={[ec.taskName, { color: theme.text }]} numberOfLines={1}>{m.name}</Text>
                    <Text style={[ec.taskTime, { color: theme.muted }]}>{Math.round(m.calories)} kcal</Text>
                  </View>
                )
              })}
            </View>
          ))}
        </View>
      )}

      <ReviewBadge item={item} theme={theme} />
    </View>
  )
}

function MacroChip({ label, value, unit, color, theme }) {
  return (
    <View style={ec.macroChip}>
      <Text style={[ec.macroChipLabel, { color }]}>{label}</Text>
      <Text style={[ec.macroChipVal, { color: theme.text }]}>{value}{unit}</Text>
    </View>
  )
}

// ── Community card router ─────────────────────────────────────────────────────

function CommunityCard({ item, currentUserId, theme, onDelete, onReport, onBlock }) {
  if (item.post_type === 'workout') {
    return <WorkoutCard item={item} currentUserId={currentUserId} theme={theme} onDelete={onDelete} onReport={onReport} onBlock={onBlock} />
  }
  if (item.post_type === 'meal_day') {
    return <MealDayCard item={item} currentUserId={currentUserId} theme={theme} onDelete={onDelete} onReport={onReport} onBlock={onBlock} />
  }
  return <RoutineCard item={item} currentUserId={currentUserId} theme={theme} onDelete={onDelete} onReport={onReport} onBlock={onBlock} />
}

// ── Post modal ────────────────────────────────────────────────────────────────

const POST_TABS = [
  { key: 'routine',   label: 'Routine',    emoji: '📋' },
  { key: 'workout',   label: 'Workout',    emoji: '🏋️' },
  { key: 'meal_day',  label: 'Meal Day',   emoji: '🍽' },
]

function PostModal({ visible, theme, userId, userEmail, profile, unit, onClose, onPost }) {
  const [activeTab, setActiveTab] = useState('routine')
  const [routineNames, setRoutineNames] = useState([])
  const [workoutLogs, setWorkoutLogs] = useState([])
  const [mealDays, setMealDays] = useState([])
  const [loadingContent, setLoadingContent] = useState(false)
  const [posting, setPosting] = useState(null)
  const [localBio, setLocalBio] = useState('')
  const [goals, setGoals] = useState(null)
  const [showBio, setShowBio] = useState(true)
  const [showAvatar, setShowAvatar] = useState(true)
  const [showAge, setShowAge] = useState(true)
  const [showGender, setShowGender] = useState(true)

  useEffect(() => {
    if (!visible || !userId) return
    setLocalBio(profile?.bio ?? '')
    setShowBio(true); setShowAvatar(true); setShowAge(true); setShowGender(true)
    setActiveTab('routine')
    setPosting(null)
    setLoadingContent(true)
    Promise.all([
      getRoutineNames(userId),
      supabase.from('workout_logs').select('date, data').eq('user_id', userId).order('date', { ascending: false }).limit(10),
      supabase.from('meals').select('date, meals').eq('user_id', userId).order('date', { ascending: false }).limit(14),
      getUserGoals(userId),
    ]).then(([names, wlRes, mlRes, g]) => {
      setRoutineNames(names)
      setWorkoutLogs((wlRes.data ?? []).filter(r => (r.data?.exercises ?? []).length > 0))
      setMealDays((mlRes.data ?? []).filter(r => (r.meals ?? []).length > 0))
      setGoals(g ?? null)
      setLoadingContent(false)
    })
  }, [visible, userId])

  const isDark = theme.isDark
  const bioCount = localBio.length
  const hasAge = goals?.age != null
  const hasGender = goals?.sex != null
  const goalsAge = goals?.age ?? null
  const goalsGender = goals?.sex ?? null

  async function getAuthorPayload() {
    const trimmedBio = localBio.trim()
    if (trimmedBio !== (profile?.bio ?? '').trim()) {
      try {
        await updateBio(userId, trimmedBio)
      } catch (e) {
        Alert.alert('Could not save bio', e?.message ?? 'Your bio could not be saved. Please try again.')
        return null
      }
    }
    if (profile?.avatar_url && showAvatar) {
      const avatarResult = await moderateProfilePicture(profile.avatar_url)
      if (!avatarResult.allowed) {
        Alert.alert('Profile picture not allowed', avatarResult.reason ?? 'Your profile picture contains inappropriate content. Please update it in Settings before sharing.')
        return null
      }
    }
    const username = profile?.username || authorLabel(userEmail)
    return {
      author_name: profile?.name?.trim() || username,
      author_username: username,
      author_bio: showBio ? trimmedBio : '',
      author_avatar_url: showAvatar ? (profile?.avatar_url ?? '') : '',
      author_age: showAge ? goalsAge : null,
      author_gender: showGender ? goalsGender : null,
    }
  }

  async function handlePostRoutine(name) {
    setPosting(name)
    try {
      const rl = await consumeRateLimit(userId, 'community_post', { maxPerDay: 5, cooldownMs: 60000 })
      if (!rl.allowed) { Alert.alert('Slow down', rl.reason); return }
      const template = await getRoutineTemplate(userId, name)
      const tasks = (template ?? []).map(t => {
        const rawName = getTaskName(t)
        const { emoji, text } = splitEmoji(rawName)
        return { name: text || rawName, emoji: t.emoji ?? (emoji || null), time: t.timeGoalMins ?? Math.round((t.timeGoalSecs ?? 0) / 60) }
      })
      const trimmedBio = localBio.trim()
      const validationError = validateRoutineContent(name, tasks, trimmedBio)
      if (validationError) { Alert.alert('Cannot share this routine', validationError); return }
      const aiResult = await aiModerationCheck(name.trim(), tasks, trimmedBio)
      if (!aiResult.allowed) { Alert.alert('Cannot share this routine', aiResult.reason ?? 'Please edit your content before sharing.'); return }
      const author = await getAuthorPayload()
      if (!author) return
      const { error } = await supabase.from('shared_routines').insert({ user_id: userId, ...author, routine_name: name.trim(), tasks })
      if (error) throw error
      onPost()
    } catch (e) { const { title, msg } = postError(e, 'Could not share routine. Please try again.'); Alert.alert(title, msg) }
    finally { setPosting(null) }
  }

  async function handlePostWorkout(logRow) {
    const key = logRow.date
    setPosting(key)
    try {
      const rl = await consumeRateLimit(userId, 'community_post', { maxPerDay: 5, cooldownMs: 60000 })
      if (!rl.allowed) { Alert.alert('Slow down', rl.reason); return }
      const trimmedBio = localBio.trim()
      const log = logRow.data
      const content = buildWorkoutContent(log, unit)
      const validationError = validateWorkoutContent(content.muscleGroup, content.exercises, trimmedBio)
      if (validationError) { Alert.alert('Cannot share this workout', validationError); return }
      const aiResult = await aiModerateTexts([content.muscleGroup, ...content.exercises.map(e => e.name)], trimmedBio)
      if (!aiResult.allowed) { Alert.alert('Cannot share this workout', aiResult.reason ?? 'Please edit your content before sharing.'); return }
      const author = await getAuthorPayload()
      if (!author) return
      const { error } = await supabase.from('community_posts').insert({ user_id: userId, post_type: 'workout', ...author, content })
      if (error) throw error
      onPost()
    } catch (e) { const { title, msg } = postError(e, 'Could not share workout. Please try again.'); Alert.alert(title, msg) }
    finally { setPosting(null) }
  }

  async function handlePostMealDay(dayRow) {
    const key = dayRow.date
    setPosting(key)
    try {
      const rl = await consumeRateLimit(userId, 'community_post', { maxPerDay: 5, cooldownMs: 60000 })
      if (!rl.allowed) { Alert.alert('Slow down', rl.reason); return }
      const trimmedBio = localBio.trim()
      const content = buildMealContent(dayRow.date, dayRow.meals)
      if (content.sections.length === 0) { Alert.alert('No meals', 'This day has no logged meals to share.'); return }
      const mealNames = (dayRow.meals ?? []).map(m => m.name)
      const validationError = validateMealContent(mealNames, trimmedBio)
      if (validationError) { Alert.alert('Cannot share this meal day', validationError); return }
      const aiResult = await aiModerateTexts(mealNames, trimmedBio)
      if (!aiResult.allowed) { Alert.alert('Cannot share this meal day', aiResult.reason ?? 'Please edit your content before sharing.'); return }
      const author = await getAuthorPayload()
      if (!author) return
      const { error } = await supabase.from('community_posts').insert({ user_id: userId, post_type: 'meal_day', ...author, content })
      if (error) throw error
      onPost()
    } catch (e) { const { title, msg } = postError(e, 'Could not share meal day. Please try again.'); Alert.alert(title, msg) }
    finally { setPosting(null) }
  }

  function renderContent() {
    if (loadingContent) return <ActivityIndicator color="#6366f1" style={{ marginVertical: 24 }} />

    if (activeTab === 'routine') {
      if (routineNames.length === 0) return <Text style={[ec.emptyMsg, { color: theme.muted }]}>No routines found. Create one first!</Text>
      return routineNames.map(name => (
        <Pressable key={name} style={[ec.pickRow, { borderBottomColor: theme.divider }]} onPress={() => !posting && handlePostRoutine(name)} disabled={!!posting}>
          <Text style={[ec.pickRowName, { color: posting === name ? '#6366f1' : theme.text }]}>{name}</Text>
          {posting === name ? <ActivityIndicator size="small" color="#6366f1" /> : <Text style={[ec.pickRowCta, { color: '#6366f1' }]}>Share →</Text>}
        </Pressable>
      ))
    }

    if (activeTab === 'workout') {
      if (workoutLogs.length === 0) return <Text style={[ec.emptyMsg, { color: theme.muted }]}>No workouts found. Log a workout first!</Text>
      return workoutLogs.map(row => (
        <Pressable key={row.date} style={[ec.pickRow, { borderBottomColor: theme.divider }]} onPress={() => !posting && handlePostWorkout(row)} disabled={!!posting}>
          <View style={{ flex: 1 }}>
            <Text style={[ec.pickRowName, { color: posting === row.date ? '#6366f1' : theme.text }]}>{row.data?.muscleGroup ?? 'Workout'}</Text>
            <Text style={[ec.pickRowSub, { color: theme.muted }]}>
              {fmtDate(row.date)}
              {row.data?.exercises ? `  ·  ${row.data.exercises.filter(e => !e.skipped).length} exercises` : ''}
            </Text>
          </View>
          {posting === row.date ? <ActivityIndicator size="small" color="#6366f1" /> : <Text style={[ec.pickRowCta, { color: '#6366f1' }]}>Share →</Text>}
        </Pressable>
      ))
    }

    if (activeTab === 'meal_day') {
      if (mealDays.length === 0) return <Text style={[ec.emptyMsg, { color: theme.muted }]}>No meal days found. Log meals first!</Text>
      return mealDays.map(row => {
        const totals = (row.meals ?? []).reduce((acc, m) => ({ cal: acc.cal + (m.macros?.calories ?? 0), p: acc.p + (m.macros?.protein ?? 0) }), { cal: 0, p: 0 })
        return (
          <Pressable key={row.date} style={[ec.pickRow, { borderBottomColor: theme.divider }]} onPress={() => !posting && handlePostMealDay(row)} disabled={!!posting}>
            <View style={{ flex: 1 }}>
              <Text style={[ec.pickRowName, { color: posting === row.date ? '#6366f1' : theme.text }]}>{fmtDate(row.date)}</Text>
              <Text style={[ec.pickRowSub, { color: theme.muted }]}>
                {Math.round(totals.cal)} kcal  ·  P {Math.round(totals.p)}g  ·  {row.meals.length} item{row.meals.length !== 1 ? 's' : ''}
              </Text>
            </View>
            {posting === row.date ? <ActivityIndicator size="small" color="#6366f1" /> : <Text style={[ec.pickRowCta, { color: '#6366f1' }]}>Share →</Text>}
          </Pressable>
        )
      })
    }

    return null
  }

  const SECTION_LABELS = { routine: 'CHOOSE ROUTINE', workout: 'CHOOSE WORKOUT', meal_day: 'CHOOSE MEAL DAY' }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={ec.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={ec.overlayBg} onPress={onClose} />
        <View style={[ec.sheet, { backgroundColor: theme.card }]}>
          <View style={[ec.handle, { backgroundColor: theme.divider }]} />
          <Text style={[ec.sheetTitle, { color: theme.text }]}>Post to Community</Text>

          {/* Tab bar */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ec.tabBar} contentContainerStyle={ec.tabBarContent}>
            {POST_TABS.map(tab => {
              const isActive = activeTab === tab.key
              return (
                <Pressable key={tab.key} style={[ec.tabBtn, isActive && ec.tabBtnActive, isActive && { borderColor: '#6366f1' }]} onPress={() => setActiveTab(tab.key)}>
                  <Text style={[ec.tabBtnText, isActive && { color: '#6366f1' }, !isActive && { color: theme.muted }]}>
                    {tab.emoji} {tab.label}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>

          <ScrollView showsVerticalScrollIndicator={false} bounces={false} keyboardShouldPersistTaps="handled">

            {/* About you */}
            <Text style={[ec.sectionLabel, { color: theme.subtext }]}>ABOUT YOU</Text>
            <TextInput
              style={[ec.bioInput, { color: theme.text, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderColor: theme.cardBorder }]}
              placeholder="Add a short bio shown alongside your posts…"
              placeholderTextColor={theme.muted}
              multiline maxLength={BIO_MAX}
              value={localBio} onChangeText={setLocalBio}
            />
            <Text style={[ec.bioCount, { color: bioCount > BIO_MAX - 15 ? '#f59e0b' : theme.muted }]}>{bioCount}/{BIO_MAX}</Text>

            {/* Visibility */}
            <Text style={[ec.sectionLabel, { color: theme.subtext, marginTop: 18 }]}>VISIBILITY</Text>
            <View style={[ec.visBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', borderColor: theme.cardBorder }]}>
              <VisibilityRow label="Show bio" value={showBio} onChange={setShowBio} theme={theme} />
              <View style={[ec.visDivider, { backgroundColor: theme.divider }]} />
              <VisibilityRow label="Show profile picture" value={showAvatar} onChange={setShowAvatar} theme={theme} />
              {hasGender && (
                <>
                  <View style={[ec.visDivider, { backgroundColor: theme.divider }]} />
                  <VisibilityRow label="Show gender" value={showGender} onChange={setShowGender} theme={theme} />
                </>
              )}
              {hasAge && (
                <>
                  <View style={[ec.visDivider, { backgroundColor: theme.divider }]} />
                  <VisibilityRow label="Show age" value={showAge} onChange={setShowAge} theme={theme} />
                </>
              )}
            </View>

            {/* Content picker */}
            <Text style={[ec.sectionLabel, { color: theme.subtext, marginTop: 18 }]}>{SECTION_LABELS[activeTab]}</Text>
            {renderContent()}

            <Pressable style={[ec.cancelBtn, { borderColor: theme.cardBorder }]} onPress={onClose} disabled={!!posting}>
              <Text style={{ color: theme.subtext, fontWeight: '600', fontSize: 15 }}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ── Friends Panel ─────────────────────────────────────────────────────────────

function FriendsPanel({ theme, myFriendCode, addCodeInput, setAddCodeInput, addingFriend, onAddFriend, onShareCode, pendingRequests, onAccept, onDecline, friends, onViewProfile, onRemoveFriend }) {
  const isDark = theme.isDark
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={ec.friendsContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

      <Text style={[ec.sectionLabel, { color: theme.subtext }]}>YOUR FRIEND CODE</Text>
      <View style={[ec.codeCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
        <View style={{ flex: 1 }}>
          <Text style={[ec.codeValue, { color: '#6366f1' }]}>{myFriendCode ?? '------'}</Text>
          <Text style={[ec.codeHint, { color: theme.muted }]}>Share this so others can add you</Text>
        </View>
        <Pressable style={[ec.sharePillBtn, { backgroundColor: '#6366f1', opacity: myFriendCode ? 1 : 0.4 }]} onPress={() => onShareCode(myFriendCode)} disabled={!myFriendCode}>
          <Text style={ec.sharePillBtnText}>Share</Text>
        </Pressable>
      </View>

      <Text style={[ec.sectionLabel, { color: theme.subtext, marginTop: 24 }]}>ADD FRIEND</Text>
      <View style={[ec.addFriendRow, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
        <TextInput
          style={[ec.addFriendInput, { color: theme.text }]}
          placeholder="Enter friend code…"
          placeholderTextColor={theme.muted}
          value={addCodeInput}
          onChangeText={t => setAddCodeInput(t.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          autoCapitalize="characters"
          maxLength={6}
          returnKeyType="done"
          onSubmitEditing={onAddFriend}
        />
        <Pressable
          style={[ec.addFriendBtn, { backgroundColor: '#6366f1', opacity: (addingFriend || addCodeInput.length !== 6) ? 0.4 : 1 }]}
          onPress={onAddFriend}
          disabled={addingFriend || addCodeInput.length !== 6}
        >
          {addingFriend
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={ec.addFriendBtnText}>Add</Text>}
        </Pressable>
      </View>

      {pendingRequests.length > 0 && (
        <>
          <Text style={[ec.sectionLabel, { color: theme.subtext, marginTop: 24 }]}>
            {'FRIEND REQUESTS  ·  '}{pendingRequests.length}
          </Text>
          <View style={[ec.friendsList, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            {pendingRequests.map((req, i) => (
              <View key={req.friendshipId} style={[ec.friendItem, i < pendingRequests.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider }]}>
                {req.avatarUrl ? (
                  <Image source={{ uri: req.avatarUrl }} style={ec.friendAvatar} contentFit="cover" />
                ) : (
                  <View style={[ec.friendAvatar, ec.friendAvatarFallback, { backgroundColor: isDark ? '#1e1e38' : '#eef2ff' }]}>
                    <Text style={ec.friendAvatarInitial}>{(req.username?.[0] ?? '?').toUpperCase()}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[ec.friendName, { color: theme.text }]}>{req.username ?? 'User'}</Text>
                  <Text style={[ec.friendSub, { color: theme.muted }]}>wants to be friends</Text>
                </View>
                <Pressable style={ec.acceptBtn} onPress={() => onAccept(req.friendshipId)}>
                  <Text style={ec.acceptBtnText}>Accept</Text>
                </Pressable>
                <Pressable style={[ec.declineBtn, { borderColor: theme.cardBorder }]} onPress={() => onDecline(req.friendshipId)}>
                  <Text style={[ec.declineBtnText, { color: theme.subtext }]}>✕</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </>
      )}

      <Text style={[ec.sectionLabel, { color: theme.subtext, marginTop: 24 }]}>
        {friends.length > 0 ? `FRIENDS  ·  ${friends.length}` : 'FRIENDS'}
      </Text>
      {friends.length === 0 ? (
        <View style={ec.noFriendsBox}>
          <Text style={{ fontSize: 38, marginBottom: 12 }}>👥</Text>
          <Text style={[{ fontSize: 16, fontWeight: '700', marginBottom: 6 }, { color: theme.text }]}>No friends yet</Text>
          <Text style={[{ fontSize: 13, fontWeight: '500', textAlign: 'center', lineHeight: 19 }, { color: theme.subtext }]}>
            Share your friend code or enter a friend's code above
          </Text>
        </View>
      ) : (
        <View style={[ec.friendsList, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          {friends.map((f, i) => (
            <Pressable
              key={f.friendshipId}
              style={[ec.friendItem, i < friends.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider }]}
              onPress={() => onViewProfile(f)}
              onLongPress={() => onRemoveFriend(f.friendshipId)}
            >
              {f.avatarUrl ? (
                <Image source={{ uri: f.avatarUrl }} style={ec.friendAvatar} contentFit="cover" />
              ) : (
                <View style={[ec.friendAvatar, ec.friendAvatarFallback, { backgroundColor: isDark ? '#1e1e38' : '#eef2ff' }]}>
                  <Text style={ec.friendAvatarInitial}>{(f.username?.[0] ?? '?').toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={[ec.friendName, { color: theme.text }]}>{f.username ?? 'User'}</Text>
                {!!f.bio && <Text style={[ec.friendSub, { color: theme.muted }]} numberOfLines={1}>{f.bio}</Text>}
              </View>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#6366f1' }}>View →</Text>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ExploreScreen() {
  const { user, profile } = useAuth()
  const { theme, unit } = useTheme()
  const navigation = useNavigation()
  const [feed, setFeed] = useState([])
  const [blockedIds, setBlockedIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [postModalVisible, setPostModalVisible] = useState(false)
  const [activeTopTab, setActiveTopTab] = useState('community')
  const [friends, setFriends] = useState([])
  const [pendingRequests, setPendingRequests] = useState([])
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [addCodeInput, setAddCodeInput] = useState('')
  const [addingFriend, setAddingFriend] = useState(false)
  const [myFriendCode, setMyFriendCode] = useState(null)

  useLayoutEffect(() => {
    navigation.setOptions({
      headerStyle: { backgroundColor: theme.header },
      headerShadowVisible: false,
      headerTintColor: theme.text,
      headerTitle: 'Explore',
      headerTitleStyle: { fontWeight: '700', fontSize: 17, color: theme.text },
    })
  }, [navigation, theme])

  async function fetchFeed() {
    setLoading(true)
    const [routinesRes, postsRes, blocked] = await Promise.all([
      supabase.from('shared_routines').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('community_posts').select('*').order('created_at', { ascending: false }).limit(100),
      getBlockedIds(user?.id),
    ])
    const routines = (routinesRes.data ?? []).map(r => ({ ...r, post_type: 'routine', _table: 'shared_routines' }))
    const posts = (postsRes.data ?? []).map(p => ({ ...p, _table: 'community_posts' }))
    const merged = [...routines, ...posts].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    setBlockedIds(blocked)
    setFeed(merged)
    setLoading(false)
  }

  async function loadFriends() {
    if (!user?.id) return
    setFriendsLoading(true)
    const [f, p, code] = await Promise.all([
      getFriends(user.id),
      getPendingRequests(user.id),
      getMyFriendCode(user.id),
    ])
    setFriends(f)
    setPendingRequests(p)
    setMyFriendCode(code)
    setFriendsLoading(false)
  }

  async function handleAddFriend() {
    if (!addCodeInput.trim() || addingFriend) return
    setAddingFriend(true)
    const result = await addFriendByCode(user.id, addCodeInput.trim())
    setAddingFriend(false)
    if (result.error === 'not_found') return Alert.alert('Not Found', 'No user found with that friend code. Double-check and try again.')
    if (result.error === 'self') return Alert.alert('Oops', "That's your own friend code!")
    if (result.error === 'already_friends') return Alert.alert('Already Friends', "You're already friends with that user.")
    if (result.error === 'pending_sent') return Alert.alert('Already Sent', 'You already sent this person a friend request.')
    if (result.error) return Alert.alert('Error', 'Could not send friend request. Please try again.')
    setAddCodeInput('')
    if (result.accepted) Alert.alert('Friends!', `You and ${result.username ?? 'that user'} are now friends.`)
    else Alert.alert('Request Sent', `Friend request sent to ${result.username ?? 'that user'}.`)
    loadFriends()
  }

  async function handleAccept(friendshipId) {
    try { await acceptFriendRequest(friendshipId); loadFriends() }
    catch { Alert.alert('Error', 'Could not accept request.') }
  }

  async function handleDecline(friendshipId) {
    try { await declineFriendRequest(friendshipId); loadFriends() }
    catch { Alert.alert('Error', 'Could not decline request.') }
  }

  function handleRemoveFriend(friendshipId) {
    Alert.alert('Remove Friend?', 'Remove this person from your friends list?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try { await removeFriend(friendshipId); loadFriends() }
        catch { Alert.alert('Error', 'Could not remove friend.') }
      }},
    ])
  }

  function handleViewProfile(friend) {
    router.push(`/friend-profile?userId=${friend.userId}&username=${encodeURIComponent(friend.username ?? 'User')}`)
  }

  async function handleShareCode(code) {
    if (!code) return
    try { await Share.share({ message: `Add me on Productivity! My friend code is: ${code}` }) } catch {}
  }

  useEffect(() => {
    if (activeTopTab === 'friends' && user?.id) loadFriends()
  }, [activeTopTab])

  useFocusEffect(useCallback(() => { fetchFeed() }, [user?.id]))

  function handleDelete(item) {
    Alert.alert('Remove Post?', 'Remove this post from the community feed?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          await supabase.from(item._table).delete().eq('id', item.id)
          fetchFeed()
        },
      },
    ])
  }

  function handleBlock(item) {
    if (!user?.id || item.user_id === user.id) return
    const handle = item.author_username ?? item.author_name ?? 'this user'
    Alert.alert(`Block @${handle}?`, "You won't see their posts anymore, and they won't see yours.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block', style: 'destructive', onPress: async () => {
          try {
            await blockUser(user.id, item.user_id)
            setBlockedIds(prev => prev.includes(item.user_id) ? prev : [...prev, item.user_id])
            setFeed(prev => prev.filter(p => p.user_id !== item.user_id))
            Alert.alert('Blocked', `You will no longer see posts from @${handle}.`)
          } catch {
            Alert.alert('Error', 'Could not block this user. Please try again.')
          }
        },
      },
    ])
  }

  function handleReport(item) {
    if (item._table === 'community_posts') {
      Alert.alert('Report Post?', 'Report this post for inappropriate content?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report', style: 'destructive', onPress: async () => {
            const { error } = await supabase.from('community_post_reports').insert({
              reporter_id: user.id, post_id: item.id, reported_user_id: item.user_id,
            })
            if (error?.code === '23505') Alert.alert('Already reported', 'You have already reported this post.')
            else if (error) Alert.alert('Error', 'Could not submit report. Please try again.')
            else Alert.alert('Report submitted', 'Thank you. Our team reviews every report within 24 hours and removes anything that breaks the rules.')
          },
        },
      ])
      return
    }
    Alert.alert('Report Post?', 'Report this post for inappropriate content?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report', style: 'destructive', onPress: async () => {
          const { error } = await supabase.from('reports').insert({
            reporter_id: user.id,
            shared_routine_id: item.id,
            reported_user_id: item.user_id,
          })
          if (error?.code === '23505') Alert.alert('Already reported', 'You have already reported this post.')
          else if (error?.code === '42501') Alert.alert('Rate limit reached', 'You can only report 5 posts per hour. Please try again later.')
          else if (error) Alert.alert('Error', 'Could not submit report. Please try again.')
          else Alert.alert('Report submitted', 'Thank you. We will review this post.')
        },
      },
    ])
  }

  return (
    <KeyboardAvoidingView
      style={[ec.page, { backgroundColor: theme.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Top tab bar */}
      <View style={[ec.topTabBar, { backgroundColor: theme.header, borderBottomColor: theme.divider }]}>
        <Pressable style={ec.topTab} onPress={() => setActiveTopTab('community')}>
          <Text style={[ec.topTabText, { color: activeTopTab === 'community' ? '#6366f1' : theme.subtext }]}>Community</Text>
          {activeTopTab === 'community' && <View style={ec.topTabIndicator} />}
        </Pressable>
        <Pressable style={ec.topTab} onPress={() => setActiveTopTab('friends')}>
          <Text style={[ec.topTabText, { color: activeTopTab === 'friends' ? '#6366f1' : theme.subtext }]}>Friends</Text>
          {pendingRequests.length > 0 && (
            <View style={ec.pendingBadge}>
              <Text style={ec.pendingBadgeText}>{pendingRequests.length}</Text>
            </View>
          )}
          {activeTopTab === 'friends' && <View style={ec.topTabIndicator} />}
        </Pressable>
      </View>

      {activeTopTab === 'community' ? (
        loading ? (
          <View style={ec.loadingContainer}>
            <ActivityIndicator size="large" color="#6366f1" />
          </View>
        ) : (
          <FlatList
            data={feed.filter(item => !blockedIds.includes(item.user_id))}
            keyExtractor={item => item.id}
            contentContainerStyle={ec.listContent}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <CommunityCard
                item={item}
                currentUserId={user?.id}
                theme={theme}
                onDelete={handleDelete}
                onReport={handleReport}
                onBlock={handleBlock}
              />
            )}
            ListHeaderComponent={() => (
              <Text style={[ec.feedLabel, { color: theme.subtext }]}>COMMUNITY</Text>
            )}
            ListFooterComponent={() => (
              <Text style={[ec.guidelines, { color: theme.muted }]}>
                Community posts are moderated. Reported content is reviewed and removed within 24 hours, and accounts that post abusive content are removed.
              </Text>
            )}
            ListEmptyComponent={() => (
              <View style={ec.emptyContainer}>
                <Text style={ec.emptyIcon}>🌐</Text>
                <Text style={[ec.emptyTitle, { color: theme.text }]}>Nothing here yet</Text>
                <Text style={[ec.emptySub, { color: theme.subtext }]}>
                  Be the first to share with the community!
                </Text>
              </View>
            )}
          />
        )
      ) : (
        friendsLoading ? (
          <View style={ec.loadingContainer}>
            <ActivityIndicator size="large" color="#6366f1" />
          </View>
        ) : (
          <FriendsPanel
            theme={theme}
            myFriendCode={myFriendCode}
            addCodeInput={addCodeInput}
            setAddCodeInput={setAddCodeInput}
            addingFriend={addingFriend}
            onAddFriend={handleAddFriend}
            onShareCode={handleShareCode}
            pendingRequests={pendingRequests}
            onAccept={handleAccept}
            onDecline={handleDecline}
            friends={friends}
            onViewProfile={handleViewProfile}
            onRemoveFriend={handleRemoveFriend}
          />
        )
      )}

      {activeTopTab === 'community' && (
        <Pressable style={[ec.fab, { backgroundColor: '#6366f1' }]} onPress={() => setPostModalVisible(true)}>
          <Text style={ec.fabText}>＋</Text>
        </Pressable>
      )}

      <PostModal
        visible={postModalVisible}
        theme={theme}
        userId={user?.id}
        userEmail={user?.email}
        profile={profile}
        unit={unit}
        onClose={() => setPostModalVisible(false)}
        onPost={() => { setPostModalVisible(false); fetchFeed() }}
      />
    </KeyboardAvoidingView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const ec = StyleSheet.create({
  page: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 110 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  feedLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 12 },
  guidelines: { fontSize: 11, fontWeight: '500', lineHeight: 17, textAlign: 'center', paddingHorizontal: 12, paddingTop: 8 },

  card: {
    borderRadius: 20, marginBottom: 16, borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 8, elevation: 3, overflow: 'hidden',
  },

  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14 },
  avatar: { width: 46, height: 46, borderRadius: 23 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 20, fontWeight: '800', color: '#6366f1' },
  authorBlock: { flex: 1, marginLeft: 12, marginTop: 1 },
  authorName: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  authorMeta: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  authorBio: { fontSize: 12, fontWeight: '400', marginTop: 4, lineHeight: 17 },
  actionBtn: { padding: 4, marginLeft: 8, marginTop: 2 },
  actionGlyph: { fontSize: 20, fontWeight: '800', lineHeight: 20 },

  routineSection: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  routinePill: { alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 8 },
  routinePillText: { fontSize: 14, fontWeight: '700', color: '#6366f1', letterSpacing: -0.2 },
  routineMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  routineMetaText: { fontSize: 13, fontWeight: '500' },
  routineMetaDot: { fontSize: 13 },

  taskList: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 4 },
  taskRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 10 },
  taskEmoji: { fontSize: 16, width: 22, textAlign: 'center' },
  taskBullet: { width: 7, height: 7, borderRadius: 4, marginHorizontal: 7.5, opacity: 0.5 },
  exerciseThumb: { width: 44, height: 44, borderRadius: 8 },
  taskName: { flex: 1, fontSize: 14, fontWeight: '500' },
  taskTime: { fontSize: 13, fontWeight: '500', minWidth: 30, textAlign: 'right' },

  macroRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 12, borderTopWidth: StyleSheet.hairlineWidth },
  macroChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  macroChipLabel: { fontSize: 12, fontWeight: '800' },
  macroChipVal: { fontSize: 13, fontWeight: '600' },

  mealSectionHeader: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  mealSectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  reviewRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingBottom: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  reviewBadge: { backgroundColor: '#f59e0b20', borderColor: '#f59e0b', borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  reviewBadgeText: { fontSize: 11, fontWeight: '700', color: '#f59e0b' },

  emptyContainer: { alignItems: 'center', paddingTop: 72 },
  emptyIcon: { fontSize: 52, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  emptySub: { fontSize: 14, fontWeight: '500', textAlign: 'center', lineHeight: 21, paddingHorizontal: 24 },
  emptyMsg: { textAlign: 'center', paddingVertical: 24, fontSize: 14, fontStyle: 'italic' },

  fab: {
    position: 'absolute', bottom: 32, right: 24,
    width: 62, height: 62, borderRadius: 31,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#6366f1', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 14, elevation: 10,
  },
  fabText: { color: '#fff', fontSize: 28, fontWeight: '300', lineHeight: 34 },

  overlay: { flex: 1, justifyContent: 'flex-end' },
  overlayBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 10, paddingHorizontal: 24, paddingBottom: 48,
    maxHeight: '90%',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 20,
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3, marginBottom: 12 },

  tabBar: { marginHorizontal: -24, marginBottom: 16 },
  tabBarContent: { paddingHorizontal: 24, gap: 8 },
  tabBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: 'transparent' },
  tabBtnActive: { backgroundColor: 'rgba(99,102,241,0.1)' },
  tabBtnText: { fontSize: 13, fontWeight: '700' },

  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8 },

  bioInput: {
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, borderWidth: 1, height: 68,
    textAlignVertical: 'top', marginBottom: 4,
  },
  bioCount: { fontSize: 11, fontWeight: '500', textAlign: 'right', marginBottom: 12 },

  visBox: { borderRadius: 14, borderWidth: 1, overflow: 'hidden', marginBottom: 4 },
  visRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  visLabel: { fontSize: 15, fontWeight: '500' },
  visDivider: { height: StyleSheet.hairlineWidth },

  pickRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  pickRowName: { fontSize: 16, fontWeight: '600', flex: 1 },
  pickRowSub: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  pickRowCta: { fontSize: 14, fontWeight: '700', marginLeft: 8 },

  cancelBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1.5, marginTop: 16, marginBottom: 8 },

  topTabBar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  topTab: { flex: 1, alignItems: 'center', paddingVertical: 12, position: 'relative' },
  topTabText: { fontSize: 15, fontWeight: '700' },
  topTabIndicator: { position: 'absolute', bottom: 0, left: '20%', right: '20%', height: 2.5, borderRadius: 2, backgroundColor: '#6366f1' },
  pendingBadge: { position: 'absolute', top: 8, right: 28, backgroundColor: '#ef4444', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  pendingBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },

  friendsContent: { padding: 20, paddingBottom: 110 },
  codeCard: { borderRadius: 16, borderWidth: 1, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  codeValue: { fontSize: 28, fontWeight: '800', letterSpacing: 5 },
  codeHint: { fontSize: 12, fontWeight: '500', marginTop: 3 },
  sharePillBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12 },
  sharePillBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  addFriendRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, paddingLeft: 16, paddingRight: 8, paddingVertical: 8, gap: 10, marginBottom: 4 },
  addFriendInput: { flex: 1, fontSize: 16, fontWeight: '700', letterSpacing: 3, paddingVertical: 6 },
  addFriendBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  addFriendBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  friendsList: { borderRadius: 16, borderWidth: 1, overflow: 'hidden', marginBottom: 4 },
  friendItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  friendAvatar: { width: 44, height: 44, borderRadius: 22 },
  friendAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  friendAvatarInitial: { fontSize: 17, fontWeight: '800', color: '#6366f1' },
  friendName: { fontSize: 15, fontWeight: '600' },
  friendSub: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  acceptBtn: { backgroundColor: '#6366f1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  acceptBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  declineBtn: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1 },
  declineBtnText: { fontWeight: '700', fontSize: 13 },
  noFriendsBox: { alignItems: 'center', paddingVertical: 40 },
})
