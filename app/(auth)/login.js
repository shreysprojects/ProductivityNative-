import { useState } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert, Image,
} from 'react-native'
import { Link, router } from 'expo-router'
import { useAuth } from '../../lib/AuthContext'
import GoogleSignInButton from '../../components/GoogleSignInButton'
import AppleSignInButton from '../../components/AppleSignInButton'

export default function Login() {
  const { signIn, resendSignUpCode } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSignIn() {
    if (!email || !password) return Alert.alert('Fill in all fields')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return Alert.alert('Invalid email', 'Please enter a valid email address.')
    setLoading(true)
    try {
      await signIn({ email, password })
      router.replace('/')
    } catch (e) {
      const msg = (e.message ?? '').toLowerCase()
      if (msg.includes('not confirmed') || msg.includes('confirm')) {
        // Account exists but email isn't verified yet → send them to verify it.
        try { await resendSignUpCode(email) } catch {}
        router.push({ pathname: '/(auth)/verify-email', params: { email: email.trim() } })
        return
      }
      Alert.alert('Sign in failed', e.message)
    } finally {
      setLoading(false)
    }
  }

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
          <Text style={s.title}>Welcome back</Text>

          <TextInput
            style={s.input}
            placeholder="Email"
            placeholderTextColor="#9090a8"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={s.input}
            placeholder="Password"
            placeholderTextColor="#9090a8"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <Pressable onPress={() => router.push('/(auth)/forgot-password')} style={s.forgot} hitSlop={8}>
            <Text style={s.forgotText}>Forgot password?</Text>
          </Pressable>

          <Pressable style={[s.btn, loading && s.btnDisabled]} onPress={handleSignIn} disabled={loading}>
            <Text style={s.btnText}>{loading ? 'Signing in…' : 'Sign in'}</Text>
          </Pressable>

          <View style={s.divider}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>OR</Text>
            <View style={s.dividerLine} />
          </View>

          <AppleSignInButton />
          {Platform.OS === 'ios' && <View style={{ height: 10 }} />}
          <GoogleSignInButton />

          <View style={s.footer}>
            <Text style={s.footerText}>No account? </Text>
            <Link href="/(auth)/signup" style={s.link}>Create one</Link>
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
    maxHeight: '68%',
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
  btn: {
    backgroundColor: '#2b7fff',
    borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 4,
    borderWidth: 2.5, borderColor: '#0d1b5e',
    shadowColor: '#0d1b5e', shadowOffset: { width: 3, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 0, elevation: 6,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16, letterSpacing: 0.2 },

  forgot: { alignSelf: 'flex-end', marginBottom: 4, marginTop: -4, paddingVertical: 4 },
  forgotText: { color: '#5c5ef0', fontWeight: '600', fontSize: 13 },

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
