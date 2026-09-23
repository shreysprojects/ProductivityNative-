import { useState, useEffect, useRef } from 'react'
import {
  View, Text, TextInput, Pressable, ScrollView, Image,
  ActivityIndicator, Alert, StyleSheet,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
// manipulateAsync is the older entry point (the contextual API is the newer
// one) but it is still supported in SDK 57 and is what the rest of the app
// uses for photo uploads.
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { clarifyFood, estimateFood } from '../lib/aiFood'

// The "Ask AI" path under the food search, also used by the "Describe to AI"
// meal logger. Three screens in one component: the model asks what it needs
// to know, the user answers (and may attach a photo), the estimate comes back
// with every nutrient the app tracks and can be added to the meal straight
// away. `details` ({ ingredients, servings, notes }) is what the meal logger
// collected up front; the search path has none.

const CHIPS = [
  ['fiber', 'Fiber', 'g'], ['sugar', 'Sugar', 'g'], ['saturatedFat', 'Sat fat', 'g'],
  ['sodium', 'Sodium', 'mg'], ['potassium', 'Potassium', 'mg'], ['cholesterol', 'Cholesterol', 'mg'],
  ['calcium', 'Calcium', 'mg'], ['iron', 'Iron', 'mg'], ['magnesium', 'Magnesium', 'mg'],
  ['vitaminA', 'Vitamin A', 'mcg'], ['vitaminC', 'Vitamin C', 'mg'], ['vitaminD', 'Vitamin D', 'mcg'],
  ['vitaminB12', 'Vitamin B12', 'mcg'], ['folate', 'Folate', 'mcg'],
]

const CONFIDENCE_COLOR = { high: '#10b981', medium: '#f59e0b', low: '#ef4444' }

function scaleMacros(macros, servings) {
  const mult = parseFloat(servings) || 1
  const out = {}
  Object.entries(macros ?? {}).forEach(([k, v]) => {
    const n = (Number(v) || 0) * mult
    out[k] = k === 'calories' ? Math.round(n) : Math.round(n * 10) / 10
  })
  return out
}

// `initialPhoto` ({ uri, base64 }) and `initialQuestions` come from the meal
// scanner, which has already looked at the plate and asked what it needs:
// they skip the clarify round-trip, and with `autoEstimate` an empty question
// list goes straight to the estimate.
export default function AIFoodEstimate({
  query, details, section, sectionLabel, sectionColor, onAdd, onBack, backLabel = 'Back to search',
  initialPhoto = null, initialQuestions = null, autoEstimate = false, kicker = '✨ ASK AI',
}) {
  const [step, setStep] = useState('asking')     // asking | answer | estimating | result
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})
  const [extra, setExtra] = useState('')
  const [photo, setPhoto] = useState(initialPhoto)   // { uri, base64 }
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [servings, setServings] = useState('1')
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  useEffect(() => { ask() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  async function ask() {
    setStep('asking')
    setError(null)
    if (Array.isArray(initialQuestions)) {
      // The scanner already asked; a clear photo goes straight to the numbers.
      setQuestions(initialQuestions)
      if (autoEstimate && initialQuestions.length === 0) { estimate(initialQuestions); return }
      setStep('answer')
      return
    }
    try {
      const data = await clarifyFood(query, details)
      if (!alive.current) return
      setQuestions(Array.isArray(data?.questions) ? data.questions : [])
      setStep('answer')
    } catch (e) {
      if (!alive.current) return
      // The questions are a convenience; the estimate can still be attempted
      // from the description alone.
      setQuestions([])
      setError(String(e?.message ?? e))
      setStep('answer')
    }
  }

  async function attachPhoto(fromCamera) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (perm.status !== 'granted') {
      Alert.alert(
        'Permission needed',
        fromCamera ? 'Camera access is required to take a photo.' : 'Photo library access is required to pick a photo.'
      )
      return
    }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.8 })
    const asset = res.canceled ? null : res.assets?.[0]
    if (!asset) return
    try {
      // Judging a portion does not need a big image; 1024px keeps the upload
      // small and well under the proxy's size cap.
      const shrunk = await manipulateAsync(
        asset.uri,
        [{ resize: { width: Math.min(asset.width || 1024, 1024) } }],
        { compress: 0.7, format: SaveFormat.JPEG, base64: true }
      )
      if (!shrunk.base64) throw new Error('No image data')
      setPhoto({ uri: shrunk.uri, base64: shrunk.base64 })
    } catch (e) {
      Alert.alert('Could not use that photo', String(e?.message ?? e))
    }
  }

  async function estimate(qs = questions) {
    setStep('estimating')
    setError(null)
    const qa = qs
      .map(q => ({ q: q.text, a: (answers[q.id] ?? '').trim() }))
      .filter(x => x.a)
    if (extra.trim()) qa.push({ q: 'Anything else', a: extra.trim() })
    try {
      const data = await estimateFood({ query, answers: qa, base64: photo?.base64, details })
      if (!alive.current) return
      setResult(data)
      setServings('1')
      setStep('result')
    } catch (e) {
      if (!alive.current) return
      setError(String(e?.message ?? e))
      setStep('answer')
    }
  }

  function add() {
    const mult = parseFloat(servings) || 1
    const portion = result.portion
      ? (mult === 1 ? result.portion : `${mult} × ${result.portion}`)
      : null
    onAdd({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      name: result.name || query,
      contents: [portion, result.contents, 'AI estimate'].filter(Boolean).join(' · '),
      section,
      macros: scaleMacros(result.macros, servings),
      aiEstimateId: result.estimateId ?? null,
      // Marks the food as an AI estimate wherever it shows up (log, plan,
      // history, saved meals) so the numbers are never mistaken for a label.
      source: 'ai',
    })
  }

  const scaled = result ? scaleMacros(result.macros, servings) : null

  return (
    <View style={{ flex: 1 }}>
      <Pressable onPress={onBack} style={a.backRow}>
        <Text style={a.backText}>‹  {backLabel}</Text>
      </Pressable>

      <ScrollView contentContainerStyle={a.scroll} keyboardShouldPersistTaps="handled">
        <View style={a.queryCard}>
          <Text style={a.queryKicker}>{kicker}</Text>
          <Text style={a.queryText}>“{query}”</Text>
          {!!details?.ingredients && <Text style={a.queryDetail} numberOfLines={4}>{details.ingredients}</Text>}
          {!!details?.servings && <Text style={a.queryDetail}>Amount eaten: {details.servings}</Text>}
          {!!details?.notes && <Text style={a.queryDetail} numberOfLines={3}>{details.notes}</Text>}
        </View>

        {step === 'asking' && (
          <View style={a.centered}>
            <ActivityIndicator size="large" color={sectionColor} />
            <Text style={a.loadingText}>Working out what to ask…</Text>
          </View>
        )}

        {step === 'estimating' && (
          <View style={a.centered}>
            <ActivityIndicator size="large" color={sectionColor} />
            <Text style={a.loadingText}>
              {photo ? 'Reading the photo and estimating nutrition…' : 'Estimating nutrition…'}
            </Text>
          </View>
        )}

        {step === 'answer' && (
          <>
            {!!error && (
              <View style={a.errorBox}>
                <Text style={a.errorText}>{error}</Text>
              </View>
            )}

            {questions.length > 0 ? (
              <Text style={a.sectionTitle}>A FEW QUICK QUESTIONS</Text>
            ) : (
              <Text style={a.sectionTitle}>{error ? 'DETAILS (OPTIONAL)' : 'THAT IS SPECIFIC ENOUGH. ANYTHING TO ADD?'}</Text>
            )}

            {questions.map(q => (
              <View key={q.id} style={a.qBlock}>
                <Text style={a.qText}>{q.text}</Text>
                <TextInput
                  style={a.input}
                  placeholder={q.hint || 'Your answer'}
                  placeholderTextColor="#bbb"
                  value={answers[q.id] ?? ''}
                  onChangeText={v => setAnswers(prev => ({ ...prev, [q.id]: v }))}
                  returnKeyType="done"
                />
              </View>
            ))}

            <View style={a.qBlock}>
              {questions.length > 0 && <Text style={a.qText}>Anything else? (optional)</Text>}
              <TextInput
                style={[a.input, a.inputMulti]}
                placeholder="e.g. cooked in a little olive oil, about a cereal bowl"
                placeholderTextColor="#bbb"
                value={extra}
                onChangeText={setExtra}
                multiline
                textAlignVertical="top"
              />
            </View>

            <Text style={a.sectionTitle}>PHOTO (OPTIONAL)</Text>
            {photo ? (
              <View style={a.photoWrap}>
                <Image source={{ uri: photo.uri }} style={a.photo} resizeMode="cover" />
                <Pressable onPress={() => setPhoto(null)} hitSlop={8} style={a.photoRemove}>
                  <Text style={a.photoRemoveText}>Remove photo</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <View style={a.photoBtnRow}>
                  <Pressable style={a.photoBtn} onPress={() => attachPhoto(true)}>
                    <Text style={a.photoBtnText}>📷  Take photo</Text>
                  </Pressable>
                  <Pressable style={a.photoBtn} onPress={() => attachPhoto(false)}>
                    <Text style={a.photoBtnText}>🖼  Choose photo</Text>
                  </Pressable>
                </View>
                <Text style={a.hint}>A photo helps the AI judge the portion and what is in it.</Text>
              </>
            )}

            <Pressable style={[a.primaryBtn, { backgroundColor: sectionColor }]} onPress={() => estimate()}>
              <Text style={a.primaryBtnText}>Get the macros</Text>
            </Pressable>
          </>
        )}

        {step === 'result' && result && scaled && (
          <>
            <View style={a.resultHeader}>
              <Text style={a.resultName}>{result.name || query}</Text>
              {!!result.portion && <Text style={a.resultPortion}>{result.portion}</Text>}
              {!!result.contents && <Text style={a.resultContents}>{result.contents}</Text>}
              <View style={a.badgeRow}>
                <Text style={[a.confBadge, { color: CONFIDENCE_COLOR[result.confidence] ?? '#f59e0b' }]}>
                  ● {result.confidence ?? 'medium'} confidence
                </Text>
                <Text style={a.aiBadge}>AI ESTIMATE</Text>
              </View>
              {!!result.notes && <Text style={a.notes}>{result.notes}</Text>}
            </View>

            <View style={a.portionBox}>
              <Text style={a.portionTitle}>HOW MANY OF THAT PORTION?</Text>
              <View style={a.portionRow}>
                <Pressable style={a.step} onPress={() => setServings(String(Math.max(0.25, (parseFloat(servings) || 1) - 0.25)))}>
                  <Text style={a.stepText}>−</Text>
                </Pressable>
                <TextInput
                  style={a.portionInput}
                  value={String(servings)}
                  onChangeText={setServings}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                />
                <Pressable style={a.step} onPress={() => setServings(((parseFloat(servings) || 1) + 0.25).toFixed(2))}>
                  <Text style={a.stepText}>+</Text>
                </Pressable>
                <Text style={a.portionLabel}>× {result.portion || 'the estimated portion'}</Text>
              </View>
            </View>

            <View style={a.macroGrid}>
              {[
                { label: 'Calories', val: scaled.calories, unit: 'kcal', color: '#f59e0b' },
                { label: 'Protein',  val: scaled.protein,  unit: 'g',    color: '#ef4444' },
                { label: 'Carbs',    val: scaled.carbs,    unit: 'g',    color: '#10b981' },
                { label: 'Fat',      val: scaled.fat,      unit: 'g',    color: '#3b82f6' },
              ].map(item => (
                <View key={item.label} style={a.macroCell}>
                  <Text style={[a.macroCellVal, { color: item.color }]}>
                    {item.val ?? 0}<Text style={a.macroCellUnit}> {item.unit}</Text>
                  </Text>
                  <Text style={a.macroCellLabel}>{item.label}</Text>
                </View>
              ))}
            </View>

            <View style={a.chipRow}>
              {CHIPS.filter(([k]) => (scaled[k] ?? 0) > 0).map(([k, label, unit]) => (
                <Text key={k} style={a.chip}>{label} {scaled[k]}{unit}</Text>
              ))}
            </View>
            <Text style={a.hint}>Every tracked nutrient is filled in, including the vitamins and minerals not shown here.</Text>

            <Pressable style={[a.primaryBtn, { backgroundColor: sectionColor }]} onPress={add}>
              <Text style={a.primaryBtnText}>Add to {sectionLabel}</Text>
            </Pressable>
            <Pressable style={a.secondaryBtn} onPress={() => setStep('answer')}>
              <Text style={a.secondaryBtnText}>Not right? Change the answers</Text>
            </Pressable>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  )
}

const a = StyleSheet.create({
  backRow: { paddingHorizontal: 18, paddingVertical: 12 },
  backText: { fontSize: 15, color: '#6366f1', fontWeight: '600' },
  scroll: { paddingHorizontal: 18, paddingTop: 4 },

  queryCard: { backgroundColor: '#f6f7fb', borderRadius: 14, padding: 14, marginBottom: 18 },
  queryKicker: { fontSize: 11, fontWeight: '800', color: '#6366f1', letterSpacing: 1, marginBottom: 4 },
  queryText: { fontSize: 18, fontWeight: '800', color: '#111' },
  queryDetail: { fontSize: 13, color: '#666', lineHeight: 18, marginTop: 6 },

  centered: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 24 },
  loadingText: { marginTop: 12, fontSize: 15, color: '#aaa', textAlign: 'center' },

  errorBox: { backgroundColor: '#fef2f2', borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#fecaca' },
  errorText: { fontSize: 13, color: '#b91c1c', fontWeight: '600', lineHeight: 18 },

  sectionTitle: { fontSize: 11, fontWeight: '800', color: '#aaa', letterSpacing: 1, marginBottom: 10, marginTop: 4 },
  qBlock: { marginBottom: 14 },
  qText: { fontSize: 15, fontWeight: '600', color: '#111', marginBottom: 8, lineHeight: 20 },
  input: {
    borderWidth: 1.5, borderColor: '#e0e7ff', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: '#111', backgroundColor: '#fafbff',
  },
  inputMulti: { minHeight: 68 },

  photoWrap: { marginBottom: 6 },
  photo: { width: '100%', height: 180, borderRadius: 14, backgroundColor: '#eee' },
  photoRemove: { paddingVertical: 8, alignSelf: 'flex-start' },
  photoRemoveText: { fontSize: 13, fontWeight: '700', color: '#ef4444' },
  photoBtnRow: { flexDirection: 'row', gap: 8 },
  photoBtn: {
    flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center',
    backgroundColor: '#f6f7fb', borderWidth: 1, borderColor: '#e5e7eb',
  },
  photoBtnText: { fontSize: 14, fontWeight: '700', color: '#333' },
  hint: { fontSize: 12, color: '#999', marginTop: 8, lineHeight: 17 },

  primaryBtn: { borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 22 },
  primaryBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  secondaryBtn: { paddingVertical: 14, alignItems: 'center' },
  secondaryBtnText: { fontSize: 14, fontWeight: '600', color: '#6366f1' },

  resultHeader: { marginBottom: 14 },
  resultName: { fontSize: 20, fontWeight: '800', color: '#111', marginBottom: 3 },
  resultPortion: { fontSize: 14, color: '#555', fontWeight: '600', marginBottom: 2 },
  resultContents: { fontSize: 13, color: '#888', lineHeight: 18 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  confBadge: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  aiBadge: { fontSize: 9, fontWeight: '800', color: '#fff', backgroundColor: '#6366f1', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  notes: { fontSize: 12.5, color: '#777', fontStyle: 'italic', marginTop: 8, lineHeight: 17 },

  portionBox: { backgroundColor: '#f6f7fb', borderRadius: 14, padding: 14, marginBottom: 16 },
  portionTitle: { fontSize: 11, fontWeight: '800', color: '#aaa', letterSpacing: 1, marginBottom: 8 },
  portionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  step: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e5e7eb' },
  stepText: { fontSize: 20, color: '#333', fontWeight: '600', lineHeight: 24 },
  portionInput: { width: 56, height: 36, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, textAlign: 'center', fontSize: 16, fontWeight: '700', color: '#111', backgroundColor: '#fff' },
  portionLabel: { fontSize: 13, color: '#666', fontWeight: '500', flex: 1 },

  macroGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  macroCell: { alignItems: 'center', flex: 1 },
  macroCellVal: { fontSize: 22, fontWeight: '800' },
  macroCellUnit: { fontSize: 13, fontWeight: '600' },
  macroCellLabel: { fontSize: 11, color: '#aaa', fontWeight: '600', marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { fontSize: 12, color: '#555', backgroundColor: '#f0f0f3', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4, fontWeight: '500' },
})
