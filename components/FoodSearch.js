import { useState } from 'react'
import {
  Modal, View, Text, TextInput, Pressable, ScrollView,
  ActivityIndicator, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform,
} from 'react-native'
import { mapNutriments } from './BarcodeScanner'

// ── USDA FoodData Central normalization ────────────────────────────────────
function normalizeUSDA(food) {
  const getN = (name) => {
    const match = food.foodNutrients?.find(n => n.nutrientName === name)
    if (!match) return 0
    if (match.unitName === 'MG') return match.value / 1000   // mg→g
    if (match.unitName === 'UG') return match.value / 1e6    // μg→g
    return match.value || 0
  }
  const kcal = food.foodNutrients?.find(n => n.nutrientName === 'Energy' && n.unitName === 'KCAL')?.value || 0
  const servingQty = food.servingSize || 100
  return {
    code: `usda_${food.fdcId}`,
    product_name: food.description,
    brands: food.brandName || food.brandOwner || null,
    serving_size: servingQty ? `${Math.round(servingQty)}${food.servingSizeUnit || 'g'}` : null,
    serving_quantity: servingQty,
    source: 'USDA',
    nutriments: {
      'energy-kcal_100g': kcal,
      'proteins_100g': getN('Protein'),
      'carbohydrates_100g': getN('Carbohydrate, by difference'),
      'fat_100g': getN('Total lipid (fat)'),
      'fiber_100g': getN('Fiber, total dietary'),
      'sugars_100g': getN('Sugars, total including NLEA') || getN('Sugars, total'),
      'saturated-fat_100g': getN('Fatty acids, total saturated'),
      'sodium_100g': getN('Sodium, Na'),
      'potassium_100g': getN('Potassium, K'),
      'calcium_100g': getN('Calcium, Ca'),
      'iron_100g': getN('Iron, Fe'),
      'vitamin-c_100g': getN('Vitamin C, total ascorbic acid'),
      'cholesterol_100g': getN('Cholesterol'),
    },
  }
}

// ── API search functions ───────────────────────────────────────────────────
function timedFetch(url, ms = 10000) {
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), ms)
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(tid))
}

async function searchOFF(query) {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?action=process&search_terms=${encodeURIComponent(query)}&search_simple=1&json=1&page_size=20`
  const res = await timedFetch(url)
  const json = await res.json()
  return (json.products || [])
    .filter(p => (p.product_name || p.product_name_en)?.trim())
    .map(p => ({ ...p, product_name: p.product_name || p.product_name_en, source: 'OFF' }))
}

async function searchUSDA(query) {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&api_key=DEMO_KEY&pageSize=20&dataType=Branded,Foundation,SR%20Legacy`
  const res = await timedFetch(url)
  const json = await res.json()
  return (json.foods || []).filter(f => f.description?.trim()).map(normalizeUSDA)
}

// ── Shared helpers ─────────────────────────────────────────────────────────
function scaleMacros(base, servings) {
  const s = parseFloat(servings) || 1
  const out = {}
  Object.entries(base).forEach(([k, v]) => {
    out[k] = k === 'calories' ? Math.round(v * s) : parseFloat((v * s).toFixed(1))
  })
  return out
}

function PortionSelector({ servingSize, servings, onChange }) {
  return (
    <View style={fs.portionBox}>
      <Text style={fs.portionTitle}>PORTION SIZE</Text>
      <View style={fs.portionRow}>
        <Pressable style={fs.step} onPress={() => onChange(Math.max(0.25, (parseFloat(servings) || 1) - 0.25))}>
          <Text style={fs.stepText}>−</Text>
        </Pressable>
        <TextInput
          style={fs.portionInput}
          value={String(servings)}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          selectTextOnFocus
        />
        <Pressable style={fs.step} onPress={() => onChange(((parseFloat(servings) || 1) + 0.25).toFixed(2))}>
          <Text style={fs.stepText}>+</Text>
        </Pressable>
        <Text style={fs.portionLabel}>× {servingSize || '1 serving'}</Text>
      </View>
    </View>
  )
}

