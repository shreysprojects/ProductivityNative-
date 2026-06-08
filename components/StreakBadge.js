import { View, Text, StyleSheet } from 'react-native'

export default function StreakBadge({ streak }) {
  if (streak.current === 0) return null
  return (
    <View style={s.badge}>
      <Text style={s.fire}>🔥</Text>
      <View>
        <Text style={s.num}>{streak.current}-day streak</Text>
        <Text style={s.sub}>Best: {streak.longest} days</Text>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff7ed', borderRadius: 12, padding: 12,
    marginBottom: 14, borderWidth: 1, borderColor: '#fed7aa',
  },
  fire: { fontSize: 28 },
  num: { fontSize: 16, fontWeight: '700', color: '#c2410c' },
  sub: { fontSize: 12, color: '#ea580c', marginTop: 1 },
})
