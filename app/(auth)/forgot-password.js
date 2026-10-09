import { useState } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator,
} from 'react-native'
import { router } from 'expo-router'
import { useAuth } from '../../lib/AuthContext'

export default function ForgotPassword() {
  const { sendPasswordReset, confirmPasswordReset } = useAuth()
  const [phase, setPhase] = useState('email') // 'email' | 'reset'
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSend() {
    if (!email.trim()) return Alert.alert('Enter your email')
    setLoading(true)
    try {
      await sendPasswordReset(email)
      setPhase('reset')
      Alert.alert('Check your email', `We sent a password reset code to ${email.trim()}. Enter it below along with your new password.`)
    } catch (e) {
      Alert.alert('Could not send code', e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleReset() {
    if (!code.trim()) return Alert.alert('Enter the code from your email')
    if (newPassword.length < 6) return Alert.alert('Password too short', 'Use at least 6 characters.')
    setLoading(true)
    try {
      await confirmPasswordReset(email, code, newPassword)
      Alert.alert('Password updated', 'Your password has been reset.')
      router.replace('/')
    } catch (e) {
      Alert.alert('Could not reset password', e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.inner} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={s.emoji}>🔑</Text>
        <Text style={s.title}>Reset your password</Text>
        <Text style={s.sub}>
          {phase === 'email'
            ? "Enter your account email and we'll send you a reset code."
            : `Enter the code sent to ${email.trim()} and choose a new password.`}
        </Text>

        {phase === 'email' ? (
          <>
            <TextInput
              style={s.input}
              placeholder="Email"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <Pressable style={[s.btn, loading && s.btnDisabled]} onPress={handleSend} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Send reset code</Text>}
            </Pressable>
          </>
        ) : (
          <>
            <TextInput
              style={s.input}
              placeholder="Reset code"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="none"
              keyboardType="number-pad"
              value={code}
              onChangeText={setCode}
            />
            <TextInput
              style={s.input}
              placeholder="New password"
              placeholderTextColor="rgba(255,255,255,0.35)"
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
            />
            <Pressable style={[s.btn, loading && s.btnDisabled]} onPress={handleReset} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Reset password</Text>}
            </Pressable>
            <Pressable onPress={() => setPhase('email')} disabled={loading} style={s.resend}>
              <Text style={s.resendText}>Use a different email</Text>
            </Pressable>
          </>
        )}

        <Pressable onPress={() => router.back()} style={s.backLink}>
          <Text style={s.backLinkText}>← Back to sign in</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#0d0d17' },
  inner: { flexGrow: 1, paddingHorizontal: 28, justifyContent: 'center', paddingVertical: 60 },
  emoji: { fontSize: 52, textAlign: 'center', marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '800', color: '#fff', letterSpacing: -0.5, textAlign: 'center', marginBottom: 8 },
  sub: { fontSize: 15, color: 'rgba(255,255,255,0.45)', textAlign: 'center', marginBottom: 32, fontWeight: '500', lineHeight: 21 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 15,
    fontSize: 16, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.12)',
    marginBottom: 12, color: '#fff',
  },
  btn: {
    backgroundColor: '#6366f1',
    borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8,
    shadowColor: '#6366f1', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 10, elevation: 6,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  resend: { alignItems: 'center', paddingVertical: 14 },
  resendText: { color: 'rgba(255,255,255,0.55)', fontSize: 14, fontWeight: '600' },
  backLink: { alignItems: 'center', paddingVertical: 16, marginTop: 8 },
  backLinkText: { color: '#8b8bf0', fontSize: 14, fontWeight: '700' },
})
