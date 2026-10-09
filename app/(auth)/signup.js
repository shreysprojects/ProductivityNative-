import { useState, useEffect, useRef } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert, Image,
} from 'react-native'
import { Link, router } from 'expo-router'
import { useAuth } from '../../lib/AuthContext'
import GoogleSignInButton from '../../components/GoogleSignInButton'
import AppleSignInButton from '../../components/AppleSignInButton'
import { checkUsernameAvailable } from '../../lib/profileStorage'

function validateUsernameFormat(u) {
  if (!u || u.length < 3) return 'too_short'
  if (u.length > 20) return 'too_long'
  if (!/^[a-z0-9_]+$/.test(u)) return 'invalid_chars'
  return 'valid'
}

export default function Signup() {
  const { signUp } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [usernameStatus, setUsernameStatus] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => {
    const normalized = username.toLowerCase().trim()
    if (!normalized) { setUsernameStatus(null); return }

    const fmt = validateUsernameFormat(normalized)
    if (fmt !== 'valid') {
      setUsernameStatus('invalid')
      return
    }

    setUsernameStatus('checking')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      const ok = await checkUsernameAvailable(normalized)
      setUsernameStatus(ok ? 'available' : 'taken')
    }, 500)
    return () => clearTimeout(timerRef.current)
  }, [username])

  function usernameHint() {
    if (!username) return null
    if (usernameStatus === 'invalid') {
      const fmt = validateUsernameFormat(username.toLowerCase().trim())
      if (fmt === 'too_short') return { text: 'At least 3 characters', color: '#f59e0b' }
      if (fmt === 'too_long') return { text: 'Max 20 characters', color: '#f59e0b' }
      return { text: 'Letters, numbers, and underscores only', color: '#f59e0b' }
    }
    if (usernameStatus === 'checking') return { text: 'Checking availability…', color: '#9090a8' }
    if (usernameStatus === 'available') return { text: `@${username.toLowerCase()} is available ✓`, color: '#22c55e' }
    if (usernameStatus === 'taken') return { text: 'Username is already taken', color: '#ef4444' }
    return null
  }

  async function handleSignUp() {
    if (!email || !password || !username) return Alert.alert('Required fields missing', 'Email, username, and password are required.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return Alert.alert('Invalid email', 'Please enter a valid email address.')
    if (password.length < 8) return Alert.alert('Weak password', 'Password must be at least 8 characters.')
    if (password !== confirm) return Alert.alert('Passwords do not match')
    if (validateUsernameFormat(username.toLowerCase().trim()) !== 'valid') return Alert.alert('Invalid username', 'Use 3–20 letters, numbers, or underscores.')
    if (usernameStatus !== 'available') return Alert.alert('Username unavailable', 'Please choose a different username.')
    setLoading(true)
    try {
      const res = await signUp({ name, email, password, username })
      if (res?.needsConfirmation) {
        router.push({
          pathname: '/(auth)/verify-email',
          params: { email: email.trim(), username: username.toLowerCase().trim(), name },
        })
      } else {
        router.replace('/')
      }
    } catch (e) {
      Alert.alert('Sign up failed', e.message)
    } finally {
      setLoading(false)
    }
  }

  const hint = usernameHint()

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.brand}>
        <Image source={require('../../assets/images/logo.png')} style={s.brandLogo} resizeMode="contain" />
        <Text style={s.brandName}>LifeLayer</Text>
        <Text style={s.brandTagline}>Build habits. Track progress.</Text>
      </View>

      <View style={s.sheet}>
        <View style={s.sheetHandle} />
        <ScrollView
          contentContainerStyle={s.form}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.title}>Create account</Text>

          <TextInput
            style={s.input} placeholder="Name (optional)"
            placeholderTextColor="#9090a8"
            value={name} onChangeText={setName}
          />
          <TextInput
            style={s.input} placeholder="Email"
            placeholderTextColor="#9090a8"
            autoCapitalize="none" keyboardType="email-address"
            value={email} onChangeText={setEmail}
          />

          <TextInput
            style={[s.input, hint ? { marginBottom: 4 } : null]}
            placeholder="Username"
            placeholderTextColor="#9090a8"
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={setUsername}
          />
          {hint && <Text style={[s.hint, { color: hint.color }]}>{hint.text}</Text>}

          <TextInput
            style={s.input} placeholder="Password (min 8 characters)"
            placeholderTextColor="#9090a8"
            secureTextEntry value={password} onChangeText={setPassword}
          />
          <TextInput
            style={s.input} placeholder="Confirm password"
            placeholderTextColor="#9090a8"
            secureTextEntry value={confirm} onChangeText={setConfirm}
          />

          <Pressable style={[s.btn, loading && s.btnDisabled]} onPress={handleSignUp} disabled={loading}>
            <Text style={s.btnText}>{loading ? 'Creating account…' : 'Create account'}</Text>
          </Pressable>

          <Text style={s.legalText}>
            By creating your account, you agree to LifeLayer's{' '}
            <Text style={s.legalLink} onPress={() => router.push('/terms')}>terms and conditions</Text>
            {' '}and{' '}
            <Text style={s.legalLink} onPress={() => router.push('/privacy')}>privacy policy</Text>.
          </Text>

          <View style={s.divider}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>OR</Text>
            <View style={s.dividerLine} />
          </View>

          <AppleSignInButton />
          {Platform.OS === 'ios' && <View style={{ height: 10 }} />}
          <GoogleSignInButton />

          <View style={s.footer}>
            <Text style={s.footerText}>Already have an account? </Text>
            <Link href="/(auth)/login" style={s.link}>Sign in</Link>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#0d1b5e' },

  brand: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    paddingBottom: 24,
  },
  brandLogo: { width: 90, height: 90, marginBottom: 14 },
  brandName: {
    fontSize: 34, fontWeight: '800', color: '#ffffff',
    letterSpacing: -0.8,
  },
  brandTagline: {
    fontSize: 15, color: 'rgba(255,255,255,0.45)',
    marginTop: 6, fontWeight: '500',
  },

  sheet: {
    backgroundColor: '#f4f4f9',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingTop: 10,
    maxHeight: '78%',
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#ddd',
    alignSelf: 'center', marginBottom: 10,
  },
  form: { paddingHorizontal: 28, paddingBottom: 36 },

  title: {
    fontSize: 24, fontWeight: '700', color: '#0d0d18',
    letterSpacing: -0.4, marginBottom: 20,
  },
  input: {
    backgroundColor: '#ffffff',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 15,
    fontSize: 16, borderWidth: 1.5, borderColor: '#e0e0f0',
    marginBottom: 12, color: '#0d0d18',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  hint: {
    fontSize: 12, fontWeight: '600',
    marginBottom: 10, marginLeft: 4,
  },
  btn: {
    backgroundColor: '#2b7fff',
    borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 4,
    borderWidth: 2.5, borderColor: '#0d1b5e',
    shadowColor: '#0d1b5e', shadowOffset: { width: 3, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 0, elevation: 6,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16, letterSpacing: 0.2 },

  legalText: { fontSize: 11, color: '#9090a8', textAlign: 'center', marginTop: 12, lineHeight: 16 },
  legalLink: { fontWeight: '700', textDecorationLine: 'underline', color: '#5c5ef0' },

  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 18 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#e5e5f0' },
  dividerText: {
    marginHorizontal: 14, color: '#b0b0c8',
    fontSize: 11, fontWeight: '700', letterSpacing: 1,
  },

  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 22 },
  footerText: { color: '#9090a8', fontSize: 14 },
  link: { color: '#5c5ef0', fontWeight: '700', fontSize: 14 },
})
