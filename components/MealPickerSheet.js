import { Modal, View, Text, Pressable, StyleSheet, TouchableWithoutFeedback } from 'react-native'

const OPTIONS = [
  {
    key: 'barcode',
    icon: '📷',
    title: 'Scan Barcode',
    desc: 'Auto-fill nutrition facts from any packaged food',
  },
  {
    key: 'search',
    icon: '🔍',
    title: 'Search Food Database',
    desc: 'Search millions of foods by name, or ask AI to estimate what you ate',
  },
  {
    key: 'history',
    icon: '🕐',
    title: 'From History',
    desc: 'Re-add a meal you\'ve logged before',
  },
  {
    key: 'saved',
    icon: '⭐',
    title: 'Saved Meals',
    desc: 'Pick from your custom templates with ingredients & notes',
  },
  {
    key: 'manual',
    icon: '✏️',
    title: 'Log Manually',
    desc: 'Enter meal name and macros yourself',
  },
]

export default function MealPickerSheet({ sectionLabel, sectionColor, onSelect, onClose }) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={p.overlay}>
          <TouchableWithoutFeedback>
            <View style={p.sheet}>
              <View style={p.handle} />
              <Text style={p.title}>Add to <Text style={{ color: sectionColor }}>{sectionLabel}</Text></Text>

              {OPTIONS.map((opt, i) => (
                <Pressable
                  key={opt.key}
                  style={[p.row, i < OPTIONS.length - 1 && p.rowBorder]}
                  onPress={() => onSelect(opt.key)}
                >
                  <View style={[p.iconWrap, { backgroundColor: sectionColor + '18' }]}>
                    <Text style={p.icon}>{opt.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={p.rowTitle}>{opt.title}</Text>
                    <Text style={p.rowDesc}>{opt.desc}</Text>
                  </View>
                  <Text style={[p.arrow, { color: sectionColor }]}>›</Text>
                </Pressable>
              ))}

              <Pressable style={p.cancelBtn} onPress={onClose}>
                <Text style={p.cancelText}>Cancel</Text>
              </Pressable>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  )
}

const p = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
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
    paddingHorizontal: 22, marginBottom: 6,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 22, paddingVertical: 16,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#f5f5f7' },
  iconWrap: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  icon: { fontSize: 22 },
  rowTitle: { fontSize: 16, fontWeight: '700', color: '#111', marginBottom: 2 },
  rowDesc: { fontSize: 13, color: '#999', lineHeight: 18 },
  arrow: { fontSize: 24, fontWeight: '300' },
  cancelBtn: {
    marginHorizontal: 22, marginTop: 10,
    paddingVertical: 14, borderRadius: 14,
    backgroundColor: '#f5f5f7', alignItems: 'center',
  },
  cancelText: { fontSize: 16, fontWeight: '600', color: '#666' },
})
