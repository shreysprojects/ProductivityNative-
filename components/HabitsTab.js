import { useState, useEffect } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet, Modal, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native'
import { saveHabits } from '../lib/habitsStorage'

const HABITS_COLOR = '#f43f5e'
const BUILD_COLOR  = '#10b981'

function SobrietyTimer({ startDate, theme }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const totalSecs = Math.max(0, Math.floor((now - new Date(startDate).getTime()) / 1000))
  const secs = totalSecs % 60
  const totalMins = Math.floor(totalSecs / 60)
  const mins = totalMins % 60
  const totalHrs = Math.floor(totalMins / 60)
  const hrs = totalHrs % 24
  const totalDays = Math.floor(totalHrs / 24)
  const months = Math.floor(totalDays / 30)
  const days = totalDays % 30
  const units = []
  if (months > 0) units.push({ v: months, l: 'mo' })
  units.push({ v: days, l: 'days' }, { v: hrs, l: 'hrs' }, { v: mins, l: 'min' }, { v: secs, l: 'sec' })
  return (
    <View style={hb.timerRow}>
      {units.map(({ v, l }) => (
        <View key={l} style={[hb.timerUnit, { backgroundColor: HABITS_COLOR + '14' }]}>
          <Text style={[hb.timerVal, { color: HABITS_COLOR, fontVariant: ['tabular-nums'] }]}>
            {String(v).padStart(2, '0')}
          </Text>
          <Text style={[hb.timerLabel, { color: theme.muted }]}>{l}</Text>
        </View>
      ))}
    </View>
  )
}

