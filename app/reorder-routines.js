import { useState, useCallback } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist'
import { router, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '../lib/AuthContext'
import { useTheme } from '../lib/ThemeContext'
import { getRoutineNames, saveRoutineOrder, getRoutineGroupMap, saveRoutineGroupMap } from '../lib/storage'
import { routineTheme } from '../lib/themes'

// One draggable list with the two section headers as fixed rows: drag a
// routine under the WHENEVER header to make it a no-pressure routine, or
// back up under EVERY DAY to make it a daily priority.

const H_EVERYDAY = '__everyday__'
const H_WHENEVER = '__whenever__'
const isHeader = item => item === H_EVERYDAY || item === H_WHENEVER

// Same section identities as the dashboard headers
const EVERYDAY_COLOR = '#f59e0b'
const WHENEVER_COLOR = '#06b6d4'

export default function ReorderRoutines() {
  const { user } = useAuth()
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const [data, setData] = useState([])
  const [saving, setSaving] = useState(false)

  useFocusEffect(useCallback(() => {
    if (!user) return
    Promise.all([getRoutineNames(user.id), getRoutineGroupMap(user.id)]).then(([names, gMap]) => {
      const everyday = names.filter(n => (gMap[n] ?? 'everyday') === 'everyday')
      const whenever = names.filter(n => gMap[n] === 'whenever')
      setData([H_EVERYDAY, ...everyday, H_WHENEVER, ...whenever])
    })
  }, [user]))

  // Split the flat list back into the two groups (headers pinned in place).
  function splitGroups(list) {
    const items = list.filter(i => i !== H_EVERYDAY)
    const wIdx = items.indexOf(H_WHENEVER)
    return { everyday: items.slice(0, wIdx), whenever: items.slice(wIdx + 1) }
  }

  function moveItem(name) {
    const { everyday, whenever } = splitGroups(data)
    const next = everyday.includes(name)
      ? { everyday: everyday.filter(n => n !== name), whenever: [...whenever, name] }
      : { everyday: [...everyday, name], whenever: whenever.filter(n => n !== name) }
    setData([H_EVERYDAY, ...next.everyday, H_WHENEVER, ...next.whenever])
  }

  async function done() {
    if (!user) return router.back()
    setSaving(true)
    try {
      const { everyday, whenever } = splitGroups(data)
      const groupMap = {}
      everyday.forEach(n => { groupMap[n] = 'everyday' })
      whenever.forEach(n => { groupMap[n] = 'whenever' })
      await Promise.all([
        saveRoutineOrder(user.id, [...everyday, ...whenever]),
        saveRoutineGroupMap(user.id, groupMap),
      ])
    } finally {
      setSaving(false)
    }
    router.back()
  }

  function renderItem({ item, drag, isActive }) {
    if (isHeader(item)) {
      const everyday = item === H_EVERYDAY
      const color = everyday ? EVERYDAY_COLOR : WHENEVER_COLOR
      return (
        <View style={[s.sectionRow, item === H_WHENEVER && { marginTop: 18 }]}>
          <View style={[s.sectionChip, { backgroundColor: color + '1c' }]}>
            <Text style={s.sectionEmoji}>{everyday ? '⭐' : '🌊'}</Text>
            <Text style={[s.sectionText, { color }]}>
              {everyday ? 'EVERY DAY' : 'WHENEVER'}
            </Text>
          </View>
          <Text style={[s.sectionHint, { color: theme.muted }]}>
            {everyday ? 'aim to do these daily' : 'for when you feel like it'}
          </Text>
          <View style={[s.sectionRule, { backgroundColor: color + '2a' }]} />
        </View>
      )
    }
    const rt = routineTheme(item)
    const inEveryday = splitGroups(data).everyday.includes(item)
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
          <Pressable
            onPress={() => moveItem(item)}
            hitSlop={8}
            style={[s.moveBtn, { borderColor: theme.cardBorder }]}
          >
            <Text style={[s.moveBtnText, { color: theme.subtext }]}>
              {inEveryday ? '🌊 ↓' : '⭐ ↑'}
            </Text>
          </Pressable>
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
        <Text style={[s.title, { color: theme.text }]}>Organize Routines</Text>
        <Pressable onPress={done} disabled={saving} hitSlop={12} style={s.headerBtn}>
          <Text style={[s.doneText, { color: theme.accent }]}>{saving ? '…' : 'Done'}</Text>
        </Pressable>
      </View>

      <Text style={[s.hint, { color: theme.subtext }]}>
        Hold ☰ and drag to reorder — drop a routine under a section to move it there, or tap the button on the right.
      </Text>

      <DraggableFlatList
        data={data}
        keyExtractor={n => n}
        onDragEnd={({ data: next }) => {
          const { everyday, whenever } = splitGroups(next)
          setData([H_EVERYDAY, ...everyday, H_WHENEVER, ...whenever])
        }}
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

  sectionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 2, paddingTop: 8,
  },
  sectionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 9, paddingHorizontal: 9, paddingVertical: 4,
  },
  sectionEmoji: { fontSize: 12 },
  sectionText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.7 },
  sectionHint: { fontSize: 11, fontWeight: '500' },
  sectionRule: { flex: 1, height: 2, borderRadius: 1, minWidth: 8 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 14, borderWidth: 1, marginTop: 10,
    shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, elevation: 2,
  },
  grip: { fontSize: 18, fontWeight: '700' },
  iconWrap: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1, fontSize: 16, fontWeight: '700' },
  moveBtn: {
    borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  moveBtnText: { fontSize: 13, fontWeight: '700' },
})
