import { useEffect, useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native'
import { getRoutine, saveRoutine } from '../lib/storage'

export default function RoutineView({ userId, name, onSave }) {
  const [steps, setSteps] = useState([])
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setSteps([])
    getRoutine(userId, name).then(setSteps)
  }, [userId, name])

  async function toggle(id) {
    const updated = steps.map(s => s.id === id ? { ...s, done: !s.done } : s)
    setSteps(updated)
    await saveRoutine(userId, name, updated)
  }

  async function add() {
    if (!text.trim()) return
    const updated = [...steps, { id: Date.now(), text: text.trim(), done: false }]
    setSteps(updated)
    setText('')
    await saveRoutine(userId, name, updated)
  }

  async function remove(id) {
    const updated = steps.filter(s => s.id !== id)
    setSteps(updated)
    await saveRoutine(userId, name, updated)
  }

  async function handleSave() {
    if (steps.length === 0) return Alert.alert('No steps to save')
    setSaving(true)
    try { await onSave(steps) } finally { setSaving(false) }
  }

  const done = steps.filter(s => s.done).length
  const pct = steps.length > 0 ? Math.round((done / steps.length) * 100) : 0

  return (
    <View style={s.card}>
      <View style={s.header}>
        <Text style={s.title}>{name} Routine</Text>
        <Text style={s.pct}>{done}/{steps.length}</Text>
      </View>

      <View style={s.progressBar}>
        <View style={[s.progressFill, { width: `${pct}%` }]} />
      </View>

      {steps.map(step => (
        <Pressable key={step.id} style={s.item} onPress={() => toggle(step.id)}>
          <View style={[s.check, step.done && s.checkDone]}>
            {step.done && <Text style={s.checkmark}>✓</Text>}
          </View>
          <Text style={[s.stepText, step.done && s.stepDone]}>{step.text}</Text>
          <Pressable onPress={() => remove(step.id)} hitSlop={8}>
            <Text style={s.remove}>✕</Text>
          </Pressable>
        </Pressable>
      ))}

      <View style={s.addRow}>
        <TextInput
          style={s.addInput}
          placeholder="Add a step…"
          placeholderTextColor="#bbb"
          value={text}
          onChangeText={setText}
          onSubmitEditing={add}
          returnKeyType="done"
        />
        <Pressable style={s.addBtn} onPress={add}>
          <Text style={s.addBtnText}>+</Text>
        </Pressable>
      </View>

      <Pressable style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
        <Text style={s.saveBtnText}>{saving ? 'Saving…' : 'Save today\'s progress'}</Text>
      </Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#f0f0f3',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 17, fontWeight: '700', color: '#111' },
  pct: { fontSize: 14, color: '#888', fontWeight: '600' },
  progressBar: { height: 6, backgroundColor: '#f0f0f3', borderRadius: 3, marginBottom: 14, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: '#4f46e5', borderRadius: 3 },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#f6f7fb' },
  check: {
    width: 28, height: 28, borderRadius: 8, borderWidth: 1.5,
    borderColor: '#d1d5db', marginRight: 12, alignItems: 'center', justifyContent: 'center',
  },
  checkDone: { backgroundColor: '#4f46e5', borderColor: '#4f46e5' },
  checkmark: { color: '#fff', fontWeight: '700', fontSize: 14 },
  stepText: { flex: 1, fontSize: 15, color: '#222' },
  stepDone: { color: '#aaa', textDecorationLine: 'line-through' },
  remove: { color: '#ddd', fontSize: 16, paddingHorizontal: 4 },
  addRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  addInput: {
    flex: 1, backgroundColor: '#f6f7fb', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#111',
  },
  addBtn: {
    backgroundColor: '#4f46e5', borderRadius: 10,
    width: 42, alignItems: 'center', justifyContent: 'center',
  },
  addBtnText: { color: '#fff', fontSize: 22, fontWeight: '400', lineHeight: 26 },
  saveBtn: {
    backgroundColor: '#10b981', borderRadius: 10,
    padding: 14, alignItems: 'center', marginTop: 14,
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
})
