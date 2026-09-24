import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react'
import {
  View, Text, Pressable, TextInput, StyleSheet, Alert, AppState, Keyboard, InputAccessoryView, Platform,
} from 'react-native'
import { useFocusEffect, useNavigation } from 'expo-router'
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist'
import { useAuth } from '../../lib/AuthContext'
import { useTheme } from '../../lib/ThemeContext'
import { supabase } from '../../lib/supabase'
import {
  saveMeal, saveDayMeals, deleteMeal, today,
  getSavedMeals, upsertSavedMeal, deleteSavedMeal, getRecentMealHistory, recordMealHistory,
} from '../../lib/storage'
import { getUserGoals } from '../../lib/goalsStorage'
import { PLAN_DAYS, DAY_NAMES, dayKeyOf, sumPlanMacros, planMealCount, emptyDays } from '../../lib/mealPlan'
import { getMealPlan, addPlannedMeal, deletePlannedMeal, setPlannedDay, replaceMealPlan } from '../../lib/mealPlanStorage'
import { isAiFood, derivedSource } from '../../lib/foodSource'
import ScanMealModal from '../../components/ScanMealModal'
import AddMealModal from '../../components/AddMealModal'
import MealPickerSheet from '../../components/MealPickerSheet'
import BarcodeScanner from '../../components/BarcodeScanner'
import HistoryPicker from '../../components/HistoryPicker'
import SavedMealsPicker from '../../components/SavedMealsPicker'
import SavedSnacksPicker from '../../components/SavedSnacksPicker'
import AIMealLogModal from '../../components/AIMealLogModal'
import MealPlannerModal from '../../components/MealPlannerModal'
import MealCoachChat from '../../components/MealCoachChat'

const SECTIONS = [
  { key: 'morning', label: 'Morning', emoji: '🌅', color: '#f97316', bg: '#fff7ed' },
  { key: 'lunch',   label: 'Lunch',   emoji: '☀️',  color: '#10b981', bg: '#ecfdf5' },
  { key: 'dinner',  label: 'Dinner',  emoji: '🌙',  color: '#6366f1', bg: '#eef2ff' },
  { key: 'snacks',  label: 'Snacks',  emoji: '🍎',  color: '#ec4899', bg: '#fdf2f8' },
]

const DETAIL_GROUPS = [
  { label: 'Macros', keys: [
    'protein','carbs','fiber','sugar','addedSugar',
    'fat','saturatedFat','transFat','polyunsaturatedFat','monounsaturatedFat',
  ]},
  { label: 'Minerals & Electrolytes', keys: [
    'sodium','potassium','cholesterol','calcium','iron',
    'magnesium','zinc','phosphorus','selenium','copper','manganese','chromium','iodine',
  ]},
  { label: 'Vitamins', keys: [
    'vitaminA','vitaminC','vitaminD','vitaminE','vitaminK',
    'vitaminB6','vitaminB12','folate','thiamin','riboflavin',
    'niacin','pantothenicAcid','biotin',
  ]},
]

const LABELS = {
  protein:'Protein', carbs:'Carbohydrates', fiber:'Dietary Fiber', sugar:'Total Sugars', addedSugar:'Added Sugars',
  fat:'Total Fat', saturatedFat:'Saturated Fat', transFat:'Trans Fat',
  polyunsaturatedFat:'Polyunsaturated Fat', monounsaturatedFat:'Monounsaturated Fat',
  sodium:'Sodium', potassium:'Potassium', cholesterol:'Cholesterol', calcium:'Calcium',
  iron:'Iron', magnesium:'Magnesium', zinc:'Zinc', phosphorus:'Phosphorus',
  selenium:'Selenium', copper:'Copper', manganese:'Manganese', chromium:'Chromium', iodine:'Iodine',
  vitaminA:'Vitamin A', vitaminC:'Vitamin C', vitaminD:'Vitamin D', vitaminE:'Vitamin E',
  vitaminK:'Vitamin K', vitaminB6:'Vitamin B6', vitaminB12:'Vitamin B12',
  folate:'Folate (B9)', thiamin:'Thiamin (B1)', riboflavin:'Riboflavin (B2)',
  niacin:'Niacin (B3)', pantothenicAcid:'Pantothenic Acid (B5)', biotin:'Biotin (B7)',
}

const UNITS = {
  protein:'g', carbs:'g', fiber:'g', sugar:'g', addedSugar:'g',
  fat:'g', saturatedFat:'g', transFat:'g', polyunsaturatedFat:'g', monounsaturatedFat:'g',
  sodium:'mg', potassium:'mg', cholesterol:'mg', calcium:'mg', iron:'mg',
  magnesium:'mg', zinc:'mg', phosphorus:'mg', selenium:'mcg', copper:'mg',
  manganese:'mg', chromium:'mcg', iodine:'mcg',
  vitaminA:'mcg', vitaminC:'mg', vitaminD:'mcg', vitaminE:'mg', vitaminK:'mcg',
  vitaminB6:'mg', vitaminB12:'mcg', folate:'mcg', thiamin:'mg', riboflavin:'mg',
  niacin:'mg', pantothenicAcid:'mg', biotin:'mcg',
}

// FDA Daily Values — 2,000 kcal reference diet
const MICRO_DV = [
  { key: 'saturatedFat',    dv: 20,   unit: 'g',   limit: true, label: 'Saturated Fat' },
  { key: 'transFat',        dv: 2,    unit: 'g',   limit: true, label: 'Trans Fat' },
  { key: 'cholesterol',     dv: 300,  unit: 'mg',  limit: true, label: 'Cholesterol' },
  { key: 'sodium',          dv: 2300, unit: 'mg',  limit: true, label: 'Sodium' },
  { key: 'addedSugar',      dv: 50,   unit: 'g',   limit: true, label: 'Added Sugars' },
  { key: 'fiber',           dv: 28,   unit: 'g',               label: 'Dietary Fiber' },
  { key: 'potassium',       dv: 4700, unit: 'mg',              label: 'Potassium' },
  { key: 'calcium',         dv: 1300, unit: 'mg',              label: 'Calcium' },
  { key: 'iron',            dv: 18,   unit: 'mg',              label: 'Iron' },
  { key: 'magnesium',       dv: 420,  unit: 'mg',              label: 'Magnesium' },
  { key: 'zinc',            dv: 11,   unit: 'mg',              label: 'Zinc' },
  { key: 'phosphorus',      dv: 1250, unit: 'mg',              label: 'Phosphorus' },
  { key: 'selenium',        dv: 55,   unit: 'mcg',             label: 'Selenium' },
  { key: 'copper',          dv: 0.9,  unit: 'mg',              label: 'Copper' },
  { key: 'manganese',       dv: 2.3,  unit: 'mg',              label: 'Manganese' },
  { key: 'chromium',        dv: 35,   unit: 'mcg',             label: 'Chromium' },
  { key: 'iodine',          dv: 150,  unit: 'mcg',             label: 'Iodine' },
  { key: 'vitaminA',        dv: 900,  unit: 'mcg',             label: 'Vitamin A' },
  { key: 'vitaminC',        dv: 90,   unit: 'mg',              label: 'Vitamin C' },
  { key: 'vitaminD',        dv: 20,   unit: 'mcg',             label: 'Vitamin D' },
  { key: 'vitaminE',        dv: 15,   unit: 'mg',              label: 'Vitamin E' },
  { key: 'vitaminK',        dv: 120,  unit: 'mcg',             label: 'Vitamin K' },
  { key: 'vitaminB6',       dv: 1.7,  unit: 'mg',              label: 'Vitamin B6' },
  { key: 'vitaminB12',      dv: 2.4,  unit: 'mcg',             label: 'Vitamin B12' },
  { key: 'folate',          dv: 400,  unit: 'mcg',             label: 'Folate (B9)' },
  { key: 'thiamin',         dv: 1.2,  unit: 'mg',              label: 'Thiamin (B1)' },
  { key: 'riboflavin',      dv: 1.3,  unit: 'mg',              label: 'Riboflavin (B2)' },
  { key: 'niacin',          dv: 16,   unit: 'mg',              label: 'Niacin (B3)' },
  { key: 'pantothenicAcid', dv: 5,    unit: 'mg',              label: 'Pantothenic Acid' },
  { key: 'biotin',          dv: 30,   unit: 'mcg',             label: 'Biotin (B7)' },
]
const PRIORITY_MICROS = new Set(['saturatedFat','cholesterol','sodium','addedSugar','fiber','potassium','calcium','iron','vitaminD'])

