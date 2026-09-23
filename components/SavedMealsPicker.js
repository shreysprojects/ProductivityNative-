import { useState, useEffect, useMemo } from 'react'
import {
  Modal, View, Text, TextInput, Pressable, ScrollView, Image, ActivityIndicator,
  StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, Alert,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { uploadIngredientPhoto, deleteIngredientPhoto } from '../lib/photoStorage'
import { isAiFood, derivedSource } from '../lib/foodSource'
import ImageViewerModal from './ImageViewerModal'
import BarcodeScanner from './BarcodeScanner'
import HistoryPicker from './HistoryPicker'
import AddMealModal from './AddMealModal'
import AIMealLogModal from './AIMealLogModal'
import ScanMealModal from './ScanMealModal'

// Every way a meal can be added is also a way to add an ingredient. Same
// keys as the add-a-meal picker on the Meals page; shown inline as a grid
// because the editor is already a modal.
const ING_SOURCES = [
  { key: 'scan',    icon: '📸', label: 'Scan meal' },
  { key: 'barcode', icon: '📷', label: 'Scan barcode' },
  { key: 'ai',      icon: '✨', label: 'Describe to AI' },
  { key: 'history', icon: '🕐', label: 'From history' },
  { key: 'saved',   icon: '⭐', label: 'Saved meal' },
  { key: 'manual',  icon: '✏️', label: 'Enter manually' },
]

// A saved meal can be labelled with the part of the day it is for. Same keys
// as the Meals page sections, so a label can default to where the picker was
// opened from and filter the list there.
const MEAL_LABELS = [
  { key: 'morning', emoji: '🌅', label: 'Breakfast' },
  { key: 'lunch',   emoji: '☀️',  label: 'Lunch' },
  { key: 'dinner',  emoji: '🌙',  label: 'Dinner' },
  { key: 'snacks',  emoji: '🍎',  label: 'Snack' },
]
const labelOf = key => MEAL_LABELS.find(l => l.key === key) ?? null

const fmtMult = m => (m === 0.25 ? '¼' : m === 0.5 ? '½' : m === 0.75 ? '¾' : m % 1 === 0 ? String(m) : m.toFixed(2).replace(/0+$/, ''))

function scalePart(macros, mult) {
  const out = {}
  Object.entries(macros ?? {}).forEach(([k, v]) => {
    const n = (Number(v) || 0) * mult
    out[k] = k === 'calories' ? Math.round(n) : Math.round(n * 10) / 10
  })
  return out
}

// ── Adjust view ────────────────────────────────────────────────────────────
// Adding a saved meal to the day goes through here: each ingredient can be
// resized on its own (a portion multiplier) or left out, and the logged
// meal is built from what is left. The template itself is not changed.
function AdjustView({ meal, sectionLabel, sectionColor, onConfirm, onCancel }) {
  const [parts, setParts] = useState(() =>
    (meal.ingredients ?? []).map(i => ({ ...i, mult: 1, included: true }))
  )

  const setMult = (id, fn) => setParts(prev => prev.map(p => (p.id === id ? { ...p, mult: Math.max(0.25, Math.round(fn(p.mult) * 100) / 100) } : p)))
  const toggle = id => setParts(prev => prev.map(p => (p.id === id ? { ...p, included: !p.included } : p)))

  const included = parts.filter(p => p.included)
  const totals = {}
  included.forEach(p => {
    if (!p.macros) return
    Object.entries(scalePart(p.macros, p.mult)).forEach(([k, v]) => { totals[k] = (totals[k] || 0) + v })
  })
  for (const k of Object.keys(totals)) totals[k] = k === 'calories' ? Math.round(totals[k]) : Math.round(totals[k] * 10) / 10

  const confirm = () => {
    if (included.length === 0) return
    onConfirm({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      name: meal.name,
      contents: included.map(p => `${p.name}${p.mult !== 1 ? ` ×${fmtMult(p.mult)}` : ''}`).join(', '),
      macros: totals,
      source: included.some(isAiFood) ? 'ai' : (meal.source === 'ai' ? null : meal.source ?? null),
    })
  }

  return (
    <>
      <View style={s.header}>
        <Pressable onPress={onCancel} hitSlop={10}><Text style={s.cancel}>‹ Back</Text></Pressable>
        <Text style={s.headerTitle}>Adjust Meal</Text>
        <Pressable
          style={[s.actionBtn, { backgroundColor: included.length ? sectionColor : '#e5e7eb' }]}
          onPress={confirm}
          disabled={!included.length}
        >
          <Text style={[s.actionBtnText, { color: included.length ? '#fff' : '#aaa' }]}>Add</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        <Text style={adj.mealName}>{meal.name}</Text>
        <Text style={adj.hint}>Resize any part or leave it out, then add to {sectionLabel}. The saved meal stays as it is.</Text>

        {parts.map(p => (
          <View key={p.id} style={[adj.row, !p.included && adj.rowOff]}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={[adj.name, !p.included && adj.nameOff]} numberOfLines={1}>{p.name}</Text>
                {isAiFood(p) && <Text style={[adj.aiTag, { color: sectionColor }]}>✦ AI</Text>}
              </View>
              {p.macros ? (
                <Text style={adj.macros}>
                  {scalePart(p.macros, p.mult).calories ?? 0} kcal · {scalePart(p.macros, p.mult).protein ?? 0}g P · {scalePart(p.macros, p.mult).carbs ?? 0}g C · {scalePart(p.macros, p.mult).fat ?? 0}g F
                </Text>
              ) : (
                <Text style={adj.macros}>No nutrition tracked</Text>
              )}
            </View>
            {p.included ? (
              <>
                <View style={adj.stepper}>
                  <Pressable style={adj.stepBtn} onPress={() => setMult(p.id, m => m - 0.25)} hitSlop={6}>
                    <Text style={adj.stepText}>−</Text>
                  </Pressable>
                  <Text style={[adj.multText, { color: sectionColor }]}>×{fmtMult(p.mult)}</Text>
                  <Pressable style={adj.stepBtn} onPress={() => setMult(p.id, m => m + 0.25)} hitSlop={6}>
                    <Text style={adj.stepText}>+</Text>
                  </Pressable>
                </View>
                <Pressable onPress={() => toggle(p.id)} hitSlop={10} style={adj.removeBtn}>
                  <Text style={adj.removeText}>✕</Text>
                </Pressable>
              </>
            ) : (
              <Pressable onPress={() => toggle(p.id)} hitSlop={10} style={[adj.addBackBtn, { borderColor: sectionColor }]}>
                <Text style={[adj.addBackText, { color: sectionColor }]}>Add back</Text>
              </Pressable>
            )}
          </View>
        ))}

        <View style={s.calcTotals}>
          <Text style={s.calcTitle}>{included.length} OF {parts.length} PART{parts.length === 1 ? '' : 'S'} · TOTAL</Text>
          <Text style={s.calcVal}>
            {Math.round(totals.calories || 0)} kcal · {totals.protein?.toFixed(1) || 0}g P · {totals.carbs?.toFixed(1) || 0}g C · {totals.fat?.toFixed(1) || 0}g F
          </Text>
        </View>
        <View style={{ height: 48 }} />
      </ScrollView>
    </>
  )
}

const adj = StyleSheet.create({
  mealName: { fontSize: 20, fontWeight: '800', color: '#111', marginBottom: 4 },
  hint: { fontSize: 13, color: '#888', lineHeight: 18, marginBottom: 14 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: '#eee',
  },
  rowOff: { opacity: 0.55, backgroundColor: '#fafafa' },
  name: { fontSize: 15, fontWeight: '700', color: '#111', flexShrink: 1 },
  nameOff: { textDecorationLine: 'line-through' },
  aiTag: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3, marginLeft: 6 },
  macros: { fontSize: 12, color: '#888', marginTop: 2, fontWeight: '500' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepBtn: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#f0f0f5', alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 18, color: '#333', fontWeight: '600', lineHeight: 22 },
  multText: { fontSize: 14, fontWeight: '800', minWidth: 38, textAlign: 'center' },
  removeBtn: { paddingHorizontal: 4, paddingVertical: 6 },
  removeText: { fontSize: 15, color: '#c4c4c4', fontWeight: '700' },
  addBackBtn: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  addBackText: { fontSize: 12, fontWeight: '800' },
})

// ── Create / Edit view ─────────────────────────────────────────────────────
// name/ingredients/note are owned by the parent (SavedMealsPicker) so they
// survive while the Modal hides for an ingredient sub-picker.
function CreateView({
  name, onNameChange,
  ingredients, onIngredientsChange,
  note, onNoteChange,
  label, onLabelChange,
  initialMeal, sectionColor, onIngredientPick, onIngredientPhoto, onViewPhoto, uploadingId, onSave, onCancel,
}) {
  const addIngredient = (type) => {
    onIngredientPick(type, (item) => {
      onIngredientsChange(prev => [...prev, {
        id: item.id || (Date.now().toString(36) + Math.random().toString(36).slice(2)),
        name: item.name,
        info: item.contents || null,
        macros: item.macros || null,
        source: item.source ?? null,   // 'ai' when the numbers are an AI estimate
        image: null,
      }])
    })
  }

  const removeIngredient = (id) => {
    const gone = ingredients.find(i => i.id === id)
    if (gone?.image) deleteIngredientPhoto(gone.image)
    onIngredientsChange(prev => prev.filter(i => i.id !== id))
  }

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
      label: label ?? null,
      macros: calculatedMacros,
      // Any AI-estimated ingredient makes the totals partly an estimate.
      source: ingredients.some(isAiFood) ? 'ai' : null,
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
          <Text style={s.groupLabel}>LABEL</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {MEAL_LABELS.map(l => {
              const active = label === l.key
              return (
                <Pressable
                  key={l.key}
                  onPress={() => onLabelChange(active ? null : l.key)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5,
                    borderColor: active ? sectionColor : '#e5e7eb',
                    backgroundColor: active ? sectionColor + '14' : '#fff',
                  }}
                >
                  <Text style={{ fontSize: 14 }}>{l.emoji}</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: active ? sectionColor : '#555' }}>{l.label}</Text>
                </Pressable>
              )
            })}
          </View>
          <Text style={s.ingHint}>Optional. Labelled meals are shown first when you add to that part of the day.</Text>
        </View>

        <View style={s.group}>
          <Text style={s.groupLabel}>INGREDIENTS</Text>

          <View style={s.ingBtnRow}>
            {ING_SOURCES.map(src => (
              <Pressable
                key={src.key}
                style={[s.ingAddBtn, { borderColor: sectionColor }]}
                onPress={() => addIngredient(src.key)}
              >
                <Text style={[s.ingAddBtnText, { color: sectionColor }]} numberOfLines={1}>{src.label}</Text>
                <Text style={s.ingAddBtnIcon}>{src.icon}</Text>
              </Pressable>
            ))}
          </View>

          {ingredients.map((ing, i) => (
            <View key={ing.id ?? String(i)} style={s.ingChip}>
              {/* The picture (tap to see it full size, hold to change or
                  remove it), or the camera that adds one */}
              <Pressable
                onPress={() => (ing.image ? onViewPhoto(ing.image) : onIngredientPhoto(ing))}
                onLongPress={() => onIngredientPhoto(ing)}
                delayLongPress={350}
                disabled={uploadingId === ing.id}
                hitSlop={6}
                style={s.ingThumbBtn}
              >
                {uploadingId === ing.id ? (
                  <ActivityIndicator size="small" color={sectionColor} />
                ) : ing.image ? (
                  <Image source={{ uri: ing.image }} style={s.ingThumb} resizeMode="cover" />
                ) : (
                  <View style={[s.ingThumbEmpty, { borderColor: sectionColor + '66' }]}>
                    <Text style={s.ingThumbEmptyText}>📷</Text>
                  </View>
                )}
              </Pressable>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[s.ingChipName, { flexShrink: 1 }]} numberOfLines={1}>{ing.name}</Text>
                  {isAiFood(ing) && (
                    <Text style={{ fontSize: 10, fontWeight: '800', letterSpacing: 0.3, marginLeft: 6, color: sectionColor }}>✦ AI</Text>
                  )}
                </View>
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
          {ingredients.length > 0 && (
            <Text style={s.ingHint}>
              {ingredients.some(i => i.image)
                ? 'Tap a picture to see it full size; hold it to change or remove it.'
                : 'Tap the camera on an ingredient to add a picture of it.'}
            </Text>
          )}

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
function ListView({ meals, section, sectionColor, onAdd, onEdit, onDelete, onCreate, onViewPhoto, onClose }) {
  const [expandedId, setExpandedId] = useState(null)
  // Opened from Lunch, start on the lunch-labelled meals when there are any,
  // otherwise everything. Derived until the user picks a chip, because the
  // meals arrive after the first render.
  const [picked, setPicked] = useState(null)
  const filter = picked ?? (meals.some(m => m.label === section) ? section : 'all')
  const shown = filter === 'all' ? meals : meals.filter(m => m.label === filter)
  const chips = [{ key: 'all', label: 'All' }, ...MEAL_LABELS.filter(l => meals.some(m => m.label === l.key))]

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
          <Text style={s.emptyDesc}>Create templates with ingredients (scan, describe to AI, history or manual entry) and cooking notes for fast daily logging.</Text>
          <Pressable style={[s.createFirstBtn, { backgroundColor: sectionColor }]} onPress={onCreate}>
            <Text style={s.createFirstText}>Create First Meal</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.list}>
          {chips.length > 1 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {chips.map(c => {
                const active = filter === c.key
                return (
                  <Pressable
                    key={c.key}
                    onPress={() => setPicked(c.key)}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5,
                      borderColor: active ? sectionColor : '#e5e7eb',
                      backgroundColor: active ? sectionColor + '14' : '#fff',
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '700', color: active ? sectionColor : '#666' }}>
                      {c.emoji ? `${c.emoji} ` : ''}{c.label}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          )}
          {shown.length === 0 && (
            <Text style={{ fontSize: 13, color: '#999', textAlign: 'center', marginVertical: 20 }}>
              Nothing labelled {labelOf(filter)?.label ?? filter} yet.
            </Text>
          )}
          {shown.map(meal => {
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
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                      <Text style={s.cardName}>{meal.name}</Text>
                      {isAiFood(meal) && (
                        <Text style={{ fontSize: 10.5, fontWeight: '800', letterSpacing: 0.3, marginLeft: 6, marginBottom: 2, color: sectionColor }}>✦ AI</Text>
                      )}
                      {!!labelOf(meal.label) && (
                        <Text style={{
                          fontSize: 10, fontWeight: '800', letterSpacing: 0.3, marginLeft: 6, marginBottom: 2,
                          color: '#666', backgroundColor: '#f0f0f5', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden',
                        }}>
                          {labelOf(meal.label).emoji} {labelOf(meal.label).label.toUpperCase()}
                        </Text>
                      )}
                    </View>
                    {meal.ingredients?.length > 0 && (
                      <Text style={s.cardIngredients} numberOfLines={expanded ? undefined : 1}>
                        {meal.ingredients.map(i => i.name).join(' · ')}
                      </Text>
                    )}
                    {meal.ingredients?.some(i => i.image) && (
                      <View style={s.cardThumbs}>
                        {meal.ingredients.filter(i => i.image).slice(0, 8).map((i, idx) => (
                          <Pressable key={i.id ?? idx} onPress={() => onViewPhoto(i.image)} hitSlop={4}>
                            <Image source={{ uri: i.image }} style={s.cardThumb} resizeMode="cover" />
                          </Pressable>
                        ))}
                      </View>
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
                    {/* Delete, always in reach; onDelete asks first. */}
                    <Pressable style={s.deleteX} onPress={() => onDelete(meal)} hitSlop={10}>
                      <Text style={s.deleteXText}>✕</Text>
                    </Pressable>
                  </View>
                </View>

                {expanded && !!meal.note && (
                  <View style={s.noteBox}>
                    <Text style={s.noteLabel}>📝 COOKING NOTE</Text>
                    <Text style={s.noteText}>{meal.note}</Text>
                  </View>
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
// `loadHistory` feeds the From-history ingredient source and
// `onIngredientPicked` tells the owner about each pick (the Meals page records
// it in history); the saved-meal source nests another SavedMealsPicker, so the
// template callbacks are passed straight through to it. `userId` owns the
// ingredient photos.
export default function SavedMealsPicker({
  section, sectionLabel, sectionColor, userId,
  loadSaved, loadHistory, onIngredientPicked, onSaveTemplate, onDeleteTemplate, onAdd, onClose,
}) {
  const [meals, setMeals] = useState([])
  const [view, setView] = useState('list')
  const [editingMeal, setEditingMeal] = useState(null)

  // Form state lives here (outside the Modal) so it survives while the Modal
  // hides to make room for an ingredient sub-picker's modal.
  const [pendingName, setPendingName] = useState('')
  const [pendingIngredients, setPendingIngredients] = useState([])
  const [pendingNote, setPendingNote] = useState('')
  const [pendingLabel, setPendingLabel] = useState(null)   // a MEAL_LABELS key or null
  const [adjusting, setAdjusting] = useState(null)         // the template being resized before it is added
  const [uploadingId, setUploadingId] = useState(null)   // ingredient whose photo is uploading
  const [photoViewer, setPhotoViewer] = useState(null)   // picture shown full size

  const [ingFlow, setIngFlow] = useState(null)   // null | an ING_SOURCES key
  const [ingCallback, setIngCallback] = useState(null)

  // Saved snacks share the same stored list (kind 'snack'); they have their
  // own picker, so they are left out here.
  const refresh = () => loadSaved().then(list => setMeals((list ?? []).filter(m => m?.kind !== 'snack')))
  useEffect(() => { refresh() }, [])

  const openCreate = () => {
    setPendingName('')
    setPendingIngredients([])
    setPendingNote('')
    // A new meal is labelled for the part of the day it is being made from.
    setPendingLabel(labelOf(section) ? section : null)
    setEditingMeal(null)
    setView('create')
  }

  const openEdit = (meal) => {
    setPendingName(meal.name || '')
    setPendingIngredients(meal.ingredients || [])
    setPendingNote(meal.note || '')
    setPendingLabel(labelOf(meal.label) ? meal.label : null)
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
    if (onIngredientPicked) onIngredientPicked(item)
    setIngFlow(null)
    setIngCallback(null)
  }

  // A picture for one ingredient: pick or take it, upload it, and put the
  // URL on the ingredient. Three buttons at most, so Android shows them all.
  const setIngredientImage = (id, image) =>
    setPendingIngredients(prev => prev.map(i => i.id === id ? { ...i, image } : i))

  function pickIngredientPhoto(ing) {
    if (!userId) { Alert.alert('Not signed in', 'Sign in to add photos.'); return }
    const choose = async (fromCamera) => {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (perm.status !== 'granted') {
        Alert.alert('Permission needed', fromCamera ? 'Camera access is required to take a photo.' : 'Photo library access is required to pick a photo.')
        return
      }
      const res = fromCamera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 0.6 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.6 })
      const uri = res.canceled ? null : res.assets?.[0]?.uri
      if (!uri) return
      setUploadingId(ing.id)
      try {
        const url = await uploadIngredientPhoto(userId, uri)
        if (ing.image) deleteIngredientPhoto(ing.image)
        setIngredientImage(ing.id, url)
      } catch (e) {
        Alert.alert('Could not add photo', e?.message ?? 'Please try again.')
      } finally {
        setUploadingId(null)
      }
    }
    const buttons = ing.image
      ? [
          { text: 'Change photo', onPress: () => choose(false) },
          { text: 'Remove photo', style: 'destructive', onPress: () => { deleteIngredientPhoto(ing.image); setIngredientImage(ing.id, null) } },
        ]
      : [
          { text: '📷  Take photo', onPress: () => choose(true) },
          { text: '🖼  Choose photo', onPress: () => choose(false) },
        ]
    Alert.alert(ing.image ? 'Ingredient photo' : 'Add a photo', ing.name, [...buttons, { text: 'Cancel', style: 'cancel' }])
  }

  const handleSaveTemplate = async (meal) => {
    await onSaveTemplate(meal)
    setPendingName('')
    setPendingIngredients([])
    setPendingNote('')
    setPendingLabel(null)
    setView('list')
    setEditingMeal(null)
    refresh()
  }

  const handleDelete = (meal) => {
    Alert.alert('Delete Saved Meal', `Remove "${meal.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await onDeleteTemplate(meal.id)
        ;(meal.ingredients ?? []).forEach(i => { if (i.image) deleteIngredientPhoto(i.image) })
        refresh()
      } },
    ])
  }

  // A meal with parts goes through the adjust view first, so each part can
  // be resized or left out; one with no ingredients is added as it is.
  const handleAdd = (meal) => {
    if (meal.ingredients?.length > 0) { setAdjusting(meal); setView('adjust'); return }
    onAdd({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      name: meal.name,
      contents: meal.ingredients?.map(i => i.name).join(', ') || '',
      section,
      macros: meal.macros || {},
      // Older templates predate the flag: derive it from their ingredients.
      source: derivedSource(meal),
    })
  }

  const handleAdjusted = (built) => {
    setAdjusting(null)
    setView('list')
    onAdd({ ...built, section })
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
        <SafeAreaView style={{ flex: 1, backgroundColor: view === 'list' ? '#f6f7fb' : '#fff' }}>
          {view === 'adjust' && adjusting ? (
            <AdjustView
              meal={adjusting}
              sectionLabel={sectionLabel}
              sectionColor={sectionColor}
              onConfirm={handleAdjusted}
              onCancel={() => { setAdjusting(null); setView('list') }}
            />
          ) : view === 'list' ? (
            <ListView
              meals={meals}
              section={section}
              sectionColor={sectionColor}
              onAdd={handleAdd}
              onEdit={openEdit}
              onDelete={handleDelete}
              onCreate={openCreate}
              onViewPhoto={setPhotoViewer}
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
              label={pendingLabel}
              onLabelChange={setPendingLabel}
              initialMeal={editingMeal}
              sectionColor={sectionColor}
              onIngredientPick={pickIngredient}
              onIngredientPhoto={pickIngredientPhoto}
              onViewPhoto={setPhotoViewer}
              uploadingId={uploadingId}
              onSave={handleSaveTemplate}
              onCancel={cancelCreate}
            />
          )}
        </SafeAreaView>
        <ImageViewerModal uri={photoViewer} onClose={() => setPhotoViewer(null)} />
      </Modal>

      {/* Ingredient sources: the same flows the Meals page uses to add a meal */}
      {ingFlow === 'scan' && (
        <ScanMealModal
          section={section}
          sectionLabel="ingredient"
          sectionColor={sectionColor}
          onAdd={handleIngredientPicked}
          onClose={() => setIngFlow(null)}
        />
      )}
      {ingFlow === 'barcode' && (
        <BarcodeScanner
          section={section}
          sectionLabel="ingredient"
          sectionColor={sectionColor}
          onAdd={handleIngredientPicked}
          onClose={() => setIngFlow(null)}
          onSearchInstead={() => setIngFlow('ai')}
        />
      )}
      {ingFlow === 'ai' && (
        <AIMealLogModal
          section={section}
          sectionLabel="ingredient"
          sectionColor={sectionColor}
          onAdd={handleIngredientPicked}
          onClose={() => setIngFlow(null)}
        />
      )}
      {ingFlow === 'history' && (
        <HistoryPicker
          section={section}
          sectionLabel="ingredient"
          sectionColor={sectionColor}
          loadHistory={loadHistory ?? (() => Promise.resolve([]))}
          onAdd={handleIngredientPicked}
          onClose={() => setIngFlow(null)}
        />
      )}
      {ingFlow === 'saved' && (
        <SavedMealsPicker
          section={section}
          sectionLabel="ingredient"
          sectionColor={sectionColor}
          userId={userId}
          loadSaved={loadSaved}
          loadHistory={loadHistory}
          onIngredientPicked={onIngredientPicked}
          onSaveTemplate={onSaveTemplate}
          onDeleteTemplate={onDeleteTemplate}
          onAdd={handleIngredientPicked}
          onClose={() => setIngFlow(null)}
        />
      )}
      {ingFlow === 'manual' && (
        <AddMealModal
          section={section}
          sectionLabel="ingredient"
          sectionColor={sectionColor}
          onSave={handleIngredientPicked}
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
  deleteX: { paddingLeft: 6, paddingVertical: 8 },
  deleteXText: { color: '#ef4444', fontWeight: '800', fontSize: 15 },

  form: { padding: 16 },
  group: { marginBottom: 22 },
  groupLabel: { fontSize: 11, fontWeight: '800', color: '#aaa', letterSpacing: 1.2, marginBottom: 10 },
  nameInput: { borderWidth: 1.5, borderColor: '#e0e7ff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 17, fontWeight: '600', color: '#111', backgroundColor: '#fafbff' },
  ingBtnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  ingAddBtn: {
    flexBasis: '31%', flexGrow: 1, borderWidth: 1.5, borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', gap: 3, borderStyle: 'dashed',
  },
  ingAddBtnIcon: { fontSize: 18 },
  ingAddBtnText: { fontSize: 12, fontWeight: '700' },
  ingChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f9fafb', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#f0f0f3', gap: 10 },
  ingThumbBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  ingThumb: { width: 44, height: 44, borderRadius: 10, backgroundColor: '#eee' },
  ingThumbEmpty: { width: 44, height: 44, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  ingThumbEmptyText: { fontSize: 16 },
  ingHint: { fontSize: 12, color: '#aaa', marginTop: 2, marginBottom: 6, lineHeight: 16 },
  cardThumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2, marginBottom: 4 },
  cardThumb: { width: 28, height: 28, borderRadius: 7, backgroundColor: '#eee' },
  ingChipName: { fontSize: 14, fontWeight: '600', color: '#111' },
  ingChipInfo: { fontSize: 12, color: '#aaa', marginTop: 1 },
  ingChipMacros: { fontSize: 11, color: '#888', marginTop: 2 },
  ingRemove: { fontSize: 14, color: '#ccc', fontWeight: '700' },
  calcTotals: { backgroundColor: '#f0fdf4', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#bbf7d0', marginTop: 4 },
  calcTitle: { fontSize: 10, fontWeight: '800', color: '#16a34a', letterSpacing: 1, marginBottom: 4 },
  calcVal: { fontSize: 13, fontWeight: '700', color: '#166534' },
  noteInput: { borderWidth: 1.5, borderColor: '#e0e7ff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#444', backgroundColor: '#fafbff', minHeight: 100 },
})
