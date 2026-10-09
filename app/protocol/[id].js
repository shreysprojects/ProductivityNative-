import { useState, useCallback } from 'react'
import {
  View, Text, Pressable, ScrollView, Modal, TextInput, Switch,
  StyleSheet, KeyboardAvoidingView, Platform, Alert,
} from 'react-native'
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist'
import { useAuth } from '../../lib/AuthContext'
import { useTheme } from '../../lib/ThemeContext'
import { today } from '../../lib/storage'
import { runWithAdjustedStart } from '../../lib/runSteps'
import RunRoutine from '../../components/RunRoutine'
import ProtocolAIModal from '../../components/ProtocolAIModal'
import {
  getProtocols, saveProtocol, deleteProtocol,
  saveProtocolJournal, genProtocolId,
} from '../../lib/protocolStorage'

// A protocol is an emergency routine for a hard moment — feeling unmotivated,
// close to a relapse. It runs exactly like a routine: one step at a time with
// a timer (and optional per-step time goals), resumable if the app closes
// mid-run. Finishing offers a protocol journal (shown on the calendar), and an
// optional counter tracks time since the last reset.

const PROTOCOL_COLOR = '#ec4899'
const EMOJIS = ['🛟', '🚨', '🧘', '💪', '🧠', '❤️']

const blankProtocol = () => ({
  id: genProtocolId(),
  name: '', emoji: '🛟',
  steps: [{ id: genProtocolId(), text: '', timeGoalMins: null }],
  tracker: null,
  // Optional letter-to-self: { title, text }. Shown every time the protocol
  // is finished, and readable from the preview.
  note: null,
  createdAt: Date.now(),
})