// Tracked nutrients with no official FDA DV — shown in Extra section
const EXTRA_MICRO = [
  { key: 'sugar',              unit: 'g', label: 'Total Sugars' },
  { key: 'polyunsaturatedFat', unit: 'g', label: 'Polyunsaturated Fat' },
  { key: 'monounsaturatedFat', unit: 'g', label: 'Monounsaturated Fat' },
]

function sumMacros(meals) {
  const t = {}
  meals.forEach(m => Object.entries(m.macros || {}).forEach(([k, v]) => { t[k] = (t[k] || 0) + (v || 0) }))
  return t
}

function fmt(v) {
  if (!v) return '0'
  return v % 1 === 0 ? String(Math.round(v)) : v.toFixed(1)
}

// ── Portions ───────────────────────────────────────────────────────────────
// A logged meal can be resized after the fact. The macros it was logged with
// are kept as `baseMacros` and `portion` is the multiplier on top, so every
// nutrient is rescaled from the original each time and nothing drifts.
const PORTION_MIN = 0.25
const PORTION_MAX = 20

function scaleMacros(base, mult) {
  const out = {}
  for (const [k, v] of Object.entries(base ?? {})) {
    const n = (Number(v) || 0) * mult
    out[k] = k === 'calories' ? Math.round(n) : Math.round(n * 10) / 10
  }
  return out
}

const clampPortion = p => Math.min(PORTION_MAX, Math.max(PORTION_MIN, Math.round(p * 100) / 100))

function applyPortion(meal, portion) {
  const p = clampPortion(portion)
  const base = meal.baseMacros ?? meal.macros ?? {}
  return { ...meal, baseMacros: base, portion: p, macros: scaleMacros(base, p) }
}

function fmtPortion(p) {
  if (p === 0.5) return '½'
  if (p === 0.25) return '¼'
  if (p === 0.75) return '¾'
  return p % 1 === 0 ? String(p) : String(Math.round(p * 100) / 100)
}

const PORTION_CHIPS = [0.5, 1, 1.5, 2, 3]

// iOS number pads have no return key, so the portion box gets a Done bar.
const PORTION_DONE_ID = 'mealPortionDone'

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function newMealId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

const DAY_LABELS = ['M','T','W','T','F','S','S']

function getWeekDays(weekOffset) {
  const now = new Date()
  const dow = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1) + weekOffset * 7)
  monday.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

function WeekNav({ selectedDate, onSelect, weekOffset, onWeekChange }) {
  const { theme } = useTheme()
  const s = makeStyles(theme)
  const todayStr = localDateStr(new Date())
  const days = getWeekDays(weekOffset)
  return (
    <View style={s.weekNav}>
      <Pressable style={s.weekArrow} onPress={() => onWeekChange(weekOffset - 1)}>
        <Text style={s.weekArrowText}>‹</Text>
      </Pressable>
      <View style={s.weekDays}>
        {days.map((d, i) => {
          const dateStr = localDateStr(d)
          const isFuture = dateStr > todayStr
          const isSelected = dateStr === selectedDate
          const isToday = dateStr === todayStr
          return (
            <Pressable
              key={dateStr}
              style={[s.dayCircle, isSelected && s.dayCircleSelected, isFuture && s.dayCircleFuture]}
              onPress={() => !isFuture && onSelect(dateStr)}
              disabled={isFuture}
            >
              <Text style={[s.dayLabel, isSelected && s.dayLabelSelected]}>{DAY_LABELS[i]}</Text>
              <Text style={[s.dayNum, isSelected && s.dayNumSelected]}>{d.getDate()}</Text>
              {isToday && !isSelected && <View style={s.todayDot} />}
            </Pressable>
          )
        })}
      </View>
      <Pressable
        style={[s.weekArrow, weekOffset === 0 && s.weekArrowDisabled]}
        onPress={() => onWeekChange(weekOffset + 1)}
        disabled={weekOffset === 0}
      >
        <Text style={[s.weekArrowText, weekOffset === 0 && s.weekArrowTextDisabled]}>›</Text>
      </Pressable>
    </View>
  )
}

function MicroRow({ nutrient, value }) {
  const { theme } = useTheme()
  const s = makeStyles(theme)
  if (!nutrient.dv) {
    return (
      <View style={s.microRow}>
        <Text style={s.microLabel} numberOfLines={1}>{nutrient.label}</Text>
        <View style={{ flex: 1 }} />
        <Text style={[s.microRight, { minWidth: 0 }]} numberOfLines={1}>
          <Text style={s.microActual}>{fmt(value)}{nutrient.unit}</Text>
        </Text>
      </View>
    )
  }
  const pctDisplay = Math.round((value / nutrient.dv) * 100)
  let barColor = '#6366f1'
  if (nutrient.limit) {
    if (pctDisplay > 100) barColor = '#ef4444'
    else if (pctDisplay > 75) barColor = '#f59e0b'
    else barColor = '#f97316'
  } else if (pctDisplay >= 100) {
    barColor = '#10b981'
  }
  return (
    <View style={s.microRow}>
      <Text style={s.microLabel} numberOfLines={1}>{nutrient.label}</Text>
      <View style={s.microBarTrack}>
        {value > 0 && (
          <View style={[s.microBarFill, { width: `${Math.min(pctDisplay, 100)}%`, backgroundColor: barColor }]} />
        )}
      </View>
      <Text style={s.microRight} numberOfLines={1}>
        <Text style={s.microActual}>{fmt(value)}{nutrient.unit}</Text>
        <Text style={s.microDvMax}>/{fmt(nutrient.dv)}{nutrient.unit}</Text>
      </Text>
    </View>
  )
}

function MicronutrientBars({ totals }) {
  const { theme } = useTheme()
  const s = makeStyles(theme)
  const limitRows   = MICRO_DV.filter(n =>  n.limit && (PRIORITY_MICROS.has(n.key) || (totals[n.key] || 0) > 0))
  const benefitRows = MICRO_DV.filter(n => !n.limit && (PRIORITY_MICROS.has(n.key) || (totals[n.key] || 0) > 0))
  const extraRows   = EXTRA_MICRO.filter(n => (totals[n.key] || 0) > 0)
  const hasAbove    = limitRows.length > 0 || benefitRows.length > 0
  return (
    <View style={s.microWrap}>
      {limitRows.length > 0 && (
        <>
          <Text style={s.microGroupLabel}>LIMIT THESE</Text>
          {limitRows.map(n => <MicroRow key={n.key} nutrient={n} value={totals[n.key] || 0} />)}
        </>
      )}
      {benefitRows.length > 0 && (
        <>
          <Text style={[s.microGroupLabel, limitRows.length > 0 && { marginTop: 12 }]}>DAILY VALUE TARGETS</Text>
          {benefitRows.map(n => <MicroRow key={n.key} nutrient={n} value={totals[n.key] || 0} />)}
        </>
      )}
      {extraRows.length > 0 && (
        <>
          <Text style={[s.microGroupLabel, hasAbove && { marginTop: 12 }]}>EXTRA NUTRIENTS</Text>
          {extraRows.map(n => <MicroRow key={n.key} nutrient={n} value={totals[n.key] || 0} />)}
        </>
      )}
    </View>
  )
}

