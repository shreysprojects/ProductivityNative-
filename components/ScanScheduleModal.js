import { useState, useEffect, useRef } from 'react'
import {
  View, Text, Pressable, ScrollView, Modal,
  StyleSheet, ActivityIndicator, Alert, Animated,
} from 'react-native'
import { useSheetDrag } from '../lib/useSheetDrag'
import * as ImagePicker from 'expo-image-picker'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { useTheme } from '../lib/ThemeContext'
import { supabase } from '../lib/supabase'

// Import a class timetable from screenshots. The AI returns one row per class
// meeting; the user reviews and picks which to keep before anything is saved.

const CLASS_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#22c55e', '#eab308', '#06b6d4', '#ef4444']

// AI returns 'Mon'..'Sun'; schedule_items.days uses JS day-of-week (0 = Sunday).
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

const DAY_ALIASES = {
  sun: 'Sun', sunday: 'Sun', mon: 'Mon', monday: 'Mon',
  tue: 'Tue', tues: 'Tue', tuesday: 'Tue', wed: 'Wed', wednesday: 'Wed',
  thu: 'Thu', thur: 'Thu', thurs: 'Thu', thursday: 'Thu',
  fri: 'Fri', friday: 'Fri', sat: 'Sat', saturday: 'Sat',
}

function normalizeDay(day) {
  return DAY_ALIASES[String(day ?? '').trim().toLowerCase()] ?? null
}

const TYPE_EMOJI = {
  Lecture: '🎓', Tutorial: '✏️', Lab: '🔬', Seminar: '💬', Other: '📘',
}

