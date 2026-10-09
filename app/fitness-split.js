import { useState, useEffect, useRef } from 'react'
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native'
import { router } from 'expo-router'
import { useAuth } from '../lib/AuthContext'
import { useTheme } from '../lib/ThemeContext'
import { loadGymSplit, saveGymSplit } from '../lib/storage'
import {
  SPLIT_PRESETS, MUSCLE_GROUPS, DAY_LABELS,
  muscleColor, muscleTextColor, todaySplitIndex, normalizeDay,
} from '../lib/splitData'

const PRESETS = Object.keys(SPLIT_PRESETS)

export default function FitnessSplit() {
  const { user } = useAuth()
  const userId = user?.id
  const { theme } = useTheme()
  const s = makeStyles(theme)
  const [preset, setPreset] = useState('PPL')
  const [days, setDays] = useState(SPLIT_PRESETS['PPL'].days.map(d => [...d]))
  const [openDay, setOpenDay] = useState(null)
  const [saving, setSaving] = useState(false)
  // The planner saves the whole split back, so it only opens on the real
  // one: a failed read used to show (and then save) the stock PPL split.
  const [status, setStatus] = useState('loading')   // loading | ready | error
  const [loadError, setLoadError] = useState(null)
  const loadReq = useRef(0)
  const edited = useRef(false)
  // Worked out on every render, so a planner left open past midnight moves on.
  const todayIdx = todaySplitIndex()

  function load() {
    const req = ++loadReq.current
    setStatus('loading')
    loadGymSplit(userId)
      .then(split => {
        if (req !== loadReq.current) return
        // A read that lands after the user started editing never reverts them.
        if (!edited.current) {
          setPreset(split.preset)
          setDays(split.days.map(d => normalizeDay(d)))
        }
        setStatus('ready')
      })
      .catch(e => {
        if (req !== loadReq.current) return
        setLoadError(e?.message ?? 'Could not load your split.')
        setStatus('error')
      })
  }

  useEffect(() => {
    if (userId) load()
  }, [userId])

  function applyPreset(name) {
    // Custom is where the edits live: tapping it again must not wipe every
    // day back to Rest.
    if (name === 'Custom' && preset === 'Custom') return
    edited.current = true
    setPreset(name)
    setDays(SPLIT_PRESETS[name].days.map(d => [...d]))
    setOpenDay(null)
  }

  function toggleMuscle(dayIdx, muscle) {
    const current = normalizeDay(days[dayIdx])
    let next
    if (muscle === 'Rest') {
      next = ['Rest']
    } else {
      const withoutRest = current.filter(m => m !== 'Rest')
      if (withoutRest.includes(muscle)) {
        const removed = withoutRest.filter(m => m !== muscle)
        next = removed.length > 0 ? removed : ['Rest']
      } else {
        next = [...withoutRest, muscle]
      }
    }
    edited.current = true
    setDays(prev => {
      const copy = [...prev]
      copy[dayIdx] = next
      return copy
    })
    setPreset('Custom')
  }

  async function handleSave() {
    if (status !== 'ready') return
    setSaving(true)
    try {
      await saveGymSplit(userId, { preset, days })
      router.back()
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView style={s.page} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => router.back()} style={s.back}>
        <Text style={s.backText}>← Back</Text>
      </Pressable>

      <Text style={s.title}>Gym Split Planner</Text>
      <Text style={s.subtitle}>Tap a preset to auto-fill, then tap any day to customise. A day can train more than one muscle group.</Text>

      {status === 'loading' && <ActivityIndicator color="#10b981" style={{ marginTop: 32 }} />}

      {status === 'error' && (
        <View style={s.errorWrap}>
          <Text style={s.errorEmoji}>⚠️</Text>
          <Text style={s.errorTitle}>Couldn't load your split</Text>
          <Text style={s.errorSub}>{loadError}</Text>
          <Pressable style={s.retryBtn} onPress={load}>
            <Text style={s.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {status === 'ready' && (<>
      {/* Preset chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.presetScroll} contentContainerStyle={s.presetRow}>
        {PRESETS.map(name => {
          const p = SPLIT_PRESETS[name]
          const active = preset === name
          return (
            <Pressable
              key={name}
              style={[s.presetChip, active && s.presetChipActive]}
              onPress={() => applyPreset(name)}
            >
              <Text style={s.presetEmoji}>{p.emoji}</Text>
              <Text style={[s.presetLabel, active && s.presetLabelActive]}>{p.label}</Text>
            </Pressable>
          )
        })}
      </ScrollView>

      {/* Day cards (vertical list) */}
      {days.map((dayVal, i) => {
        const muscles = normalizeDay(dayVal)
        const isToday = i === todayIdx
        const isOpen = openDay === i
        return (
          <View key={i} style={[s.dayCard, isToday && s.dayCardToday]}>
            <Pressable
              style={s.dayCardHeader}
              onPress={() => setOpenDay(isOpen ? null : i)}
            >
              {/* Day name */}
              <View style={[s.dayNameBox, isToday && s.dayNameBoxToday]}>
                <Text style={[s.dayName, isToday && s.dayNameToday]}>{DAY_LABELS[i]}</Text>
                {isToday && <Text style={s.todayBadge}>Today</Text>}
              </View>

              {/* Muscle pills */}
              <View style={s.musclePillsRow}>
                {muscles.map(m => (
                  <View key={m} style={[s.musclePill, { backgroundColor: muscleColor(m) }]}>
                    <Text style={[s.musclePillText, { color: muscleTextColor(m) }]}>{m}</Text>
                  </View>
                ))}
              </View>

              <Text style={[s.chevron, isOpen && s.chevronOpen]}>›</Text>
            </Pressable>

            {/* Muscle picker (accordion) */}
            {isOpen && (
              <View style={s.picker}>
                <Text style={s.pickerHint}>Tap to toggle. Multiple groups allowed.</Text>
                <View style={s.muscleGrid}>
                  {MUSCLE_GROUPS.map(mg => {
                    const selected = muscles.includes(mg)
                    return (
                      <Pressable
                        key={mg}
                        style={[
                          s.mgChip,
                          { backgroundColor: muscleColor(mg) },
                          selected && s.mgChipSelected,
                        ]}
                        onPress={() => toggleMuscle(i, mg)}
                      >
                        {selected && <Text style={[s.mgCheck, { color: muscleTextColor(mg) }]}>✓ </Text>}
                        <Text style={[s.mgText, { color: muscleTextColor(mg) }]}>{mg}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>
            )}
          </View>
        )
      })}

      <Pressable
        style={[s.saveBtn, saving && { opacity: 0.6 }]}
        onPress={handleSave}
        disabled={saving}
      >
        <Text style={s.saveBtnText}>{saving ? 'Saving…' : 'Save Split'}</Text>
      </Pressable>
      </>)}
    </ScrollView>
  )
}

function makeStyles(theme) { return StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 20, paddingTop: 56, paddingBottom: 48 },
  back: { marginBottom: 20 },
  backText: { color: '#10b981', fontSize: 15, fontWeight: '600' },
  title: { fontSize: 26, fontWeight: '800', color: theme.text, marginBottom: 6 },
  subtitle: { fontSize: 13, color: theme.subtext, marginBottom: 22, lineHeight: 18 },

  errorWrap: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 12 },
  errorEmoji: { fontSize: 40, marginBottom: 10 },
  errorTitle: { fontSize: 17, fontWeight: '800', color: theme.text, marginBottom: 6 },
  errorSub: { fontSize: 13, color: theme.subtext, textAlign: 'center', lineHeight: 18, marginBottom: 18 },
  retryBtn: { backgroundColor: '#10b981', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  presetScroll: { marginBottom: 18, marginHorizontal: -4 },
  presetRow: { paddingHorizontal: 4, gap: 8 },
  presetChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: theme.card, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1.5, borderColor: theme.cardBorder,
  },
  presetChipActive: { borderColor: '#10b981', backgroundColor: '#ecfdf5' },
  presetEmoji: { fontSize: 16 },
  presetLabel: { fontSize: 13, fontWeight: '600', color: theme.subtext },
  presetLabelActive: { color: '#10b981' },

  dayCard: {
    backgroundColor: theme.card, borderRadius: 16, marginBottom: 10,
    borderWidth: 1.5, borderColor: theme.cardBorder, overflow: 'hidden',
    shadowColor: theme.isDark ? 'transparent' : '#0d1b5e',
    shadowOffset: { width: 4, height: 5 }, shadowOpacity: 0.18, shadowRadius: 0, elevation: 4,
  },
  dayCardToday: { borderColor: '#10b981' },
  dayCardHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, gap: 10,
  },
  dayNameBox: {
    width: 48, alignItems: 'center',
    backgroundColor: theme.input, borderRadius: 10, paddingVertical: 6,
  },
  dayNameBoxToday: { backgroundColor: '#ecfdf5' },
  dayName: { fontSize: 14, fontWeight: '800', color: theme.subtext },
  dayNameToday: { color: '#10b981' },
  todayBadge: { fontSize: 9, fontWeight: '700', color: '#10b981', letterSpacing: 0.5, marginTop: 2 },
  musclePillsRow: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  musclePill: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  musclePillText: { fontSize: 13, fontWeight: '700' },
  chevron: { fontSize: 20, color: theme.muted, fontWeight: '300' },
  chevronOpen: { transform: [{ rotate: '90deg' }] },

  picker: {
    borderTopWidth: 1, borderTopColor: theme.divider,
    padding: 14,
  },
  pickerHint: { fontSize: 11, color: theme.muted, marginBottom: 10 },
  muscleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mgChip: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 2, borderColor: 'transparent',
  },
  mgChipSelected: { borderColor: '#10b981' },
  mgCheck: { fontSize: 12, fontWeight: '800' },
  mgText: { fontSize: 13, fontWeight: '700' },

  saveBtn: {
    backgroundColor: '#10b981', borderRadius: 16, padding: 18,
    alignItems: 'center', marginTop: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12, shadowRadius: 8, elevation: 4,
  },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 17 },
}) }