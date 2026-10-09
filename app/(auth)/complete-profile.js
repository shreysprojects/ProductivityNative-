import { useState, useEffect, useRef } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator,
} from 'react-native'
const BIO_MAX = 120
import { router, useLocalSearchParams } from 'expo-router'
import { useAuth } from '../../lib/AuthContext'
import { checkUsernameAvailable, upsertProfile } from '../../lib/profileStorage'

function validateUsernameFormat(u) {
  if (!u || u.length < 3) return 'too_short'
  if (u.length > 20) return 'too_long'
  if (!/^[a-z0-9_]+$/.test(u)) return 'invalid_chars'
  return 'valid'
}

export default function CompleteProfile() {
  const { user, profile, profileLoading, profileError, profileSetupError, refreshProfile } = useAuth()
  const params = useLocalSearchParams()
  // The username chosen at sign-up, when verification could not save it.
  const [username, setUsername] = useState(() => String(profile?.username || params.username || ''))
  const [bio, setBio] = useState('')
  const [age, setAge] = useState('')
  const [usernameStatus, setUsernameStatus] = useState(null)
  const [saving, setSaving] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const timerRef = useRef(null)
  // What is in the box now. A slow answer about an earlier spelling used to
  // land late and mark the current one "available".
  const latestUsername = useRef('')
  const userId = user?.id ?? null

  useEffect(() => {
    const normalized = username.toLowerCase().trim()
    latestUsername.current = normalized
    if (!normalized) { setUsernameStatus(null); return }

    if (validateUsernameFormat(normalized) !== 'valid') {
      setUsernameStatus('invalid')
      return
    }

    setUsernameStatus('checking')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      // Your own username (a profile already part set up) is not "taken".
      const ok = await checkUsernameAvailable(normalized, userId)
      if (latestUsername.current !== normalized) return
      setUsernameStatus(ok ? 'available' : 'taken')
    }, 500)
    return () => clearTimeout(timerRef.current)
  }, [username, userId])

  function hintText() {
    if (!username) return null
    if (usernameStatus === 'invalid') {
      const fmt = validateUsernameFormat(username.toLowerCase().trim())
      if (fmt === 'too_short') return { text: 'At least 3 characters', color: '#f59e0b' }
      if (fmt === 'too_long') return { text: 'Max 20 characters', color: '#f59e0b' }
      return { text: 'Letters, numbers, and underscores only', color: '#f59e0b' }
    }
    if (usernameStatus === 'checking') return { text: 'Checking availability…', color: 'rgba(255,255,255,0.45)' }
    if (usernameStatus === 'available') return { text: `@${username.toLowerCase()} is available ✓`, color: '#22c55e' }
    if (usernameStatus === 'taken') return { text: 'Username is already taken', color: '#ef4444' }
    return null
  }

  // A profile that could not be read is not known to be empty, and saving
  // over it could wipe a bio or photo it already has.
  const profileUnknown = profileLoading || (!!profileError && !profile)

  async function retryLoad() {
    setRetrying(true)
    try { await refreshProfile() } finally { setRetrying(false) }
  }

  async function handleSave() {
    if (!user || profileUnknown) return
    if (usernameStatus !== 'available') return
    const parsedAge = age ? parseInt(age, 10) : null
    if (parsedAge !== null && parsedAge < 13) {
      Alert.alert('Age requirement', 'You must be 13 or older to use this app.')
      return
    }
    setSaving(true)
    try {
      const validAge = parsedAge && parsedAge >= 13 && parsedAge < 120 ? parsedAge : null
      // Fills in only what is empty. The account may already have a profile
      // (sign-up creates one, and a Google or Apple one has no username yet):
      // a blank field here keeps its bio, and its photo is never touched.
      await upsertProfile(user.id, {
        username: username.toLowerCase().trim(),
        bio: bio.trim() || profile?.bio || '',
        avatar_url: profile?.avatar_url || '',
        age: validAge,
      })
      await refreshProfile()
      router.replace('/')
    } catch (e) {
      Alert.alert('Error', e.message)
    } finally {
      setSaving(false)
    }
  }

  const hint = hintText()
  const canSave = usernameStatus === 'available' && !saving && !profileUnknown

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={s.inner}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.emoji}>👤</Text>
        <Text style={s.title}>Set up your profile</Text>
        <Text style={s.sub}>Choose a username to get started</Text>

        {profileSetupError ? <Text style={s.notice}>{profileSetupError}</Text> : null}

        {!!profileError && !profile && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>
              We couldn't load your profile. Check your connection and try again.
            </Text>
            <Pressable onPress={retryLoad} disabled={retrying} hitSlop={8}>
              {retrying
                ? <ActivityIndicator color="#8b8bf0" />
                : <Text style={s.retryText}>Retry</Text>}
            </Pressable>
          </View>
        )}

        <TextInput
          style={[s.input, hint ? { marginBottom: 4 } : null]}
          placeholder="Username"
          placeholderTextColor="rgba(255,255,255,0.35)"
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={setUsername}
        />
        {hint && <Text style={[s.hint, { color: hint.color }]}>{hint.text}</Text>}

        <TextInput
          style={[s.input, s.bioInput]}
          placeholder="Bio (optional)"
          placeholderTextColor="rgba(255,255,255,0.35)"
          multiline
          maxLength={BIO_MAX}
          value={bio}
          onChangeText={setBio}
        />
        {bio.length > 0 && (
          <Text style={[s.hint, { color: bio.length > BIO_MAX - 15 ? '#f59e0b' : 'rgba(255,255,255,0.35)', textAlign: 'right', marginTop: -6 }]}>
            {bio.length}/{BIO_MAX}
          </Text>
        )}

        <TextInput
          style={s.input}
          placeholder="Age (optional)"
          placeholderTextColor="rgba(255,255,255,0.35)"
          keyboardType="numeric"
          maxLength={3}
          value={age}
          onChangeText={v => setAge(v.replace(/[^0-9]/g, ''))}
        />
        <Text style={[s.hint, { color: age && parseInt(age) < 13 ? '#f87171' : 'rgba(255,255,255,0.35)' }]}>
          You must be 13 or older to use this app.
        </Text>

        <Pressable style={[s.btn, !canSave && s.btnDisabled]} onPress={handleSave} disabled={!canSave}>
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>Continue →</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#0d0d17' },
  inner: {
    flexGrow: 1, paddingHorizontal: 28,
    justifyContent: 'center', paddingVertical: 60,
  },
  emoji: { fontSize: 52, textAlign: 'center', marginBottom: 16 },
  title: {
    fontSize: 28, fontWeight: '800', color: '#fff',
    letterSpacing: -0.5, textAlign: 'center', marginBottom: 8,
  },
  sub: {
    fontSize: 15, color: 'rgba(255,255,255,0.45)',
    textAlign: 'center', marginBottom: 36, fontWeight: '500',
  },
  notice: {
    fontSize: 13, lineHeight: 19, fontWeight: '600', color: '#fbbf24',
    textAlign: 'center', marginTop: -20, marginBottom: 24,
  },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.35)',
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16,
  },
  errorText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600', color: '#fca5a5' },
  retryText: { fontSize: 14, fontWeight: '800', color: '#8b8bf0' },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 15,
    fontSize: 16, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.12)',
    marginBottom: 12, color: '#fff',
  },
  bioInput: { height: 88, textAlignVertical: 'top', paddingTop: 14 },
  hint: { fontSize: 12, fontWeight: '600', marginBottom: 10, marginLeft: 4 },
  btn: {
    backgroundColor: '#6366f1',
    borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8,
    shadowColor: '#6366f1', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 10, elevation: 6,
  },
  btnDisabled: { opacity: 0.35 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
})
