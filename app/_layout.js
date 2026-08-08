import 'react-native-url-polyfill/auto'
import { useEffect, useRef, useState } from 'react'
import { Animated, AppState, StyleSheet, View, Image } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Stack } from 'expo-router'
import { AuthProvider, useAuth } from '../lib/AuthContext'
import { ThemeProvider, useTheme } from '../lib/ThemeContext'
import { StatusBar } from 'expo-status-bar'
import * as Notifications from 'expo-notifications'
import { supabase } from '../lib/supabase'
import { flushQueue } from '../lib/syncQueue'
import { syncFromCloud } from '../lib/cloudSync'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

function SplashOverlay({ onDone }) {
  const opacity  = useRef(new Animated.Value(0)).current
  const scale    = useRef(new Animated.Value(0.82)).current
  const slideOut = useRef(new Animated.Value(0)).current

  useEffect(() => {
    // Fade + scale in
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, speed: 14, bounciness: 8, useNativeDriver: true }),
    ]).start(() => {
      // Hold for ~700ms then slide up and fade out
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(opacity,  { toValue: 0, duration: 380, useNativeDriver: true }),
          Animated.timing(slideOut, { toValue: -40, duration: 380, useNativeDriver: true }),
          Animated.timing(scale,    { toValue: 1.06, duration: 380, useNativeDriver: true }),
        ]).start(onDone)
      }, 700)
    })
  }, [])

  return (
    <Animated.View
      style={[sp.overlay, { opacity }]}
      pointerEvents="none"
    >
      <Animated.View style={{ transform: [{ scale }, { translateY: slideOut }] }}>
        <Image source={require('../assets/images/logo.png')} style={sp.logo} resizeMode="contain" />
      </Animated.View>
    </Animated.View>
  )
}

function Inner() {
  const { theme } = useTheme()
  const { user } = useAuth()
  const [splashDone, setSplashDone] = useState(false)
  const userId = user?.id ?? null

  // Keep the auth session refreshing only while the app is in the foreground,
  // and reconcile local data with the server whenever we come back to it.
  useEffect(() => {
    supabase.auth.startAutoRefresh()

    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh()
        syncFromCloud(userId)
      } else {
        supabase.auth.stopAutoRefresh()
      }
    })
    return () => sub.remove()
  }, [userId])

  // Sign-in: push anything queued offline, then pull the server's copy so a
  // device that has been used before still sees edits made elsewhere.
  useEffect(() => {
    if (userId) syncFromCloud(userId)
    else flushQueue()
  }, [userId])

  return (
    // Themed background here so route transitions never flash white.
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={theme.statusBar} />
      {/* Real stack navigator: native slide transitions between screens, so
          pages animate in instead of cutting to a blank frame while loading. */}
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.bg },
        }}
      />
      {!splashDone && <SplashOverlay onDone={() => setSplashDone(true)} />}
    </View>
  )
}

const sp = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#2b7fff',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  logo: { width: 160, height: 160 },
})

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AuthProvider>
          <Inner />
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  )
}
