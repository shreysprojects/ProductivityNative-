import { Platform, Alert, StyleSheet } from 'react-native'
import * as AppleAuthentication from 'expo-apple-authentication'
import { useAuth, createNoncePair } from '../lib/AuthContext'
import { router } from 'expo-router'

export default function AppleSignInButton() {
  const { signInWithApple } = useAuth()

  if (Platform.OS !== 'ios') return null

  async function handlePress() {
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
      router.replace('/(tabs)')
    } catch (e) {
      if (e.code !== 'ERR_CANCELED') {
        Alert.alert('Apple sign-in failed', e.message)
      }
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
