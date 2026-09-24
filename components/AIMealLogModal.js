import { useState } from 'react'
import {
  Modal, View, Text, TextInput, Pressable, ScrollView,
  StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform,
} from 'react-native'
import AIFoodEstimate from './AIFoodEstimate'

// "Describe to AI" in the add-a-meal picker. The user types the meal, its
// ingredients with amounts, how much they ate and anything else; the AI then
// asks only about what is still missing before estimating every nutrient
// (that part is the same AIFoodEstimate flow the food search uses).

export default function AIMealLogModal({ section, sectionLabel, sectionColor, onAdd, onClose }) {
  const [step, setStep] = useState('form')   // form | estimate
  const [name, setName] = useState('')
  const [ingredients, setIngredients] = useState('')
  const [notes, setNotes] = useState('')

  const ready = name.trim().length > 0

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        {/* On iOS the scroll views below make room for the keyboard
            themselves: they measure on screen, where this view's padding
            came up short inside a page sheet. */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? undefined : 'height'} style={{ flex: 1 }}>

          <View style={d.header}>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={d.cancel}>Cancel</Text>
            </Pressable>
            <Text style={d.headerTitle}>Describe to AI</Text>
            <View style={{ width: 56 }} />
          </View>

          {step === 'form' ? (
            <ScrollView contentContainerStyle={d.scroll} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
              <View style={[d.intro, { borderColor: sectionColor + '40', backgroundColor: sectionColor + '0d' }]}>
                <Text style={d.introIcon}>✨</Text>
                <Text style={d.introText}>
                  Tell the AI what you ate for <Text style={{ color: sectionColor, fontWeight: '800' }}>{sectionLabel}</Text>.
                  Amounts help most. If anything is missing it will ask, then work out every macro, vitamin and mineral.
                </Text>
              </View>

              <Text style={d.label}>MEAL NAME</Text>
              <TextInput
                style={d.input}
                placeholder="e.g. Chicken burrito bowl"
                placeholderTextColor="#bbb"
                value={name}
                onChangeText={setName}
                returnKeyType="next"
                autoFocus
              />

              <Text style={d.label}>INGREDIENTS</Text>
              <TextInput
                style={[d.input, d.inputTall]}
                placeholder={'One per line, with amounts if you know them:\n1 cup cooked rice\n150 g grilled chicken\n1/2 avocado\n2 tbsp salsa'}
                placeholderTextColor="#bbb"
                value={ingredients}
                onChangeText={setIngredients}
                multiline
                textAlignVertical="top"
                maxLength={1200}
              />

              <Text style={d.label}>ANYTHING ELSE (OPTIONAL)</Text>
              <TextInput
                style={[d.input, d.inputMulti]}
                placeholder="e.g. cooked in 1 tbsp olive oil, from a restaurant, no dressing"
                placeholderTextColor="#bbb"
                value={notes}
                onChangeText={setNotes}
                multiline
                textAlignVertical="top"
                maxLength={400}
              />

              <Pressable
                style={[d.primaryBtn, { backgroundColor: ready ? sectionColor : '#e5e7eb' }]}
                onPress={() => ready && setStep('estimate')}
                disabled={!ready}
              >
                <Text style={[d.primaryBtnText, { color: ready ? '#fff' : '#aaa' }]}>Continue with AI  ›</Text>
              </Pressable>
              <Text style={d.hint}>
                Next the AI checks what it still needs (an amount, how it was cooked), then estimates the nutrition for what you ate.
              </Text>
              <View style={{ height: 40 }} />
            </ScrollView>
          ) : (
            <AIFoodEstimate
              query={name.trim()}
              details={{ ingredients: ingredients.trim(), notes: notes.trim() }}
              section={section}
              sectionLabel={sectionLabel}
              sectionColor={sectionColor}
              onAdd={onAdd}
              onBack={() => setStep('form')}
              backLabel="Edit the description"
            />
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

const d = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f0f0f3',
  },
  cancel: { fontSize: 16, color: '#6366f1', fontWeight: '600', width: 56 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#111' },
  scroll: { paddingHorizontal: 18, paddingTop: 16 },

  intro: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 18 },
  introIcon: { fontSize: 18, lineHeight: 22 },
  introText: { flex: 1, fontSize: 13.5, lineHeight: 19, color: '#444', fontWeight: '500' },

  label: { fontSize: 11, fontWeight: '800', color: '#aaa', letterSpacing: 1, marginBottom: 8, marginTop: 4 },
  input: {
    borderWidth: 1.5, borderColor: '#e0e7ff', borderRadius: 12, marginBottom: 16,
    paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: '#111', backgroundColor: '#fafbff',
  },
  inputMulti: { minHeight: 68 },
  inputTall: { minHeight: 120 },

  primaryBtn: { borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 6 },
  primaryBtnText: { fontSize: 17, fontWeight: '800' },
  hint: { fontSize: 12, color: '#999', marginTop: 10, lineHeight: 17, textAlign: 'center' },
})
