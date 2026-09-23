import { useState, useEffect, useRef } from 'react'
import {
  Modal, View, Text, TextInput, Pressable, ScrollView, Image,
  StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import AIFoodEstimate from './AIFoodEstimate'
import { scanFood } from '../lib/aiFood'

// "Scan Meal" in the add-a-meal picker. The camera opens at once; the photo
// goes to the AI, which names the meal and what is on the plate and asks only
// what the photo cannot show (a sauce, how it was cooked, how much of the
// plate). Then the usual estimate flow prices every nutrient with the photo
// attached, and the meal is added like any other AI estimate.

export default function ScanMealModal({ section, sectionLabel, sectionColor, onAdd, onClose }) {
  const [photo, setPhoto] = useState(null)      // { uri, base64 }
  const [note, setNote] = useState('')
  const [phase, setPhase] = useState('pick')    // pick | scanning | estimate
  const [scan, setScan] = useState(null)        // { name, contents, portion, confidence, questions }
  const [error, setError] = useState(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  // Straight to the camera on open. Cancelling it leaves the pick screen,
  // which offers a retake or the photo library.
  useEffect(() => { takePhoto(true) }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  async function takePhoto(fromCamera) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (perm.status !== 'granted') {
      Alert.alert(
        'Permission needed',
        fromCamera ? 'Camera access is required to photograph the meal.' : 'Photo library access is required to pick a photo.'
      )
      return
    }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.8 })
    const asset = res.canceled ? null : res.assets?.[0]
    if (!asset || !alive.current) return
    try {
      // 1024px is plenty to read a plate and keeps the upload under the
      // proxy's size cap.
      const shrunk = await manipulateAsync(
        asset.uri,
        [{ resize: { width: Math.min(asset.width || 1024, 1024) } }],
        { compress: 0.7, format: SaveFormat.JPEG, base64: true }
      )
      if (!shrunk.base64) throw new Error('No image data')
      if (!alive.current) return
      const next = { uri: shrunk.uri, base64: shrunk.base64 }
      setPhoto(next)
      setScan(null)
      runScan(next)
    } catch (e) {
      Alert.alert('Could not use that photo', String(e?.message ?? e))
    }
  }

  async function runScan(p = photo) {
    if (!p) return
    setPhase('scanning')
    setError(null)
    try {
      const data = await scanFood({ base64: p.base64, note })
      if (!alive.current) return
      setScan(data)
      setPhase('estimate')
    } catch (e) {
      if (!alive.current) return
      setError(String(e?.message ?? e))
      setPhase('pick')
    }
  }

  // What the estimator is told, from the scan: the plate as read, the
  // portion seen and anything the user typed.
  const details = scan ? {
    ingredients: scan.contents ?? '',
    notes: [scan.portion ? `Portion seen in the photo: ${scan.portion}` : '', note.trim()].filter(Boolean).join(' · '),
  } : null

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>

          <View style={m.header}>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={m.cancel}>Cancel</Text>
            </Pressable>
            <Text style={m.headerTitle}>Scan Meal</Text>
            <View style={{ width: 56 }} />
          </View>

          {phase === 'estimate' && scan ? (
            <AIFoodEstimate
              query={scan.name}
              details={details}
              section={section}
              sectionLabel={sectionLabel}
              sectionColor={sectionColor}
              initialPhoto={photo}
              initialQuestions={scan.questions ?? []}
              autoEstimate
              kicker="📸 SCANNED"
              onAdd={onAdd}
              onBack={() => setPhase('pick')}
              backLabel="Retake or add a note"
            />
          ) : (
            <ScrollView contentContainerStyle={m.scroll} keyboardShouldPersistTaps="handled">
              <View style={[m.intro, { borderColor: sectionColor + '40', backgroundColor: sectionColor + '0d' }]}>
                <Text style={m.introIcon}>📸</Text>
                <Text style={m.introText}>
                  Photograph what you're eating for <Text style={{ color: sectionColor, fontWeight: '800' }}>{sectionLabel}</Text>.
                  The AI works out the meal from the picture and only asks about what it can't see.
                </Text>
              </View>

              {photo ? (
                <Image source={{ uri: photo.uri }} style={m.photo} resizeMode="cover" />
              ) : (
                <View style={m.photoEmpty}>
                  <Text style={m.photoEmptyIcon}>🍽️</Text>
                  <Text style={m.photoEmptyText}>No photo yet</Text>
                </View>
              )}

              {phase === 'scanning' ? (
                <View style={m.centered}>
                  <ActivityIndicator size="large" color={sectionColor} />
                  <Text style={m.loadingText}>Reading the photo…</Text>
                </View>
              ) : (
                <>
                  {!!error && (
                    <View style={m.errorBox}>
                      <Text style={m.errorText}>{error}</Text>
                    </View>
                  )}

                  <View style={m.photoBtnRow}>
                    <Pressable style={m.photoBtn} onPress={() => takePhoto(true)}>
                      <Text style={m.photoBtnText}>📷  {photo ? 'Retake' : 'Take photo'}</Text>
                    </Pressable>
                    <Pressable style={m.photoBtn} onPress={() => takePhoto(false)}>
                      <Text style={m.photoBtnText}>🖼  Choose photo</Text>
                    </Pressable>
                  </View>

                  <Text style={m.label}>ANYTHING THE PHOTO CAN'T SHOW (OPTIONAL)</Text>
                  <TextInput
                    style={m.input}
                    placeholder="e.g. cooked in butter, only eating half, oat milk latte"
                    placeholderTextColor="#bbb"
                    value={note}
                    onChangeText={setNote}
                    multiline
                    textAlignVertical="top"
                    maxLength={300}
                  />

                  <Pressable
                    style={[m.primaryBtn, { backgroundColor: photo ? sectionColor : '#e5e7eb' }]}
                    onPress={() => runScan()}
                    disabled={!photo}
                  >
                    <Text style={[m.primaryBtnText, { color: photo ? '#fff' : '#aaa' }]}>
                      {error ? 'Try again  ›' : 'Scan with AI  ›'}
                    </Text>
                  </Pressable>
                </>
              )}
              <View style={{ height: 40 }} />
            </ScrollView>
          )}
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
  cancel: { fontSize: 16, color: '#6366f1', fontWeight: '600', width: 56 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#111' },
  scroll: { paddingHorizontal: 18, paddingTop: 16 },

  intro: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 16 },
  introIcon: { fontSize: 18, lineHeight: 22 },
  introText: { flex: 1, fontSize: 13.5, lineHeight: 19, color: '#444', fontWeight: '500' },

  photo: { width: '100%', height: 240, borderRadius: 16, backgroundColor: '#eee', marginBottom: 12 },
  photoEmpty: {
    height: 160, borderRadius: 16, marginBottom: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#f6f7fb', borderWidth: 1.5, borderColor: '#e5e7eb', borderStyle: 'dashed',
  },
  photoEmptyIcon: { fontSize: 34 },
  photoEmptyText: { fontSize: 13, color: '#999', fontWeight: '600', marginTop: 6 },

  centered: { alignItems: 'center', paddingVertical: 32 },
  loadingText: { marginTop: 12, fontSize: 15, color: '#aaa' },

  errorBox: { backgroundColor: '#fef2f2', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#fecaca' },
  errorText: { fontSize: 13, color: '#b91c1c', fontWeight: '600', lineHeight: 18 },

  photoBtnRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  photoBtn: {
    flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center',
    backgroundColor: '#f6f7fb', borderWidth: 1, borderColor: '#e5e7eb',
  },
  photoBtnText: { fontSize: 14, fontWeight: '700', color: '#333' },

  label: { fontSize: 11, fontWeight: '800', color: '#aaa', letterSpacing: 1, marginBottom: 8 },
  input: {
    borderWidth: 1.5, borderColor: '#e0e7ff', borderRadius: 12, minHeight: 64,
    paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: '#111', backgroundColor: '#fafbff',
  },

  primaryBtn: { borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 18 },
  primaryBtnText: { fontSize: 17, fontWeight: '800' },
})