// `title` overrides the date heading (the Plan tab uses it for "MONDAY'S PLAN").
function DailySummary({ totals, goals, selectedDate, title }) {
  const { theme } = useTheme()
  const s = makeStyles(theme)
  const [showMicro, setShowMicro] = useState(false)
  const cal = Math.round(totals.calories || 0)
  const hasData = cal > 0
  const hasGoals = goals?.calories > 0

  const calPct = hasGoals ? Math.min(Math.round((cal / goals.calories) * 100), 999) : null
  const isToday = selectedDate === localDateStr(new Date())
  const titleText = title ?? (isToday
    ? "TODAY'S NUTRITION"
    : new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase())
  // How far today is from the calorie goal, next to the count.
  const remaining = hasGoals ? goals.calories - cal : null
  const toGo = !hasGoals ? null
    : remaining > 0 ? { text: `${remaining.toLocaleString()} more calories to go!`, color: theme.accent }
    : remaining === 0 ? { text: 'Goal reached!', color: '#10b981' }
    : { text: `${Math.abs(remaining).toLocaleString()} calories over your goal`, color: '#ef4444' }

  return (
    <View style={s.summaryCard}>
      <Text style={s.summaryTitle}>{titleText}</Text>
      <View style={s.calRow}>
        <Text style={[s.calNum, !hasData && { color: '#ccc' }]}>{cal.toLocaleString()}</Text>
        <View style={{ justifyContent: 'flex-end', paddingBottom: 6 }}>
          <Text style={s.calUnit}>kcal</Text>
          {hasGoals && <Text style={s.calGoal}>/ {goals.calories.toLocaleString()}</Text>}
        </View>
        {toGo && (
          <View style={s.calToGoWrap}>
            <Text style={[s.calToGo, { color: toGo.color }]}>{toGo.text}</Text>
          </View>
        )}
      </View>

      {hasGoals && (
        <View style={s.calBarWrap}>
          <View style={s.calBarTrack}>
            <View style={[s.calBarFill, {
              width: `${Math.min((cal / goals.calories) * 100, 100)}%`,
              backgroundColor: cal > goals.calories * 1.05 ? '#ef4444' : '#6366f1',
            }]} />
          </View>
          <Text style={s.calBarPct}>{calPct}%</Text>
        </View>
      )}

      {hasGoals ? (
        <View style={s.macroBarsWrap}>
          {[
            { label: 'Protein', key: 'protein', color: '#ef4444', goal: goals.protein },
            { label: 'Carbs',   key: 'carbs',   color: '#f59e0b', goal: goals.carbs },
            { label: 'Fat',     key: 'fat',     color: '#3b82f6', goal: goals.fat },
          ].map(m => {
            const actual = totals[m.key] || 0
            const pct = m.goal > 0 ? Math.min((actual / m.goal) * 100, 100) : 0
            return (
              <View key={m.key} style={s.macroBarRow}>
                <Text style={[s.macroBarLabel, { color: m.color }]}>{m.label}</Text>
                <View style={s.macroBarTrack}>
                  <View style={[s.macroBarFill, { width: `${pct}%`, backgroundColor: m.color }]} />
                </View>
                <Text style={s.macroBarVal}>{fmt(actual)}<Text style={s.macroBarUnit}>g</Text></Text>
                <Text style={s.macroBarGoal}>/ {m.goal}g</Text>
              </View>
            )
          })}
        </View>
      ) : (
        <View style={s.summaryMacros}>
          {[
            { label: 'Protein', key: 'protein', color: '#ef4444' },
            { label: 'Carbs',   key: 'carbs',   color: '#f59e0b' },
            { label: 'Fat',     key: 'fat',     color: '#3b82f6' },
            { label: 'Fiber',   key: 'fiber',   color: '#10b981' },
            { label: 'Sodium',  key: 'sodium',  color: '#8b5cf6' },
          ].map(item => (
            <View key={item.label} style={s.summaryMacroBox}>
              <Text style={[s.summaryMacroVal, { color: item.color }]}>
                {fmt(totals[item.key])}
                <Text style={s.summaryMacroUnit}>{UNITS[item.key]}</Text>
              </Text>
              <Text style={s.summaryMacroLabel}>{item.label}</Text>
            </View>
          ))}
        </View>
      )}

      <Pressable style={s.microToggleRow} onPress={() => setShowMicro(v => !v)}>
        <Text style={s.summaryDetailToggleText}>Micronutrients</Text>
        <Text style={s.summaryDetailToggleArrow}>{showMicro ? '▲' : '▼'}</Text>
      </Pressable>
      {showMicro && <MicronutrientBars totals={totals} />}

    </View>
  )
}

function MacroDetail({ macros }) {
  const { theme } = useTheme()
  const s = makeStyles(theme)
  return (
    <View style={s.detailWrap}>
      {DETAIL_GROUPS.map(group => {
        const entries = group.keys
          .filter(k => (macros[k] || 0) > 0)
          .map(k => ({ k, label: LABELS[k], val: macros[k], unit: UNITS[k] }))
        if (!entries.length) return null
        return (
          <View key={group.label} style={s.detailGroup}>
            <Text style={s.detailGroupLabel}>{group.label.toUpperCase()}</Text>
            {entries.map(e => (
              <View key={e.k} style={s.detailRow}>
                <Text style={s.detailLabel}>{e.label}</Text>
                <Text style={s.detailVal}>{fmt(e.val)} {e.unit}</Text>
              </View>
            ))}
          </View>
        )
      })}
    </View>
  )
}

