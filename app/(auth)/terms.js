import { View, Text, Pressable, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../lib/ThemeContext'

export default function Terms() {
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <View style={[s.page, { backgroundColor: theme.bg }]}>
      <View style={[s.header, { paddingTop: insets.top + 8, borderBottomColor: theme.divider, backgroundColor: theme.header }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
          <Text style={[s.backText, { color: theme.accent }]}>← Back</Text>
        </Pressable>
        <Text style={[s.title, { color: theme.text }]} numberOfLines={1}>Terms &amp; Conditions</Text>
        <View style={s.headerRight} />
      </View>

      {/* Content intentionally left blank — to be filled in later. */}
    </View>
  )
}

const s = StyleSheet.create({
  page: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { minWidth: 70 },
  backText: { fontSize: 16, fontWeight: '600' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700' },
  headerRight: { minWidth: 70 },
})