const fmtMs = ms => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function ProtocolScreen() {
  const { id } = useLocalSearchParams()
  const { user } = useAuth()
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const isNew = id === 'new'

  const [protocol, setProtocol] = useState(null)
  const [run, setRun]           = useState(null)
  const [loading, setLoading]   = useState(true)

  // Edit sheet (also the create form when the route is /protocol/new)
  const [editOpen, setEditOpen] = useState(isNew)
  const [draft, setDraft]       = useState(isNew ? blankProtocol() : null)

  // AI helper chat (describes struggles → advice → generated protocol)
  const [aiOpen, setAiOpen] = useState(false)

  // Post-completion journal
  const [journalText, setJournalText]   = useState('')
  const [journalSaved, setJournalSaved] = useState(false)

  // Note-to-self collapsed/expanded in the preview
  const [noteOpen, setNoteOpen] = useState(false)

  useFocusEffect(useCallback(() => {
    if (!user) return
    if (isNew) { setLoading(false); return }
    let active = true
    getProtocols(user.id).then(all => {
      if (!active) return
      const p = all.find(x => x.id === id) ?? null
      setProtocol(p)
      // Resume a run that was interrupted mid-way (app closed, phone call).
      setRun(prev => prev ?? p?.activeRun ?? null)
      setLoading(false)
    }).catch(() => setLoading(false))
    return () => { active = false }
  }, [user, id, isNew]))

  // Live clock for the time-since counter — ticks while a tracker is shown.
  // Runs under useFocusEffect rather than useEffect: expo-router keeps this
  // screen mounted when the user navigates away, and a 1-second tick has no
  // business re-rendering a screen nobody is looking at. Refocusing restarts
  // the interval and snaps the clock forward immediately.
  const [nowTs, setNowTs] = useState(Date.now())
  useFocusEffect(useCallback(() => {
    if (!protocol?.tracker) return
    setNowTs(Date.now())
    const t = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(t)
  }, [protocol?.tracker]))

  const elapsed = Math.max(0, nowTs - (protocol?.tracker?.since ?? nowTs))
  const timerParts = [
    [Math.floor(elapsed / 86400000), 'DAYS'],
    [Math.floor((elapsed % 86400000) / 3600000), 'HRS'],
    [Math.floor((elapsed % 3600000) / 60000), 'MIN'],
    [Math.floor((elapsed % 60000) / 1000), 'SEC'],
  ]

  // ── Run lifecycle (mirrors the routine system) ───────────────────────────

  // The in-progress run rides on the protocol object, so it survives app
  // restarts and syncs with the account like everything else.
  async function persistRun(nextRun) {
    setRun(nextRun)
    const saved = await saveProtocol(user.id, {
      ...protocol,
      activeRun: nextRun && !nextRun.finished ? nextRun : null,
    })
    setProtocol(saved)
  }

  function handleStart() {
    const now = Date.now()
    const steps = protocol.steps.map(s => ({
      id: s.id, text: s.text,
      timeGoalSecs: (s.timeGoalMins ?? 0) * 60,
      startedAt: null, completedAt: null, elapsedMs: 0,
      subTasks: [],
    }))
    if (steps.length > 0) steps[0].startedAt = now
    persistRun({ startedAt: now, currentStep: 0, steps, finished: false })
  }

  function handleStepDone(elapsedMs) {
    const now = Date.now()
    persistRun({
      ...run,
      currentStep: run.currentStep + 1,
      steps: run.steps.map((s, i) => {
        if (i === run.currentStep) return { ...s, completedAt: now, elapsedMs }
        if (i === run.currentStep + 1) return { ...s, startedAt: now }
        return s
      }),
    })
  }

  function handleFinish(elapsedMs) {
    const now = Date.now()
    persistRun({
      ...run,
      finished: true,
      completedAt: now,
      steps: run.steps.map((s, i) =>
        i === run.currentStep ? { ...s, completedAt: now, elapsedMs } : s
      ),
    })
  }

  function handleGoBack() {
    const prev = run.currentStep - 1
    if (prev < 0) return
    persistRun({
      ...run,
      currentStep: prev,
      steps: run.steps.map((s, i) =>
        i === prev ? { ...s, completedAt: null, elapsedMs: 0, startedAt: Date.now() } : s
      ),
    })
  }

  function handleAdjustStart(newStartedAt) {
    persistRun(runWithAdjustedStart(run, newStartedAt, Date.now()))
  }

  function handleAbandon() {
    Alert.alert('Stop this run?', 'Your progress through the steps will be discarded.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Stop', style: 'destructive', onPress: () => persistRun(null) },
    ])
  }

  function handleRunAgain() {
    setRun(null)
    setJournalText('')
    setJournalSaved(false)
  }

  // ── Edit / tracker / journal ─────────────────────────────────────────────

  function openEdit() {
    setDraft({
      ...protocol,
      steps: protocol.steps.length
        ? protocol.steps.map(s => ({ ...s }))
        : [{ id: genProtocolId(), text: '', timeGoalMins: null }],
    })
    setEditOpen(true)
  }

  async function handleSaveDraft() {
    const name = draft.name.trim()
    if (!name) { Alert.alert('Missing name', 'Give your protocol a name.'); return }
    const cleanSteps = draft.steps
      .map(s => ({
        ...s,
        text: s.text.trim(),
        timeGoalMins: s.timeGoalMins > 0 ? s.timeGoalMins : null,
      }))
      .filter(s => s.text)
    if (cleanSteps.length === 0) { Alert.alert('No steps', 'Add at least one step.'); return }
    // A note needs text to exist; an untitled one gets a default name.
    const noteText = (draft.note?.text ?? '').trim()
    const note = noteText
      ? { title: (draft.note?.title ?? '').trim() || 'Note to self', text: noteText }
      : null
    // Editing the steps invalidates a half-finished run of the old ones.
    const saved = await saveProtocol(user.id, {
      ...draft, name, steps: cleanSteps, note, activeRun: null,
    })
    setProtocol(saved)
    setRun(null)
    setEditOpen(false)
  }

  // The AI helper's protocol replaces this protocol's content wholesale —
  // name, emoji, steps and note all come from the generated version. The
  // counter (tracker), reset history and past journals stay.
  function handleApplyAI(gen) {
    const apply = async () => {
      const base = protocol ?? blankProtocol()
      const saved = await saveProtocol(user.id, {
        ...base,
        name: gen.name,
        emoji: gen.emoji,
        steps: gen.steps.map(s => ({
          id: genProtocolId(), text: s.text, timeGoalMins: s.timeGoalMins ?? null,
        })),
        note: gen.note ?? null,
        activeRun: null,
      })
      setProtocol(saved)
      setRun(null)
      setAiOpen(false)
      setEditOpen(false)
    }
    if (protocol) {
      Alert.alert(
        'Replace this protocol?',
        `"${protocol.name}" will be replaced with the AI version. Your counter and calendar history stay.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Replace', style: 'destructive', onPress: apply },
        ]
      )
    } else {
      apply()
    }
  }

  function handleDelete() {
    Alert.alert('Delete Protocol?', `"${draft.name || 'This protocol'}" and its counter will be removed. Past protocol journals stay on your calendar.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await deleteProtocol(user.id, draft.id)
          router.back()
        },
      },
    ])
  }

  function handleResetTracker() {
    Alert.alert(
      'Reset the counter?',
      'This restarts the clock from now. Use it when you relapsed or broke the protocol — the past count isn\'t stored anywhere else.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset to zero', style: 'destructive',
          onPress: async () => {
            // The reset is kept as a dated event so it shows on the calendar.
            const at = Date.now()
            const saved = await saveProtocol(user.id, {
              ...protocol,
              tracker: { since: at },
              resets: [
                ...(protocol.resets ?? []),
                { id: genProtocolId(), date: today(), at },
              ],
            })
            setProtocol(saved)
            // Snap the clock to zero this instant — without this, a counter
            // that already read 00:00:00:0x can look like the tap did nothing.
            setNowTs(at)
            Alert.alert('Counter reset', 'Back to zero, starting now. It\'s marked on today\'s calendar.')
          },
        },
      ]
    )
  }

  async function handleSaveJournal() {
    const text = journalText.trim()
    if (!text) return
    await saveProtocolJournal(user.id, {
      id: genProtocolId(),
      date: today(),
      protocolId: protocol.id,
      protocolName: protocol.name,
      text,
      at: Date.now(),
    })
    setJournalSaved(true)
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) return <View style={[ps.page, { backgroundColor: theme.bg }]} />

  if (!protocol && !isNew && !editOpen) {
    return (
      <View style={[ps.page, ps.center, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        <Text style={{ color: theme.subtext, fontWeight: '600' }}>This protocol no longer exists.</Text>
        <Pressable onPress={() => router.back()} style={[ps.primaryBtn, { backgroundColor: PROTOCOL_COLOR, marginTop: 16 }]}>
          <Text style={ps.primaryBtnText}>Go back</Text>
        </Pressable>
      </View>
    )
  }

  const running = run && !run.finished

  // Edit-sheet step row. The sheet scrolls as a DraggableFlatList so steps can
  // be held on their ☰ handle and dragged into a new order.
  function renderStepRow({ item: step, drag, isActive, getIndex }) {
    const i = getIndex() ?? 0
    return (
      <ScaleDecorator activeScale={0.98}>
        <View style={ps.stepEditRow}>
          <Pressable onLongPress={drag} disabled={isActive} delayLongPress={150} hitSlop={8} style={ps.dragHandle}>
            <Text style={[ps.dragHandleText, { color: theme.muted }]}>☰</Text>
          </Pressable>
          <TextInput
            style={[ps.input, { flex: 1, marginBottom: 0, paddingTop: 11, textAlignVertical: 'top', backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
            placeholder={`Step ${i + 1}`}
            placeholderTextColor={theme.muted}
            multiline
            value={step.text}
            onChangeText={t => setDraft(d => ({
              ...d, steps: d.steps.map(x => x.id === step.id ? { ...x, text: t } : x),
            }))}
          />
          <TextInput
            style={[ps.input, ps.goalInput, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
            placeholder="min"
            placeholderTextColor={theme.muted}
            keyboardType="number-pad"
            maxLength={3}
            value={step.timeGoalMins ? String(step.timeGoalMins) : ''}
            onChangeText={t => setDraft(d => ({
              ...d,
              steps: d.steps.map(x => x.id === step.id
                ? { ...x, timeGoalMins: parseInt(t.replace(/\D/g, ''), 10) || null }
                : x),
            }))}
          />
          {draft.steps.length > 1 && (
            <Pressable
              hitSlop={8}
              onPress={() => setDraft(d => ({ ...d, steps: d.steps.filter(x => x.id !== step.id) }))}
            >
              <Text style={[ps.stepRemove, { color: theme.muted }]}>✕</Text>
            </Pressable>
          )}
        </View>
      </ScaleDecorator>
    )
  }

  return (
    <View style={[ps.page, { backgroundColor: theme.bg }]}>
      {/* Header */}
      <View style={[ps.header, { paddingTop: insets.top + 10, borderBottomColor: theme.divider }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={[ps.headerBack, { color: theme.muted }]}>‹</Text>
        </Pressable>
        <Text style={[ps.headerTitle, { color: theme.text }]} numberOfLines={1}>
          {protocol ? `${protocol.emoji ?? '🛟'}  ${protocol.name}` : 'New Protocol'}
        </Text>
        {protocol ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Pressable onPress={() => setAiOpen(true)} hitSlop={12}>
              <Text style={[ps.headerEdit, { color: PROTOCOL_COLOR }]}>✦ AI</Text>
            </Pressable>
            <Pressable onPress={openEdit} hitSlop={12}>
              <Text style={[ps.headerEdit, { color: PROTOCOL_COLOR }]}>Edit</Text>
            </Pressable>
          </View>
        ) : <View style={{ width: 32 }} />}
      </View>

      {protocol && (
        <ScrollView contentContainerStyle={ps.content} showsVerticalScrollIndicator={false}>
          {/* Time-since-last-reset tracker */}
          {protocol.tracker && (
            <View style={[ps.trackerCard, { backgroundColor: theme.card, borderColor: PROTOCOL_COLOR + '44' }]}>
              <View style={ps.timerRow}>
                {timerParts.map(([v, l], i) => (
                  <View key={l} style={ps.timerUnitWrap}>
                    {i > 0 && <Text style={[ps.timerColon, { color: PROTOCOL_COLOR + '77' }]}>:</Text>}
                    <View style={[ps.timerUnit, { backgroundColor: PROTOCOL_COLOR + '14' }]}>
                      <Text style={[ps.timerVal, { color: PROTOCOL_COLOR }]}>
                        {String(v).padStart(2, '0')}
                      </Text>
                      <Text style={[ps.timerLbl, { color: theme.subtext }]}>{l}</Text>
                    </View>
                  </View>
                ))}
              </View>
              <View style={ps.trackerFooter}>
                <Text style={[ps.trackerCaption, { color: theme.subtext }]}>since last reset</Text>
                <Pressable style={[ps.resetBtn, { borderColor: PROTOCOL_COLOR + '55' }]} onPress={handleResetTracker} hitSlop={8}>
                  <Text style={[ps.resetBtnText, { color: PROTOCOL_COLOR }]}>↩ Reset</Text>
                </Pressable>
              </View>
              <Text style={[ps.trackerNote, { color: theme.muted }]}>
                There's no high score here. Focus on today and the lifestyle you're building.
              </Text>
            </View>
          )}

          {/* ── Not started: step preview + Start (routine-style) ── */}
          {!run && (
            <>
              {protocol.note && (
                <Pressable
                  onPress={() => setNoteOpen(o => !o)}
                  style={[ps.noteCard, { backgroundColor: theme.card, borderColor: PROTOCOL_COLOR + '3a' }]}
                >
                  <View style={ps.noteHeader}>
                    <Text style={[ps.noteTitle, { color: PROTOCOL_COLOR }]} numberOfLines={1}>
                      ✉️  {protocol.note.title}
                    </Text>
                    <Text style={[ps.noteChevron, { color: theme.muted }]}>{noteOpen ? '▾' : '▸'}</Text>
                  </View>
                  {noteOpen && (
                    <Text style={[ps.noteText, { color: theme.text }]}>{protocol.note.text}</Text>
                  )}
                </Pressable>
              )}

              <Text style={[ps.sectionLabel, { color: theme.muted }]}>
                {protocol.steps.length} STEP{protocol.steps.length === 1 ? '' : 'S'}
              </Text>
              {protocol.steps.map((step, i) => (
                <View key={step.id} style={[ps.previewRow, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
                  <View style={[ps.previewNum, { backgroundColor: PROTOCOL_COLOR + '18' }]}>
                    <Text style={[ps.previewNumText, { color: PROTOCOL_COLOR }]}>{i + 1}</Text>
                  </View>
                  <Text style={[ps.previewText, { color: theme.text }]}>{step.text}</Text>
                  {step.timeGoalMins > 0 && (
                    <Text style={[ps.previewGoal, { color: theme.muted }]}>{step.timeGoalMins}m</Text>
                  )}
                </View>
              ))}
              <Pressable style={[ps.primaryBtn, { backgroundColor: PROTOCOL_COLOR, marginTop: 14 }]} onPress={handleStart}>
                <Text style={ps.primaryBtnText}>▶  Start Protocol</Text>
              </Pressable>
            </>
          )}

          {/* ── Running: the routine runner, step by step ── */}
          {running && (
            <>
              <RunRoutine
                run={run}
                color={PROTOCOL_COLOR}
                onStepDone={handleStepDone}
                onFinish={handleFinish}
                onGoBack={handleGoBack}
                onToggleSubTask={() => {}}
                onAdjustStart={handleAdjustStart}
              />
              <Pressable onPress={handleAbandon} hitSlop={8} style={ps.abandonBtn}>
                <Text style={[ps.abandonText, { color: theme.muted }]}>Stop this run</Text>
              </Pressable>
            </>
          )}

          {/* ── Finished: note to self, recap + protocol journal ── */}
          {run?.finished && (
            <>
              {protocol.note && (
                <View style={[ps.noteCard, { backgroundColor: theme.card, borderColor: PROTOCOL_COLOR + '55' }]}>
                  <Text style={[ps.noteTitle, { color: PROTOCOL_COLOR }]}>✉️  {protocol.note.title}</Text>
                  <Text style={[ps.noteText, { color: theme.text }]}>{protocol.note.text}</Text>
                </View>
              )}
              <View style={[ps.doneCard, { backgroundColor: PROTOCOL_COLOR + (theme.isDark ? '22' : '12'), borderColor: PROTOCOL_COLOR + '44' }]}>
                <Text style={ps.doneEmoji}>🌊</Text>
                <Text style={[ps.doneTitle, { color: theme.text }]}>You got through it.</Text>
                <Text style={[ps.doneSub, { color: theme.subtext }]}>
                  Total time: {fmtMs((run.completedAt ?? 0) - (run.startedAt ?? 0))}
                </Text>
                {journalSaved ? (
                  <Text style={[ps.doneSub, { color: theme.subtext, marginTop: 8 }]}>
                    Journal saved — you'll find it on today's calendar.
                  </Text>
                ) : (
                  <>
                    <Text style={[ps.doneSub, { color: theme.subtext, marginTop: 8 }]}>
                      Want to write down what happened? It helps next time, and it'll be on your calendar as a protocol journal.
                    </Text>
                    <TextInput
                      style={[ps.journalInput, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
                      placeholder="What triggered this? What helped?"
                      placeholderTextColor={theme.muted}
                      value={journalText}
                      onChangeText={setJournalText}
                      multiline
                    />
                    <Pressable
                      style={[ps.primaryBtn, { backgroundColor: PROTOCOL_COLOR, opacity: journalText.trim() ? 1 : 0.5 }]}
                      onPress={handleSaveJournal}
                      disabled={!journalText.trim()}
                    >
                      <Text style={ps.primaryBtnText}>Save journal</Text>
                    </Pressable>
                  </>
                )}
                <Pressable onPress={handleRunAgain} hitSlop={8} style={{ marginTop: 12 }}>
                  <Text style={[ps.clearLink, { color: theme.muted }]}>↺ Back to start</Text>
                </Pressable>
              </View>

              {/* Per-step recap, routine-style */}
              {run.steps.map(step => (
                <View key={step.id} style={[ps.recapRow, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
                  <Text style={[ps.recapCheck, { color: '#10b981' }]}>✓</Text>
                  <Text style={[ps.recapText, { color: theme.text }]} numberOfLines={1}>{step.text}</Text>
                  <Text style={[ps.recapTime, { color: theme.muted }]}>{fmtMs(step.elapsedMs)}</Text>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}

      {/* ── Edit / create sheet ── */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => { if (!isNew || protocol) setEditOpen(false); else router.back() }}>
        <KeyboardAvoidingView style={ps.modalWrap} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={{ flex: 1 }} onPress={() => { (!isNew || protocol) ? setEditOpen(false) : router.back() }} />
          <GestureHandlerRootView style={[ps.sheet, { backgroundColor: theme.card }]}>
            {draft && (
              <DraggableFlatList
                data={draft.steps}
                keyExtractor={st => st.id}
                onDragEnd={({ data }) => setDraft(d => ({ ...d, steps: data }))}
                renderItem={renderStepRow}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                ListHeaderComponent={
                  <>
                  <View style={[ps.handle, { backgroundColor: theme.divider }]} />
                  <Text style={[ps.sheetTitle, { color: theme.text }]}>
                    {protocol ? 'Edit Protocol' : 'New Protocol'}
                  </Text>
                  <Pressable
                    style={[ps.aiHelperBtn, { borderColor: PROTOCOL_COLOR + '55', backgroundColor: PROTOCOL_COLOR + '0d' }]}
                    onPress={() => { setEditOpen(false); setAiOpen(true) }}
                  >
                    <Text style={{ fontSize: 18 }}>✦</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.text, fontWeight: '700', fontSize: 14 }}>Build it with AI</Text>
                      <Text style={{ color: theme.subtext, fontSize: 12, lineHeight: 16, marginTop: 2 }}>
                        Describe what you're fighting, get advice, and the AI writes this protocol for you.
                      </Text>
                    </View>
                    <Text style={{ color: PROTOCOL_COLOR, fontSize: 18, fontWeight: '300' }}>›</Text>
                  </Pressable>

                  <Text style={[ps.fieldLabel, { color: theme.muted }]}>NAME</Text>
                  <TextInput
                    style={[ps.input, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
                    placeholder='e.g. "Urge surfing", "Get moving"'
                    placeholderTextColor={theme.muted}
                    value={draft.name}
                    onChangeText={t => setDraft(d => ({ ...d, name: t }))}
                  />

                  <Text style={[ps.fieldLabel, { color: theme.muted }]}>ICON</Text>
                  <View style={ps.emojiRow}>
                    {EMOJIS.map(e => (
                      <Pressable
                        key={e}
                        onPress={() => setDraft(d => ({ ...d, emoji: e }))}
                        style={[ps.emojiBtn, {
                          borderColor: draft.emoji === e ? PROTOCOL_COLOR : theme.cardBorder,
                          backgroundColor: draft.emoji === e ? PROTOCOL_COLOR + '18' : 'transparent',
                        }]}
                      >
                        <Text style={{ fontSize: 20 }}>{e}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={[ps.fieldLabel, { color: theme.muted }]}>STEPS  ·  minutes goal optional  ·  hold ☰ to reorder</Text>
                  </>
                }
                ListFooterComponent={
                  <>
                  <Pressable
                    onPress={() => setDraft(d => ({ ...d, steps: [...d.steps, { id: genProtocolId(), text: '', timeGoalMins: null }] }))}
                    hitSlop={8}
                    style={{ marginTop: 6, marginBottom: 14 }}
                  >
                    <Text style={{ color: PROTOCOL_COLOR, fontWeight: '700', fontSize: 13.5 }}>+ Add step</Text>
                  </Pressable>

                  <Text style={[ps.fieldLabel, { color: theme.muted }]}>NOTE TO SELF (optional)</Text>
                  <Text style={{ color: theme.subtext, fontSize: 12, lineHeight: 16, marginBottom: 8 }}>
                    Shown every time you finish this protocol — a message from you, for that moment.
                  </Text>
                  <TextInput
                    style={[ps.input, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
                    placeholder="Note title, e.g. “Read this, from calm you”"
                    placeholderTextColor={theme.muted}
                    value={draft.note?.title ?? ''}
                    onChangeText={t => setDraft(d => ({ ...d, note: { ...(d.note ?? { text: '' }), title: t } }))}
                  />
                  <TextInput
                    style={[ps.input, ps.noteInput, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
                    placeholder="What do you want to tell yourself after getting through it?"
                    placeholderTextColor={theme.muted}
                    value={draft.note?.text ?? ''}
                    onChangeText={t => setDraft(d => ({ ...d, note: { ...(d.note ?? { title: '' }), text: t } }))}
                    multiline
                  />

                  <View style={ps.trackerToggleRow}>
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      <Text style={{ color: theme.text, fontWeight: '700', fontSize: 14 }}>Time counter</Text>
                      <Text style={{ color: theme.subtext, fontSize: 12, marginTop: 2, lineHeight: 16 }}>
                        Track how long it's been since you last relapsed or broke this protocol.
                      </Text>
                    </View>
                    <Switch
                      value={!!draft.tracker}
                      onValueChange={on => setDraft(d => ({ ...d, tracker: on ? (d.tracker ?? { since: Date.now() }) : null }))}
                      trackColor={{ true: PROTOCOL_COLOR }}
                    />
                  </View>

                  <Pressable style={[ps.primaryBtn, { backgroundColor: PROTOCOL_COLOR }]} onPress={handleSaveDraft}>
                    <Text style={ps.primaryBtnText}>{protocol ? 'Save Changes' : 'Create Protocol'}</Text>
                  </Pressable>
                  {protocol && (
                    <Pressable onPress={handleDelete} hitSlop={8} style={ps.deleteBtn}>
                      <Text style={ps.deleteText}>Delete Protocol</Text>
                    </Pressable>
                  )}
                  </>
                }
              />
            )}
          </GestureHandlerRootView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── AI helper chat ── */}
      <ProtocolAIModal
        visible={aiOpen}
        onClose={() => {
          setAiOpen(false)
          // Landed here from the create form without applying: reopen it so
          // the /protocol/new route isn't left showing an empty page.
          if (isNew && !protocol) setEditOpen(true)
        }}
        theme={theme}
        color={PROTOCOL_COLOR}
        protocolName={protocol?.name ?? ''}
        onApply={handleApplyAI}
      />
    </View>
  )
}

const ps = StyleSheet.create({
  page: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBack: { fontSize: 30, fontWeight: '700', lineHeight: 32, width: 20 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '800', letterSpacing: -0.3, textAlign: 'center' },
  headerEdit: { fontSize: 14, fontWeight: '700' },
  content: { padding: 16, paddingBottom: 40 },

  trackerCard: { borderRadius: 18, borderWidth: 1.5, padding: 16, marginBottom: 18 },
  timerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  timerUnitWrap: { flexDirection: 'row', alignItems: 'center' },
  timerColon: { fontSize: 22, fontWeight: '900', marginHorizontal: 4, marginBottom: 14 },
  timerUnit: { borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10, alignItems: 'center', minWidth: 56 },
  timerVal: { fontSize: 22, fontWeight: '900', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  timerLbl: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6, marginTop: 2 },
  trackerFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12,
  },
  trackerCaption: { fontSize: 12.5, fontWeight: '600' },
  trackerNote: {
    fontSize: 12, lineHeight: 17, fontWeight: '500', fontStyle: 'italic',
    textAlign: 'center', marginTop: 12,
  },
  resetBtn: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  resetBtnText: { fontSize: 13, fontWeight: '800' },

  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, marginBottom: 8 },

  // Step preview (before starting)
  previewRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, borderWidth: 1, padding: 13, marginBottom: 8,
  },
  previewNum: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  previewNumText: { fontSize: 13, fontWeight: '800' },
  previewText: { flex: 1, fontSize: 14.5, fontWeight: '600', lineHeight: 20 },
  previewGoal: { fontSize: 12, fontWeight: '700' },

  abandonBtn: { alignItems: 'center', paddingVertical: 4 },
  abandonText: { fontSize: 13, fontWeight: '600' },

  // Note to self
  noteCard: { borderRadius: 16, borderWidth: 1.5, padding: 14, marginBottom: 14 },
  noteHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  noteTitle: { fontSize: 14, fontWeight: '800', flexShrink: 1 },
  noteChevron: { fontSize: 14, fontWeight: '800' },
  noteText: { fontSize: 14, lineHeight: 21, fontWeight: '500', marginTop: 10 },
  noteInput: { minHeight: 84, maxHeight: 160, textAlignVertical: 'top', paddingTop: 11 },

  doneCard: { borderRadius: 18, borderWidth: 1.5, padding: 18, marginBottom: 12, alignItems: 'center' },
  doneEmoji: { fontSize: 30 },
  doneTitle: { fontSize: 17, fontWeight: '800', marginTop: 6 },
  doneSub: { fontSize: 13, lineHeight: 19, fontWeight: '500', textAlign: 'center', marginTop: 4 },
  journalInput: {
    alignSelf: 'stretch', minHeight: 90, maxHeight: 160, borderWidth: 1, borderRadius: 14,
    padding: 12, fontSize: 14, textAlignVertical: 'top', marginTop: 12,
  },
  primaryBtn: {
    alignSelf: 'stretch', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 12,
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  clearLink: { fontSize: 12.5, fontWeight: '600' },

  recapRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 11, marginBottom: 7,
  },
  recapCheck: { fontSize: 14, fontWeight: '900' },
  recapText: { flex: 1, fontSize: 14, fontWeight: '600' },
  recapTime: { fontSize: 12.5, fontWeight: '700', fontVariant: ['tabular-nums'] },

  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '88%',
    paddingTop: 8, paddingHorizontal: 22, paddingBottom: 30,
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3, marginBottom: 14 },
  fieldLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, marginBottom: 6, marginTop: 4 },
  input: { borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14.5, marginBottom: 12 },
  goalInput: { width: 62, marginBottom: 0, textAlign: 'center' },
  emojiRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  emojiBtn: { width: 42, height: 42, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  // flex-start so the minutes box and ✕ stay pinned to the top while a long
  // step's multiline input grows downward.
  stepEditRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  stepRemove: { fontSize: 16, fontWeight: '700', paddingHorizontal: 2, paddingTop: 12 },
  dragHandle: { paddingTop: 12, paddingRight: 2 },
  dragHandleText: { fontSize: 16, fontWeight: '700' },
  trackerToggleRow: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 6, marginBottom: 6, paddingVertical: 8,
  },
  aiHelperBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1.5, borderRadius: 14, padding: 12, marginBottom: 14,
  },
  deleteBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  deleteText: { color: '#ef4444', fontWeight: '700', fontSize: 14 },
})