// A logged or planned meal. Planned meals also show prep time and notes and,
// for days that have arrived, a "Log this meal" action. Holding the card
// starts a drag (onLongPress) when the list allows it. Expanded, the card
// offers a portion control that rescales every nutrient.
function MealCard({ meal, color, expanded, onToggle, onLongPress, dragging, onDelete, deleteLabel = 'Delete Meal', onLog, onPortion }) {
  const { theme } = useTheme()
  const s = makeStyles(theme)
  const [showDetail, setShowDetail] = useState(false)
  const portion = meal.portion ?? 1
  const [portionText, setPortionText] = useState(String(portion))
  useEffect(() => { setPortionText(String(portion)) }, [portion])
  const setPortion = p => { if (onPortion) onPortion(meal, p) }
  // A decimal comma counts ("1,5" on a French keyboard). 0 or an unreadable
  // amount is refused, anything else is clamped, and either way the box ends
  // up showing the portion actually applied.
  const commitPortionText = () => {
    const n = parseFloat(portionText.replace(',', '.'))
    const p = Number.isFinite(n) && n > 0 ? clampPortion(n) : portion
    setPortionText(String(p))
    if (p !== portion) setPortion(p)
  }
  const cal    = meal.macros?.calories || 0
  const prot   = meal.macros?.protein  || 0
  const carbs  = meal.macros?.carbs    || 0
  const fat    = meal.macros?.fat      || 0
  const prepBits = []
  if (meal.prepMinutes) prepBits.push(`⏱ ${meal.prepMinutes} min`)
  if (meal.prepNote) prepBits.push(meal.prepNote)

  return (
    <Pressable
      style={[s.mealCard, expanded && { borderColor: color + '55' }, dragging && { borderColor: color }]}
      onPress={onToggle}
      onLongPress={onLongPress}
      delayLongPress={200}
      disabled={dragging}
    >
      <View style={s.mealCardTop}>
        <View style={[s.mealColorBar, { backgroundColor: color }]} />
        <View style={{ flex: 1 }}>
          <Text style={s.mealName}>{meal.name}</Text>
          {meal.contents ? (
            <Text style={s.mealContents} numberOfLines={expanded ? undefined : 1}>{meal.contents}</Text>
          ) : null}
          {prepBits.length > 0 && (
            <Text style={s.mealPrep} numberOfLines={expanded ? undefined : 1}>{prepBits.join('  ·  ')}</Text>
          )}
          <View style={s.mealQuickRow}>
            <Text style={s.mealQuickItem}>{fmt(prot)}g protein</Text>
            <Text style={s.mealQuickDot}>·</Text>
            <Text style={s.mealQuickItem}>{fmt(carbs)}g carbs</Text>
            <Text style={s.mealQuickDot}>·</Text>
            <Text style={s.mealQuickItem}>{fmt(fat)}g fat</Text>
            {portion !== 1 && <Text style={[s.mealPortionTag, { color, backgroundColor: color + '18' }]}>× {fmtPortion(portion)}</Text>}
            {isAiFood(meal) && <Text style={[s.mealAiTag, { color }]}>✦ AI</Text>}
          </View>
        </View>
        <View style={s.mealCalBox}>
          <Text style={[s.mealCalNum, { color }]}>{Math.round(cal)}</Text>
          <Text style={s.mealCalUnit}>kcal</Text>
        </View>
      </View>

      {expanded && (
        <>
          {onPortion && (
            <View style={s.portionBox}>
              <Text style={s.portionTitle}>PORTION  ·  every nutrient scales with it</Text>
              <View style={s.portionRow}>
                <Pressable style={s.portionStep} onPress={() => setPortion(portion - 0.25)} hitSlop={6}>
                  <Text style={s.portionStepText}>−</Text>
                </Pressable>
                <TextInput
                  style={[s.portionInput, { borderColor: color + '66' }]}
                  value={portionText}
                  onChangeText={setPortionText}
                  onEndEditing={commitPortionText}
                  onSubmitEditing={commitPortionText}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  inputAccessoryViewID={PORTION_DONE_ID}
                  selectTextOnFocus
                />
                <Pressable style={s.portionStep} onPress={() => setPortion(portion + 0.25)} hitSlop={6}>
                  <Text style={s.portionStepText}>+</Text>
                </Pressable>
                <Text style={s.portionLabel}>× what was logged</Text>
              </View>
              {/* After the input it serves: iOS attaches the bar to the input
                  it finds in place when the bar mounts. */}
              {Platform.OS === 'ios' && (
                <InputAccessoryView nativeID={PORTION_DONE_ID} backgroundColor={theme.header}>
                  <View style={s.doneBar}>
                    <Pressable onPress={() => Keyboard.dismiss()} hitSlop={10}>
                      <Text style={[s.doneBarText, { color: theme.accent }]}>Done</Text>
                    </Pressable>
                  </View>
                </InputAccessoryView>
              )}
              <View style={s.portionChips}>
                {PORTION_CHIPS.map(p => (
                  <Pressable
                    key={p}
                    style={[s.portionChip, portion === p && { backgroundColor: color, borderColor: color }]}
                    onPress={() => setPortion(p)}
                  >
                    <Text style={[s.portionChipText, portion === p && { color: '#fff' }]}>{fmtPortion(p)}×</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          <Pressable style={s.macroToggle} onPress={() => setShowDetail(v => !v)}>
            <Text style={s.macroToggleLabel}>All nutrition details</Text>
            <Text style={s.macroToggleArrow}>{showDetail ? '▲' : '▼'}</Text>
          </Pressable>
          {showDetail && <MacroDetail macros={meal.macros || {}} />}
          {onLog && (
            <Pressable style={[s.logBtn, { backgroundColor: color }]} onPress={onLog}>
              <Text style={s.logBtnText}>Log this meal</Text>
            </Pressable>
          )}
          <Pressable style={s.deleteBtn} onPress={onDelete}>
            <Text style={s.deleteBtnText}>{deleteLabel}</Text>
          </Pressable>
        </>
      )}
    </Pressable>
  )
}

// ── A day's meals as one draggable list ────────────────────────────────────
// The four sections are a single list so a meal can be held and dragged from
// one part of the day into another. Header and footer rows mark each
// section's bounds, and after a drop a meal belongs to whichever section's
// header sits above it. Rows are rebuilt from the meals on every render, so
// the list can never drift from the data.

function dayRows(meals) {
  const rows = []
  for (const sec of SECTIONS) {
    const own = meals.filter(m => m.section === sec.key)
    rows.push({ key: `h:${sec.key}`, type: 'header', sec, meals: own })
    own.forEach(meal => rows.push({ key: `m:${meal.id}`, type: 'meal', sec, meal }))
    rows.push({ key: `f:${sec.key}`, type: 'footer', sec, empty: own.length === 0 })
  }
  return rows
}

function mealsFromRows(rows) {
  let current = SECTIONS[0].key
  const out = []
  for (const row of rows) {
    if (row.type === 'header' || row.type === 'footer') current = row.sec.key
    else if (row.type === 'meal') out.push(row.meal.section === current ? row.meal : { ...row.meal, section: current })
  }
  return out
}

function DayList({
  meals, header, canEdit, canDrag, emptyText, deleteLabel, onLogMeal, onPortion,
  onAdd, onDelete, onReorder, expandedId, onToggleExpand,
}) {
  const { theme } = useTheme()
  const s = makeStyles(theme)
  const rows = useMemo(() => dayRows(meals), [meals])

  const renderItem = ({ item: row, drag, isActive }) => {
    const { sec } = row
    if (row.type === 'header') {
      const sectionCal = Math.round(sumMacros(row.meals).calories || 0)
      return (
        <View style={[s.secTop, { borderLeftColor: sec.color }]}>
          <View style={[s.sectionHeader, { marginBottom: 6 }]}>
            <View style={s.sectionLeft}>
              <View style={[s.sectionIconWrap, { backgroundColor: sec.bg }]}>
                <Text style={s.sectionEmoji}>{sec.emoji}</Text>
              </View>
              <View>
                <Text style={s.sectionLabel}>{sec.label}</Text>
                {row.meals.length > 0 && (
                  <Text style={[s.sectionCal, { color: sec.color }]}>{sectionCal} kcal · {row.meals.length} meal{row.meals.length > 1 ? 's' : ''}</Text>
                )}
              </View>
            </View>
            {canEdit && (
              <Pressable style={[s.addBtn, { backgroundColor: sec.color }]} onPress={() => onAdd(sec.key)}>
                <Text style={s.addBtnText}>+ Add</Text>
              </Pressable>
            )}
          </View>
        </View>
      )
    }
    if (row.type === 'footer') {
      return (
        <View style={[s.secBottom, { borderLeftColor: sec.color }]}>
          {row.empty && (
            <View style={s.emptyRow}>
              <Text style={s.emptyText}>{emptyText}</Text>
            </View>
          )}
        </View>
      )
    }
    return (
      <ScaleDecorator activeScale={0.97}>
        <View style={[s.secBody, { borderLeftColor: sec.color }, isActive && s.secBodyActive]}>
          <MealCard
            meal={row.meal}
            color={sec.color}
            expanded={expandedId === row.meal.id}
            onToggle={() => onToggleExpand(row.meal.id)}
            onLongPress={canDrag ? drag : undefined}
            dragging={isActive}
            onDelete={() => onDelete(row.meal.id)}
            deleteLabel={deleteLabel}
            onLog={onLogMeal ? () => onLogMeal(row.meal) : null}
            onPortion={onPortion}
          />
        </View>
      </ScaleDecorator>
    )
  }

  return (
    <DraggableFlatList
      data={rows}
      keyExtractor={row => row.key}
      renderItem={renderItem}
      onDragEnd={({ data }) => {
        const next = mealsFromRows(data)
        const changed = next.length !== meals.length
          || next.some((m, i) => m.id !== meals[i].id || m.section !== meals[i].section)
        if (changed) onReorder(next)
      }}
      ListHeaderComponent={(
        <View>
          {header}
          {canDrag && meals.length > 0 && (
            <Text style={s.dragHint}>Hold a meal to drag it into another part of the day.</Text>
          )}
        </View>
      )}
      contentContainerStyle={s.content}
      containerStyle={{ flex: 1 }}
      keyboardShouldPersistTaps="handled"
      // Lifts an open card's portion box above the keyboard (iOS).
      automaticallyAdjustKeyboardInsets
      showsVerticalScrollIndicator={false}
    />
  )
}

// A saved-meal or snack write that failed: say so, then fail the picker's
// call too, so it keeps the form (and its photos) instead of moving on as if
// the save had landed.
const failWith = title => e => {
  Alert.alert(title, e?.message ?? 'Please try again.')
  throw e
}

// The add-a-meal flows, shared by the Log and Plan tabs: pick how to add,
// then scan, describe to AI, history, saved meals, saved snacks or manual
// entry. Every step is a modal, so where this renders does not matter.
function AddMealFlows({ flow, section, userId, onFlow, onAdd, onClose }) {
  if (!flow || !section) return null
  // Whatever is added, and wherever it lands, is in "From History" at once.
  const add = meal => { recordMealHistory(userId, meal); onAdd(meal) }
  const common = { section: section.key, sectionLabel: section.label, sectionColor: section.color, onClose }
  if (flow === 'picker') {
    return <MealPickerSheet sectionLabel={section.label} sectionColor={section.color} onSelect={onFlow} onClose={onClose} />
  }
  if (flow === 'scan')    return <ScanMealModal {...common} onAdd={add} />
  if (flow === 'ai')      return <AIMealLogModal {...common} onAdd={add} />
  if (flow === 'barcode') return <BarcodeScanner {...common} onAdd={add} onSearchInstead={() => onFlow('ai')} />
  if (flow === 'history') return <HistoryPicker {...common} loadHistory={() => getRecentMealHistory(userId)} onAdd={add} />
  if (flow === 'saved') {
    return (
      <SavedMealsPicker
        {...common}
        userId={userId}
        loadSaved={() => getSavedMeals(userId)}
        loadHistory={() => getRecentMealHistory(userId)}
        onIngredientPicked={item => recordMealHistory(userId, item)}
        onSaveTemplate={meal => upsertSavedMeal(userId, meal).catch(failWith('Could not save meal'))}
        onDeleteTemplate={id => deleteSavedMeal(userId, id).catch(failWith('Could not delete meal'))}
        onAdd={add}
      />
    )
  }
  if (flow === 'snacks') {
    return (
      <SavedSnacksPicker
        {...common}
        userId={userId}
        loadSaved={() => getSavedMeals(userId)}
        loadHistory={() => getRecentMealHistory(userId)}
        onSaveTemplate={snack => upsertSavedMeal(userId, snack).catch(failWith('Could not save snack'))}
        onDeleteTemplate={id => deleteSavedMeal(userId, id).catch(failWith('Could not delete snack'))}
        onAdd={add}
      />
    )
  }
  if (flow === 'manual') return <AddMealModal {...common} onSave={add} />
  return null
}

// Today's date, kept current: the page can stay open past midnight, and a
// date worked out once kept logging to yesterday. Checked again at each
// local midnight and whenever the app comes back to the foreground.
function useToday() {
  const [day, setDay] = useState(today)
  useEffect(() => {
    let timer
    const check = () => setDay(today())
    const schedule = () => {
      const now = new Date()
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      // A second past midnight, so the new date has surely begun.
      timer = setTimeout(() => { check(); schedule() }, midnight - now + 1000)
    }
    schedule()
    const sub = AppState.addEventListener('change', state => { if (state === 'active') check() })
    return () => { clearTimeout(timer); sub.remove() }
  }, [])
  return day
}

// ── Log tab: what was eaten ────────────────────────────────────────────────

function LogPane({ user }) {
  const { theme } = useTheme()
  const s = makeStyles(theme)
  const userId = user?.id
  const todayStr = useToday()
  const [meals, setMeals] = useState([])
  const [goals, setGoals] = useState(null)
  const [addingTo, setAddingTo] = useState(null)
  const [flow, setFlow] = useState(null)  // 'picker'|'barcode'|'ai'|'history'|'saved'|'snacks'|'manual'
  const [expandedId, setExpandedId] = useState(null)
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [weekOffset, setWeekOffset] = useState(0)
  const [loadError, setLoadError] = useState(false)
  // Which date the meals on screen actually belong to (null while a newly
  // picked day loads). A failed refresh of a day already shown keeps the
  // stale list instead of an error page, and until the list matches the
  // selected day it can't be edited: the previous day's cards would save
  // themselves into the new one.
  const [loadedDate, setLoadedDate] = useState(null)
  const dayReady = loadedDate === selectedDate
  // The selected day, for loads and failed writes that finish after the
  // user has moved on to another one.
  const selectedRef = useRef(selectedDate)

  const selectDate = date => {
    if (date === selectedRef.current) return
    selectedRef.current = date
    setSelectedDate(date)
    setMeals([])
    setLoadedDate(null)
    setLoadError(false)
  }

  // getMeals() treats a failed fetch and an empty day identically, so the row
  // is queried directly here: a network failure must not render as
  // "Nothing logged yet".
  const load = useCallback(async (date) => {
    if (!userId) return
    const [mealsRes, goalData] = await Promise.all([
      supabase.from('meals').select('meals').eq('user_id', userId).eq('date', date).maybeSingle(),
      getUserGoals(userId),
    ])
    // Another day was picked while this one loaded. Its meals must not land
    // in that day's list, where the next drag would save them there.
    if (date !== selectedRef.current) return
    if (mealsRes.error) {
      setLoadError(true)
      return
    }
    setMeals(mealsRes.data?.meals ?? [])
    setGoals(goalData)
    setLoadError(false)
    setLoadedDate(date)
  }, [userId])

  useFocusEffect(useCallback(() => { load(selectedDate) }, [load, selectedDate]))

  // Past midnight, a selection left on the old today moves on to the new one
  // (and the strip back to this week), so "+ Add" logs to the right day.
  const lastTodayRef = useRef(todayStr)
  useEffect(() => {
    const was = lastTodayRef.current
    lastTodayRef.current = todayStr
    if (was !== todayStr && selectedRef.current === was) {
      setWeekOffset(0)
      selectDate(todayStr)
    }
  }, [todayStr])   // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => sumMacros(meals), [meals])
  const activeSection = SECTIONS.find(sec => sec.key === addingTo)

  const openAdd = (sectionKey) => { setAddingTo(sectionKey); setFlow('picker') }
  const closeAll = () => { setAddingTo(null); setFlow(null) }

  function handleWeekChange(newOffset) {
    if (newOffset > 0) return
    setWeekOffset(newOffset)
    const days = getWeekDays(newOffset)
    const available = days.filter(d => localDateStr(d) <= todayStr)
    if (available.length > 0) selectDate(localDateStr(available[available.length - 1]))
  }

  const handleMealAdded = async (meal) => {
    const full = { ...meal, section: addingTo }
    const date = selectedDate
    closeAll()
    // Optimistic update so the meal appears instantly…
    setMeals(prev => {
      const idx = prev.findIndex(m => m.id === full.id)
      if (idx >= 0) { const copy = [...prev]; copy[idx] = full; return copy }
      return [...prev, full]
    })
    try {
      await saveMeal(userId, date, full)
    } catch (e) {
      // …and revert to server truth if the write actually failed.
      Alert.alert('Could not save meal', 'Please check your connection and try again.')
      if (date === selectedRef.current) load(date)
    }
  }

  // Any day up to today can be logged to (the week strip already blocks the
  // future), so a forgotten meal can be added after the fact.
  const isViewOnly = false
  return (
    <View style={s.pane}>
      <WeekNav
        selectedDate={selectedDate}
        onSelect={selectDate}
        weekOffset={weekOffset}
        onWeekChange={handleWeekChange}
      />
      {loadError && !dayReady ? (
        <View style={s.errorWrap}>
          <Text style={s.errorTitle}>We couldn't load this day</Text>
          <Text style={s.errorSub}>Check your connection and try again.</Text>
          <Pressable style={s.errorBtn} onPress={() => load(selectedDate)}>
            <Text style={s.errorBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
      <DayList
        meals={meals}
        canEdit={!isViewOnly && dayReady}
        canDrag={!isViewOnly && dayReady}
        emptyText={dayReady ? 'Nothing logged yet' : 'Loading…'}
        header={<DailySummary totals={totals} goals={goals} selectedDate={selectedDate} />}
        onAdd={openAdd}
        onDelete={async id => {
          const date = selectedDate
          setMeals(prev => prev.filter(m => m.id !== id))
          try {
            await deleteMeal(userId, date, id)
          } catch (e) {
            Alert.alert('Could not delete meal', 'Please try again.')
            if (date === selectedRef.current) load(date)
          }
        }}
        onReorder={async next => {
          // A drag that ends after the day changed under it holds the old
          // day's meals; saving them would replace the new day's.
          if (!dayReady) return
          const date = selectedDate
          setMeals(next)
          try {
            await saveDayMeals(userId, date, next)
          } catch (e) {
            Alert.alert('Could not move meal', 'Please check your connection and try again.')
            if (date === selectedRef.current) load(date)
          }
        }}
        onPortion={async (meal, portion) => {
          const date = selectedDate
          const updated = applyPortion(meal, portion)
          setMeals(prev => prev.map(m => (m.id === updated.id ? updated : m)))
          try {
            await saveMeal(userId, date, updated)
          } catch (e) {
            Alert.alert('Could not change the portion', 'Please check your connection and try again.')
            if (date === selectedRef.current) load(date)
          }
        }}
        expandedId={expandedId}
        onToggleExpand={id => setExpandedId(expandedId === id ? null : id)}
      />
      )}

      <AddMealFlows
        flow={flow}
        section={activeSection}
        userId={userId}
        onFlow={setFlow}
        onAdd={handleMealAdded}
        onClose={closeAll}
      />
    </View>
  )
}

// ── Plan tab: one weekly plan that repeats, like the class schedule ────────

function PlanPane({ user }) {
  const { theme } = useTheme()
  const s = makeStyles(theme)
  const todayStr = useToday()
  const todayKey = dayKeyOf(todayStr)
  const [dayKey, setDayKey] = useState(todayKey)
  const [plan, setPlan] = useState(null)      // { days, notes }
  const [goals, setGoals] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [addingTo, setAddingTo] = useState(null)
  const [flow, setFlow] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [plannerOpen, setPlannerOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [groceryOpen, setGroceryOpen] = useState(false)
  // Whether a plan has been shown at all, so a failed refresh keeps it
  // instead of swapping in an error page.
  const loadedRef = useRef(false)

  // Past midnight, a plan left on today's weekday moves on with it, so
  // "Log this meal" stays on the day that can actually be logged.
  const lastTodayKeyRef = useRef(todayKey)
  useEffect(() => {
    const was = lastTodayKeyRef.current
    lastTodayKeyRef.current = todayKey
    if (was !== todayKey && dayKey === was) { setDayKey(todayKey); setExpandedId(null) }
  }, [todayKey])   // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!user) return
    try {
      const [p, g] = await Promise.all([getMealPlan(user.id), getUserGoals(user.id)])
      setPlan(p)
      setGoals(g)
      setLoadError(false)
      loadedRef.current = true
    } catch {
      if (!loadedRef.current) setLoadError(true)
    }
  }, [user])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const days = plan?.days ?? emptyDays()
  const dayMeals = days[dayKey] ?? []
  const totals = useMemo(() => sumPlanMacros(dayMeals), [dayMeals])
  const weekCount = planMealCount(days)
  const isToday = dayKey === todayKey
  const activeSection = SECTIONS.find(sec => sec.key === addingTo)
  const notes = plan?.notes
  const hasNotes = !!(notes && (notes.summary || notes.nutrition?.length || notes.prep?.length || notes.grocery?.length))
  const dayTitle = DAY_NAMES[dayKey]

  const openAdd = (sectionKey) => { setAddingTo(sectionKey); setFlow('picker') }
  const closeAll = () => { setAddingTo(null); setFlow(null) }

  // Writes go through the same optimistic-then-revert pattern as the Log tab.
  function updateDay(key, updater) {
    setPlan(prev => {
      const base = prev ?? { days: emptyDays(), notes: null }
      return { ...base, days: { ...base.days, [key]: updater(base.days[key] ?? []) } }
    })
  }

  const handlePlanMealAdded = async (meal) => {
    // Keep the flow's own source ('ai' for an AI estimate) so the tag shows;
    // anything without one was typed or picked by the user.
    const full = { ...meal, section: addingTo, source: meal.source ?? 'user' }
    const key = dayKey
    closeAll()
    updateDay(key, list => {
      const idx = list.findIndex(m => m.id === full.id)
      if (idx >= 0) { const copy = [...list]; copy[idx] = full; return copy }
      return [...list, full]
    })
    try {
      await addPlannedMeal(user.id, key, full)
    } catch {
      Alert.alert('Could not save to your plan', 'Please check your connection and try again.')
      load()
    }
  }

  const handlePlanMealDelete = async (id) => {
    const key = dayKey
    updateDay(key, list => list.filter(m => m.id !== id))
    try {
      await deletePlannedMeal(user.id, key, id)
    } catch {
      Alert.alert('Could not update your plan', 'Please try again.')
      load()
    }
  }

  const handlePlanReorder = async (next) => {
    const key = dayKey
    updateDay(key, () => next)
    try {
      await setPlannedDay(user.id, key, next)
    } catch {
      Alert.alert('Could not move meal', 'Please check your connection and try again.')
      load()
    }
  }

  const handlePlanPortion = async (meal, portion) => {
    const key = dayKey
    const updated = applyPortion(meal, portion)
    updateDay(key, list => list.map(m => (m.id === updated.id ? updated : m)))
    try {
      await addPlannedMeal(user.id, key, updated)
    } catch {
      Alert.alert('Could not change the portion', 'Please check your connection and try again.')
      load()
    }
  }

  // A planned meal becomes a logged one for today. The plan repeats every
  // week, so only today's weekday can be logged: any other day has no date.
  const toLogged = meal => ({
    id: newMealId(), name: meal.name, contents: meal.contents ?? '', section: meal.section, macros: meal.macros ?? {},
    source: derivedSource(meal),
  })

  // One log at a time: a second tap while the first is saving logged the
  // meal twice.
  const loggingRef = useRef(false)

  async function logPlannedMeal(meal) {
    if (loggingRef.current) return
    loggingRef.current = true
    try {
      await saveMeal(user.id, todayStr, toLogged(meal))
      Alert.alert('Logged', `${meal.name} is on today's log.`)
    } catch {
      Alert.alert('Could not log meal', 'Please check your connection and try again.')
    } finally {
      loggingRef.current = false
    }
  }

  function logWholeDay() {
    const list = dayMeals
    Alert.alert(
      `Log ${list.length} planned meal${list.length === 1 ? '' : 's'}?`,
      "They will be added to today's log.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log them', onPress: async () => {
          if (loggingRef.current) return
          loggingRef.current = true
          try {
            for (const meal of list) await saveMeal(user.id, todayStr, toLogged(meal))
            Alert.alert('Logged', 'Your planned meals are on the Log tab.')
          } catch {
            Alert.alert('Could not log everything', 'Some meals may not have been saved. Check the Log tab.')
          } finally {
            loggingRef.current = false
          }
        }},
      ],
    )
  }

  // The AI planner's week replaces the whole plan.
  function applyAiPlan(week) {
    const commit = async () => {
      setPlannerOpen(false)
      setPlan(week)
      setNotesOpen(true)
      setExpandedId(null)
      try {
        await replaceMealPlan(user.id, week)
      } catch {
        Alert.alert('Could not save the plan', 'Please check your connection and try again.')
        load()
      }
    }
    if (weekCount > 0) {
      Alert.alert(
        'Replace your weekly plan?',
        `The ${weekCount} meal${weekCount === 1 ? '' : 's'} already planned will be replaced.`,
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Replace', style: 'destructive', onPress: commit }],
      )
    } else {
      commit()
    }
  }

  function clearPlan() {
    Alert.alert(
      'Clear your weekly plan?',
      'Every planned meal will be removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: async () => {
          const empty = { days: emptyDays(), notes: null }
          setPlan(empty)
          setNotesOpen(false)
          try {
            await replaceMealPlan(user.id, empty)
          } catch {
            Alert.alert('Could not clear the plan', 'Please try again.')
            load()
          }
        }},
      ],
    )
  }

  return (
    <View style={s.pane}>
      {/* Header: the plan is one repeating week, so the strip is weekday
          names only, like the class schedule's day picker. */}
      <View style={s.planHeader}>
        <View style={s.planTitleRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.planTitle}>Weekly plan</Text>
            <Text style={s.planWeekSub}>
              {weekCount} meal{weekCount === 1 ? '' : 's'} planned · repeats every week
            </Text>
          </View>
          {!isToday && (
            <Pressable
              style={[s.planActionBtn, { backgroundColor: theme.accent + '20' }]}
              onPress={() => { setDayKey(todayKey); setExpandedId(null) }}
              hitSlop={6}
            >
              <Text style={[s.planActionText, { color: theme.accent }]}>Today</Text>
            </Pressable>
          )}
        </View>
        <View style={s.planDayStrip}>
          {PLAN_DAYS.map(d => {
            const active = d === dayKey
            const isTodayChip = d === todayKey
            const count = days[d]?.length ?? 0
            return (
              <Pressable
                key={d}
                onPress={() => { setDayKey(d); setExpandedId(null) }}
                style={[s.planDayChip, {
                  backgroundColor: active ? theme.accent : 'transparent',
                  // Selected reads as a fill, today as a ring; the border is
                  // always present so highlighting can't resize the chip.
                  borderColor: !active && isTodayChip ? theme.accent : 'transparent',
                }]}
              >
                <Text style={[s.planDayName, { color: active ? '#fff' : isTodayChip ? theme.accent : theme.subtext }]}>
                  {d}
                </Text>
                <View style={[s.planDayCount, { backgroundColor: active ? '#ffffff2e' : count ? theme.accent + '15' : 'transparent' }]}>
                  <Text style={[s.planDayCountText, { color: active ? '#fff' : count ? theme.accent : 'transparent' }]}>{count}</Text>
                </View>
              </Pressable>
            )
          })}
        </View>
      </View>

      {loadError ? (
        <View style={s.errorWrap}>
          <Text style={s.errorTitle}>We couldn't load your plan</Text>
          <Text style={s.errorSub}>Check your connection and try again.</Text>
          <Pressable style={s.errorBtn} onPress={load}>
            <Text style={s.errorBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
      <DayList
        meals={dayMeals}
        canEdit
        canDrag
        emptyText="Nothing planned"
        deleteLabel="Remove from plan"
        onLogMeal={isToday ? logPlannedMeal : null}
        onAdd={openAdd}
        onDelete={handlePlanMealDelete}
        onReorder={handlePlanReorder}
        onPortion={handlePlanPortion}
        expandedId={expandedId}
        onToggleExpand={id => setExpandedId(expandedId === id ? null : id)}
        header={(
        <View>

        {/* Actions: the AI planner, the week's notes, clear */}
        <View style={s.planActions}>
          <Pressable style={[s.plannerBtn, { backgroundColor: theme.accent }]} onPress={() => setPlannerOpen(true)}>
            <Text style={s.plannerBtnText}>✦ AI meal planner</Text>
          </Pressable>
          {hasNotes && (
            <Pressable
              style={[s.planActionBtn, { backgroundColor: theme.accent + '20' }]}
              onPress={() => setNotesOpen(v => !v)}
            >
              <Text style={[s.planActionText, { color: theme.accent }]}>{notesOpen ? 'Hide notes' : 'Week notes'}</Text>
            </Pressable>
          )}
          {weekCount > 0 && (
            <Pressable style={s.planActionBtn} onPress={clearPlan} hitSlop={6}>
              <Text style={[s.planActionText, { color: theme.muted }]}>Clear</Text>
            </Pressable>
          )}
        </View>

        {/* What the planner said about this week */}
        {hasNotes && notesOpen && (
          <View style={s.notesCard}>
            {!!notes.summary && <Text style={s.notesSummary}>{notes.summary}</Text>}
            {notes.nutrition?.length > 0 && (
              <>
                <Text style={s.notesTitle}>NUTRITION CHECK</Text>
                {notes.nutrition.map((n, i) => (
                  <View key={i} style={s.notesRow}>
                    <Text style={[s.notesBullet, { color: theme.accent }]}>•</Text>
                    <Text style={s.notesText}>{n}</Text>
                  </View>
                ))}
              </>
            )}
            {notes.prep?.length > 0 && (
              <>
                <Text style={s.notesTitle}>MEAL PREP</Text>
                {notes.prep.map((n, i) => (
                  <View key={i} style={s.notesRow}>
                    <Text style={[s.notesNum, { color: theme.accent }]}>{i + 1}.</Text>
                    <Text style={s.notesText}>{n}</Text>
                  </View>
                ))}
              </>
            )}
            {notes.grocery?.length > 0 && (
              <>
                <Pressable style={s.notesToggle} onPress={() => setGroceryOpen(v => !v)}>
                  <Text style={[s.notesTitle, { marginTop: 0, marginBottom: 0 }]}>GROCERY LIST · {notes.grocery.length}</Text>
                  <Text style={s.summaryDetailToggleArrow}>{groceryOpen ? '▲' : '▼'}</Text>
                </Pressable>
                {groceryOpen && notes.grocery.map((g, i) => (
                  <View key={i} style={s.groceryRow}>
                    <Text style={s.groceryItem}>{g.item}</Text>
                    <Text style={s.groceryAmount}>{g.amount}</Text>
                  </View>
                ))}
              </>
            )}
            <Text style={s.notesDisclaimer}>
              AI guidance from what you shared, not medical advice. For supplements or a health condition, speak to a doctor or registered dietitian.
            </Text>
          </View>
        )}

        <DailySummary
          totals={totals}
          goals={goals}
          selectedDate={todayStr}
          title={`${dayTitle.toUpperCase()}'S PLAN`}
        />

        {isToday && dayMeals.length > 0 && (
          <Pressable style={[s.logDayBtn, { borderColor: theme.accent }]} onPress={logWholeDay}>
            <Text style={[s.logDayText, { color: theme.accent }]}>
              Log {dayMeals.length === 1 ? 'this meal' : `all ${dayMeals.length} meals`} to today
            </Text>
          </Pressable>
        )}

        </View>
        )}
      />
      )}

      <AddMealFlows
        flow={flow}
        section={activeSection}
        userId={user.id}
        onFlow={setFlow}
        onAdd={handlePlanMealAdded}
        onClose={closeAll}
      />

      <MealPlannerModal
        visible={plannerOpen}
        onClose={() => setPlannerOpen(false)}
        userId={user.id}
        goals={goals}
        onApply={applyAiPlan}
      />
    </View>
  )
}

