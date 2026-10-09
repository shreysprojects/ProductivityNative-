import { useState, useRef, useEffect } from 'react'
import {
  Modal, View, Text, TextInput, Pressable, ActivityIndicator, AppState, Linking,
  StyleSheet, SafeAreaView, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { MACRO_GROUPS } from './AddMealModal'

// A typed number: a decimal comma counts ("1,5" on a French keyboard).
function typedNumber(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

// Open Food Facts is edited by volunteers, so a number can be anything: a
// stray exponent (1e400 reads as Infinity), a minus sign, a typo. No real
// label comes near 5000 kcal, or 5 kg of anything, so every value is kept
// between 0 and that.
const MAX_LABEL_VALUE = 5000

function labelNumber(v) {
  const n = typedNumber(v)
  return n == null ? null : Math.min(MAX_LABEL_VALUE, Math.max(0, n))
}

// The pack's serving size in grams, or null when it has no usable one.
function servingGrams(qty) {
  const g = typedNumber(qty)
  return g > 0 && g <= MAX_LABEL_VALUE ? g : null
}

// What one portion is. With a serving size in grams, a serving. Without one
// the numbers are Open Food Facts' own per 100 g, so the portion is 100 g,
// not "1 serving" (a label that only has per-serving numbers stays a serving).
function portionBasis(n, servingQty) {
  const grams = servingGrams(servingQty)
  const per100g = !grams && ['energy-kcal', 'proteins', 'carbohydrates', 'fat']
    .some(k => labelNumber(n?.[`${k}_100g`]) != null)
  return { grams, per100g }
}

export function mapNutriments(n, servingQty) {
  const { grams, per100g } = portionBasis(n, servingQty)
  const get = (key) => {
    const srv = per100g ? null : labelNumber(n[`${key}_serving`])
    if (srv != null) return srv
    const p100 = labelNumber(n[`${key}_100g`])
    if (p100 != null) return grams ? Math.min(MAX_LABEL_VALUE, p100 * grams / 100) : p100
    return 0
  }
  return {
    calories:     Math.round(get('energy-kcal')),
    protein:      parseFloat((get('proteins') || get('protein')).toFixed(1)),
    carbs:        parseFloat(get('carbohydrates').toFixed(1)),
    fiber:        parseFloat(get('fiber').toFixed(1)),
    sugar:        parseFloat(get('sugars').toFixed(1)),
    fat:          parseFloat(get('fat').toFixed(1)),
    saturatedFat: parseFloat(get('saturated-fat').toFixed(1)),
    transFat:     parseFloat(get('trans-fat').toFixed(1)),
    sodium:       Math.round(get('sodium') * 1000),
    potassium:    Math.round(get('potassium') * 1000),
    cholesterol:  Math.round(get('cholesterol') * 1000),
    iron:         parseFloat((get('iron') * 1000).toFixed(1)),
    calcium:      Math.round(get('calcium') * 1000),
    vitaminC:     parseFloat((get('vitamin-c') * 1000).toFixed(1)),
  }
}

// How many portions a typed amount stands for: 0 or less is the smallest
// portion, anything unreadable is one.
const clampServings = n => Math.min(20, Math.max(0.25, Math.round(n * 100) / 100))
const servingsOf = text => {
  const n = typedNumber(text)
  return n == null ? 1 : clampServings(n)
}

function scaleMacros(base, servings) {
  const s = servingsOf(servings)
  const out = {}
  Object.entries(base).forEach(([k, v]) => {
    out[k] = k === 'calories' ? Math.round(v * s) : parseFloat((v * s).toFixed(1))
  })
  return out
}

function PortionSelector({ label, servings, onChange }) {
  return (
    <View style={bc.portionBox}>
      <Text style={bc.portionTitle}>Portion Size</Text>
      <View style={bc.portionRow}>
        <Pressable style={bc.portionStep} onPress={() => onChange(String(clampServings(servingsOf(servings) - 0.25)))}>
          <Text style={bc.portionStepText}>−</Text>
        </Pressable>
        <TextInput
          style={bc.portionInput}
          value={String(servings)}
          onChangeText={onChange}
          // Once typing stops the box shows the amount actually used.
          onEndEditing={() => {
            const used = String(servingsOf(servings))
            if (used !== String(servings)) onChange(used)
          }}
          keyboardType="decimal-pad"
          selectTextOnFocus
        />
        <Pressable style={bc.portionStep} onPress={() => onChange(String(clampServings(servingsOf(servings) + 0.25)))}>
          <Text style={bc.portionStepText}>+</Text>
        </Pressable>
        <Text style={bc.portionLabel}>× {label}</Text>
      </View>
    </View>
  )
}

// The name in whichever language the entry has one; plenty of products here
// only carry the English or the French field.
const nameOf = p => [p?.product_name, p?.product_name_en, p?.product_name_fr]
  .map(v => String(v ?? '').trim()).find(Boolean) ?? ''

const LOOKUP_TIMEOUT_MS = 12000

export default function BarcodeScanner({ section, sectionLabel, sectionColor, onAdd, onClose, onSearchInstead }) {
  const [permission, requestPermission, getPermission] = useCameraPermissions()
  const [scanned, setScanned] = useState(false)
  const [loading, setLoading] = useState(false)
  const [product, setProduct] = useState(null)
  const [baseMacros, setBaseMacros] = useState(null)
  const [servings, setServings] = useState('1')
  const [error, setError] = useState(null)
  const [showEditMacros, setShowEditMacros] = useState(false)
  const [editedMacros, setEditedMacros] = useState(null)
  // The camera reports a code on frame after frame. State only changes on
  // the next render, so a ref is what stops the second frame from starting
  // a second lookup.
  const busyRef = useRef(false)
  // The lookup under way ({ ctrl }). Its reply only counts while it is still
  // the current one: Scan Again or closing the scanner moves on from it.
  const lookupRef = useRef(null)

  useEffect(() => () => {
    lookupRef.current?.ctrl.abort()
    lookupRef.current = null
  }, [])

  // Android keeps the app running through a trip to Settings, so coming back
  // with camera access turned on has to be noticed here.
  useEffect(() => {
    if (!permission || permission.granted) return
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') getPermission().catch(() => {})
    })
    return () => sub.remove()
  }, [permission?.granted])   // eslint-disable-line react-hooks/exhaustive-deps

  async function askForCamera() {
    try {
      // Once access has been refused for good, asking again does nothing;
      // only the Settings app can turn it back on.
      if (permission?.canAskAgain === false) await Linking.openSettings()
      else await requestPermission()
    } catch {}
  }

  async function handleBarcode({ data }) {
    if (busyRef.current) return
    busyRef.current = true
    setScanned(true)
    setError(null)
    const code = String(data ?? '').trim()
    // Only a retail product code (8 to 14 digits) can be looked up; anything
    // else would also end up in the URL as it was read.
    if (!/^\d{8,14}$/.test(code)) {
      setError("That isn't a product barcode. Scan the barcode on the pack.")
      return
    }
    const lookup = { ctrl: new AbortController() }
    lookupRef.current = lookup
    const timer = setTimeout(() => lookup.ctrl.abort(), LOOKUP_TIMEOUT_MS)
    setLoading(true)
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(code)}.json`, { signal: lookup.ctrl.signal })
      const json = await res.json()
      if (lookupRef.current !== lookup) return
      if (json.status === 1 && json.product) {
        const p = json.product
        setProduct(p)
        setBaseMacros(mapNutriments(p.nutriments || {}, p.serving_quantity))
        setServings('1')
      } else {
        setError('Product not found in database.')
      }
    } catch {
      if (lookupRef.current !== lookup) return
      setError(lookup.ctrl.signal.aborted
        ? 'The lookup took too long — check your connection.'
        : 'Network error — check your connection.')
    } finally {
      clearTimeout(timer)
      if (lookupRef.current === lookup) setLoading(false)
    }
  }

  const reset = () => {
    lookupRef.current?.ctrl.abort()
    lookupRef.current = null
    busyRef.current = false
    setScanned(false); setLoading(false); setProduct(null); setBaseMacros(null); setError(null); setServings('1'); setShowEditMacros(false); setEditedMacros(null)
  }

  const basis = product ? portionBasis(product.nutriments, product.serving_quantity) : null
  const portionLabel = !basis ? '' : basis.grams ? (product.serving_size || `${basis.grams}g`)
    : basis.per100g ? '100 g' : (product.serving_size || '1 serving')

  const handleAdd = () => {
    if (!product || !baseMacros) return
    let final
    if (editedMacros) {
      final = {}
      Object.entries(editedMacros).forEach(([k, v]) => {
        const n = Math.max(0, typedNumber(v) ?? 0)
        final[k] = k === 'calories' ? Math.round(n) : parseFloat(n.toFixed(1))
      })
    } else {
      final = scaleMacros(baseMacros, servings)
    }
    const mult = servingsOf(servings)
    onAdd({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      name: nameOf(product) || 'Scanned Product',
      contents: [
        product.brands,
        basis.per100g ? `${Math.round(mult * 100)} g` : `${mult} serving${mult !== 1 ? 's' : ''}`,
        !basis.per100g && product.serving_size && `(${product.serving_size} each)`,
      ].filter(Boolean).join(' · '),
      section,
      macros: final,
    })
  }

  if (!permission) return null

  if (!permission.granted) {
    const blocked = permission.canAskAgain === false
    return (
      <Modal visible animationType="slide" onRequestClose={onClose}>
        <SafeAreaView style={bc.centered}>
          <Text style={bc.permEmoji}>📷</Text>
          <Text style={bc.permTitle}>Camera Access Needed</Text>
          <Text style={bc.permDesc}>
            {blocked
              ? 'Camera access is turned off for this app. Turn it on in Settings to scan product barcodes.'
              : 'Allow camera access to scan product barcodes.'}
          </Text>
          <Pressable style={[bc.bigBtn, { backgroundColor: sectionColor }]} onPress={askForCamera}>
            <Text style={bc.bigBtnText}>{blocked ? 'Open Settings' : 'Grant Access'}</Text>
          </Pressable>
          <Pressable onPress={onClose} style={{ marginTop: 14 }}>
            <Text style={bc.link}>Cancel</Text>
          </Pressable>
        </SafeAreaView>
      </Modal>
    )
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#000' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {!scanned && (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            onBarcodeScanned={scanned ? undefined : handleBarcode}
            // expo-camera's own names: one it doesn't know makes iOS drop the
            // whole list and scan every symbology, QR codes included.
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'] }}
          />
        )}

        {/* Drawn before the top bar, so ✕ stays in reach during a lookup. */}
        {loading && (
          <View style={bc.loadingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={bc.loadingText}>Looking up product…</Text>
          </View>
        )}

        <SafeAreaView style={bc.topBar}>
          <Pressable onPress={onClose} style={bc.closeBtn}>
            <Text style={bc.closeIcon}>✕</Text>
          </Pressable>
          <Text style={bc.topTitle}>Scan Barcode</Text>
          <View style={{ width: 40 }} />
        </SafeAreaView>

        {!scanned && (
          <View style={bc.frameArea}>
            <View style={bc.frame}>
              <View style={[bc.corner, bc.cTL]} />
              <View style={[bc.corner, bc.cTR]} />
              <View style={[bc.corner, bc.cBL]} />
              <View style={[bc.corner, bc.cBR]} />
            </View>
            <Text style={bc.frameHint}>Point at a product barcode</Text>
            {onSearchInstead && (
              <Pressable style={bc.searchInstead} onPress={onSearchInstead}>
                <Text style={bc.searchInsteadText}>✨  Describe it to AI instead</Text>
              </Pressable>
            )}
          </View>
        )}

        {!loading && error && (
          <View style={bc.resultSheet}>
            <Text style={bc.errorEmoji}>🔍</Text>
            <Text style={bc.errorTitle}>Not Found</Text>
            <Text style={bc.errorDesc}>{error}</Text>
            <Pressable style={[bc.bigBtn, { backgroundColor: sectionColor }]} onPress={reset}>
              <Text style={bc.bigBtnText}>Scan Again</Text>
            </Pressable>
            {onSearchInstead && (
              <Pressable onPress={onSearchInstead} style={{ marginTop: 12, alignItems: 'center' }}>
                <Text style={bc.link}>Describe it to AI instead</Text>
              </Pressable>
            )}
            <Pressable onPress={onClose} style={{ marginTop: 10, alignItems: 'center' }}>
              <Text style={bc.link}>Cancel</Text>
            </Pressable>
          </View>
        )}

        {!loading && product && baseMacros && (
          <View style={bc.resultSheet}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={bc.productName} numberOfLines={2}>{nameOf(product) || 'Unknown Product'}</Text>
              {!!product.brands && <Text style={bc.productBrand}>{product.brands}</Text>}

              <PortionSelector
                label={portionLabel}
                servings={servings}
                onChange={v => {
                  setServings(String(v))
                  if (showEditMacros) {
                    const newScaled = scaleMacros(baseMacros, v)
                    const out = {}
                    MACRO_GROUPS.forEach(g => g.fields.forEach(f => { out[f.key] = String(newScaled[f.key] ?? 0) }))
                    setEditedMacros(out)
                  }
                }}
              />

              {(() => {
                const scaled = scaleMacros(baseMacros, servings)
                const parsed = editedMacros
                  ? Object.fromEntries(Object.entries(editedMacros).map(([k, v]) => [k, typeof v === 'string' ? Math.max(0, typedNumber(v) ?? 0) : v]))
                  : null
                const display = parsed ?? scaled

                const initAllFields = (base) => {
                  const out = {}
                  MACRO_GROUPS.forEach(g => g.fields.forEach(f => { out[f.key] = String(base[f.key] ?? 0) }))
                  return out
                }

                return (
                  <>
                    <View style={bc.macroGrid}>
                      {[
                        { label: 'Calories', val: display.calories, unit: 'kcal', color: '#f59e0b' },
                        { label: 'Protein',  val: display.protein,  unit: 'g',    color: '#ef4444' },
                        { label: 'Carbs',    val: display.carbs,    unit: 'g',    color: '#10b981' },
                        { label: 'Fat',      val: display.fat,      unit: 'g',    color: '#3b82f6' },
                      ].map(item => (
                        <View key={item.label} style={bc.macroCell}>
                          <Text style={[bc.macroCellVal, { color: item.color }]}>
                            {item.val}<Text style={bc.macroCellUnit}> {item.unit}</Text>
                          </Text>
                          <Text style={bc.macroCellLabel}>{item.label}</Text>
                        </View>
                      ))}
                    </View>
                    <View style={bc.extraRow}>
                      {display.fiber > 0 && <Text style={bc.chip}>Fiber {display.fiber}g</Text>}
                      {display.sugar > 0 && <Text style={bc.chip}>Sugar {display.sugar}g</Text>}
                      {display.saturatedFat > 0 && <Text style={bc.chip}>Sat fat {display.saturatedFat}g</Text>}
                      {display.sodium > 0 && <Text style={bc.chip}>Sodium {display.sodium}mg</Text>}
                    </View>

                    <Pressable
                      style={bc.editToggle}
                      onPress={() => {
                        if (!showEditMacros) {
                          setEditedMacros(initAllFields(scaled))
                          setShowEditMacros(true)
                        } else {
                          setShowEditMacros(false)
                          setEditedMacros(null)
                        }
                      }}
                    >
                      <Text style={bc.editToggleText}>✏️  Edit macros before adding</Text>
                      <Text style={bc.editToggleArrow}>{showEditMacros ? '▲' : '▼'}</Text>
                    </Pressable>

                    {showEditMacros && editedMacros && (
                      <View style={bc.editSection}>
                        {MACRO_GROUPS.map(group => (
                          <View key={group.group}>
                            <Text style={bc.editGroupLabel}>{group.group.toUpperCase()}</Text>
                            <View style={bc.editGrid}>
                              {group.fields.map(field => (
                                <View key={field.key} style={[bc.editCell, field.sub && bc.editCellSub]}>
                                  <Text style={bc.editCellLabel}>{field.label}</Text>
                                  <View style={bc.editCellRow}>
                                    <TextInput
                                      style={bc.editCellInput}
                                      value={editedMacros[field.key] ?? '0'}
                                      onChangeText={v => setEditedMacros(prev => ({ ...prev, [field.key]: v }))}
                                      keyboardType="decimal-pad"
                                      selectTextOnFocus
                                    />
                                    <Text style={bc.editCellUnit}>{field.unit}</Text>
                                  </View>
                                </View>
                              ))}
                            </View>
                          </View>
                        ))}
                      </View>
                    )}
                  </>
                )
              })()}
            </ScrollView>

            <Pressable style={[bc.bigBtn, { backgroundColor: sectionColor, marginTop: 14 }]} onPress={handleAdd}>
              <Text style={bc.bigBtnText}>Add to {sectionLabel}</Text>
            </Pressable>
            <Pressable onPress={reset} style={{ marginTop: 10, alignItems: 'center' }}>
              <Text style={bc.link}>Scan Different Product</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  )
}

const CORNER = 22, THICK = 3

const bc = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#fff' },
  permEmoji: { fontSize: 48, marginBottom: 16 },
  permTitle: { fontSize: 22, fontWeight: '800', color: '#111', marginBottom: 10, textAlign: 'center' },
  permDesc: { fontSize: 15, color: '#666', textAlign: 'center', lineHeight: 22, marginBottom: 28 },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  closeIcon: { color: '#fff', fontSize: 18, fontWeight: '700' },
  topTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },

  frameArea: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: -60 },
  frame: { width: 240, height: 150 },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: '#fff' },
  cTL: { top: 0, left: 0, borderTopWidth: THICK, borderLeftWidth: THICK, borderTopLeftRadius: 4 },
  cTR: { top: 0, right: 0, borderTopWidth: THICK, borderRightWidth: THICK, borderTopRightRadius: 4 },
  cBL: { bottom: 0, left: 0, borderBottomWidth: THICK, borderLeftWidth: THICK, borderBottomLeftRadius: 4 },
  cBR: { bottom: 0, right: 0, borderBottomWidth: THICK, borderRightWidth: THICK, borderBottomRightRadius: 4 },
  frameHint: { color: 'rgba(255,255,255,0.7)', fontSize: 14, marginTop: 20, fontWeight: '500' },
  searchInstead: { marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20 },
  searchInsteadText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  resultSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 22, paddingBottom: 44, maxHeight: '75%',
  },
  errorEmoji: { fontSize: 36, textAlign: 'center', marginBottom: 8 },
  errorTitle: { fontSize: 20, fontWeight: '800', color: '#111', textAlign: 'center', marginBottom: 6 },
  errorDesc: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 24, lineHeight: 20 },

  productName: { fontSize: 19, fontWeight: '800', color: '#111', marginBottom: 3 },
  productBrand: { fontSize: 13, color: '#aaa', fontWeight: '500', marginBottom: 12 },

  portionBox: { backgroundColor: '#f6f7fb', borderRadius: 14, padding: 14, marginBottom: 14 },
  portionTitle: { fontSize: 11, fontWeight: '800', color: '#aaa', letterSpacing: 1, marginBottom: 8 },
  portionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  portionStep: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e5e7eb' },
  portionStepText: { fontSize: 20, color: '#333', fontWeight: '600', lineHeight: 24 },
  portionInput: { width: 56, height: 36, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, textAlign: 'center', fontSize: 16, fontWeight: '700', color: '#111', backgroundColor: '#fff' },
  portionLabel: { fontSize: 13, color: '#666', fontWeight: '500', flex: 1 },

  macroGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  macroCell: { alignItems: 'center', flex: 1 },
  macroCellVal: { fontSize: 20, fontWeight: '800' },
  macroCellUnit: { fontSize: 12, fontWeight: '600' },
  macroCellLabel: { fontSize: 10, color: '#aaa', fontWeight: '600', marginTop: 2 },

  extraRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  chip: { fontSize: 12, color: '#555', backgroundColor: '#f0f0f3', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4, fontWeight: '500' },

  bigBtn: { borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  bigBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  link: { fontSize: 14, color: '#888', textAlign: 'center', fontWeight: '500' },

  editToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 10, paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: '#f6f7fb', borderRadius: 10,
  },
  editToggleText: { fontSize: 13, fontWeight: '600', color: '#555' },
  editToggleArrow: { fontSize: 12, color: '#aaa', fontWeight: '700' },
  editSection: { marginTop: 8 },
  editGroupLabel: {
    fontSize: 10, fontWeight: '800', color: '#aaa', letterSpacing: 1.2,
    marginTop: 14, marginBottom: 8,
  },
  editGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  editCell: {
    width: '47%',
    backgroundColor: '#f9fafb', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: '#e5e7eb',
  },
  editCellSub: { backgroundColor: '#f4f4f6', borderColor: '#ebebef' },
  editCellLabel: { fontSize: 10, fontWeight: '700', color: '#aaa', letterSpacing: 0.6, marginBottom: 5 },
  editCellRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  editCellInput: {
    flex: 1, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 7,
    paddingHorizontal: 8, paddingVertical: 5, textAlign: 'right',
    fontSize: 15, fontWeight: '700', color: '#111', backgroundColor: '#fff',
  },
  editCellUnit: { fontSize: 11, color: '#999', fontWeight: '500', minWidth: 24 },
})
