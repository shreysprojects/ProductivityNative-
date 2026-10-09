import { useState, useCallback } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist'
import { router, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '../lib/AuthContext'
import { useTheme } from '../lib/ThemeContext'
import { getRoutineNames, saveRoutineOrder } from '../lib/storage'
import { routineTheme } from '../lib/themes'

export default function ReorderRoutines() {
  const { user } = useAuth()
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const [names, setNames] = useState([])
  const [saving, setSaving] = useState(false)

  useFocusEffect(useCallback(() => {
    if (user) getRoutineNames(user.id).then(setNames)
  }, [user]))

  async function done() {
    if (!user) return router.back()
    setSaving(true)
    try {
      await saveRoutineOrder(user.id, names)
    } finally {
      setSaving(false)
    }
    router.back()
  }

  function renderItem({ item, drag, isActive }) {
    const rt = routineTheme(item)
    return (
      <ScaleDecorator activeScale={0.98}>
        <Pressable
          onLongPress={drag}
          disabled={isActive}
          delayLongPress={150}
          style={[s.row, {
            backgroundColor: theme.card,
            borderColor: isActive ? rt.color : theme.cardBorder,
            shadowColor: isActive ? rt.color : '#000',
            shadowOpacity: isActive ? 0.18 : 0.05,
          }]}
        >
          <Text style={[s.grip, { color: theme.muted }]}>☰</Text>
          <View style={[s.iconWrap, { backgroundColor: rt.color + '18' }]}>
            <Text style={{ fontSize: 18 }}>{rt.emoji}</Text>
          </View>
          <Text style={[s.name, { color: theme.text }]}>{item}</Text>
        </Pressable>
      </ScaleDecorator>
    )
  }

  return (
    <View style={[s.page, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
      <View style={[s.header, { borderBottomColor: theme.headerBorder, backgroundColor: theme.header }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.headerBtn}>
          <Text style={[s.back, { color: theme.text }]}>←</Text>
        </Pressable>
        <Text style={[s.title, { color: theme.text }]}>Reorder Routines</Text>
        <Pressable onPress={done} disabled={saving} hitSlop={12} style={s.headerBtn}>
          <Text style={[s.doneText, { color: theme.accent }]}>{saving ? '…' : 'Done'}</Text>
        </Pressable>
      </View>

      <Text style={[s.hint, { color: theme.subtext }]}>
        Hold ☰ and drag to change the order routines appear on your dashboard.
      </Text>

      <DraggableFlatList
        data={names}
        keyExtractor={n => n}
        onDragEnd={({ data }) => setNames(data)}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      />
    </View>
  )
}

const s = StyleSheet.create({
  page: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1,
  },
  headerBtn: { minWidth: 54 },
  back: { fontSize: 24, fontWeight: '700' },
  title: { fontSize: 17, fontWeight: '800' },
  doneText: { fontSize: 16, fontWeight: '700', textAlign: 'right' },
  hint: { fontSize: 13, lineHeight: 18, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 14, borderWidth: 1, marginTop: 10,
    shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, elevation: 2,
  },
  grip: { fontSize: 18, fontWeight: '700' },
  iconWrap: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1, fontSize: 16, fontWeight: '700' },
})