// ── The page: Log | Plan ───────────────────────────────────────────────────

export default function MealsScreen() {
  const { user } = useAuth()
  const { theme } = useTheme()
  const navigation = useNavigation()
  const s = makeStyles(theme)
  const [tab, setTab] = useState('log')
  const [coachOpen, setCoachOpen] = useState(false)

  // The meal coach lives behind an ✦ AI button in the header.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => setCoachOpen(true)}
          hitSlop={10}
          style={[s.coachBtn, { backgroundColor: theme.accent + '20' }]}
        >
          <Text style={[s.coachBtnText, { color: theme.accent }]}>✦ AI</Text>
        </Pressable>
      ),
    })
  }, [navigation, theme])   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={s.page}>
      <MealCoachChat visible={coachOpen} onClose={() => setCoachOpen(false)} userId={user.id} />
      <View style={s.tabBar}>
        <View style={s.tabPill}>
          {[['log', 'Log'], ['plan', 'Plan']].map(([key, label]) => {
            const active = tab === key
            return (
              <Pressable
                key={key}
                style={[s.tabOpt, active && { backgroundColor: theme.accent }]}
                onPress={() => setTab(key)}
              >
                <Text style={[s.tabOptText, { color: active ? '#fff' : theme.subtext }]}>{label}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>
      {tab === 'log' ? <LogPane user={user} /> : <PlanPane user={user} />}
    </View>
  )
}

function makeStyles(theme) { return StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.bg },
  pane: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },

  tabBar: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, backgroundColor: theme.header },
  coachBtn: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, marginRight: 14 },
  coachBtnText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
  tabPill: { flexDirection: 'row', borderRadius: 14, padding: 3, backgroundColor: theme.isDark ? '#1c1c32' : '#f0f0f8' },
  tabOpt: { flex: 1, paddingVertical: 8, borderRadius: 11, alignItems: 'center' },
  tabOptText: { fontSize: 13.5, fontWeight: '700' },

  summaryCard: {
    backgroundColor: theme.card, borderRadius: 22, padding: 22, marginBottom: 16,
    shadowColor: theme.isDark ? 'transparent' : '#0d1b5e',
    shadowOffset: { width: 4, height: 5 }, shadowOpacity: 0.18, shadowRadius: 0, elevation: 6,
  },
  summaryTitle: { fontSize: 11, fontWeight: '800', color: theme.muted, letterSpacing: 1.4, marginBottom: 10 },
  calRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 18 },
  calNum: { fontSize: 52, fontWeight: '800', color: theme.text, lineHeight: 56 },
  calUnit: { fontSize: 17, color: theme.subtext, fontWeight: '600' },
  summaryMacros: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryMacroBox: { alignItems: 'center' },
  summaryMacroVal: { fontSize: 16, fontWeight: '800' },
  summaryMacroUnit: { fontSize: 12, fontWeight: '600' },
  summaryMacroLabel: { fontSize: 10, color: theme.muted, marginTop: 2, fontWeight: '600' },

  calGoal: { fontSize: 13, color: theme.muted, fontWeight: '600' },
  calToGoWrap: { flex: 1, alignItems: 'flex-end', justifyContent: 'flex-end', paddingBottom: 8, paddingLeft: 8 },
  calToGo: { fontSize: 12.5, fontWeight: '700', textAlign: 'right', lineHeight: 16 },

  calBarWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  calBarTrack: { flex: 1, height: 7, backgroundColor: theme.input, borderRadius: 4, overflow: 'hidden' },
  calBarFill: { height: '100%', borderRadius: 4 },
  calBarPct: { fontSize: 12, fontWeight: '700', color: theme.subtext, minWidth: 38, textAlign: 'right' },

  macroBarsWrap: { gap: 9, marginBottom: 16 },
  macroBarRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  macroBarLabel: { fontSize: 12, fontWeight: '700', width: 52 },
  macroBarTrack: { flex: 1, height: 6, backgroundColor: theme.input, borderRadius: 3, overflow: 'hidden' },
  macroBarFill: { height: '100%', borderRadius: 3 },
  macroBarVal: { fontSize: 12, fontWeight: '700', color: theme.text, textAlign: 'right', minWidth: 30 },
  macroBarUnit: { fontSize: 10, fontWeight: '600' },
  macroBarGoal: { fontSize: 11, color: theme.muted, fontWeight: '500', minWidth: 40, textAlign: 'right' },

  summaryDetailToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 16, paddingTop: 14, paddingHorizontal: 2,
    borderTopWidth: 1, borderTopColor: theme.divider,
  },
  summaryDetailToggleText: { fontSize: 13, fontWeight: '600', color: theme.subtext },
  summaryDetailToggleArrow: { fontSize: 12, color: theme.muted, fontWeight: '700' },

  // One section = a header row, its meal rows and a footer row, drawn so
  // they read as a single card (the outline runs down both sides).
  secTop: {
    backgroundColor: theme.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderWidth: 1, borderBottomWidth: 0, borderColor: theme.divider, borderLeftWidth: 4,
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6,
  },
  secBody: {
    backgroundColor: theme.card,
    borderWidth: 1, borderTopWidth: 0, borderBottomWidth: 0, borderColor: theme.divider, borderLeftWidth: 4,
    paddingHorizontal: 16, paddingTop: 8,
  },
  secBodyActive: {
    borderRadius: 16, borderTopWidth: 1, borderBottomWidth: 1, paddingBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 8,
  },
  secBottom: {
    backgroundColor: theme.card, borderBottomLeftRadius: 20, borderBottomRightRadius: 20,
    borderWidth: 1, borderTopWidth: 0, borderColor: theme.divider, borderLeftWidth: 4,
    paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12, marginBottom: 14,
  },
  dragHint: { fontSize: 12, color: theme.muted, fontWeight: '600', textAlign: 'center', marginTop: -6, marginBottom: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sectionIconWrap: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  sectionEmoji: { fontSize: 22 },
  sectionLabel: { fontSize: 17, fontWeight: '700', color: theme.text },
  sectionCal: { fontSize: 12, fontWeight: '600', marginTop: 1 },
  addBtn: { borderRadius: 11, paddingHorizontal: 14, paddingVertical: 9 },
  addBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },

  emptyRow: { paddingVertical: 16, alignItems: 'center' },
  emptyText: { fontSize: 14, color: theme.muted, fontStyle: 'italic' },

  errorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorTitle: { fontSize: 17, fontWeight: '700', color: theme.text, letterSpacing: -0.2, textAlign: 'center' },
  errorSub: { fontSize: 13, fontWeight: '500', color: theme.subtext, textAlign: 'center', marginTop: 6, lineHeight: 18 },
  errorBtn: { borderRadius: 14, paddingVertical: 13, paddingHorizontal: 30, marginTop: 20, backgroundColor: theme.accent },
  errorBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  mealCard: {
    backgroundColor: theme.input, borderRadius: 14, borderWidth: 1.5, borderColor: theme.divider,
    overflow: 'hidden',
  },
  mealCardTop: { flexDirection: 'row', alignItems: 'flex-start', padding: 12, gap: 10 },
  mealColorBar: { width: 3, borderRadius: 2, alignSelf: 'stretch', minHeight: 40 },
  mealName: { fontSize: 15, fontWeight: '700', color: theme.text, marginBottom: 3 },
  mealContents: { fontSize: 13, color: theme.subtext, lineHeight: 18, marginBottom: 6 },
  mealPrep: { fontSize: 12, color: theme.muted, lineHeight: 16, marginBottom: 6, fontStyle: 'italic' },
  mealQuickRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  mealQuickItem: { fontSize: 12, color: theme.subtext, fontWeight: '500' },
  mealQuickDot: { fontSize: 12, color: theme.muted },
  mealAiTag: { fontSize: 10.5, fontWeight: '800', marginLeft: 4, letterSpacing: 0.3 },
  mealPortionTag: { fontSize: 10.5, fontWeight: '800', marginLeft: 4, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },

  portionBox: { marginHorizontal: 14, marginTop: 4, marginBottom: 6, backgroundColor: theme.input, borderRadius: 12, padding: 12 },
  portionTitle: { fontSize: 10, fontWeight: '800', color: theme.muted, letterSpacing: 1, marginBottom: 8 },
  portionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  portionStep: { width: 34, height: 34, borderRadius: 10, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.divider },
  portionStepText: { fontSize: 20, color: theme.text, fontWeight: '600', lineHeight: 24 },
  portionInput: { width: 62, height: 34, borderWidth: 1.5, borderRadius: 10, textAlign: 'center', fontSize: 15, fontWeight: '700', color: theme.text, backgroundColor: theme.card },
  portionLabel: { flex: 1, fontSize: 12, color: theme.subtext, fontWeight: '500' },
  portionChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  portionChip: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: theme.divider, backgroundColor: theme.card },
  portionChipText: { fontSize: 12.5, fontWeight: '700', color: theme.subtext },
  doneBar: {
    flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 18, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: theme.divider,
  },
  doneBarText: { fontSize: 16, fontWeight: '700' },
  mealCalBox: { alignItems: 'center', minWidth: 44 },
  mealCalNum: { fontSize: 22, fontWeight: '800', lineHeight: 26 },
  mealCalUnit: { fontSize: 10, color: theme.muted, fontWeight: '700' },

  detailWrap: { paddingHorizontal: 14, paddingBottom: 4 },
  detailGroup: { marginBottom: 10 },
  detailGroupLabel: { fontSize: 9, fontWeight: '800', color: theme.muted, letterSpacing: 1.2, marginBottom: 6, marginTop: 2 },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: theme.divider,
  },
  detailLabel: { fontSize: 13, color: theme.subtext, fontWeight: '400' },
  detailVal: { fontSize: 13, fontWeight: '700', color: theme.text },

  macroToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 14, marginTop: 4, marginBottom: 4,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: theme.input, borderRadius: 10,
  },
  macroToggleLabel: { fontSize: 13, fontWeight: '600', color: theme.subtext },
  macroToggleArrow: { fontSize: 12, color: theme.muted, fontWeight: '700' },

  logBtn: {
    marginHorizontal: 14, marginTop: 6, marginBottom: 4,
    paddingVertical: 11, borderRadius: 11, alignItems: 'center',
  },
  logBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  deleteBtn: {
    marginHorizontal: 14, marginBottom: 14, marginTop: 4,
    paddingVertical: 11, borderRadius: 11,
    backgroundColor: '#fef2f2', alignItems: 'center',
  },
  deleteBtnText: { color: '#ef4444', fontWeight: '700', fontSize: 14 },

  microToggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 14, paddingTop: 14, paddingHorizontal: 2,
    borderTopWidth: 1, borderTopColor: theme.divider,
  },
  microWrap: { paddingTop: 10, paddingHorizontal: 2 },
  microGroupLabel: { fontSize: 9, fontWeight: '800', color: theme.muted, letterSpacing: 1.2, marginBottom: 6 },
  microRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: theme.divider,
  },
  microLabel: { fontSize: 11, color: theme.subtext, fontWeight: '500', width: 114 },
  microBarTrack: { flex: 1, height: 5, backgroundColor: theme.input, borderRadius: 2.5, overflow: 'hidden', marginHorizontal: 8 },
  microBarFill:  { height: 5, borderRadius: 2.5 },
  microRight:    { fontSize: 11, textAlign: 'right', minWidth: 92 },
  microActual:   { fontWeight: '700', color: theme.text },
  microDvMax:    { color: theme.muted },

  weekNav: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: theme.header,
    borderBottomWidth: 1, borderBottomColor: theme.divider,
  },
  weekArrow: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  weekArrowDisabled: { opacity: 0.25 },
  weekArrowText: { fontSize: 26, color: theme.accent, fontWeight: '400', lineHeight: 30 },
  weekArrowTextDisabled: { color: theme.muted },
  weekDays: { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  dayCircle: { alignItems: 'center', paddingVertical: 5, paddingHorizontal: 3, borderRadius: 18, minWidth: 34 },
  dayCircleSelected: { backgroundColor: theme.accent },
  dayCircleFuture: { opacity: 0.3 },
  dayLabel: { fontSize: 10, fontWeight: '600', color: theme.muted, marginBottom: 2 },
  dayLabelSelected: { color: '#fff' },
  dayNum: { fontSize: 15, fontWeight: '700', color: theme.text },
  dayNumSelected: { color: '#fff' },
  todayDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: theme.accent, marginTop: 2 },

  // Plan tab header: same bones as the class calendar's day picker.
  planHeader: {
    backgroundColor: theme.header, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: theme.divider,
  },
  planTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  planTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, color: theme.text },
  planWeekSub: { fontSize: 11.5, fontWeight: '600', color: theme.muted, marginTop: 1 },
  planDayStrip: { flexDirection: 'row', gap: 5, paddingHorizontal: 10 },
  planDayChip: {
    flex: 1, minWidth: 40, alignItems: 'center', gap: 1, paddingVertical: 7,
    borderRadius: 15, borderWidth: 1.5,
  },
  planDayName: { fontSize: 12, fontWeight: '800' },
  planDayCount: { minWidth: 20, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  planDayCountText: { fontSize: 10.5, lineHeight: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },

  planActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  plannerBtn: { flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  plannerBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  planActionBtn: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  planActionText: { fontSize: 13, fontWeight: '700' },

  notesCard: {
    backgroundColor: theme.card, borderRadius: 20, padding: 18, marginBottom: 16,
    borderWidth: 1, borderColor: theme.cardBorder,
  },
  notesSummary: { fontSize: 14, lineHeight: 21, fontWeight: '500', color: theme.text },
  notesTitle: { fontSize: 10.5, fontWeight: '800', color: theme.muted, letterSpacing: 1.2, marginTop: 16, marginBottom: 8 },
  notesRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  notesBullet: { fontSize: 14, fontWeight: '800', lineHeight: 20 },
  notesNum: { fontSize: 13, fontWeight: '800', lineHeight: 20, minWidth: 18 },
  notesText: { flex: 1, fontSize: 13.5, lineHeight: 20, fontWeight: '500', color: theme.text },
  notesToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 8 },
  groceryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: theme.divider },
  groceryItem: { flex: 1, fontSize: 13.5, fontWeight: '600', color: theme.text },
  groceryAmount: { fontSize: 13, fontWeight: '500', color: theme.subtext },
  notesDisclaimer: { fontSize: 11.5, lineHeight: 16, fontWeight: '500', color: theme.muted, marginTop: 14 },

  logDayBtn: { borderRadius: 14, borderWidth: 1.5, paddingVertical: 12, alignItems: 'center', marginBottom: 14 },
  logDayText: { fontSize: 14, fontWeight: '700' },
}) }
