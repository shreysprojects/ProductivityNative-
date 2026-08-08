import { Platform, Pressable, Text, StyleSheet, Alert } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import * as Google from 'expo-auth-session/providers/google'
import { useEffect, useState } from 'react'
import { useAuth, createNoncePair } from '../lib/AuthContext'
import { router } from 'expo-router'

WebBrowser.maybeCompleteAuthSession()

// Google.useAuthRequest THROWS during render when this platform's client id
// is missing — which crashed the whole login screen (a white screen at launch
// for anyone signed out). So the hook lives in an inner component that only
// mounts when this platform is actually configured.
function clientIdForPlatform() {
  if (Platform.OS === 'ios')     return process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
  if (Platform.OS === 'android') return process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID
  return process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
}

function ButtonShell({ dimmed, onPress }) {
  return (
    <Pressable style={[s.btn, dimmed && s.btnDisabled]} onPress={onPress}>
      <Text style={s.g}>G</Text>
      <Text style={s.text}>Continue with Google</Text>
    </Pressable>
  )
}

function ConfiguredGoogleSignInButton() {
  const { signInWithGoogle } = useAuth()
  const [nonce, setNonce] = useState(null)

  useEffect(() => {
    let active = true
    createNoncePair().then(pair => { if (active) setNonce(pair) })
    return () => { active = false }
  }, [])

  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    scopes: ['openid', 'profile', 'email'],
    // Google echoes this into the id_token, so Supabase can match it to our raw nonce.
    extraParams: nonce ? { nonce: nonce.hashed } : undefined,
  })

  useEffect(() => {
    if (response?.type !== 'success') return
    // expo-auth-session returns idToken in authentication (PKCE) or params (implicit)
    const idToken = response.authentication?.idToken ?? response.params?.id_token
    if (!idToken) {
      Alert.alert('Google sign-in failed', 'No ID token received.')
      return
    }
    signInWithGoogle(idToken, nonce?.raw)
      .then(() => router.replace('/(tabs)'))
      .catch(e => Alert.alert('Google sign-in failed', e.message))
  }, [response])

  const ready = !!request && !!nonce
  return <ButtonShell dimmed={!ready} onPress={() => { if (ready) promptAsync() }} />
}

export default function GoogleSignInButton() {
  if (!clientIdForPlatform()) {
    return (
      <ButtonShell
        dimmed
        onPress={() => Alert.alert(
          'Not available',
          'Google sign-in is not set up for this device. Use email or Apple sign-in instead.'
        )}
      />
    )
  }
  return <ConfiguredGoogleSignInButton />
}

const s = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    borderWidth: 1, borderColor: '#e6e6ef', borderRadius: 12,
    padding: 14, backgroundColor: '#fff',
  },
  btnDisabled: { opacity: 0.5 },
  g: { fontSize: 17, fontWeight: '700', color: '#4285F4' },
  text: { fontSize: 15, fontWeight: '600', color: '#333' },
})
