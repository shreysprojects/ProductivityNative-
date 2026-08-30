import { Modal, View, Text, Pressable, StyleSheet } from 'react-native'
import { Image } from 'expo-image'

// A full-screen look at a routine photo. Used from the routine editor and from
// both run views, all of which put their photos inside rows that do something
// else when tapped — so the photo has to own its own tap.
//
// Pass uri = null to keep it closed. Tapping the backdrop, the photo, the ✕, or
// the Android back button all close it.
export default function ImageViewerModal({ uri, onClose }) {
  return (
    <Modal
      visible={!!uri}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={s.backdrop} onPress={onClose}>
        {!!uri && (
          <Image
            source={{ uri }}
            style={s.image}
            contentFit="contain"
            transition={150}
          />
        )}
        <View style={s.closeBtn} pointerEvents="none">
          <Text style={s.closeText}>✕</Text>
        </View>
        <Text style={s.hint}>Tap anywhere to close</Text>
      </Pressable>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.94)',
    alignItems: 'center', justifyContent: 'center',
  },
  image: { width: '100%', height: '80%' },
  closeBtn: {
    position: 'absolute', top: 54, right: 20,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },
  closeText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  hint: {
    position: 'absolute', bottom: 46,
    color: 'rgba(255,255,255,0.5)', fontSize: 12.5, fontWeight: '600',
  },
})
