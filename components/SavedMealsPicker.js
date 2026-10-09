import { useState, useEffect, useMemo } from 'react'
import {
  Modal, View, Text, TextInput, Pressable, ScrollView,
  StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, Alert,
} from 'react-native'
import BarcodeScanner from './BarcodeScanner'
import FoodSearch from './FoodSearch'

// ── Create / Edit view ─────────────────────────────────────────────────────
// name/ingredients/note are owned by the parent (SavedMealsPicker) so they
// survive while the Modal hides for the barcode/search sub-picker.
function CreateView({
  name, onNameChange,
  ingredients, onIngredientsChange,
  note, onNoteChange,
  initialMeal, sectionColor, onIngredientPick, onSave, onCancel,
}) {
  const addIngredient = (type) => {
    onIngredientPick(type, (item) => {
      onIngredientsChange(prev => [...prev, {
        id: item.id || (Date.now().toString(36) + Math.random().toString(36).slice(2)),
        name: item.name,
        info: item.contents || null,
        macros: item.macros || null,
      }])
    })
  }

  const removeIngredient = (id) => onIngredientsChange(prev => prev.filter(i => i.id !== id))

  const calculatedMacros = useMemo(() => {
    const totals = {}
    ingredients.forEach(ing => {
      if (!ing.macros) return
      Object.entries(ing.macros).forEach(([k, v]) => { totals[k] = (totals[k] || 0) + (v || 0) })
    })
    return totals
  }, [ingredients])

  const handleSave = () => {
    if (!name.trim()) return
    onSave({
      id: initialMeal?.id || (Date.now().toString(36) + Math.random().toString(36).slice(2)),
      name: name.trim(),
      ingredients,
      note: note.trim(),
      macros: calculatedMacros,
    })
  }

  const ready = name.trim().length > 0
  const trackedCount = ingredients.filter(i => i.macros).length
  const cal = Math.round(calculatedMacros.calories || 0)

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View style={s.header}>
        <Pressable onPress={onCancel} hitSlop={10}>
          <Text style={s.cancel}>{initialMeal ? '‹ Back' : 'Back'}</Text>
        </Pressable>
        <Text style={s.headerTitle}>{initialMeal ? 'Edit Meal' : 'New Saved Meal'}</Text>
        <Pressable
          style={[s.actionBtn, { backgroundColor: ready ? sectionColor : '#e5e7eb' }]}
          onPress={handleSave}
          disabled={!ready}
        >
          <Text style={[s.actionBtnText, { color: ready ? '#fff' : '#aaa' }]}>Save</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        <View style={s.group}>
          <Text style={s.groupLabel}>MEAL NAME</Text>
          <TextInput
            style={s.nameInput}
            placeholder="e.g. Post-Workout Shake"
            placeholderTextColor="#bbb"
            value={name}
            onChangeText={onNameChange}
            autoFocus={!initialMeal}
          />
        </View>

        <View style={s.group}>
          <Text style={s.groupLabel}>INGREDIENTS</Text>

          <View style={s.ingBtnRow}>
            <Pressable style={[s.ingAddBtn, { borderColor: sectionColor }]} onPress={() => addIngredient('barcode')}>
              <Text style={[s.ingAddBtnText, { color: sectionColor }]}>📷  Scan Barcode</Text>
            </Pressable>
            <Pressable style={[s.ingAddBtn, { borderColor: sectionColor }]} onPress={() => addIngredient('search')}>
              <Text style={[s.ingAddBtnText, { color: sectionColor }]}>🔍  Search Foods</Text>
            </Pressable>
          </View>

          {ingredients.map((ing, i) => (
            <View key={ing.id ?? String(i)} style={s.ingChip}>
              <View style={{ flex: 1 }}>
                <Text style={s.ingChipName} numberOfLines={1}>{ing.name}</Text>
                {!!ing.info && <Text style={s.ingChipInfo} numberOfLines={1}>{ing.info}</Text>}
                {ing.macros && (
                  <Text style={s.ingChipMacros}>
                    {Math.round(ing.macros.calories || 0)} kcal · {ing.macros.protein || 0}g P · {ing.macros.carbs || 0}g C · {ing.macros.fat || 0}g F
                  </Text>
                )}
              </View>
              <Pressable onPress={() => removeIngredient(ing.id)} hitSlop={10}>
                <Text style={s.ingRemove}>✕</Text>
              </Pressable>
            </View>
          ))}

          {trackedCount > 0 && (
            <View style={s.calcTotals}>
              <Text style={s.calcTitle}>TOTAL FROM {trackedCount} TRACKED INGREDIENT{trackedCount > 1 ? 'S' : ''}</Text>
              <Text style={s.calcVal}>
                {cal} kcal · {calculatedMacros.protein?.toFixed(1) || 0}g P · {calculatedMacros.carbs?.toFixed(1) || 0}g C · {calculatedMacros.fat?.toFixed(1) || 0}g F
              </Text>
            </View>
          )}
        </View>

        <View style={s.group}>
          <Text style={s.groupLabel}>COOKING NOTE (OPTIONAL)</Text>
          <TextInput
            style={s.noteInput}
            placeholder="How to prepare it, tips, substitutions…"
            placeholderTextColor="#bbb"
            value={note}
            onChangeText={onNoteChange}
            multiline
            textAlignVertical="top"
          />
        </View>

        <View style={{ height: 48 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// ── List view ──────────────────────────────────────────────────────────────
function ListView({ meals, sectionColor, onAdd, onEdit, onDelete, onCreate, onClose }) {
  const [expandedId, setExpandedId] = useState(null)

  return (
    <>
      <View style={s.header}>
        <Pressable onPress={onClose} hitSlop={10}><Text style={s.cancel}>Cancel</Text></Pressable>
        <Text style={s.headerTitle}>Saved Meals</Text>
        <Pressable style={[s.actionBtn, { backgroundColor: sectionColor }]} onPress={onCreate}>
          <Text style={s.actionBtnText}>＋ New</Text>
        </Pressable>
      </View>

      {meals.length === 0 ? (
        <View style={s.centered}>
          <Text style={s.emptyEmoji}>⭐</Text>
          <Text style={s.emptyTitle}>No saved meals yet</Text>
          <Text style={s.emptyDesc}>Create templates with ingredients (scan barcodes or search foods) and cooking notes for fast daily logging.</Text>
          <Pressable style={[s.createFirstBtn, { backgroundColor: sectionColor }]} onPress={onCreate}>
            <Text style={s.createFirstText}>Create First Meal</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.list}>
          {meals.map(meal => {
            const expanded = expandedId === meal.id
            return (
              <Pressable
                key={meal.id}
                style={[s.card, expanded && { borderColor: sectionColor + '66' }]}
                onPress={() => setExpandedId(expanded ? null : meal.id)}
              >
                <View style={s.cardTop}>
                  <View style={[s.stripe, { backgroundColor: sectionColor }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardName}>{meal.name}</Text>
                    {meal.ingredients?.length > 0 && (
                      <Text style={s.cardIngredients} numberOfLines={expanded ? undefined : 1}>
                        {meal.ingredients.map(i => i.name).join(' · ')}
                      </Text>
                    )}
                    {(meal.macros?.calories > 0) && (
                      <Text style={s.cardMacros}>
                        {Math.round(meal.macros.calories)} kcal · {meal.macros.protein?.toFixed(1) || 0}g P · {meal.macros.carbs?.toFixed(1) || 0}g C · {meal.macros.fat?.toFixed(1) || 0}g F
                      </Text>
                    )}
                  </View>
                  <View style={s.cardActions}>
                    <Pressable style={[s.editBtn, { borderColor: sectionColor }]} onPress={() => onEdit(meal)}>
                      <Text style={[s.editBtnText, { color: sectionColor }]}>Edit</Text>
                    </Pressable>
                    <Pressable style={[s.addBtn, { backgroundColor: sectionColor }]} onPress={() => onAdd(meal)}>
                      <Text style={s.addBtnText}>Add</Text>
                    </Pressable>
                  </View>
                </View>

                {expanded && !!meal.note && (
                  <View style={s.noteBox}>
                    <Text style={s.noteLabel}>📝 COOKING NOTE</Text>
                    <Text style={s.noteText}>{meal.note}</Text>
                  </View>
                )}

                {expanded && (
                  <Pressable style={s.deleteBtn} onPress={() => onDelete(meal)}>
                    <Text style={s.deleteBtnText}>Delete Saved Meal</Text>
                  </Pressable>
                )}
              </Pressable>
            )
          })}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </>
  )
}

// ── Main export ────────────────────────────────────────────────────────────
export default function SavedMealsPicker({
  section, sectionLabel, sectionColor,
  loadSaved, onSaveTemplate, onDeleteTemplate, onAdd, onClose,
}) {
  const [meals, setMeals] = useState([])
  const [view, setView] = useState('list')
  const [editingMeal, setEditingMeal] = useState(null)

  // Form state lives here (outside the Modal) so it survives while the Modal
  // hides to make room for the BarcodeScanner / FoodSearch modal.
  const [pendingName, setPendingName] = useState('')
  const [pendingIngredients, setPendingIngredients] = useState([])
  const [pendingNote, setPendingNote] = useState('')

  const [ingFlow, setIngFlow] = useState(null)   // null | 'barcode' | 'search'
  const [ingCallback, setIngCallback] = useState(null)

  const refresh = () => loadSaved().then(setMeals)
  useEffect(() => { refresh() }, [])

  const openCreate = () => {
    setPendingName('')
    setPendingIngredients([])
    setPendingNote('')
    setEditingMeal(null)
    setView('create')
  }

  const openEdit = (meal) => {
    setPendingName(meal.name || '')
    setPendingIngredients(meal.ingredients || [])
    setPendingNote(meal.note || '')
    setEditingMeal(meal)
    setView('create')
  }

  const cancelCreate = () => {
    setView('list')
    setEditingMeal(null)
  }

  const pickIngredient = (type, callback) => {
    setIngCallback(() => callback)
    setIngFlow(type)
  }

  const handleIngredientPicked = (item) => {
    if (ingCallback) ingCallback(item)
    setIngFlow(null)
    setIngCallback(null)
  }

  const handleSaveTemplate = async (meal) => {
    await onSaveTemplate(meal)
    setPendingName('')
    setPendingIngredients([])
    setPendingNote('')
    setView('list')
    setEditingMeal(null)
    refresh()
  }

  const handleDelete = (meal) => {
    Alert.alert('Delete Saved Meal', `Remove "${meal.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await onDeleteTemplate(meal.id); refresh() } },
    ])
  }

  const handleAdd = (meal) => {
    onAdd({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      name: meal.name,
      contents: meal.ingredients?.map(i => i.name).join(', ') || '',
      section,
      macros: meal.macros || {},
    })
  }

  return (
    <>
      {/* Main modal hides while sub-picker is active so iOS can stack modals */}
      <Modal
        visible={ingFlow === null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={onClose}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: view === 'create' ? '#fff' : '#f6f7fb' }}>
          {view === 'list' ? (
            <ListView
              meals={meals}
              sectionColor={sectionColor}
              onAdd={handleAdd}
              onEdit={openEdit}
              onDelete={handleDelete}
              onCreate={openCreate}
              onClose={onClose}
            />
          ) : (
            <CreateView
              name={pendingName}
              onNameChange={setPendingName}
              ingredients={pendingIngredients}
              onIngredientsChange={setPendingIngredients}
              note={pendingNote}
              onNoteChange={setPendingNote}
              initialMeal={editingMeal}
              sectionColor={sectionColor}
              onIngredientPick={pickIngredient}
              onSave={handleSaveTemplate}
              onCancel={cancelCreate}
            />
          )}
        </SafeAreaView>
      </Modal>

      {ingFlow === 'barcode' && (
        <BarcodeScanner
          section={section}
          sectionLabel="ingredient"
          sectionColor={sectionColor}
          onAdd={handleIngredientPicked}
          onClose={() => setIngFlow(null)}
          onSearchInstead={() => setIngFlow('search')}
        />
      )}
      {ingFlow === 'search' && (
        <FoodSearch
          section={section}
          sectionLabel="ingredient"
          sectionColor={sectionColor}
          onAdd={handleIngredientPicked}
          onClose={() => setIngFlow(null)}
        />
      )}
    </>
  )
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 14,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f0f0f3',
  },
  cancel: { fontSize: 16, color: '#6366f1', minWidth: 56 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111' },
  actionBtn: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, minWidth: 56, alignItems: 'center' },
  actionBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: '#111', marginBottom: 8, textAlign: 'center' },
  emptyDesc: { fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 21, marginBottom: 28 },
  createFirstBtn: { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28 },
  createFirstText: { color: '#fff', fontWeight: '800', fontSize: 16 },

  list: { padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 16, marginBottom: 10, borderWidth: 1.5, borderColor: '#f0f0f3', overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  cardTop: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  stripe: { width: 3, alignSelf: 'stretch', borderRadius: 2, minHeight: 40 },
  cardName: { fontSize: 15, fontWeight: '700', color: '#111', marginBottom: 2 },
  cardIngredients: { fontSize: 13, color: '#aaa', lineHeight: 18, marginBottom: 3 },
  cardMacros: { fontSize: 12, color: '#888', fontWeight: '500' },
  cardActions: { flexDirection: 'row', gap: 6 },
  editBtn: { borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, borderWidth: 1.5, alignItems: 'center' },
  editBtnText: { fontWeight: '700', fontSize: 13 },
  addBtn: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, alignItems: 'center' },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  noteBox: { marginHorizontal: 14, marginBottom: 10, backgroundColor: '#fffbeb', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#fde68a' },
  noteLabel: { fontSize: 10, fontWeight: '800', color: '#b45309', letterSpacing: 1, marginBottom: 6 },
  noteText: { fontSize: 14, color: '#444', lineHeight: 20 },
  deleteBtn: { marginHorizontal: 14, marginBottom: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: '#fef2f2', alignItems: 'center' },
  deleteBtnText: { color: '#ef4444', fontWeight: '700', fontSize: 14 },

  form: { padding: 16 },
  group: { marginBottom: 22 },
  groupLabel: { fontSize: 11, fontWeight: '800', color: '#aaa', letterSpacing: 1.2, marginBottom: 10 },
  nameInput: { borderWidth: 1.5, borderColor: '#e0e7ff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 17, fontWeight: '600', color: '#111', backgroundColor: '#fafbff' },
  ingBtnRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  ingAddBtn: { flex: 1, borderWidth: 1.5, borderRadius: 12, paddingVertical: 13, alignItems: 'center', borderStyle: 'dashed' },
  ingAddBtnText: { fontSize: 14, fontWeight: '600' },
  ingChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f9fafb', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#f0f0f3', gap: 10 },
  ingChipName: { fontSize: 14, fontWeight: '600', color: '#111' },
  ingChipInfo: { fontSize: 12, color: '#aaa', marginTop: 1 },
  ingChipMacros: { fontSize: 11, color: '#888', marginTop: 2 },
  ingRemove: { fontSize: 14, color: '#ccc', fontWeight: '700' },
  calcTotals: { backgroundColor: '#f0fdf4', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#bbf7d0', marginTop: 4 },
  calcTitle: { fontSize: 10, fontWeight: '800', color: '#16a34a', letterSpacing: 1, marginBottom: 4 },
  calcVal: { fontSize: 13, fontWeight: '700', color: '#166534' },
  noteInput: { borderWidth: 1.5, borderColor: '#e0e7ff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#444', backgroundColor: '#fafbff', minHeight: 100 },
})
