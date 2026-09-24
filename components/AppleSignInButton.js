import { useEffect, useRef } from 'react'
import { Platform, Alert, StyleSheet } from 'react-native'
import * as AppleAuthentication from 'expo-apple-authentication'
import { useAuth, createNoncePair } from '../lib/AuthContext'
import { router } from 'expo-router'

// Closing Apple's sheet is not a failure. SDK 57 reports it as
// ERR_REQUEST_CANCELED; older versions said ERR_CANCELED.
const CANCELED = new Set(['ERR_REQUEST_CANCELED', 'ERR_CANCELED'])

export default function AppleSignInButton() {
  const { signInWithApple } = useAuth()
  // One sign-in at a time: a second tap used to start a second Apple sheet.
  const busy = useRef(false)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  if (Platform.OS !== 'ios') return null

  async function handlePress() {
    if (busy.current) return
    busy.current = true
    try {
      const { raw, hashed } = await createNoncePair()
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashed,
      })
      await signInWithApple(credential, raw)
      // Through the start-up checks in app/index.js, which send a new account
      // through setup first. The login screen moves on by itself once the
      // session arrives, so only navigate if this screen is still here.
      if (mounted.current) router.replace('/')
    } catch (e) {
      if (!CANCELED.has(e?.code)) {
        Alert.alert('Apple sign-in failed', e?.message ?? 'Please try again.')
      }
    } finally {
      busy.current = false
    }
  }

  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
      cornerRadius={14}
      style={s.btn}
      onPress={handlePress}
    />
  )
}

const s = StyleSheet.create({
  btn: { height: 52, width: '100%' },
})
