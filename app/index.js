import { Redirect } from 'expo-router'
import { useAuth } from '../lib/AuthContext'
import { View, ActivityIndicator } from 'react-native'
import { useEffect, useState } from 'react'
import { hasUserSetup } from '../lib/storage'
import { hasOnboardingDone } from '../lib/goalsStorage'

export default function Root() {
  const { user, loading } = useAuth()
  const [setupChecked, setSetupChecked] = useState(false)
  const [setupDone, setSetupDone] = useState(false)
  const [onboardingDone, setOnboardingDone] = useState(false)

  useEffect(() => {
    if (!user) { setSetupChecked(false); return }
    Promise.all([
      hasUserSetup(user.id),
      hasOnboardingDone(user.id),
    ]).then(([setup, onb]) => {
      setSetupDone(setup)
      setOnboardingDone(onb)
      setSetupChecked(true)
    })
  }, [user])

  if (loading || (user && !setupChecked)) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f6f7fb' }}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    )
  }

  if (!user) return <Redirect href="/(auth)/login" />
  if (!setupDone) return <Redirect href="/setup-routine" />
  if (!onboardingDone) return <Redirect href="/onboarding" />
  return <Redirect href="/(tabs)" />
}