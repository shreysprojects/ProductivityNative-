import { useState, useEffect } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useAuth } from '../../lib/AuthContext'

const RESEND_COOLDOWN = 60

export default function VerifyEmail() {
  const { email } = useLocalSearchParams()
  const { confirmSignUp, resendSignUpCode } = useAuth()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  // The signup email was just sent, so start in cooldown to avoid the 60s server reject.
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setInterval(() => setCooldown(c => (c <= 1 ? 0 : c - 1)), 1000)
    return () => clearInterval(id)
  }, [cooldown > 0])

  async function handleVerify() {
    if (!code.trim()) return Alert.alert('Enter the code from your email')
    setLoading(true)
    try {
      await confirmSignUp(String(email), code)
      router.replace('/')
    } catch (e) {
      Alert.alert('Could not verify', e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    if (cooldown > 0 || resending) return
    setResending(true)
    try {
      await resendSignUpCode(String(email))
      setCooldown(RESEND_COOLDOWN)
      Alert.alert('Code sent', `We sent a new code to ${email}.`)
    } catch (e) {
      // Supabase enforces a ~60s window between sends; surface it and start the timer.
      if (/\d+\s*seconds?/.test(e.message ?? '')) setCooldown(RESEND_COOLDOWN)
      Alert.alert('Please wait', e.message)
    } finally {
      setResending(false)
    }
  }

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.inner} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={s.emoji}>📧</Text>
        <Text style={s.title}>Verify your email</Text>
        <Text style={s.sub}>We sent a verification code to {email}. Enter it below to finish creating your account.</Text>

        <TextInput
          style={s.input}
          placeholder="Verification code"
          placeholderTextColor="rgba(255,255,255,0.35)"
          autoCapitalize="none"
          keyboardType="number-pad"
          value={code}
          onChangeText={setCode}
        />

        <Pressable style={[s.btn, loading && s.btnDisabled]} onPress={handleVerify} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Verify & continue</Text>}
        </Pressable>

        <Pressable onPress={handleResend} disabled={resending || cooldown > 0} style={s.resend}>
          <Text style={[s.resendText, (resending || cooldown > 0) && { opacity: 0.5 }]}>
            {resending ? 'Sending…' : cooldown > 0 ? `Resend code in ${cooldown}s` : "Didn't get it? Resend code"}
          </Text>
        </Pressable>

        <Pressable onPress={() => router.back()} style={s.backLink}>
          <Text style={s.backLinkText}>← Back</Text>
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
