import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useProductivity } from '../lib/ProductivityContext'
import { useTheme } from '../lib/ThemeContext'

function fmtSeconds(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
}

export default function SessionBanner() {
  const { activeSession, elapsedSeconds, isPaused, pause, resume, openSession } = useProductivity()
  const { theme } = useTheme()

  if (!activeSession) return null

  const goalSecs = (activeSession.goalMins ?? 60) * 60
  const overtime = elapsedSeconds > goalSecs

  return (
    <Pressable
      style={[s.banner, { backgroundColor: overtime ? '#10b981' : '#6366f1' }]}
      onPress={openSession}
    >
      <View style={s.left}>
        <View style={[s.dot, { backgroundColor: isPaused ? '#fbbf24' : '#fff' }]} />
        <Text style={s.task} numberOfLines={1}>
          {activeSession.taskDesc || 'Productivity Session'}
        </Text>
      </View>

      <View style={s.right}>
        <Text style={s.time}>{fmtSeconds(elapsedSeconds)}</Text>
        <Pressable
          style={s.controlBtn}
          onPress={isPaused ? resume : pause}
          hitSlop={10}
        >
          <Text style={s.controlIcon}>{isPaused ? '▶' : '⏸'}</Text>
        </Pressable>
      </View>
    </Pressable>
  )
}

const s = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  task: { fontSize: 13, fontWeight: '600', color: '#fff', flex: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  time: {
    fontSize: 14, fontWeight: '800', color: '#fff',
    fontVariant: ['tabular-nums'], letterSpacing: 0.5,
  },
  controlBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  controlIcon: { fontSize: 11, color: '#fff' },
})
