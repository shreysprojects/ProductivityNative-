import { useState, useCallback } from 'react'
import { View, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useAuth } from '../../lib/AuthContext'
import { useTheme } from '../../lib/ThemeContext'
import { loadHabits } from '../../lib/habitsStorage'
import HabitsTab from '../../components/HabitsTab'

export default function HabitsScreen() {
  const { user } = useAuth()
  const { theme } = useTheme()
  const [habits, setHabits] = useState({ breaking: [], building: [], tips: '' })
  const [loading, setLoading] = useState(true)

  useFocusEffect(useCallback(() => {
    if (!user) return
    let active = true
    loadHabits(user.id).then(h => {
      if (!active) return
      setHabits(h)
      setLoading(false)
    })
    return () => { active = false }
  }, [user]))

  if (loading) return <View style={[hs.page, { backgroundColor: theme.bg }]} />

  return (
    <KeyboardAvoidingView style={[hs.page, { backgroundColor: theme.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={hs.content} keyboardShouldPersistTaps="handled">
        <HabitsTab userId={user.id} theme={theme} habits={habits} onHabitsChange={setHabits} />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const hs = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: 16, paddingBottom: 36 },
})
