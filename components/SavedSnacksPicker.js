import { useState, useEffect } from 'react'
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

// Saved snacks: like saved meals, but one item instead of a list of
// ingredients. The item comes from any add source (scan, AI, history,
// manual); the user names it, can add a note and a picture, and later adds
// it to any section in a tap. A snack is stored in the same saved_meals list
// as meal templates with kind 'snack':
//   { id, kind: 'snack', name, itemName, contents, macros, note, image }

const ITEM_SOURCES = [
  { key: 'barcode', icon: '📷', label: 'Scan barcode' },
  { key: 'ai',      icon: '✨', label: 'Describe to AI' },
  { key: 'history', icon: '🕐', label: 'From history' },
  { key: 'manual',  icon: '✏️', label: 'Enter manually' },
]

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2)
const fmt = v => { const n = Number(v) || 0; return n % 1 === 0 ? String(Math.round(n)) : n.toFixed(1) }

// ── Create / Edit view ─────────────────────────────────────────────────────
// Form state is owned by the parent so it survives while this modal hides
// for the item sub-picker.
function CreateView({
  name, onNameChange, item, onPickItem, onClearItem, note, onNoteChange,
  image, onPhoto, onViewPhoto, uploading, initial, sectionColor, onSave, onCancel,
}) {
  const ready = name.trim().length > 0 && !!item
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View style={s.header}>
        <Pressable onPress={onCancel} hitSlop={10}>
          <Text style={s.cancel}>{initial ? '‹ Back' : 'Back'}</Text>
        </Pressable>
        <Text style={s.headerTitle}>{initial ? 'Edit Snack' : 'New Saved Snack'}</Text>
        <Pressable
          style={[s.actionBtn, { backgroundColor: ready ? sectionColor : '#e5e7eb' }]}
          onPress={() => ready && onSave()}
          disabled={!ready}
        >
          <Text style={[s.actionBtnText, { color: ready ? '#fff' : '#aaa' }]}>Save</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
        <View style={s.group}>
          <Text style={s.groupLabel}>THE ITEM</Text>
          {item ? (
            <View style={s.itemCard}>
              <View style={{ flex: 1 }}>
                <Text style={s.itemName} numberOfLines={2}>{item.name}</Text>
                {!!item.contents && <Text style={s.itemInfo} numberOfLines={2}>{item.contents}</Text>}
                <Text style={s.itemMacros}>
                  {Math.round(item.macros?.calories || 0)} kcal · {fmt(item.macros?.protein)}g P · {fmt(item.macros?.carbs)}g C · {fmt(item.macros?.fat)}g F
                </Text>
              </View>
              <Pressable style={[s.changeBtn, { borderColor: sectionColor }]} onPress={onClearItem} hitSlop={6}>
                <Text style={[s.changeBtnText, { color: sectionColor }]}>Change</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={s.groupHint}>Pick the one thing this snack is. Its nutrition comes with it.</Text>
              <View style={s.srcRow}>
                {ITEM_SOURCES.map(src => (
                  <Pressable key={src.key} style={[s.srcBtn, { borderColor: sectionColor }]} onPress={() => onPickItem(src.key)}>
                    <Text style={[s.srcText, { color: sectionColor }]} numberOfLines={1}>{src.label}</Text>
                    <Text style={s.srcIcon}>{src.icon}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </View>

        <View style={s.group}>
          <Text style={s.groupLabel}>SNACK NAME</Text>
          <TextInput
            style={s.nameInput}
            placeholder={item ? item.name : 'e.g. Afternoon protein bar'}
            placeholderTextColor="#bbb"
            value={name}
            onChangeText={onNameChange}
          />
        </View>

        <View style={s.group}>
          <Text style={s.groupLabel}>PICTURE (OPTIONAL)</Text>
          {/* Tap the picture to see it full size; the text (or a hold) changes or removes it */}
          <View style={s.photoRow}>
            <Pressable
              onPress={() => (image ? onViewPhoto(image) : onPhoto())}
              onLongPress={onPhoto}
              delayLongPress={350}
              disabled={uploading}
            >
              {uploading ? (
                <View style={s.photoEmpty}><ActivityIndicator size="small" color={sectionColor} /></View>
              ) : image ? (
                <Image source={{ uri: image }} style={s.photo} resizeMode="cover" />
              ) : (
                <View style={[s.photoEmpty, { borderColor: sectionColor + '66' }]}><Text style={{ fontSize: 20 }}>📷</Text></View>
              )}
            </Pressable>
            <Pressable onPress={onPhoto} disabled={uploading} hitSlop={8}>
              <Text style={[s.photoText, { color: sectionColor }]}>
                {uploading ? 'Uploading…' : image ? 'Change or remove picture' : 'Add a picture'}
              </Text>
              {!!image && !uploading && <Text style={s.photoHint}>Tap the picture to see it full size</Text>}
            </Pressable>
          </View>
        </View>

        <View style={s.group}>
          <Text style={s.groupLabel}>NOTE (OPTIONAL)</Text>
          <TextInput
            style={s.noteInput}
            placeholder="Where you buy it, when you have it…"
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
function ListView({ snacks, sectionColor, onAdd, onEdit, onDelete, onCreate, onViewPhoto, onClose }) {
  return (
    <>
      <View style={s.header}>
        <Pressable onPress={onClose} hitSlop={10}><Text style={s.cancel}>Cancel</Text></Pressable>
        <Text style={s.headerTitle}>Saved Snacks</Text>
        <Pressable style={[s.actionBtn, { backgroundColor: sectionColor }]} onPress={onCreate}>
          <Text style={s.actionBtnText}>＋ New</Text>
        </Pressable>
      </View>

      {snacks.length === 0 ? (
        <View style={s.centered}>
          <Text style={s.emptyEmoji}>🍪</Text>
          <Text style={s.emptyTitle}>No saved snacks yet</Text>
          <Text style={s.emptyDesc}>Save single items you have often, like a protein bar or an apple, and add them in a tap.</Text>
          <Pressable style={[s.createFirstBtn, { backgroundColor: sectionColor }]} onPress={onCreate}>
            <Text style={s.createFirstText}>Save a Snack</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.list}>
          {snacks.map(snack => (
            <View key={snack.id} style={s.card}>
              {snack.image ? (
                <Pressable onPress={() => onViewPhoto(snack.image)} hitSlop={4}>
                  <Image source={{ uri: snack.image }} style={s.cardThumb} resizeMode="cover" />
                </Pressable>
              ) : (
                <View style={[s.stripe, { backgroundColor: sectionColor }]} />
              )}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Text style={s.cardName}>{snack.name}</Text>
                  {isAiFood(snack) && (
                    <Text style={{ fontSize: 10.5, fontWeight: '800', letterSpacing: 0.3, marginLeft: 6, color: sectionColor }}>✦ AI</Text>
                  )}
                </View>
                {!!snack.contents && <Text style={s.cardInfo} numberOfLines={1}>{snack.contents}</Text>}
                {snack.macros?.calories > 0 && (
                  <Text style={s.cardMacros}>
                    {Math.round(snack.macros.calories)} kcal · {fmt(snack.macros.protein)}g P · {fmt(snack.macros.carbs)}g C · {fmt(snack.macros.fat)}g F
                  </Text>
                )}
                {!!snack.note && <Text style={s.cardNote} numberOfLines={1}>📝 {snack.note}</Text>}
              </View>
              <View style={s.cardActions}>
                <Pressable style={[s.editBtn, { borderColor: sectionColor }]} onPress={() => onEdit(snack)}>
                  <Text style={[s.editBtnText, { color: sectionColor }]}>Edit</Text>
                </Pressable>
                <Pressable style={[s.addBtn, { backgroundColor: sectionColor }]} onPress={() => onAdd(snack)}>
                  <Text style={s.addBtnText}>Add</Text>
                </Pressable>
                <Pressable style={s.deleteX} onPress={() => onDelete(snack)} hitSlop={10}>
                  <Text style={s.deleteXText}>✕</Text>
                </Pressable>
              </View>
            </View>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </>
  )
}

// ── Main export ────────────────────────────────────────────────────────────
export default function SavedSnacksPicker({
  section, sectionLabel, sectionColor, userId,
  loadSaved, loadHistory, onSaveTemplate, onDeleteTemplate, onAdd, onClose,
}) {
  const [snacks, setSnacks] = useState([])
  const [view, setView] = useState('list')
  const [editing, setEditing] = useState(null)

  const [name, setName] = useState('')
  const [item, setItem] = useState(null)     // { name, contents, macros }
  const [note, setNote] = useState('')
  const [image, setImage] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [photoViewer, setPhotoViewer] = useState(null)   // picture shown full size
  const [itemFlow, setItemFlow] = useState(null)   // null | an ITEM_SOURCES key

  const refresh = () => loadSaved().then(list => setSnacks((list ?? []).filter(m => m?.kind === 'snack')))
  useEffect(() => { refresh() }, [])

  const openCreate = () => {
    setName(''); setItem(null); setNote(''); setImage(null)
    setEditing(null)
    setView('create')
  }

  const openEdit = (snack) => {
    setName(snack.name || '')
    setItem({ name: snack.itemName || snack.name, contents: snack.contents || '', macros: snack.macros || {}, source: snack.source ?? null })
    setNote(snack.note || '')
    setImage(snack.image || null)
    setEditing(snack)
    setView('create')
  }

  const cancelCreate = () => { setView('list'); setEditing(null) }

  // The item arrives from a sub-picker in logged-meal shape.
  const handleItemPicked = (picked) => {
    setItem({ name: picked.name, contents: picked.contents || '', macros: picked.macros || {}, source: picked.source ?? null })
    if (!name.trim()) setName(picked.name)
    setItemFlow(null)
  }

  function pickPhoto() {
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
      setUploading(true)
      try {
        const url = await uploadIngredientPhoto(userId, uri)
        if (image) deleteIngredientPhoto(image)
        setImage(url)
      } catch (e) {
        Alert.alert('Could not add photo', e?.message ?? 'Please try again.')
      } finally {
        setUploading(false)
      }
    }
    const buttons = image
      ? [
          { text: 'Change photo', onPress: () => choose(false) },
          { text: 'Remove photo', style: 'destructive', onPress: () => { deleteIngredientPhoto(image); setImage(null) } },
        ]
      : [
          { text: '📷  Take photo', onPress: () => choose(true) },
          { text: '🖼  Choose photo', onPress: () => choose(false) },
        ]
    Alert.alert(image ? 'Snack picture' : 'Add a picture', name.trim() || 'Snack', [...buttons, { text: 'Cancel', style: 'cancel' }])
  }

  const handleSave = async () => {
    if (!name.trim() || !item) return
    await onSaveTemplate({
      id: editing?.id || newId(),
      kind: 'snack',
      name: name.trim(),
      itemName: item.name,
      contents: item.contents || '',
      macros: item.macros || {},
      source: item.source ?? null,   // 'ai' when the numbers are an AI estimate
      note: note.trim(),
      image: image || null,
    })
    setView('list')
    setEditing(null)
    refresh()
  }

  const handleDelete = (snack) => {
    Alert.alert('Delete Saved Snack', `Remove "${snack.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await onDeleteTemplate(snack.id)
        if (snack.image) deleteIngredientPhoto(snack.image)
        refresh()
      } },
    ])
  }

  const handleAdd = (snack) => {
    onAdd({
      id: newId(),
      name: snack.name,
      contents: snack.contents || '',
      section,
      macros: snack.macros || {},
      source: derivedSource(snack),
    })
  }

  const sub = { section, sectionLabel: 'snack', sectionColor, onClose: () => setItemFlow(null) }

  return (
    <>
      {/* Main modal hides while a sub-picker is active so iOS can stack modals */}
      <Modal visible={itemFlow === null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <SafeAreaView style={{ flex: 1, backgroundColor: view === 'create' ? '#fff' : '#f6f7fb' }}>
          {view === 'list' ? (
            <ListView
              snacks={snacks}
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
              name={name}
              onNameChange={setName}
              item={item}
              onPickItem={setItemFlow}
              onClearItem={() => setItem(null)}
              note={note}
              onNoteChange={setNote}
              image={image}
              onPhoto={pickPhoto}
              onViewPhoto={setPhotoViewer}
              uploading={uploading}
              initial={editing}
              sectionColor={sectionColor}
              onSave={handleSave}
              onCancel={cancelCreate}
            />
          )}
        </SafeAreaView>
        <ImageViewerModal uri={photoViewer} onClose={() => setPhotoViewer(null)} />
      </Modal>

      {itemFlow === 'barcode' && <BarcodeScanner {...sub} onAdd={handleItemPicked} onSearchInstead={() => setItemFlow('ai')} />}
      {itemFlow === 'ai'      && <AIMealLogModal {...sub} onAdd={handleItemPicked} />}
      {itemFlow === 'history' && <HistoryPicker {...sub} loadHistory={loadHistory ?? (() => Promise.resolve([]))} onAdd={handleItemPicked} />}
      {itemFlow === 'manual'  && <AddMealModal {...sub} onSave={handleItemPicked} />}
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
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14,
    backgroundColor: '#fff', borderRadius: 16, marginBottom: 10, borderWidth: 1.5, borderColor: '#f0f0f3',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  cardThumb: { width: 44, height: 44, borderRadius: 10, backgroundColor: '#eee' },
  stripe: { width: 3, alignSelf: 'stretch', borderRadius: 2, minHeight: 40 },
  cardName: { fontSize: 15, fontWeight: '700', color: '#111', marginBottom: 2 },
  cardInfo: { fontSize: 12.5, color: '#aaa', marginBottom: 3 },
  cardMacros: { fontSize: 12, color: '#888', fontWeight: '500' },
  cardNote: { fontSize: 12, color: '#b45309', marginTop: 3 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  editBtn: { borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, borderWidth: 1.5, alignItems: 'center' },
  editBtnText: { fontWeight: '700', fontSize: 13 },
  addBtn: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, alignItems: 'center' },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  deleteX: { paddingLeft: 6, paddingVertical: 8 },
  deleteXText: { color: '#ef4444', fontWeight: '800', fontSize: 15 },

  form: { padding: 16 },
  group: { marginBottom: 22 },
  groupLabel: { fontSize: 11, fontWeight: '800', color: '#aaa', letterSpacing: 1.2, marginBottom: 10 },
  groupHint: { fontSize: 13, color: '#888', lineHeight: 18, marginBottom: 10 },
  nameInput: { borderWidth: 1.5, borderColor: '#e0e7ff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 17, fontWeight: '600', color: '#111', backgroundColor: '#fafbff' },
  srcRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  srcBtn: {
    flexBasis: '31%', flexGrow: 1, borderWidth: 1.5, borderRadius: 12, borderStyle: 'dashed',
    paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', gap: 3,
  },
  srcIcon: { fontSize: 18 },
  srcText: { fontSize: 12, fontWeight: '700' },
  itemCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f9fafb', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#f0f0f3' },
  itemName: { fontSize: 15, fontWeight: '700', color: '#111' },
  itemInfo: { fontSize: 12.5, color: '#aaa', marginTop: 2 },
  itemMacros: { fontSize: 11.5, color: '#888', marginTop: 3, fontWeight: '500' },
  changeBtn: { borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8, borderWidth: 1.5 },
  changeBtnText: { fontWeight: '700', fontSize: 13 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  photo: { width: 64, height: 64, borderRadius: 12, backgroundColor: '#eee' },
  photoEmpty: { width: 64, height: 64, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#e0e7ff', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fafbff' },
  photoText: { fontSize: 14, fontWeight: '700' },
  photoHint: { fontSize: 12, color: '#aaa', marginTop: 3 },
  noteInput: { borderWidth: 1.5, borderColor: '#e0e7ff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#444', backgroundColor: '#fafbff', minHeight: 80 },
})