function BreakingHabitCard({ habit, theme, onRelapse, onDeleteHistory, onDelete }) {
  const startFmt = new Date(habit.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const relapseCount = habit.history.filter(h => h.type === 'relapse').length
  return (
    <View style={[hb.bCard, { backgroundColor: theme.isDark ? theme.bg : '#fff9fa', borderColor: HABITS_COLOR + '44', shadowColor: theme.isDark ? 'transparent' : '#0d1b5e' }]}>
      <View style={[hb.bStripe, { backgroundColor: HABITS_COLOR }]} />
      <View style={hb.bBody}>
        <View style={hb.bHeader}>
          <View style={[hb.bIconCircle, { backgroundColor: HABITS_COLOR + '18' }]}>
            <Text style={{ fontSize: 22 }}>🚫</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[hb.bName, { color: theme.text }]}>{habit.name}</Text>
            <Text style={[hb.bSince, { color: theme.subtext }]}>
              Clean since {startFmt}{relapseCount > 0 ? `  ·  ${relapseCount} relapse${relapseCount > 1 ? 's' : ''}` : ''}
            </Text>
          </View>
          <Pressable onPress={onDelete} hitSlop={12} style={{ padding: 4 }}>
            <Text style={{ fontSize: 13 }}>🗑</Text>
          </Pressable>
        </View>
        <SobrietyTimer startDate={habit.startDate} theme={theme} />
        <View style={hb.bActions}>
          <Pressable style={[hb.relapseBtn, { borderColor: HABITS_COLOR + '44' }]} onPress={onRelapse}>
            <Text style={[hb.relapseBtnText, { color: HABITS_COLOR }]}>↩ Relapsed</Text>
          </Pressable>
          {habit.history.length > 1 && (
            <Pressable style={[hb.clearHistoryBtn, { borderColor: theme.cardBorder }]} onPress={onDeleteHistory}>
              <Text style={[hb.clearHistoryText, { color: theme.muted }]}>Clear history</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  )
}

function AddBreakingHabitModal({ visible, theme, onClose, onAdd }) {
  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  function reset() { setName(''); setReason('') }
  function close() { reset(); onClose() }
  function save() {
    if (!name.trim()) return
    const now = new Date().toISOString()
    onAdd({ id: Date.now().toString(), name: name.trim(), reason: reason.trim(), startDate: now, history: [{ date: now, type: 'start' }] })
    reset()
  }
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={hb.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={hb.overlayBg} onPress={close} />
        <View style={[hb.modal, { backgroundColor: theme.card }]}>
          <View style={[hb.handle, { backgroundColor: theme.divider }]} />
          <Text style={[hb.modalTitle, { color: theme.text }]}>Track a Habit to Break</Text>
          <Text style={[hb.modalLabel, { color: theme.subtext }]}>HABIT NAME</Text>
          <TextInput
            style={[hb.modalInput, { color: theme.text, borderColor: HABITS_COLOR + '88', backgroundColor: theme.bg }]}
            placeholder="e.g. Smoking, Phone before bed, Nail biting..."
            placeholderTextColor={theme.muted}
            value={name} onChangeText={setName} autoFocus
          />
          <Text style={[hb.modalLabel, { color: theme.subtext }]}>WHY DO YOU WANT TO BREAK THIS? (optional)</Text>
          <TextInput
            style={[hb.modalInput, hb.modalTextArea, { color: theme.text, borderColor: theme.cardBorder, backgroundColor: theme.bg }]}
            placeholder="Your reason will appear when you're about to relapse..."
            placeholderTextColor={theme.muted}
            value={reason} onChangeText={setReason}
            multiline numberOfLines={3} textAlignVertical="top"
          />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            <Pressable style={[hb.modalCancel, { borderColor: theme.cardBorder }]} onPress={close}>
              <Text style={{ color: theme.subtext, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
            <Pressable style={[hb.modalSave, { backgroundColor: HABITS_COLOR, flex: 1 }]} onPress={save}>
              <Text style={hb.modalSaveText}>Start Tracking</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function RelapseConfirmModal({ visible, habit, theme, onConfirm, onCancel }) {
  if (!habit) return null
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[hb.overlay, { justifyContent: 'center', padding: 28 }]}>
        <Pressable style={hb.overlayBg} onPress={onCancel} />
        <View style={[hb.confirmCard, { backgroundColor: theme.card, borderColor: HABITS_COLOR + '44' }]}>
          <Text style={{ fontSize: 36, textAlign: 'center', marginBottom: 10 }}>😔</Text>
          <Text style={[hb.confirmTitle, { color: theme.text }]}>Relapsed on {habit.name}?</Text>
          <Text style={[hb.confirmSub, { color: theme.subtext }]}>Your timer will reset. This will be saved in your history.</Text>
          {!!habit.reason && (
            <View style={[hb.reasonBox, { backgroundColor: HABITS_COLOR + '10', borderColor: HABITS_COLOR + '30' }]}>
              <Text style={[hb.reasonLabel, { color: HABITS_COLOR }]}>Your reason for stopping:</Text>
              <Text style={[hb.reasonText, { color: theme.text }]}>{habit.reason}</Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <Pressable style={[hb.confirmCancel, { borderColor: theme.cardBorder, flex: 1 }]} onPress={onCancel}>
              <Text style={{ color: theme.text, fontWeight: '700', textAlign: 'center' }}>Actually No</Text>
            </Pressable>
            <Pressable style={[hb.confirmRelapseBtn, { flex: 1 }]} onPress={onConfirm}>
              <Text style={{ color: '#fff', fontWeight: '700', textAlign: 'center' }}>Yes, Reset</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

export default function HabitsTab({ userId, theme, habits, onHabitsChange }) {
  const [addBreakingOpen, setAddBreakingOpen] = useState(false)
  const [relapseTarget, setRelapseTarget] = useState(null)
  const [addingBuilding, setAddingBuilding] = useState(false)
  const [newBuildingName, setNewBuildingName] = useState('')
  const [editingTips, setEditingTips] = useState(false)
  const [tipsText, setTipsText] = useState(habits.tips || '')
  useEffect(() => { setTipsText(habits.tips || '') }, [habits.tips])

  async function update(next) { onHabitsChange(next); await saveHabits(userId, next) }

  async function handleAddBreaking(habit) {
    await update({ ...habits, breaking: [...habits.breaking, habit] })
    setAddBreakingOpen(false)
  }

  async function confirmRelapse() {
    if (!relapseTarget) return
    const now = new Date().toISOString()
    await update({
      ...habits,
      breaking: habits.breaking.map(h =>
        h.id !== relapseTarget.id ? h : {
          ...h, startDate: now,
          history: [...h.history, { date: now, type: 'relapse' }, { date: now, type: 'start' }],
        }
      ),
    })
    setRelapseTarget(null)
  }

  async function handleDeleteHistory(habitId) {
    Alert.alert('Clear History?', 'This erases past relapse history but keeps your current streak.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => {
        await update({
          ...habits,
          breaking: habits.breaking.map(h =>
            h.id !== habitId ? h : { ...h, history: [{ date: h.startDate, type: 'start' }] }
          ),
        })
      }},
    ])
  }

  async function handleDeleteBreaking(habitId) {
    Alert.alert('Delete Habit?', 'This permanently removes this habit and all its history.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await update({ ...habits, breaking: habits.breaking.filter(h => h.id !== habitId) })
      }},
    ])
  }

  async function handleAddBuilding() {
    if (!newBuildingName.trim()) { setAddingBuilding(false); return }
    await update({
      ...habits,
      building: [...habits.building, { id: Date.now().toString(), name: newBuildingName.trim(), addedDate: new Date().toISOString() }],
    })
    setNewBuildingName(''); setAddingBuilding(false)
  }

  async function handleDeleteBuilding(id) {
    await update({ ...habits, building: habits.building.filter(h => h.id !== id) })
  }

  async function saveTips() {
    await update({ ...habits, tips: tipsText })
    setEditingTips(false)
  }

  return (
    <>
      {/* Breaking habits */}
      <View style={[hb.sectionCard, { backgroundColor: theme.card, borderColor: theme.cardBorder, shadowColor: theme.isDark ? 'transparent' : '#0d1b5e' }]}>
        <View style={hb.sectionHeader}>
          <View style={hb.sectionTitleRow}>
            <Text style={{ fontSize: 24 }}>🚫</Text>
            <View style={{ marginLeft: 12 }}>
              <Text style={[hb.sectionTitle, { color: theme.text }]}>Habits to Break</Text>
              <Text style={[hb.sectionSub, { color: theme.subtext }]}>Sobriety-style tracking</Text>
            </View>
          </View>
          <Pressable style={[hb.sectionAddBtn, { backgroundColor: HABITS_COLOR }]} onPress={() => setAddBreakingOpen(true)}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 18, lineHeight: 20 }}>＋</Text>
          </Pressable>
        </View>
        {habits.breaking.length === 0 ? (
          <Text style={[hb.emptyText, { color: theme.subtext }]}>Add habits you're working to quit — smoking, doom-scrolling, etc.</Text>
        ) : habits.breaking.map(habit => (
          <BreakingHabitCard key={habit.id} habit={habit} theme={theme}
            onRelapse={() => setRelapseTarget(habit)}
            onDeleteHistory={() => handleDeleteHistory(habit.id)}
            onDelete={() => handleDeleteBreaking(habit.id)}
          />
        ))}
      </View>

      {/* Building habits */}
      <View style={[hb.sectionCard, { backgroundColor: theme.card, borderColor: theme.cardBorder, shadowColor: theme.isDark ? 'transparent' : '#0d1b5e' }]}>
        <View style={hb.sectionHeader}>
          <View style={hb.sectionTitleRow}>
            <Text style={{ fontSize: 24 }}>🌱</Text>
            <View style={{ marginLeft: 12 }}>
              <Text style={[hb.sectionTitle, { color: theme.text }]}>My Habits</Text>
              <Text style={[hb.sectionSub, { color: theme.subtext }]}>Habits you're building</Text>
            </View>
          </View>
          <Pressable style={[hb.sectionAddBtn, { backgroundColor: BUILD_COLOR }]} onPress={() => setAddingBuilding(true)}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 18, lineHeight: 20 }}>＋</Text>
          </Pressable>
        </View>
        {habits.building.length === 0 && !addingBuilding && (
          <Text style={[hb.emptyText, { color: theme.subtext }]}>Add habits to develop — daily exercise, reading, journaling, etc.</Text>
        )}
        {habits.building.map(h => (
          <View key={h.id} style={[hb.buildRow, { borderBottomColor: theme.divider }]}>
            <View style={[hb.buildDot, { backgroundColor: BUILD_COLOR }]} />
            <Text style={[hb.buildName, { color: theme.text }]}>{h.name}</Text>
            <Pressable onPress={() => handleDeleteBuilding(h.id)} hitSlop={12}>
              <Text style={{ color: theme.muted, fontSize: 14 }}>✕</Text>
            </Pressable>
          </View>
        ))}
        {addingBuilding && (
          <View style={hb.buildAddRow}>
            <TextInput
              style={[hb.buildInput, { color: theme.text, borderColor: BUILD_COLOR + '88', backgroundColor: theme.bg }]}
              placeholder="New habit to develop..."
              placeholderTextColor={theme.muted}
              value={newBuildingName} onChangeText={setNewBuildingName}
              autoFocus returnKeyType="done" onSubmitEditing={handleAddBuilding}
            />
            <Pressable style={[hb.buildConfirm, { backgroundColor: BUILD_COLOR }]} onPress={handleAddBuilding}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Add</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Tips for myself */}
      <View style={[hb.sectionCard, { backgroundColor: theme.card, borderColor: theme.cardBorder, shadowColor: theme.isDark ? 'transparent' : '#0d1b5e' }]}>
        <View style={[hb.sectionHeader, { marginBottom: (editingTips || habits.tips) ? 12 : 0 }]}>
          <View style={hb.sectionTitleRow}>
            <Text style={{ fontSize: 24 }}>💡</Text>
            <View style={{ marginLeft: 12 }}>
              <Text style={[hb.sectionTitle, { color: theme.text }]}>Tips for Myself</Text>
              <Text style={[hb.sectionSub, { color: theme.subtext }]}>Notes to stay on track</Text>
            </View>
          </View>
          <Pressable style={[hb.editTipsBtn, { borderColor: theme.cardBorder }]} onPress={() => editingTips ? saveTips() : setEditingTips(true)}>
            <Text style={{ color: theme.accent, fontWeight: '700', fontSize: 13 }}>{editingTips ? 'Save' : 'Edit'}</Text>
          </Pressable>
        </View>
        {editingTips ? (
          <TextInput
            style={[hb.tipsInput, { color: theme.text, borderColor: theme.accent + '55', backgroundColor: theme.bg }]}
            placeholder="Write reminders, strategies, or mantras for yourself..."
            placeholderTextColor={theme.muted}
            value={tipsText} onChangeText={setTipsText}
            multiline numberOfLines={6} autoFocus textAlignVertical="top"
          />
        ) : habits.tips ? (
          <Text style={[hb.tipsDisplay, { color: theme.text }]}>{habits.tips}</Text>
        ) : (
          <Text style={[hb.emptyText, { color: theme.subtext }]}>Tap Edit to write reminders, strategies, or mantras to help you stay consistent.</Text>
        )}
      </View>

      <AddBreakingHabitModal visible={addBreakingOpen} theme={theme} onClose={() => setAddBreakingOpen(false)} onAdd={handleAddBreaking} />
      <RelapseConfirmModal visible={!!relapseTarget} habit={relapseTarget} theme={theme} onConfirm={confirmRelapse} onCancel={() => setRelapseTarget(null)} />
    </>
  )
}

