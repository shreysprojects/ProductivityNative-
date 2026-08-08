import { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, Pressable, ScrollView, Modal, TextInput,
  StyleSheet, KeyboardAvoidingView, Platform, Switch,
} from 'react-native'
import { useTheme } from '../lib/ThemeContext'
import {
  slotStarts, minsToLabel, nowMins,
  getTimeLogsForDay, saveTimeLog, deleteTimeLog,
} from '../lib/timeLogging'

// One row per time slot for a single day. Tapping a slot opens a sheet to
// write what you were doing. Slots that haven't happened yet can't be logged.
export default function DayLogTimeline({
  userId, day, todayStr, settings, onCountsChange, headerRight,
}) {
  const { theme } = useTheme()

  const [entries, setEntries] = useState({})   // slotStart -> { text, kind }
  const [editing, setEditing] = useState(null) // slotStart | null
  const [draft, setDraft]     = useState('')
  const [isBreak, setIsBreak] = useState(false)
  const [, setTick]           = useState(0)

  const scrollRef = useRef(null)
  const didAutoScroll = useRef(false)

  const isToday     = day === todayStr
  const dayIsFuture = day > todayStr // 'YYYY-MM-DD' sorts lexicographically
  const slots       = slotStarts(settings)
  const now         = nowMins()

  const load = useCallback(() => {
    getTimeLogsForDay(userId, day).then(setEntries).catch(() => {})
  }, [userId, day])

  useEffect(() => { load() }, [load])
  useEffect(() => { didAutoScroll.current = false }, [day])

  // Keep "now" fresh so the current slot unlocks as the day moves on.
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000)
    return () => clearInterval(id)
  }, [])

  const filled = slots.filter(s => entries[s]).length
  useEffect(() => { onCountsChange?.(filled, slots.length) }, [filled, slots.length])

  const isLocked  = s => dayIsFuture || (isToday && s > now)
  const isCurrent = s => isToday && now >= s && now < s + settings.interval

  function open(slot) {
    if (isLocked(slot)) return
    const e = entries[slot]
    setDraft(e?.text ?? '')
    setIsBreak(e?.kind === 'break')
    setEditing(slot)
  }

  async function save() {
    const slot = editing
    const text = draft.trim()
    setEditing(null)
    // An empty, non-break entry means "nothing here" — clear it instead.
    const next = (!text && !isBreak)
      ? await deleteTimeLog(userId, day, slot)
      : await saveTimeLog(userId, day, slot, text, isBreak ? 'break' : 'log')
    setEntries({ ...next })
  }

  async function clear() {
    const slot = editing
    setEditing(null)
    setEntries({ ...(await deleteTimeLog(userId, day, slot)) })
  }

  function onRowLayout(slot, e) {
    if (didAutoScroll.current || !isToday || !isCurrent(slot)) return
    didAutoScroll.current = true
    const y = e.nativeEvent.layout.y
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 120), animated: false })
  }

  if (slots.length === 0) {
    return (
      <View style={st.emptyWrap}>
        <Text style={[st.emptyText, { color: theme.subtext }]}>
          No time slots to log — check your day start and end times in Settings.
        </Text>
      </View>
    )
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[st.summaryBar, { backgroundColor: theme.card, borderBottomColor: theme.divider }]}>
        <Text style={[st.summaryText, { color: theme.subtext }]}>
          <Text style={{ color: theme.accent, fontWeight: '800' }}>{filled}</Text>
          {` / ${slots.length} slots logged`}
        </Text>
        {headerRight}
      </View>

      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 28 }}>
        {slots.map((s, i) => {
          const e = entries[s]
          const current = isCurrent(s)
          const past    = isToday && !current && s + settings.interval <= now
          const locked  = isLocked(s)
          const striped = i % 2 === 0

          return (
            <Pressable
              key={s}
              onLayout={ev => onRowLayout(s, ev)}
              onPress={() => open(s)}
              disabled={locked}
              style={[st.row, {
                backgroundColor: striped ? (theme.isDark ? '#16162b' : '#f7f7fc') : 'transparent',
                borderBottomColor: theme.divider,
                opacity: locked ? 0.4 : 1,
              }]}
            >
              <View style={st.timeCol}>
                <Text style={[st.timeLabel, { color: current ? theme.accent : theme.muted }]}>
                  {minsToLabel(s)}
                </Text>
              </View>

              <View style={[st.cell, current && {
                borderLeftColor: theme.accent, borderLeftWidth: 3,
                backgroundColor: theme.accent + '11',
              }]}>
                {e?.kind === 'break' ? (
                  <View style={[st.breakBlock, { backgroundColor: '#ef4444' }]}>
                    <Text style={st.breakText}>{e.text || 'Break'}</Text>
                  </View>
                ) : e ? (
                  <Text style={[st.entryText, { color: theme.text }]}>{e.text}</Text>
                ) : current ? (
                  <Text style={[st.hintText, { color: theme.accent }]}>
                    What are you doing right now? Tap to log
                  </Text>
                ) : past ? (
                  <Text style={[st.hintText, { color: theme.muted }]}>—</Text>
                ) : null}
              </View>
            </Pressable>
          )
        })}
      </ScrollView>

      <Modal visible={editing !== null} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView style={st.modalWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={{ flex: 1 }} onPress={() => setEditing(null)} />
          <View style={[st.sheet, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <Text style={[st.sheetTitle, { color: theme.text }]}>
              {editing !== null ? `${minsToLabel(editing)} – ${minsToLabel(editing + settings.interval)}` : ''}
            </Text>

            <TextInput
              value={draft}
              onChangeText={setDraft}
              multiline
              autoFocus
              placeholder={'What did you do?\ne.g. Studied for midterm'}
              placeholderTextColor={theme.muted}
              style={[st.input, {
                backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text,
              }]}
            />

            <View style={st.breakRow}>
              <Text style={{ color: theme.text, fontWeight: '600', fontSize: 14 }}>☕  Break</Text>
              <Switch value={isBreak} onValueChange={setIsBreak} trackColor={{ true: '#ef4444' }} />
            </View>

            <View style={st.buttonRow}>
              {entries[editing] ? (
                <Pressable onPress={clear} hitSlop={8} style={st.clearBtn}>
                  <Text style={{ color: '#ef4444', fontWeight: '700', fontSize: 14 }}>Clear</Text>
                </Pressable>
              ) : <View />}
              <Pressable onPress={save} style={[st.saveBtn, { backgroundColor: theme.accent }]}>
                <Text style={st.saveText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

const st = StyleSheet.create({
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 20 },
  summaryBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  summaryText: { fontSize: 12.5, fontWeight: '600' },
  row: { flexDirection: 'row', minHeight: 46, borderBottomWidth: StyleSheet.hairlineWidth },
  timeCol: { width: 76, paddingRight: 10, alignItems: 'flex-end', justifyContent: 'center' },
  timeLabel: { fontSize: 11, fontWeight: '700' },
  cell: { flex: 1, paddingVertical: 8, paddingHorizontal: 10, justifyContent: 'center' },
  entryText: { fontSize: 13, lineHeight: 19, fontWeight: '500' },
  hintText: { fontSize: 12, fontWeight: '600' },
  breakBlock: { borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, alignSelf: 'flex-start' },
  breakText: { color: '#fff', fontWeight: '700', fontSize: 12.5 },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1,
    padding: 20, paddingBottom: 32, gap: 14,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  input: {
    minHeight: 100, maxHeight: 180, borderWidth: 1, borderRadius: 14,
    padding: 12, fontSize: 15, textAlignVertical: 'top',
  },
  breakRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  buttonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  clearBtn: { paddingVertical: 10, paddingHorizontal: 6 },
  saveBtn: { paddingVertical: 13, paddingHorizontal: 32, borderRadius: 14, marginLeft: 'auto' },
  saveText: { color: '#fff', fontWeight: '800', fontSize: 15 },
})
