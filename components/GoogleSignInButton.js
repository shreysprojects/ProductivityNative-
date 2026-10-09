import { Pressable, Text, StyleSheet, Alert } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import * as Google from 'expo-auth-session/providers/google'
import { useEffect } from 'react'
import { useAuth } from '../lib/AuthContext'
import { router } from 'expo-router'

WebBrowser.maybeCompleteAuthSession()

export default function GoogleSignInButton() {
  const { signInWithGoogle } = useAuth()

  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    scopes: ['openid', 'profile', 'email'],
  })

  useEffect(() => {
    if (response?.type !== 'success') return
    // expo-auth-session returns idToken in authentication (PKCE) or params (implicit)
    const idToken = response.authentication?.idToken ?? response.params?.id_token
    if (!idToken) {
      Alert.alert('Google sign-in failed', 'No ID token received.')
      return
    }
    signInWithGoogle(idToken)
      .then(() => router.replace('/(tabs)'))
      .catch(e => Alert.alert('Google sign-in failed', e.message))
  }, [response])

  const ready = !!process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID

  return (
    <Pressable
      style={[s.btn, !ready && s.btnDisabled]}
      onPress={() => ready
        ? promptAsync()
        : Alert.alert('Not configured', 'Add EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID to your .env file.')
      }
    >
      <Text style={s.g}>G</Text>
      <Text style={s.text}>Continue with Google</Text>
    </Pressable>
  )
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
