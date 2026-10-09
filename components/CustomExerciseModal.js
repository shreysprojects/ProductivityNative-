import { useState, useRef } from 'react'
import {
  Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  KeyboardAvoidingView, Platform, SafeAreaView, ActivityIndicator, Alert,
} from 'react-native'
import { MUSCLE_OPTIONS, suggestMuscles, isYouTubeId } from '../lib/customExercises'
import ExerciseVideo from './ExerciseVideo'

// Create (or edit) one of the user's own exercises: a name, an optional
// description, and the muscles it trains. Tap a muscle once for "main",
// again for "also works", again to clear. "Ask AI" fills the chips in from
// the name and description.

const COLOR = '#6366f1'
const SECONDARY = '#0ea5e9'

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2) }

const norm = s => String(s ?? '').trim().toLowerCase()

export default function CustomExerciseModal({ initial, onSave, onDelete, onClose }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [picks, setPicks] = useState(() => {
    const m = {}
    for (const n of initial?.primary ?? []) m[n] = 'primary'
    for (const n of initial?.secondary ?? []) if (!m[n]) m[n] = 'secondary'
    return m
  })
  const [aiBusy, setAiBusy] = useState(false)
  const [aiNote, setAiNote] = useState(null)
  // A YouTube demo the AI step found once it recognised the exercise. It
  // belongs to the name it was found for: renaming drops it, and asking the
  // AI again replaces it, or clears it when nothing is found this time.
  const [video, setVideo] = useState(isYouTubeId(initial?.video?.id) ? initial.video : null)
  const videoFor = useRef(norm(initial?.name))
  // A second tap on Add before the sheet closed saved the exercise twice.
  const saved = useRef(false)

  const primary = MUSCLE_OPTIONS.filter(n => picks[n] === 'primary')
  const secondary = MUSCLE_OPTIONS.filter(n => picks[n] === 'secondary')
  const ready = name.trim().length > 0 && primary.length > 0

  function cycle(n) {
    setPicks(prev => {
      const cur = prev[n]
      const next = { ...prev }
      if (!cur) next[n] = 'primary'
      else if (cur === 'primary') next[n] = 'secondary'
      else delete next[n]
      return next
    })
  }

  function rename(text) {
    setName(text)
    if (video && norm(text) !== videoFor.current) setVideo(null)
  }

  async function askAI() {
    if (!name.trim()) { Alert.alert('Name it first', 'Type the exercise name so the AI knows what to look at.'); return }
    setAiBusy(true)
    setAiNote(null)
    try {
      const data = await suggestMuscles({ name: name.trim(), description: description.trim() })
      videoFor.current = norm(name)
      setVideo(isYouTubeId(data?.video?.id) ? { id: data.video.id, title: String(data.video.title ?? '') } : null)
      const p = Array.isArray(data?.primary) ? data.primary : []
      const s = Array.isArray(data?.secondary) ? data.secondary : []
      if (p.length === 0 && s.length === 0) {
        setAiNote(data?.note || 'The AI could not tell which muscles this trains. Pick them yourself below.')
        return
      }
      const m = {}
      for (const n of p) if (MUSCLE_OPTIONS.includes(n)) m[n] = 'primary'
      for (const n of s) if (MUSCLE_OPTIONS.includes(n) && !m[n]) m[n] = 'secondary'
      setPicks(m)
      setAiNote(data?.note || 'Filled in by AI. Adjust anything that looks off.')
    } catch (e) {
      Alert.alert('Could not ask AI', String(e?.message ?? e))
    } finally {
      setAiBusy(false)
    }
  }

  function save() {
    if (saved.current) return
    if (!name.trim()) { Alert.alert('Name the exercise'); return }
    if (primary.length === 0) { Alert.alert('Pick the main muscle', 'Tap at least one muscle once so it counts as the main one.'); return }
    saved.current = true
    onSave({
      id: initial?.id ?? genId(),
      name: name.trim(),
      description: description.trim(),
      primary,
      secondary,
      video,
    })
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={m.header}>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={m.cancel}>Cancel</Text>
            </Pressable>
            <Text style={m.title}>{initial ? 'Edit exercise' : 'Your own exercise'}</Text>
            <Pressable
              onPress={save}
              style={[m.saveBtn, { backgroundColor: ready ? COLOR : '#e5e7eb' }]}
              disabled={!ready}
            >
              <Text style={[m.saveBtnText, { color: ready ? '#fff' : '#aaa' }]}>{initial ? 'Save' : 'Add'}</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={m.form} keyboardShouldPersistTaps="handled">
            <Text style={m.label}>NAME</Text>
            <TextInput
              style={m.input}
              placeholder='e.g. "Bayesian curl"'
              placeholderTextColor="#bbb"
              value={name}
              onChangeText={rename}
              returnKeyType="next"
              autoFocus={!initial}
            />

            <Text style={m.label}>DESCRIPTION (optional)</Text>
            <TextInput
              style={[m.input, m.inputMulti]}
              placeholder="How it's done, cues, equipment…"
              placeholderTextColor="#bbb"
              value={description}
              onChangeText={setDescription}
              multiline
              textAlignVertical="top"
            />

            <View style={m.musclesHeader}>
              <Text style={m.label}>MUSCLES IT TRAINS</Text>
              <Pressable style={[m.aiBtn, aiBusy && { opacity: 0.6 }]} onPress={askAI} disabled={aiBusy}>
                {aiBusy
                  ? <ActivityIndicator size="small" color={COLOR} />
                  : <Text style={m.aiBtnText}>✨ Ask AI</Text>}
              </Pressable>
            </View>
            <Text style={m.legend}>
              Tap once for <Text style={{ color: COLOR, fontWeight: '800' }}>main</Text>, twice for{' '}
              <Text style={{ color: SECONDARY, fontWeight: '800' }}>also works</Text>, again to clear.
            </Text>
            {!!aiNote && <Text style={m.aiNote}>{aiNote}</Text>}

            <View style={m.chipGrid}>
              {MUSCLE_OPTIONS.map(n => {
                const state = picks[n]
                return (
                  <Pressable
                    key={n}
                    onPress={() => cycle(n)}
                    style={[
                      m.chip,
                      state === 'primary' && { backgroundColor: COLOR, borderColor: COLOR },
                      state === 'secondary' && { backgroundColor: SECONDARY + '1a', borderColor: SECONDARY },
                    ]}
                  >
                    <Text style={[
                      m.chipText,
                      state === 'primary' && { color: '#fff' },
                      state === 'secondary' && { color: SECONDARY },
                    ]}>
                      {state === 'primary' ? '● ' : state === 'secondary' ? '◐ ' : ''}{n}
                    </Text>
                  </Pressable>
                )
              })}
            </View>

            {!!video?.id && (
              <View style={m.videoWrap}>
                <View style={m.videoHeader}>
                  <Text style={m.label}>DEMO VIDEO</Text>
                  <Pressable onPress={() => setVideo(null)} hitSlop={8}>
                    <Text style={m.videoRemove}>Remove</Text>
                  </Pressable>
                </View>
                <ExerciseVideo videoId={video.id} />
                {!!video.title && <Text style={m.videoTitle} numberOfLines={2}>{video.title}</Text>}
                <Text style={m.videoHint}>Found on YouTube for this exercise. It stays with the exercise.</Text>
              </View>
            )}

            {(primary.length > 0 || secondary.length > 0) && (
              <View style={m.summary}>
                {primary.length > 0 && (
                  <Text style={m.summaryLine}>
                    <Text style={{ color: COLOR, fontWeight: '800' }}>Main:</Text> {primary.join(', ')}
                  </Text>
                )}
                {secondary.length > 0 && (
                  <Text style={m.summaryLine}>
                    <Text style={{ color: SECONDARY, fontWeight: '800' }}>Also works:</Text> {secondary.join(', ')}
                  </Text>
                )}
              </View>
            )}

            {!!onDelete && (
              <Pressable style={m.deleteBtn} onPress={onDelete}>
                <Text style={m.deleteText}>Delete this exercise</Text>
              </Pressable>
            )}
            <View style={{ height: 48 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

const m = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f0f0f3',
  },
  cancel: { fontSize: 16, color: COLOR, minWidth: 56 },
  title: { fontSize: 17, fontWeight: '700', color: '#111' },
  saveBtn: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8, minWidth: 56, alignItems: 'center' },
  saveBtnText: { fontSize: 15, fontWeight: '700' },

  form: { padding: 16 },
  label: { fontSize: 11, fontWeight: '800', color: '#999', letterSpacing: 1.2, marginBottom: 8, marginTop: 6 },
  input: {
    borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: '#111', backgroundColor: '#fafbff',
    marginBottom: 14,
  },
  inputMulti: { minHeight: 84 },
  musclesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  aiBtn: {
    borderRadius: 10, borderWidth: 1.5, borderColor: COLOR + '66', backgroundColor: COLOR + '0c',
    paddingHorizontal: 12, paddingVertical: 6, minWidth: 84, alignItems: 'center',
  },
  aiBtnText: { fontSize: 13, fontWeight: '800', color: COLOR },
  legend: { fontSize: 12, color: '#888', lineHeight: 17, marginBottom: 10 },
  aiNote: { fontSize: 12.5, color: '#555', fontStyle: 'italic', lineHeight: 17, marginBottom: 10 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 20, borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#f6f7fb',
    paddingHorizontal: 12, paddingVertical: 8,
  },
  chipText: { fontSize: 13, fontWeight: '700', color: '#555' },
  videoWrap: { marginTop: 16 },
  videoHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  videoRemove: { fontSize: 12, fontWeight: '700', color: '#ef4444' },
  videoTitle: { fontSize: 13, fontWeight: '600', color: '#333', marginTop: 8, lineHeight: 18 },
  videoHint: { fontSize: 11.5, color: '#999', marginTop: 4 },
  summary: { marginTop: 14, backgroundColor: '#f6f7fb', borderRadius: 12, padding: 12, gap: 4 },
  summaryLine: { fontSize: 13, color: '#333', lineHeight: 18 },
  deleteBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 20 },
  deleteText: { fontSize: 14, fontWeight: '700', color: '#ef4444' },
})
