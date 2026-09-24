import { Redirect } from 'expo-router'
import { useAuth } from '../lib/AuthContext'
import { useTheme } from '../lib/ThemeContext'
import { View, ActivityIndicator } from 'react-native'
import { useEffect, useState } from 'react'
import { hasUserSetup } from '../lib/storage'
import { hasOnboardingDone } from '../lib/goalsStorage'

// Startup gate. These checks decide which screen to land on, and one of them
// reaches the network — so it gets a deadline. Without one, a slow or
// unreachable server left the app sitting on this spinner forever, which reads
// as "the app won't open".
const CHECK_TIMEOUT_MS = 6000

export default function Root() {
  const { user, loading } = useAuth()
  const { theme } = useTheme()
  const [setupChecked, setSetupChecked] = useState(false)
  const [setupDone, setSetupDone] = useState(false)
  const [onboardingDone, setOnboardingDone] = useState(false)
  const userId = user?.id ?? null

  useEffect(() => {
    if (!userId) { setSetupChecked(false); return }
    let cancelled = false

    const timeout = new Promise(resolve => setTimeout(() => resolve(null), CHECK_TIMEOUT_MS))

    Promise.race([
      Promise.all([hasUserSetup(userId), hasOnboardingDone(userId)]),
      timeout,
    ])
      .then(result => {
        if (cancelled) return
        if (Array.isArray(result)) {
          setSetupDone(result[0])
          setOnboardingDone(result[1])
        } else {
          // Couldn't decide in time. Send an existing user into the app rather
          // than stranding them here or pushing them back through first-run
          // setup; every screen loads from its own local cache anyway.
          setSetupDone(true)
          setOnboardingDone(true)
        }
        setSetupChecked(true)
      })
      .catch(() => {
        if (cancelled) return
        setSetupDone(true)
        setOnboardingDone(true)
        setSetupChecked(true)
      })

    return () => { cancelled = true }
  }, [userId])

  if (loading || (user && !setupChecked)) {
    return (
      // Themed like every other screen: a fixed light background flashed
      // white on each launch in dark mode.
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.bg }}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    )
  }

  if (!user) return <Redirect href="/(auth)/login" />
  if (!setupDone) return <Redirect href="/setup-routine" />
  if (!onboardingDone) return <Redirect href="/onboarding" />
  return <Redirect href="/(tabs)" />
}
