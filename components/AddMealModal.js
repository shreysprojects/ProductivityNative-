import { useState } from 'react'
import {
  Modal, View, Text, TextInput, Pressable, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, SafeAreaView,
} from 'react-native'
import { useTheme } from '../lib/ThemeContext'

const MACRO_GROUPS = [
  { group: 'Energy', fields: [
    { key: 'calories', label: 'Calories', unit: 'kcal' },
  ]},
  { group: 'Macronutrients', fields: [
    { key: 'protein',            label: 'Protein',            unit: 'g' },
    { key: 'carbs',              label: 'Carbohydrates',      unit: 'g' },
    { key: 'fiber',              label: 'Dietary Fiber',      unit: 'g', sub: true },
    { key: 'sugar',              label: 'Total Sugars',       unit: 'g', sub: true },
    { key: 'addedSugar',         label: 'Added Sugars',       unit: 'g', sub: true },
    { key: 'fat',                label: 'Total Fat',          unit: 'g' },
    { key: 'saturatedFat',       label: 'Saturated Fat',      unit: 'g', sub: true },
    { key: 'transFat',           label: 'Trans Fat',          unit: 'g', sub: true },
    { key: 'polyunsaturatedFat', label: 'Polyunsaturated Fat', unit: 'g', sub: true },
    { key: 'monounsaturatedFat', label: 'Monounsaturated Fat', unit: 'g', sub: true },
  ]},
  { group: 'Minerals & Electrolytes', fields: [
    { key: 'sodium',      label: 'Sodium',      unit: 'mg' },
    { key: 'potassium',   label: 'Potassium',   unit: 'mg' },
    { key: 'cholesterol', label: 'Cholesterol', unit: 'mg' },
    { key: 'calcium',     label: 'Calcium',     unit: 'mg' },
    { key: 'iron',        label: 'Iron',        unit: 'mg' },
    { key: 'magnesium',   label: 'Magnesium',   unit: 'mg' },
    { key: 'zinc',        label: 'Zinc',        unit: 'mg' },
    { key: 'phosphorus',  label: 'Phosphorus',  unit: 'mg' },
    { key: 'selenium',    label: 'Selenium',    unit: 'mcg' },
    { key: 'copper',      label: 'Copper',      unit: 'mg' },
    { key: 'manganese',   label: 'Manganese',   unit: 'mg' },
    { key: 'chromium',    label: 'Chromium',    unit: 'mcg' },
    { key: 'iodine',      label: 'Iodine',      unit: 'mcg' },
  ]},
  { group: 'Vitamins', fields: [
    { key: 'vitaminA',        label: 'Vitamin A',           unit: 'mcg' },
    { key: 'vitaminC',        label: 'Vitamin C',           unit: 'mg' },
    { key: 'vitaminD',        label: 'Vitamin D',           unit: 'mcg' },
    { key: 'vitaminE',        label: 'Vitamin E',           unit: 'mg' },
    { key: 'vitaminK',        label: 'Vitamin K',           unit: 'mcg' },
    { key: 'vitaminB6',       label: 'Vitamin B6',          unit: 'mg' },
    { key: 'vitaminB12',      label: 'Vitamin B12',         unit: 'mcg' },
    { key: 'folate',          label: 'Folate (B9)',         unit: 'mcg' },
    { key: 'thiamin',         label: 'Thiamin (B1)',        unit: 'mg' },
    { key: 'riboflavin',      label: 'Riboflavin (B2)',     unit: 'mg' },
    { key: 'niacin',          label: 'Niacin (B3)',         unit: 'mg' },
    { key: 'pantothenicAcid', label: 'Pantothenic Acid (B5)', unit: 'mg' },
    { key: 'biotin',          label: 'Biotin (B7)',         unit: 'mcg' },
  ]},
]

function emptyMacros() {
  const obj = {}
  MACRO_GROUPS.forEach(g => g.fields.forEach(f => { obj[f.key] = '' }))
  return obj
}

export { MACRO_GROUPS }