const hb = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  overlayBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },

  sectionCard: {
    borderRadius: 22, borderWidth: 2,
    paddingHorizontal: 18, paddingVertical: 16, marginBottom: 14,
    shadowOffset: { width: 4, height: 5 },
    shadowOpacity: 0.18, shadowRadius: 0, elevation: 6,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center' },
  sectionTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  sectionSub: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  sectionAddBtn: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14, fontStyle: 'italic', textAlign: 'center', paddingVertical: 8, paddingBottom: 4 },

  bCard: {
    flexDirection: 'row', borderRadius: 18, marginBottom: 12,
    borderWidth: 1.5, overflow: 'hidden',
    shadowOffset: { width: 2, height: 3 }, shadowOpacity: 0.1, shadowRadius: 0, elevation: 3,
  },
  bStripe: { width: 5 },
  bBody: { flex: 1, padding: 14 },
  bHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  bIconCircle: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  bName: { fontSize: 16, fontWeight: '700' },
  bSince: { fontSize: 11, marginTop: 2, fontWeight: '500' },

  timerRow: { flexDirection: 'row', gap: 6, marginBottom: 12, flexWrap: 'wrap' },
  timerUnit: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, alignItems: 'center', minWidth: 50 },
  timerVal: { fontSize: 18, fontWeight: '800' },
  timerLabel: { fontSize: 10, fontWeight: '600', marginTop: 1 },

  bActions: { flexDirection: 'row', gap: 8 },
  relapseBtn: { flex: 1, paddingVertical: 9, borderRadius: 12, alignItems: 'center', borderWidth: 1.5 },
  relapseBtnText: { fontSize: 13, fontWeight: '700' },
  clearHistoryBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, borderWidth: 1.5 },
  clearHistoryText: { fontSize: 12, fontWeight: '600' },

  buildRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  buildDot: { width: 8, height: 8, borderRadius: 4 },
  buildName: { flex: 1, fontSize: 15, fontWeight: '500' },
  buildAddRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8 },
  buildInput: { flex: 1, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  buildConfirm: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12 },

  editTipsBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5 },
  tipsInput: { borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, lineHeight: 22, minHeight: 120 },
  tipsDisplay: { fontSize: 15, lineHeight: 22 },

  modal: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 10, paddingHorizontal: 24, paddingBottom: 48, maxHeight: '82%',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 20,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3, marginBottom: 20, marginTop: 8 },
  modalLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.9, marginBottom: 8 },
  modalInput: { borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginBottom: 20 },
  modalTextArea: { minHeight: 80, textAlignVertical: 'top' },
  modalCancel: { paddingHorizontal: 16, paddingVertical: 13, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  modalSave: { borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  modalSaveText: { color: '#fff', fontWeight: '800', fontSize: 16 },

  confirmCard: {
    borderRadius: 24, borderWidth: 2, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 20, elevation: 20,
  },
  confirmTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  confirmSub: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 12 },
  reasonBox: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 4 },
  reasonLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 6 },
  reasonText: { fontSize: 14, lineHeight: 20, fontStyle: 'italic' },
  confirmCancel: { paddingVertical: 13, borderRadius: 14, borderWidth: 1.5 },
  confirmRelapseBtn: { paddingVertical: 13, borderRadius: 14, backgroundColor: '#f43f5e' },
})