// ── Product detail view ────────────────────────────────────────────────────
function ProductDetail({ product, baseMacros, servings, setServings, sectionLabel, sectionColor, onAdd, onBack }) {
  const m = scaleMacros(baseMacros, servings)
  return (
    <View style={{ flex: 1 }}>
      <Pressable onPress={onBack} style={fs.backRow}>
        <Text style={fs.backText}>‹  Back to results</Text>
      </Pressable>
      <ScrollView contentContainerStyle={fs.detailScroll} keyboardShouldPersistTaps="handled">
        <View style={fs.detailHeader}>
          <Text style={fs.detailName}>{product.product_name || 'Unknown'}</Text>
          {!!product.brands && <Text style={fs.detailBrand}>{product.brands}</Text>}
          {product.source === 'USDA' && <Text style={fs.sourceBadge}>USDA FoodData Central</Text>}
        </View>

        <PortionSelector
          servingSize={product.serving_size}
          servings={servings}
          onChange={v => setServings(String(v))}
        />

        <View style={fs.macroGrid}>
          {[
            { label: 'Calories', val: m.calories, unit: 'kcal', color: '#f59e0b' },
            { label: 'Protein',  val: m.protein,  unit: 'g',    color: '#ef4444' },
            { label: 'Carbs',    val: m.carbs,    unit: 'g',    color: '#10b981' },
            { label: 'Fat',      val: m.fat,      unit: 'g',    color: '#3b82f6' },
          ].map(item => (
            <View key={item.label} style={fs.macroCell}>
              <Text style={[fs.macroCellVal, { color: item.color }]}>
                {item.val}<Text style={fs.macroCellUnit}> {item.unit}</Text>
              </Text>
              <Text style={fs.macroCellLabel}>{item.label}</Text>
            </View>
          ))}
        </View>

        <View style={fs.extraRow}>
          {m.fiber > 0 && <Text style={fs.chip}>Fiber {m.fiber}g</Text>}
          {m.sugar > 0 && <Text style={fs.chip}>Sugar {m.sugar}g</Text>}
          {m.saturatedFat > 0 && <Text style={fs.chip}>Sat fat {m.saturatedFat}g</Text>}
          {m.sodium > 0 && <Text style={fs.chip}>Sodium {m.sodium}mg</Text>}
          {m.potassium > 0 && <Text style={fs.chip}>Potassium {m.potassium}mg</Text>}
          {m.iron > 0 && <Text style={fs.chip}>Iron {m.iron}mg</Text>}
          {m.calcium > 0 && <Text style={fs.chip}>Calcium {m.calcium}mg</Text>}
          {m.vitaminC > 0 && <Text style={fs.chip}>Vitamin C {m.vitaminC}mg</Text>}
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      <View style={fs.detailFooter}>
        <Pressable style={[fs.addBtn, { backgroundColor: sectionColor }]} onPress={() => onAdd(m)}>
          <Text style={fs.addBtnText}>Add to {sectionLabel}</Text>
        </Pressable>
      </View>
    </View>
  )
}

