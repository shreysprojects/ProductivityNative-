import { View, Text, Pressable, Modal, StyleSheet, Animated } from 'react-native'
import { useTheme } from '../lib/ThemeContext'
import { useSheetDrag } from '../lib/useSheetDrag'

// Asks whether a class that has already finished was actually attended. A yes
// writes it onto the time log; a no is remembered so the same class is never
// asked about twice. Classes are asked about one at a time.

function fmt(t) {
  const [h, m] = String(t ?? '').split(':').map(Number)
  if (!Number.isFinite(h)) return ''
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

export default function ClassAttendancePrompt({
  item, index = 0, total = 1, onAttended, onSkipped, onClose,
}) {
  const { theme } = useTheme()
  // Pulling the sheet down means "ask me later", like tapping outside it.
  const drag = useSheetDrag(onClose)
  if (!item) return null

  return (
    <Modal visible transparent animationType="slide" onRequestClose={drag.close}>
      <View style={ap.wrap}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={drag.close} />
        <Animated.View style={[ap.sheet, { backgroundColor: theme.card, transform: [{ translateY: drag.dragY }] }]}>
          <View {...drag.handlePan.panHandlers} style={drag.grabStyle}>
            <View style={[ap.handle, { backgroundColor: theme.divider }]} />
            <Text style={[ap.title, { color: theme.text }]}>Did you attend this class?</Text>
            {total > 1 && (
              <Text style={[ap.counter, { color: theme.muted }]}>{index + 1} of {total}</Text>
            )}
          </View>

          <View style={[ap.card, {
            backgroundColor: (item.color ?? theme.accent) + (theme.isDark ? '24' : '14'),
            borderLeftColor: item.color ?? theme.accent,
          }]}>
            <Text style={[ap.cardTitle, { color: theme.text }]} numberOfLines={2}>{item.title}</Text>
            <Text style={[ap.cardMeta, { color: theme.subtext }]} numberOfLines={2}>
              {fmt(item.startTime)} – {fmt(item.endTime)}
              {item.location ? `  ·  ${item.location}` : ''}
            </Text>
          </View>

          <Text style={[ap.body, { color: theme.subtext }]}>
            Saying yes adds it to your time log. You can delete it from the log any time.
          </Text>

          <Pressable style={[ap.yesBtn, { backgroundColor: theme.accent }]} onPress={onAttended}>
            <Text style={ap.yesText}>Yes, I attended</Text>
          </Pressable>

          <Pressable style={[ap.noBtn, { borderColor: theme.cardBorder }]} onPress={onSkipped}>
            <Text style={[ap.noText, { color: theme.subtext }]}>No, I missed it</Text>
          </Pressable>

          <Pressable onPress={drag.close} hitSlop={8} style={ap.laterBtn}>
            <Text style={[ap.laterText, { color: theme.muted }]}>Ask me later</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  )
}

const ap = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 8, paddingHorizontal: 24, paddingBottom: 34,
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 18 },
  title: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  counter: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  card: {
    borderRadius: 14, borderLeftWidth: 4, padding: 14, marginTop: 16,
  },
  cardTitle: { fontSize: 15.5, fontWeight: '800' },
  cardMeta: { fontSize: 12.5, fontWeight: '600', marginTop: 4 },
  body: { fontSize: 12.5, lineHeight: 18, fontWeight: '500', marginTop: 14 },
  yesBtn: {
    borderRadius: 16, paddingVertical: 15, alignItems: 'center', marginTop: 16, minHeight: 50,
    justifyContent: 'center',
  },
  yesText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  noBtn: {
    borderRadius: 16, borderWidth: 1.5, paddingVertical: 14, alignItems: 'center', marginTop: 10,
  },
  noText: { fontWeight: '700', fontSize: 14.5 },
  laterBtn: { alignItems: 'center', paddingTop: 14 },
  laterText: { fontSize: 13.5, fontWeight: '600' },
})
