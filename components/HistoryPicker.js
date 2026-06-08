import { useState, useEffect } from 'react'
import {
  Modal, View, Text, Pressable, ScrollView,
  StyleSheet, ActivityIndicator, SafeAreaView,
} from 'react-native'

function fmt(v) {
  if (!v) return '0'
  return v % 1 === 0 ? String(Math.round(v)) : v.toFixed(1)
}

function daysAgo(dateStr) {
  const diff = Math.round((Date.now() - new Date(dateStr).getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return `${diff} days ago`
}

export default function HistoryPicker({ section, sectionLabel, sectionColor, loadHistory, onAdd, onClose }) {
  const [meals, setMeals] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadHistory().then(m => { setMeals(m); setLoading(false) })
  }, [])

  const handleAdd = (meal) => {
    onAdd({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      name: meal.name,
      contents: meal.contents,
      section,
      macros: meal.macros || {},
    })
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f6f7fb' }}>
        <View style={h.header}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={h.cancel}>Cancel</Text>
          </Pressable>
          <Text style={h.title}>From History</Text>
          <View style={{ width: 56 }} />
        </View>

        {loading ? (
          <View style={h.centered}>
            <ActivityIndicator size="large" color={sectionColor} />
          </View>
        ) : meals.length === 0 ? (
          <View style={h.centered}>
            <Text style={h.emptyEmoji}>🕐</Text>
            <Text style={h.emptyTitle}>No history yet</Text>
            <Text style={h.emptyDesc}>Meals you log will appear here so you can quickly re-add them.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={h.list}>
            <Text style={h.subheader}>RECENTLY LOGGED</Text>
            {meals.map(meal => {
              const cal = meal.macros?.calories || 0
              const prot = meal.macros?.protein || 0
              const carbs = meal.macros?.carbs || 0
              const fat = meal.macros?.fat || 0
              return (
                <View key={meal.id} style={h.card}>
                  <View style={h.cardLeft}>
                    <Text style={h.mealName}>{meal.name}</Text>
                    {!!meal.contents && (
                      <Text style={h.mealContents} numberOfLines={1}>{meal.contents}</Text>
                    )}
                    <View style={h.mealMacros}>
                      {cal > 0 && <Text style={h.macroChip}>{Math.round(cal)} kcal</Text>}
                      {prot > 0 && <Text style={h.macroChip}>{fmt(prot)}g P</Text>}
                      {carbs > 0 && <Text style={h.macroChip}>{fmt(carbs)}g C</Text>}
                      {fat > 0 && <Text style={h.macroChip}>{fmt(fat)}g F</Text>}
                    </View>
                    <Text style={h.mealDate}>{daysAgo(meal.lastEaten || '')}</Text>
                  </View>
                  <Pressable
                    style={[h.addBtn, { backgroundColor: sectionColor }]}
                    onPress={() => handleAdd(meal)}
                  >
                    <Text style={h.addBtnText}>Add</Text>
                  </Pressable>
                </View>
              )
            })}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  )
}

const h = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 14,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f0f0f3',
  },
  cancel: { fontSize: 16, color: '#6366f1', minWidth: 56 },
  title: { fontSize: 17, fontWeight: '700', color: '#111' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: '#111', marginBottom: 8 },
  emptyDesc: { fontSize: 15, color: '#888', textAlign: 'center', lineHeight: 22 },
  list: { padding: 16, paddingBottom: 40 },
  subheader: { fontSize: 11, fontWeight: '800', color: '#bbb', letterSpacing: 1.2, marginBottom: 12 },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  cardLeft: { flex: 1 },
  mealName: { fontSize: 15, fontWeight: '700', color: '#111', marginBottom: 3 },
  mealContents: { fontSize: 13, color: '#aaa', marginBottom: 6 },
  mealMacros: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 5 },
  macroChip: {
    fontSize: 11, fontWeight: '700', color: '#555',
    backgroundColor: '#f0f0f3', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3,
  },
  mealDate: { fontSize: 11, color: '#ccc', fontWeight: '500' },
  addBtn: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, minWidth: 56, alignItems: 'center' },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
})