function fmt(t) {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

// Every meeting of the same course shares a colour.
function colorFor(code, allCodes) {
  const i = allCodes.indexOf(code)
  return CLASS_COLORS[(i < 0 ? 0 : i) % CLASS_COLORS.length]
}

export default function ScanScheduleModal({ visible, onClose, onImport }) {
  const { theme } = useTheme()
  const [busy, setBusy]       = useState(false)
  const [found, setFound]     = useState(null)   // extracted classes, or null before a scan
  const [skipped, setSkipped] = useState(new Set())
  // Each scan takes a number, and closing, rescanning or unmounting moves the
  // number on. A scan still out from before then knows nobody is waiting for
  // it: no alerts, no results, and its finish can't re-enable the button in
  // the middle of a newer scan.
  const scanSeq = useRef(0)
  useEffect(() => () => { scanSeq.current++ }, [])

  function reset() {
    scanSeq.current++
    setFound(null)
    setSkipped(new Set())
    setBusy(false)
  }

  // Start every open fresh. Resetting here (not on import) means cancelling
  // the replace-confirmation keeps the scan results — no re-scan needed.
  useEffect(() => { if (visible) reset() }, [visible])

  function close() {
    reset()
    onClose()
  }

  async function pickAndScan() {
    const seq = ++scanSeq.current
    const stale = () => seq !== scanSeq.current
    // No permission request: the system photo picker only hands back what
    // was picked, so it needs no library access — asking for it (and
    // refusing to go on when it was denied) only got in the way.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsMultipleSelection: true,
      selectionLimit: 3,
      orderedSelection: true,
    })
    if (stale() || result.canceled || !result.assets?.length) return

    setBusy(true)
    try {
      // Screenshots are big PNGs — downscale and re-encode so the upload stays
      // small. Timetables are dense text grids and desktop screenshots are
      // wide, so 1100px blurred the day columns; 1600 keeps them readable and
      // still lands well under the server's image-size cap.
      const images = []
      for (const asset of result.assets) {
        const width = Math.min(asset.width || 1600, 1600)
        const shrunk = await manipulateAsync(
          asset.uri,
          [{ resize: { width } }],
          { compress: 0.75, format: SaveFormat.JPEG, base64: true }
        )
        if (shrunk.base64) images.push(shrunk.base64)
      }
      if (stale() || !images.length) return

      const { data, error } = await supabase.functions.invoke('openai-proxy', {
        body: { action: 'extract_schedule', images },
      })
      if (stale()) return
      if (error) {
        let detail = null
        try { detail = await error.context?.json() } catch {}
        if (stale()) return
        if (detail?.error === 'daily_limit') {
          Alert.alert('Limit reached', detail.reason)
          return
        }
        if (detail?.error === 'limit_unavailable') {
          Alert.alert('Try again', detail.reason)
          return
        }
        throw new Error(detail?.reason ?? detail?.message ?? detail?.error ?? error.message)
      }
      if (data?.error === 'daily_limit') {
        Alert.alert('Limit reached', data.reason)
        return
      }
      if (data?.error === 'limit_unavailable') {
        Alert.alert('Try again', data.reason)
        return
      }
      const extracted = Array.isArray(data?.classes) ? data.classes : []
      const seen = new Set()
      const classes = extracted.flatMap(c => {
        const suppliedDays = Array.isArray(c.days) ? c.days : [c.day]
        return suppliedDays.map(normalizeDay).filter(Boolean).map(day => ({ ...c, day }))
      }).filter(c => {
        const key = [c.courseCode, c.courseName, c.type, c.day, c.startTime, c.endTime, c.location].join('|')
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      if (!classes.length) {
        Alert.alert(
          'No classes found',
          "Couldn't read a class schedule from those screenshots. Try a clearer shot that shows course codes, days and times."
        )
        return
      }
      setFound(classes)
      setSkipped(new Set())
    } catch (e) {
      if (!stale()) Alert.alert('Scan failed', String(e?.message ?? e))
    } finally {
      if (!stale()) setBusy(false)
    }
  }

  function toggle(i) {
    setSkipped(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  function confirm() {
    const keep = (found ?? []).filter((_, i) => !skipped.has(i))
    if (!keep.length) { Alert.alert('Nothing selected', 'Keep at least one class to import.'); return }

    // Same course + type + time is one weekly item across several days.
    const codes = [...new Set(keep.map(c => c.courseCode || c.courseName))]
    const grouped = new Map()
    for (const c of keep) {
      const code = c.courseCode || c.courseName
      const key = `${code}|${c.type}|${c.startTime}|${c.endTime}|${c.location ?? ''}`
      if (!grouped.has(key)) {
        grouped.set(key, {
          title: code,
          location: c.location ?? null,
          days: [],
          startTime: c.startTime,
          endTime: c.endTime,
          color: colorFor(code, codes),
          meta: { courseCode: c.courseCode, courseName: c.courseName, type: c.type },
        })
      }
      const dow = DOW[c.day]
      const item = grouped.get(key)
      if (dow != null && !item.days.includes(dow)) item.days.push(dow)
    }
    const items = [...grouped.values()].filter(i => i.days.length > 0)
    // No reset here: the parent may ask "replace your schedule?" first, and a
    // cancelled confirmation should come back to these results, not a rescan.
    onImport(items)
  }

  const keptCount = found ? found.length - skipped.size : 0

  const drag = useSheetDrag(close, { visible })

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={drag.close}>
      <View style={sc.wrap}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={drag.close} />
        <Animated.View style={[sc.sheet, { backgroundColor: theme.card, transform: [{ translateY: drag.dragY }] }]}>
          <View {...drag.handlePan.panHandlers} style={drag.grabStyle}>
            <View style={[sc.handle, { backgroundColor: theme.divider }]} />
            <Text style={[sc.title, { color: theme.text }]}>Import class schedule</Text>
          </View>

          {!found ? (
            <>
              <Text style={[sc.body, { color: theme.subtext }]}>
                Pick up to 3 screenshots of your timetable. Course code, course name, type
                (lecture, tutorial, lab), day, time and room are read automatically — you
                get to review everything first. Importing replaces the classes currently
                on your schedule.
              </Text>
              <Pressable
                style={[sc.primaryBtn, { backgroundColor: theme.accent, opacity: busy ? 0.6 : 1 }]}
                onPress={pickAndScan}
                disabled={busy}
              >
                {busy
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={sc.primaryBtnText}>✦  Choose screenshots</Text>}
              </Pressable>
              {busy && (
                <Text style={[sc.busyNote, { color: theme.muted }]}>
                  Reading your timetable carefully — this can take up to a minute.
                </Text>
              )}
            </>
          ) : (
            <>
              <Text style={[sc.body, { color: theme.subtext }]}>
                Found {found.length} class{found.length === 1 ? '' : 'es'}. Tap any row to leave it out.
              </Text>
              <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                {found.map((c, i) => {
                  const off = skipped.has(i)
                  return (
                    <Pressable
                      key={i}
                      onPress={() => toggle(i)}
                      style={[sc.row, {
                        borderColor: off ? theme.cardBorder : theme.accent + '55',
                        backgroundColor: off ? 'transparent' : theme.accent + '0e',
                        opacity: off ? 0.45 : 1,
                      }]}
                    >
                      <Text style={sc.rowEmoji}>{TYPE_EMOJI[c.type] ?? '📘'}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[sc.rowTitle, { color: theme.text }]} numberOfLines={1}>
                          {c.courseCode || c.courseName}{c.type && c.type !== 'Other' ? ` · ${c.type}` : ''}
                        </Text>
                        {!!c.courseName && c.courseName !== c.courseCode && (
                          <Text style={[sc.rowName, { color: theme.subtext }]} numberOfLines={1}>
                            {c.courseName}
                          </Text>
                        )}
                        <Text style={[sc.rowMeta, { color: theme.muted }]} numberOfLines={1}>
                          {c.day}  ·  {fmt(c.startTime)} – {fmt(c.endTime)}
                          {c.location ? `  ·  ${c.location}` : ''}
                        </Text>
                      </View>
                      <Text style={[sc.rowMark, { color: off ? theme.muted : theme.accent }]}>
                        {off ? '＋' : '✓'}
                      </Text>
                    </Pressable>
                  )
                })}
              </ScrollView>
              <View style={sc.actionRow}>
                <Pressable onPress={reset} hitSlop={8} style={sc.secondaryBtn}>
                  <Text style={[sc.secondaryText, { color: theme.subtext }]}>Rescan</Text>
                </Pressable>
                <Pressable
                  style={[sc.primaryBtn, { backgroundColor: theme.accent, flex: 1, marginTop: 0 }]}
                  onPress={confirm}
                >
                  <Text style={sc.primaryBtnText}>
                    Import {keptCount} class{keptCount === 1 ? '' : 'es'}
                  </Text>
                </Pressable>
              </View>
            </>
          )}

          <Pressable onPress={drag.close} hitSlop={8} style={sc.cancelBtn}>
            <Text style={[sc.cancelText, { color: theme.muted }]}>Cancel</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  )
}

const sc = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 8, paddingHorizontal: 24, paddingBottom: 36,
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 18 },
  title: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, marginBottom: 8 },
  body: { fontSize: 13.5, lineHeight: 20, fontWeight: '500', marginBottom: 16 },
  primaryBtn: {
    borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center',
    marginTop: 4, minHeight: 50,
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  busyNote: { fontSize: 12, fontWeight: '500', textAlign: 'center', marginTop: 10 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, borderWidth: 1.5, padding: 12, marginBottom: 8,
  },
  rowEmoji: { fontSize: 20 },
  rowTitle: { fontSize: 14.5, fontWeight: '700' },
  rowName:  { fontSize: 12, fontWeight: '500', marginTop: 1 },
  rowMeta:  { fontSize: 11.5, fontWeight: '600', marginTop: 3 },
  rowMark:  { fontSize: 17, fontWeight: '800' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  secondaryBtn: { paddingVertical: 14, paddingHorizontal: 8 },
  secondaryText: { fontSize: 14, fontWeight: '700' },
  cancelBtn: { alignItems: 'center', paddingTop: 14 },
  cancelText: { fontSize: 14, fontWeight: '600' },
})