export default function AddMealModal({ section, sectionLabel, sectionColor, onSave, onClose }) {
  const { theme } = useTheme()
  const m = makeStyles(theme)
  const [name, setName] = useState('')
  const [contents, setContents] = useState('')
  const [macros, setMacros] = useState(emptyMacros)

  const setMacro = (key, val) => setMacros(prev => ({ ...prev, [key]: val }))

  const handleSave = () => {
    if (!name.trim()) return
    // A decimal comma counts ("1,5" on a French keyboard); a blank, an
    // unreadable or a negative value is 0.
    const parsed = {}
    Object.entries(macros).forEach(([k, v]) => {
      const n = parseFloat(String(v).replace(',', '.'))
      parsed[k] = Number.isFinite(n) && n > 0 ? n : 0
    })
    onSave({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      name: name.trim(),
      contents: contents.trim(),
      section,
      macros: parsed,
    })
  }

  const ready = name.trim().length > 0

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        {/* On iOS the form's scroll view makes room for the keyboard itself:
            it measures on screen, where this view's padding came up short
            inside a page sheet and left the lower fields covered. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? undefined : 'height'}
          style={{ flex: 1 }}
        >
          <View style={m.header}>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={m.cancel}>Cancel</Text>
            </Pressable>
            <Text style={m.title}>Log {sectionLabel}</Text>
            <Pressable
              onPress={handleSave}
              style={[m.addBtn, { backgroundColor: ready ? sectionColor : theme.inputBorder }]}
              disabled={!ready}
            >
              <Text style={[m.addBtnText, { color: ready ? '#fff' : theme.muted }]}>Add</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={m.form} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <View style={m.group}>
              <Text style={m.groupLabel}>MEAL NAME</Text>
              <TextInput
                style={m.nameInput}
                placeholder="e.g. Grilled Chicken & Rice"
                placeholderTextColor={theme.muted}
                value={name}
                onChangeText={setName}
                returnKeyType="next"
                autoFocus
              />
            </View>

            <View style={m.group}>
              <Text style={m.groupLabel}>CONTENTS</Text>
              <TextInput
                style={m.contentsInput}
                placeholder="What's in this meal? (optional)"
                placeholderTextColor={theme.muted}
                value={contents}
                onChangeText={setContents}
                multiline
                textAlignVertical="top"
              />
            </View>

            {MACRO_GROUPS.map(group => (
              <View key={group.group} style={m.group}>
                <Text style={m.groupLabel}>{group.group.toUpperCase()}</Text>
                {group.fields.map(field => (
                  <View key={field.key} style={[m.row, field.sub && m.rowSub]}>
                    <Text style={[m.rowLabel, field.sub && m.rowLabelSub]}>{field.label}</Text>
                    <View style={m.inputWrap}>
                      <TextInput
                        style={m.input}
                        placeholder="—"
                        placeholderTextColor={theme.muted}
                        value={macros[field.key]}
                        onChangeText={v => setMacro(field.key, v)}
                        keyboardType="decimal-pad"
                      />
                      <Text style={m.unit}>{field.unit}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ))}

            <View style={{ height: 48 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

function makeStyles(theme) { return StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: theme.divider,
  },
  cancel: { fontSize: 16, color: theme.accent, minWidth: 56 },
  title: { fontSize: 17, fontWeight: '700', color: theme.text },
  addBtn: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8, minWidth: 56, alignItems: 'center' },
  addBtnText: { fontSize: 15, fontWeight: '700' },

  form: { padding: 16 },

  group: { marginBottom: 22 },
  groupLabel: { fontSize: 11, fontWeight: '800', color: theme.muted, letterSpacing: 1.2, marginBottom: 10 },

  nameInput: {
    borderWidth: 1.5, borderColor: theme.inputBorder, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 17, fontWeight: '600', color: theme.text, backgroundColor: theme.input,
  },
  contentsInput: {
    borderWidth: 1.5, borderColor: theme.inputBorder, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: theme.text, backgroundColor: theme.input,
    minHeight: 80,
  },

  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: theme.divider,
  },
  rowSub: { paddingLeft: 14 },
  rowLabel: { fontSize: 15, color: theme.text, fontWeight: '500', flex: 1 },
  rowLabelSub: { fontSize: 14, color: theme.subtext },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: {
    borderWidth: 1, borderColor: theme.inputBorder, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 7,
    width: 76, textAlign: 'right',
    fontSize: 15, fontWeight: '600', color: theme.text, backgroundColor: theme.input,
  },
  unit: { fontSize: 13, color: theme.muted, width: 38, fontWeight: '500' },
}) }
