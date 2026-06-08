import { useState, useCallback, useMemo } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useAuth } from '../../lib/AuthContext'
import { useTheme } from '../../lib/ThemeContext'
import {
  getMeals, saveMeal, deleteMeal, today,
  getSavedMeals, upsertSavedMeal, deleteSavedMeal, getRecentMealHistory,
} from '../../lib/storage'
import { getUserGoals } from '../../lib/goalsStorage'
import AddMealModal from '../../components/AddMealModal'
import MealPickerSheet from '../../components/MealPickerSheet'
import BarcodeScanner from '../../components/BarcodeScanner'
import FoodSearch from '../../components/FoodSearch'
import HistoryPicker from '../../components/HistoryPicker'
import SavedMealsPicker from '../../components/SavedMealsPicker'

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

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
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

function DailySummary({ totals, goals, selectedDate }) {
  const { theme } = useTheme()
  const s = makeStyles(theme)
  const [showMicro, setShowMicro] = useState(false)
  const cal = Math.round(totals.calories || 0)
  const hasData = cal > 0
  const hasGoals = goals?.calories > 0

  const calPct = hasGoals ? Math.min(Math.round((cal / goals.calories) * 100), 999) : null
  const isToday = selectedDate === localDateStr(new Date())
  const titleText = isToday
    ? "TODAY'S NUTRITION"
    : new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()

  return (
    <View style={s.summaryCard}>
      <Text style={s.summaryTitle}>{titleText}</Text>
      <View style={s.calRow}>
        <Text style={[s.calNum, !hasData && { color: '#ccc' }]}>{cal.toLocaleString()}</Text>
        <View style={{ justifyContent: 'flex-end', paddingBottom: 6 }}>
          <Text style={s.calUnit}>kcal</Text>
          {hasGoals && <Text style={s.calGoal}>/ {goals.calories.toLocaleString()}</Text>}
        </View>
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

function MealCard({ meal, color, expanded, onToggle, onDelete }) {
  const { theme } = useTheme()
  const s = makeStyles(theme)
  const [showDetail, setShowDetail] = useState(false)
  const cal    = meal.macros?.calories || 0
  const prot   = meal.macros?.protein  || 0
  const carbs  = meal.macros?.carbs    || 0
  const fat    = meal.macros?.fat      || 0

  return (
    <Pressable style={[s.mealCard, expanded && { borderColor: color + '55' }]} onPress={onToggle}>
      <View style={s.mealCardTop}>
        <View style={[s.mealColorBar, { backgroundColor: color }]} />
        <View style={{ flex: 1 }}>
          <Text style={s.mealName}>{meal.name}</Text>
          {meal.contents ? (
            <Text style={s.mealContents} numberOfLines={expanded ? undefined : 1}>{meal.contents}</Text>
          ) : null}
          <View style={s.mealQuickRow}>
            <Text style={s.mealQuickItem}>{fmt(prot)}g protein</Text>
            <Text style={s.mealQuickDot}>·</Text>
            <Text style={s.mealQuickItem}>{fmt(carbs)}g carbs</Text>
            <Text style={s.mealQuickDot}>·</Text>
            <Text style={s.mealQuickItem}>{fmt(fat)}g fat</Text>
          </View>
        </View>
        <View style={s.mealCalBox}>
          <Text style={[s.mealCalNum, { color }]}>{Math.round(cal)}</Text>
          <Text style={s.mealCalUnit}>kcal</Text>
        </View>
      </View>

      {expanded && (
        <>
          <Pressable style={s.macroToggle} onPress={() => setShowDetail(v => !v)}>
            <Text style={s.macroToggleLabel}>All nutrition details</Text>
            <Text style={s.macroToggleArrow}>{showDetail ? '▲' : '▼'}</Text>
          </Pressable>
          {showDetail && <MacroDetail macros={meal.macros || {}} />}
          <Pressable style={s.deleteBtn} onPress={onDelete}>
            <Text style={s.deleteBtnText}>Delete Meal</Text>
          </Pressable>
        </>
      )}
    </Pressable>
  )
}

function MealSection({ section, meals, onAdd, onDelete, expandedId, onToggleExpand, isViewOnly }) {
  const { theme } = useTheme()
  const s = makeStyles(theme)
  const sectionCal = Math.round(sumMacros(meals).calories || 0)

  return (
    <View style={[s.section, { borderLeftColor: section.color, borderLeftWidth: 4 }]}>
      <View style={s.sectionHeader}>
        <View style={s.sectionLeft}>
          <View style={[s.sectionIconWrap, { backgroundColor: section.bg }]}>
            <Text style={s.sectionEmoji}>{section.emoji}</Text>
          </View>
          <View>
            <Text style={s.sectionLabel}>{section.label}</Text>
            {meals.length > 0 && (
              <Text style={[s.sectionCal, { color: section.color }]}>{sectionCal} kcal · {meals.length} meal{meals.length > 1 ? 's' : ''}</Text>
            )}
          </View>
        </View>
        {!isViewOnly && (
          <Pressable
            style={[s.addBtn, { backgroundColor: section.color }]}
            onPress={onAdd}
          >
            <Text style={s.addBtnText}>+ Add</Text>
          </Pressable>
        )}
      </View>

      {meals.length === 0 ? (
        <View style={s.emptyRow}>
          <Text style={s.emptyText}>Nothing logged yet</Text>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {meals.map(meal => (
            <MealCard
              key={meal.id}
              meal={meal}
              color={section.color}
              expanded={expandedId === meal.id}
              onToggle={() => onToggleExpand(meal.id)}
              onDelete={() => onDelete(meal.id)}
            />
          ))}
        </View>
      )}
    </View>
  )
}

export default function MealsScreen() {
  const { user } = useAuth()
  const { theme } = useTheme()
  const s = makeStyles(theme)
  const [meals, setMeals] = useState([])
  const [goals, setGoals] = useState(null)
  const [addingTo, setAddingTo] = useState(null)
  const [flow, setFlow] = useState(null)  // 'picker'|'barcode'|'history'|'saved'|'manual'
  const [expandedId, setExpandedId] = useState(null)
  const [selectedDate, setSelectedDate] = useState(today())
  const [weekOffset, setWeekOffset] = useState(0)

  const load = useCallback(async () => {
    if (!user) return
    const [mealData, goalData] = await Promise.all([
      getMeals(user.id, selectedDate),
      getUserGoals(user.id),
    ])
    setMeals(mealData)
    setGoals(goalData)
  }, [user, selectedDate])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const totals = useMemo(() => sumMacros(meals), [meals])
  const activeSection = SECTIONS.find(sec => sec.key === addingTo)

  const openAdd = (sectionKey) => { setAddingTo(sectionKey); setFlow('picker') }
  const closeAll = () => { setAddingTo(null); setFlow(null) }

  function handleWeekChange(newOffset) {
    if (newOffset > 0) return
    setWeekOffset(newOffset)
    const todayStr = localDateStr(new Date())
    const days = getWeekDays(newOffset)
    const available = days.filter(d => localDateStr(d) <= todayStr)
    if (available.length > 0) setSelectedDate(localDateStr(available[available.length - 1]))
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
      await saveMeal(user.id, date, full)
    } catch (e) {
      // …and revert to server truth if the write actually failed.
      Alert.alert('Could not save meal', 'Please check your connection and try again.')
      if (date === selectedDate) load()
    }
  }

  const isViewOnly = selectedDate !== today()
  return (
    <View style={s.page}>
      <WeekNav
        selectedDate={selectedDate}
        onSelect={setSelectedDate}
        weekOffset={weekOffset}
        onWeekChange={handleWeekChange}
      />
      <ScrollView contentContainerStyle={s.content}>
      <DailySummary totals={totals} goals={goals} selectedDate={selectedDate} />

      {SECTIONS.map(sec => (
        <MealSection
          key={sec.key}
          section={sec}
          meals={meals.filter(m => m.section === sec.key)}
          onAdd={() => openAdd(sec.key)}
          onDelete={async id => {
            const date = selectedDate
            setMeals(prev => prev.filter(m => m.id !== id))
            try {
              await deleteMeal(user.id, date, id)
            } catch (e) {
              Alert.alert('Could not delete meal', 'Please try again.')
              if (date === selectedDate) load()
            }
          }}
          expandedId={expandedId}
          onToggleExpand={id => setExpandedId(expandedId === id ? null : id)}
          isViewOnly={isViewOnly}
        />
      ))}

      {/* Step 1: pick how to add */}
      {flow === 'picker' && activeSection && (
        <MealPickerSheet
          sectionLabel={activeSection.label}
          sectionColor={activeSection.color}
          onSelect={f => setFlow(f)}
          onClose={closeAll}
        />
      )}

      {/* Step 2a: barcode scanner */}
      {flow === 'barcode' && activeSection && (
        <BarcodeScanner
          section={addingTo}
          sectionLabel={activeSection.label}
          sectionColor={activeSection.color}
          onAdd={handleMealAdded}
          onClose={closeAll}
          onSearchInstead={() => setFlow('search')}
        />
      )}

      {/* Step 2e: food database search */}
      {flow === 'search' && activeSection && (
        <FoodSearch
          section={addingTo}
          sectionLabel={activeSection.label}
          sectionColor={activeSection.color}
          onAdd={handleMealAdded}
          onClose={closeAll}
        />
      )}

      {/* Step 2b: history */}
      {flow === 'history' && activeSection && (
        <HistoryPicker
          section={addingTo}
          sectionLabel={activeSection.label}
          sectionColor={activeSection.color}
          loadHistory={() => getRecentMealHistory(user.id)}
          onAdd={handleMealAdded}
          onClose={closeAll}
        />
      )}

      {/* Step 2c: saved meals */}
      {flow === 'saved' && activeSection && (
        <SavedMealsPicker
          section={addingTo}
          sectionLabel={activeSection.label}
          sectionColor={activeSection.color}
          loadSaved={() => getSavedMeals(user.id)}
          onSaveTemplate={meal => upsertSavedMeal(user.id, meal)}
          onDeleteTemplate={id => deleteSavedMeal(user.id, id)}
          onAdd={handleMealAdded}
          onClose={closeAll}
        />
      )}

      {/* Step 2d: manual entry */}
      {flow === 'manual' && activeSection && (
        <AddMealModal
          section={addingTo}
          sectionLabel={activeSection.label}
          sectionColor={activeSection.color}
          onSave={handleMealAdded}
          onClose={closeAll}
        />
      )}
      </ScrollView>
    </View>
  )
}

function makeStyles(theme) { return StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, paddingBottom: 40 },

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

  section: {
    backgroundColor: theme.card, borderRadius: 20, padding: 16,
    marginBottom: 14, overflow: 'hidden',
    shadowColor: theme.isDark ? 'transparent' : '#0d1b5e',
    shadowOffset: { width: 4, height: 5 }, shadowOpacity: 0.18, shadowRadius: 0, elevation: 4,
  },
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

  mealCard: {
    backgroundColor: theme.input, borderRadius: 14, borderWidth: 1.5, borderColor: theme.divider,
    overflow: 'hidden',
  },
  mealCardTop: { flexDirection: 'row', alignItems: 'flex-start', padding: 12, gap: 10 },
  mealColorBar: { width: 3, borderRadius: 2, alignSelf: 'stretch', minHeight: 40 },
  mealName: { fontSize: 15, fontWeight: '700', color: theme.text, marginBottom: 3 },
  mealContents: { fontSize: 13, color: theme.subtext, lineHeight: 18, marginBottom: 6 },
  mealQuickRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  mealQuickItem: { fontSize: 12, color: theme.subtext, fontWeight: '500' },
  mealQuickDot: { fontSize: 12, color: theme.muted },
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
}) }