// ── Main export ────────────────────────────────────────────────────────────
export default function FoodSearch({ section, sectionLabel, sectionColor, onAdd, onClose }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [offFailed, setOffFailed] = useState(false)
  const [usdaFailed, setUsdaFailed] = useState(false)
  const [selected, setSelected] = useState(null)
  const [baseMacros, setBaseMacros] = useState(null)
  const [servings, setServings] = useState('1')

  const search = async () => {
    if (!query.trim()) return
    setLoading(true)
    setSearched(true)
    setResults([])
    setOffFailed(false)
    setUsdaFailed(false)

    const [offResult, usdaResult] = await Promise.allSettled([
      searchOFF(query.trim()),
      searchUSDA(query.trim()),
    ])

    const off = offResult.status === 'fulfilled' ? offResult.value : []
    const usda = usdaResult.status === 'fulfilled' ? usdaResult.value : []

    if (offResult.status === 'rejected') setOffFailed(true)
    if (usdaResult.status === 'rejected') setUsdaFailed(true)

    // Interleave: OFF and USDA side-by-side for variety
    const combined = []
    const max = Math.max(off.length, usda.length)
    for (let i = 0; i < max; i++) {
      if (i < off.length) combined.push(off[i])
      if (i < usda.length) combined.push(usda[i])
    }
    setResults(combined)
    setLoading(false)
  }

  const selectProduct = (product) => {
    const mapped = mapNutriments(product.nutriments || {}, product.serving_quantity)
    setSelected(product)
    setBaseMacros(mapped)
    setServings('1')
  }

  const handleAdd = (scaledMacros) => {
    onAdd({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      name: selected.product_name || 'Food Item',
      contents: [
        selected.brands,
        `${parseFloat(servings) || 1} serving${parseFloat(servings) !== 1 ? 's' : ''}`,
        selected.serving_size && `(${selected.serving_size} each)`,
      ].filter(Boolean).join(' · '),
      section,
      macros: scaledMacros,
    })
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>

          <View style={fs.header}>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={fs.cancel}>Cancel</Text>
            </Pressable>
            <Text style={fs.headerTitle}>Search Foods</Text>
            <View style={{ width: 56 }} />
          </View>

          <View style={fs.searchBar}>
            <TextInput
              style={fs.searchInput}
              placeholder="e.g. Greek yogurt, chicken breast…"
              placeholderTextColor="#bbb"
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={search}
              returnKeyType="search"
              autoFocus={!selected}
            />
            <Pressable
              style={[fs.searchBtn, { backgroundColor: query.trim() ? sectionColor : '#e5e7eb' }]}
              onPress={search}
              disabled={!query.trim() || loading}
            >
              <Text style={[fs.searchBtnText, { color: query.trim() ? '#fff' : '#aaa' }]}>
                {loading ? '…' : 'Search'}
              </Text>
            </Pressable>
          </View>

          {selected && baseMacros ? (
            <ProductDetail
              product={selected}
              baseMacros={baseMacros}
              servings={servings}
              setServings={setServings}
              sectionLabel={sectionLabel}
              sectionColor={sectionColor}
              onAdd={handleAdd}
              onBack={() => { setSelected(null); setBaseMacros(null) }}
            />
          ) : (
            <ScrollView contentContainerStyle={fs.list} keyboardShouldPersistTaps="handled">
              {loading && (
                <View style={fs.centered}>
                  <ActivityIndicator size="large" color={sectionColor} />
                  <Text style={fs.loadingText}>Searching Open Food Facts + USDA…</Text>
                </View>
              )}

              {!loading && searched && results.length === 0 && (
                <View style={fs.centered}>
                  <Text style={fs.emptyEmoji}>{offFailed && usdaFailed ? '⚠️' : '🔍'}</Text>
                  <Text style={fs.emptyTitle}>{offFailed && usdaFailed ? 'Connection error' : 'No results found'}</Text>
                  <Text style={fs.emptyDesc}>
                    {offFailed && usdaFailed
                      ? 'Could not reach food databases. Check your internet connection and try again.'
                      : 'Try different keywords or scan the product barcode instead.'}
                  </Text>
                  {(offFailed || usdaFailed) && results.length === 0 && (
                    <Text style={fs.failedApis}>
                      {[offFailed && 'Open Food Facts', usdaFailed && 'USDA'].filter(Boolean).join(' & ')} unavailable
                    </Text>
                  )}
                </View>
              )}

              {!loading && !searched && (
                <View style={fs.centered}>
                  <Text style={fs.emptyEmoji}>🥗</Text>
                  <Text style={fs.emptyTitle}>Search any food</Text>
                  <Text style={fs.emptyDesc}>Searches Open Food Facts and USDA FoodData Central — packaged foods, whole foods, restaurant items and more.</Text>
                </View>
              )}

              {!loading && (offFailed || usdaFailed) && results.length > 0 && (
                <Text style={fs.partialNotice}>
                  {offFailed ? 'Open Food Facts' : 'USDA'} unavailable — showing partial results
                </Text>
              )}

              {!loading && results.map((product, i) => {
                const macros = mapNutriments(product.nutriments || {}, product.serving_quantity)
                return (
                  <Pressable key={product.code || i} style={fs.resultCard} onPress={() => selectProduct(product)}>
                    <View style={{ flex: 1 }}>
                      <View style={fs.resultTopRow}>
                        <Text style={fs.resultName} numberOfLines={2}>{product.product_name}</Text>
                        {product.source === 'USDA' && <Text style={fs.usdaBadge}>USDA</Text>}
                      </View>
                      {!!product.brands && <Text style={fs.resultBrand}>{product.brands}</Text>}
                      {!!product.serving_size && <Text style={fs.resultServing}>{product.serving_size}</Text>}
                    </View>
                    <View style={fs.resultMacros}>
                      {macros.calories > 0 && <Text style={fs.resultCal}>{macros.calories} kcal</Text>}
                      {macros.protein > 0 && <Text style={fs.resultProt}>{macros.protein}g P</Text>}
                      {macros.carbs > 0 && <Text style={fs.resultCarbs}>{macros.carbs}g C</Text>}
                    </View>
                  </Pressable>
                )
              })}

              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

const fs = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f3',
  },
  cancel: { fontSize: 16, color: '#6366f1', minWidth: 56 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111' },

  searchBar: { flexDirection: 'row', gap: 8, padding: 14, paddingBottom: 10 },
  searchInput: { flex: 1, borderWidth: 1.5, borderColor: '#e0e7ff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: '#111', backgroundColor: '#fafbff' },
  searchBtn: { borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', minWidth: 72 },
  searchBtnText: { fontWeight: '700', fontSize: 15 },

  list: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 40 },
  centered: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  loadingText: { marginTop: 12, fontSize: 15, color: '#aaa', textAlign: 'center' },
  emptyEmoji: { fontSize: 44, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#111', marginBottom: 8, textAlign: 'center' },
  emptyDesc: { fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 21 },
  partialNotice: { fontSize: 12, color: '#f59e0b', textAlign: 'center', marginBottom: 10, fontWeight: '600' },
  failedApis: { fontSize: 11, color: '#ef4444', marginTop: 8, fontWeight: '600' },

  resultCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#f0f0f3', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  resultTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 2 },
  resultName: { fontSize: 15, fontWeight: '700', color: '#111', flex: 1 },
  usdaBadge: { fontSize: 9, fontWeight: '800', color: '#fff', backgroundColor: '#10b981', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2, alignSelf: 'flex-start', marginTop: 2 },
  resultBrand: { fontSize: 12, color: '#aaa', marginBottom: 1 },
  resultServing: { fontSize: 12, color: '#bbb', fontStyle: 'italic' },
  resultMacros: { alignItems: 'flex-end', gap: 3 },
  resultCal: { fontSize: 14, fontWeight: '800', color: '#f59e0b' },
  resultProt: { fontSize: 11, fontWeight: '600', color: '#ef4444' },
  resultCarbs: { fontSize: 11, fontWeight: '600', color: '#10b981' },

  backRow: { paddingHorizontal: 18, paddingVertical: 12 },
  backText: { fontSize: 15, color: '#6366f1', fontWeight: '600' },
  detailScroll: { paddingHorizontal: 18, paddingTop: 4 },
  detailHeader: { marginBottom: 14 },
  detailName: { fontSize: 20, fontWeight: '800', color: '#111', marginBottom: 3 },
  detailBrand: { fontSize: 14, color: '#aaa', marginBottom: 4 },
  sourceBadge: { fontSize: 11, color: '#10b981', fontWeight: '700' },

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
  extraRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { fontSize: 12, color: '#555', backgroundColor: '#f0f0f3', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4, fontWeight: '500' },

  detailFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', padding: 16, paddingBottom: 28, borderTopWidth: 1, borderTopColor: '#f0f0f3' },
  addBtn: { borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  addBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },
})
