import { Modal, View, Text, Pressable, StyleSheet, Animated } from 'react-native'
import { useSheetDrag } from '../lib/useSheetDrag'

// How to add a meal: a grid of tiles, the name above each icon. Same keys
// the Meals page's AddMealFlows switches on.
const OPTIONS = [
  { key: 'scan',    icon: '📸', title: 'Scan Meal' },
  { key: 'barcode', icon: '📷', title: 'Scan Barcode' },
  { key: 'ai',      icon: '✨', title: 'Describe to AI' },
  { key: 'history', icon: '🕐', title: 'From History' },
  { key: 'saved',   icon: '⭐', title: 'Saved Meals' },
  { key: 'snacks',  icon: '🍪', title: 'Saved Snacks' },
  { key: 'manual',  icon: '✏️', title: 'Log Manually' },
]

export default function MealPickerSheet({ sectionLabel, sectionColor, onSelect, onClose }) {
  const drag = useSheetDrag(onClose)
  return (
    <Modal visible transparent animationType="slide" onRequestClose={drag.close}>
      <View style={p.overlay}>
        <Animated.View pointerEvents="none" style={[p.overlayBg, { opacity: drag.backdrop }]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={drag.close} />
        <Animated.View style={[p.sheet, { transform: [{ translateY: drag.dragY }] }]}>
          <View {...drag.handlePan.panHandlers} style={drag.grabStyle}>
            <View style={p.handle} />
            <Text style={p.title}>Add to <Text style={{ color: sectionColor }}>{sectionLabel}</Text></Text>
          </View>

          <View style={p.grid}>
            {OPTIONS.map(opt => (
              <Pressable
                key={opt.key}
                style={({ pressed }) => [p.tile, { backgroundColor: sectionColor + (pressed ? '30' : '12'), borderColor: sectionColor + '33' }]}
                onPress={() => onSelect(opt.key)}
              >
                <Text style={p.tileTitle} numberOfLines={2}>{opt.title}</Text>
                <Text style={p.tileIcon}>{opt.icon}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable style={p.cancelBtn} onPress={drag.close}>
            <Text style={p.cancelText}>Cancel</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  )
}

const p = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  overlayBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingBottom: 36, paddingTop: 12,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: '#e0e0e0',
    alignSelf: 'center', marginBottom: 18,
  },
  title: {
    fontSize: 18, fontWeight: '800', color: '#111',
    paddingHorizontal: 22, marginBottom: 14,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 18 },
  tile: {
    flexBasis: '30%', flexGrow: 1, borderRadius: 18, borderWidth: 1,
    paddingVertical: 16, paddingHorizontal: 8, alignItems: 'center', gap: 10,
  },
  tileTitle: { fontSize: 13, fontWeight: '700', color: '#111', textAlign: 'center', lineHeight: 17, minHeight: 34 },
  tileIcon: { fontSize: 30 },
  cancelBtn: {
    marginTop: 16, marginHorizontal: 22, paddingVertical: 15,
    borderRadius: 16, backgroundColor: '#f0f0f3', alignItems: 'center',
  },
  cancelText: { fontSize: 16, fontWeight: '700', color: '#444' },
})
