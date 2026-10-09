import { useState, useEffect, useRef } from 'react'
import {
  View, Text, Pressable, StyleSheet, ScrollView,
  TextInput, ActivityIndicator, FlatList,
} from 'react-native'
import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import { useAuth } from '../lib/AuthContext'
import { getWorkoutPlan, saveWorkoutPlan, getWorkoutLog, today } from '../lib/storage'
import { WGER_CATEGORIES, fetchExercisesByCategory, searchExercises } from '../lib/wgerApi'

const COLOR = '#6366f1'

function PreviewPanel({ exercise, onClose }) {
  const allMuscles = [...exercise.muscles, ...exercise.musclesSecondary]

  return (
    <View style={s.previewPanel}>
      <View style={s.previewHeader}>
        <View style={{ flex: 1 }}>
          <Text style={s.previewName}>{exercise.name}</Text>
          <Text style={s.previewMeta}>
            {[exercise.category, exercise.equipment]
              .filter(Boolean).join('  ·  ')}
          </Text>
          {allMuscles.length > 0 && (
            <View style={s.muscleTags}>
              {exercise.muscles.map(m => (
                <View key={m.name} style={s.muscleTag}>
                  <Text style={s.muscleTagText}>{m.name}</Text>
                </View>
              ))}
              {exercise.musclesSecondary.map(m => (
                <View key={m.name} style={s.muscleTagSec}>
                  <Text style={s.muscleTagTextSec}>{m.name}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <Pressable onPress={onClose} hitSlop={10} style={s.closeBtn}>
          <Text style={s.closeBtnText}>✕</Text>
        </Pressable>
      </View>

      {exercise.gifUrl ? (
        <Image
          source={{ uri: exercise.gifUrl }}
          style={s.previewGif}
          contentFit="contain"
          autoplay
        />
      ) : (
        <View style={s.noVideoWrap}>
          <Text style={s.noVideoText}>No preview available</Text>
        </View>
      )}

      {exercise.instructions?.length > 0 && (
        <View style={s.instructions}>
          {exercise.instructions.map((step, i) => (
            <View key={i} style={s.instructionRow}>
              <Text style={s.instructionNum}>{i + 1}</Text>
              <Text style={s.instructionText}>{step}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

function ExerciseCard({ exercise, isIn, isPreviewing, onToggle, onPreview, isDoneToday }) {
  return (
    <View style={[s.card, isIn && s.cardActive]}>
      <Pressable style={s.cardMain} onPress={() => onPreview(exercise)}>
        <View style={s.thumbWrap}>
          {exercise.gifUrl ? (
            <Image
              source={{ uri: exercise.gifUrl }}
              style={s.thumbImg}
              contentFit="cover"
              autoplay={false}
            />
          ) : (
            <View style={[s.thumbPlaceholder, { borderColor: COLOR + '44' }]}>
              <Text style={s.thumbPlaceholderText}>🏋️</Text>
            </View>
          )}
          {isDoneToday && (
            <View style={s.doneTodayBadge}>
              <Text style={s.doneTodayText}>✓</Text>
            </View>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.exerciseName} numberOfLines={1}>{exercise.name}</Text>
          <Text style={s.exerciseMeta}>{exercise.category}</Text>
          {exercise.muscles.length > 0 && (
            <View style={s.muscleTags}>
              {exercise.muscles.slice(0, 3).map(m => (
                <View key={m.name} style={s.muscleTag}>
                  <Text style={s.muscleTagText}>{m.name}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <Text style={[s.previewHint, isPreviewing && s.previewHintActive]}>
          {isPreviewing ? '▲' : '▼'}
        </Text>
      </Pressable>
      <Pressable
        style={[s.addBtn, isIn && s.addBtnActive]}
        onPress={() => onToggle(exercise)}
      >
        <Text style={[s.addBtnText, isIn && s.addBtnTextActive]}>
          {isIn ? '✓ Added  ·  3 sets × 10 reps' : '+ Add to Workout'}
        </Text>
      </Pressable>
    </View>
  )
}

const MUSCLE_GROUP_CATEGORY = {
  push:       'chest',
  pull:       'back',
  legs:       'upper legs',
  chest:      'chest',
  back:       'back',
  shoulders:  'shoulders',
  arms:       'upper arms',
  biceps:     'upper arms',
  triceps:    'upper arms',
  glutes:     'upper legs',
  hamstrings: 'upper legs',
  quads:      'upper legs',
  calves:     'lower legs',
  abs:        'waist',
  core:       'waist',
}

function initialCategory(muscleGroup) {
  if (!muscleGroup) return WGER_CATEGORIES[0]
  const key = muscleGroup.toLowerCase().split('+')[0].trim()
  const bodyPart = MUSCLE_GROUP_CATEGORY[key]
  return WGER_CATEGORIES.find(c => c.id === bodyPart) ?? WGER_CATEGORIES[0]
}

export default function WorkoutLibrary() {
  const { muscleGroup } = useLocalSearchParams()
  const { user } = useAuth()
  const [plan, setPlan] = useState([])
  const [category, setCategory] = useState(() => initialCategory(muscleGroup))
  const [exercises, setExercises] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [count, setCount] = useState(0)
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [preview, setPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [doneToday, setDoneToday] = useState(new Set())
  const searchTimer = useRef(null)

  useEffect(() => {
    if (!user || !muscleGroup) return
    getWorkoutPlan(user.id, muscleGroup).then(setPlan)
  }, [user, muscleGroup])

  useEffect(() => {
    if (!user) return
    getWorkoutLog(user.id, today()).then(log => {
      if (!log) return
      const ids = new Set(
        (log.exercises || [])
          .filter(e => !e.skipped && e.sets?.length > 0)
          .map(e => e.exerciseId)
      )
      setDoneToday(ids)
    })
  }, [user])

  useEffect(() => {
    if (search.trim()) return
    setExercises([])
    setOffset(0)
    setCount(0)
    setLoadError(false)
    setLoading(true)
    fetchExercisesByCategory(category.id, 0)
      .then(data => {
        setExercises(data.results)
        setCount(data.count)
        setOffset(data.results.length)
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [category])

  useEffect(() => {
    clearTimeout(searchTimer.current)
    if (!search.trim()) {
      setSearchResults(null)
      setSearchError(false)
      return
    }
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true)
      setSearchError(false)
      try {
        const results = await searchExercises(search)
        setSearchResults(results)
      } catch {
        setSearchError(true)
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 500)
    return () => clearTimeout(searchTimer.current)
  }, [search])

  function loadMore() {
    if (loadingMore || exercises.length >= count || search.trim()) return
    setLoadingMore(true)
    fetchExercisesByCategory(category.id, offset)
      .then(data => {
        setExercises(prev => [...prev, ...data.results])
        setOffset(prev => prev + data.results.length)
      })
      .catch(console.error)
      .finally(() => setLoadingMore(false))
  }

  function togglePlan(exercise) {
    setPlan(prev =>
      prev.some(e => e.id === exercise.id)
        ? prev.filter(e => e.id !== exercise.id)
        : [...prev, { ...exercise, sets: 3, reps: 10, restSeconds: 90 }]
    )
  }

  function movePlanItem(fromIdx, direction) {
    const toIdx = fromIdx + direction
    if (toIdx < 0 || toIdx >= plan.length) return
    setPlan(prev => {
      const arr = [...prev]
      const [item] = arr.splice(fromIdx, 1)
      arr.splice(toIdx, 0, item)
      return arr
    })
  }

  function handlePreview(exercise) {
    setPreview(prev => (prev?.id === exercise.id ? null : exercise))
  }

  async function handleSave() {
    setSaving(true)
    try {
      await saveWorkoutPlan(user.id, muscleGroup, plan)
      router.back()
    } finally {
      setSaving(false)
    }
  }

  const displayed = searchResults !== null ? searchResults : exercises
  const isSearching = search.trim().length > 0

  return (
    <View style={s.page}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={s.backText}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Exercise Library</Text>
          {!!muscleGroup && (
            <Text style={s.headerSub}>{muscleGroup.replace(/\+/g, ' · ')}</Text>
          )}
        </View>
        <Pressable onPress={handleSave} disabled={saving} style={s.saveBtn}>
          <Text style={s.saveBtnText}>{saving ? 'Saving…' : `Save (${plan.length})`}</Text>
        </Pressable>
      </View>

      <View style={s.searchWrap}>
        <TextInput
          style={s.searchInput}
          placeholder="Search exercises…"
          placeholderTextColor="#bbb"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {!isSearching && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.catScroll}
          contentContainerStyle={s.catRow}
        >
          {WGER_CATEGORIES.map(c => (
            <Pressable
              key={c.id}
              style={[s.catChip, category.id === c.id && s.catChipActive]}
              onPress={() => setCategory(c)}
            >
              <Text style={[s.catLabel, category.id === c.id && s.catLabelActive]}>{c.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <FlatList
        style={{ flex: 1 }}
        data={displayed}
        keyExtractor={item => String(item.id)}
        contentContainerStyle={s.list}
        ListHeaderComponent={plan.length > 0 ? (
          <View style={s.planSection}>
            <View style={s.planSectionHeader}>
              <Text style={s.planSectionTitle}>Your Workout</Text>
              <Text style={s.planSectionCount}>{plan.length} exercise{plan.length !== 1 ? 's' : ''}</Text>
            </View>
            {plan.map((ex, idx) => (
              <View key={ex.id} style={s.planItem}>
                {ex.gifUrl ? (
                  <Image source={{ uri: ex.gifUrl }} style={s.planThumb} contentFit="cover" autoplay={false} />
                ) : (
                  <View style={[s.planThumb, s.planThumbPlaceholder]}>
                    <Text style={{ fontSize: 14 }}>🏋️</Text>
                  </View>
                )}
                <Text style={s.planItemName} numberOfLines={1}>{ex.name}</Text>
                <View style={s.planItemActions}>
                  <Pressable
                    onPress={() => movePlanItem(idx, -1)}
                    hitSlop={8}
                    disabled={idx === 0}
                    style={[s.planArrowBtn, idx === 0 && s.planArrowBtnDisabled]}
                  >
                    <Text style={s.planArrowText}>↑</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => movePlanItem(idx, 1)}
                    hitSlop={8}
                    disabled={idx === plan.length - 1}
                    style={[s.planArrowBtn, idx === plan.length - 1 && s.planArrowBtnDisabled]}
                  >
                    <Text style={s.planArrowText}>↓</Text>
                  </Pressable>
                  <Pressable onPress={() => togglePlan(ex)} hitSlop={8} style={s.planRemoveBtn}>
                    <Text style={s.planRemoveText}>✕</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          loading || searchLoading ? (
            <ActivityIndicator color={COLOR} style={{ marginTop: 40 }} size="large" />
          ) : loadError || searchError ? (
            <View style={s.errorWrap}>
              <Text style={s.errorEmoji}>⚠️</Text>
              <Text style={s.errorText}>Could not load exercises.</Text>
              <Text style={s.errorSub}>Check your internet connection and try again.</Text>
            </View>
          ) : (
            <Text style={s.empty}>
              {isSearching ? 'No exercises found.' : 'No exercises in this category.'}
            </Text>
          )
        }
        ListFooterComponent={
          loadingMore
            ? <ActivityIndicator color={COLOR} style={{ margin: 20 }} />
            : <View style={{ height: 40 }} />
        }
        renderItem={({ item }) => (
          <View>
            <ExerciseCard
              exercise={item}
              isIn={plan.some(e => e.id === item.id)}
              isPreviewing={preview?.id === item.id}
              onToggle={togglePlan}
              onPreview={handlePreview}
              isDoneToday={doneToday.has(item.id)}
            />
            {preview?.id === item.id && (
              <PreviewPanel exercise={item} onClose={() => setPreview(null)} />
            )}
          </View>
        )}
      />
    </View>
  )
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f6f7fb' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f0f0f3',
  },
  backText: { fontSize: 26, color: '#333', lineHeight: 30 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111' },
  headerSub: { fontSize: 12, color: COLOR, fontWeight: '600', marginTop: 1 },
  saveBtn: { backgroundColor: COLOR, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  searchWrap: { backgroundColor: '#fff', paddingHorizontal: 16, paddingBottom: 12, paddingTop: 10 },
  searchInput: {
    backgroundColor: '#f6f7fb', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#111',
    borderWidth: 1, borderColor: '#e5e7eb',
  },

  catScroll: { backgroundColor: '#fff', maxHeight: 56 },
  catRow: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, gap: 8, flexDirection: 'row' },
  catChip: {
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6,
    backgroundColor: '#f6f7fb', borderWidth: 1.5, borderColor: '#e5e7eb',
  },
  catChipActive: { backgroundColor: '#eef2ff', borderColor: COLOR },
  catLabel: { fontSize: 13, fontWeight: '600', color: '#888' },
  catLabelActive: { color: COLOR },

  list: { padding: 12, gap: 10, paddingTop: 0 },

  planSection: {
    backgroundColor: '#fff', borderRadius: 16, margin: 12, marginBottom: 4,
    padding: 14, borderWidth: 1.5, borderColor: COLOR + '55',
  },
  planSectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 },
  planSectionTitle: { fontSize: 13, fontWeight: '800', color: COLOR },
  planSectionCount: { fontSize: 12, color: '#888', fontWeight: '600' },
  planItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 7, borderTopWidth: 1, borderTopColor: '#f0f0f3',
  },
  planThumb: { width: 38, height: 38, borderRadius: 8, backgroundColor: '#eef2ff' },
  planThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  planItemName: { flex: 1, fontSize: 13, fontWeight: '600', color: '#222' },
  planItemActions: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  planArrowBtn: {
    width: 28, height: 28, borderRadius: 7, backgroundColor: '#f6f7fb',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#e5e7eb',
  },
  planArrowBtnDisabled: { opacity: 0.25 },
  planArrowText: { fontSize: 13, color: '#555', fontWeight: '700' },
  planRemoveBtn: {
    width: 28, height: 28, borderRadius: 7, backgroundColor: '#fef2f2',
    alignItems: 'center', justifyContent: 'center',
  },
  planRemoveText: { fontSize: 11, color: '#ef4444', fontWeight: '800' },
  empty: { textAlign: 'center', color: '#aaa', marginTop: 40, fontSize: 14 },
  errorWrap: { alignItems: 'center', padding: 40, gap: 6 },
  errorEmoji: { fontSize: 36, marginBottom: 4 },
  errorText: { fontSize: 15, fontWeight: '600', color: '#444' },
  errorSub: { fontSize: 13, color: '#aaa', textAlign: 'center' },

  previewPanel: {
    backgroundColor: '#fff', margin: 4, marginBottom: 12, borderRadius: 18,
    padding: 16, borderWidth: 1.5, borderColor: '#c7d2fe',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  previewHeader: { flexDirection: 'row', marginBottom: 14 },
  previewName: { fontSize: 17, fontWeight: '800', color: '#111', marginBottom: 2 },
  previewMeta: { fontSize: 12, color: '#888', marginBottom: 8 },
  closeBtn: { padding: 4 },
  closeBtnText: { color: '#ccc', fontSize: 16 },

  previewGif: {
    width: '100%', aspectRatio: 1, borderRadius: 12,
    backgroundColor: '#f0f0f0', marginBottom: 14,
  },
  noVideoWrap: {
    height: 60, alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  noVideoText: { fontSize: 13, color: '#bbb' },

  instructions: { gap: 8, marginTop: 4 },
  instructionRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  instructionNum: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: COLOR, color: '#fff',
    fontSize: 12, fontWeight: '700',
    textAlign: 'center', lineHeight: 22, flexShrink: 0,
  },
  instructionText: { flex: 1, fontSize: 13, color: '#444', lineHeight: 19 },

  muscleTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  muscleTag: { backgroundColor: '#f0fdf4', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  muscleTagText: { fontSize: 11, fontWeight: '600', color: '#065f46' },
  muscleTagSec: { backgroundColor: '#fefce8', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  muscleTagTextSec: { fontSize: 11, fontWeight: '600', color: '#854d0e' },

  card: {
    backgroundColor: '#fff', borderRadius: 16,
    borderWidth: 1.5, borderColor: '#e5e7eb', overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  cardActive: { borderColor: COLOR },
  cardMain: { flexDirection: 'row', padding: 12, alignItems: 'center', gap: 12 },
  thumbWrap: { position: 'relative' },
  thumbImg: { width: 56, height: 56, borderRadius: 10, backgroundColor: '#eef2ff' },
  doneTodayBadge: {
    position: 'absolute', bottom: -2, right: -2,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#10b981', borderWidth: 1.5, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  doneTodayText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  thumbPlaceholder: {
    width: 56, height: 56, borderRadius: 10, backgroundColor: '#eef2ff',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  thumbPlaceholderText: { fontSize: 24 },
  exerciseName: { fontSize: 14, fontWeight: '700', color: '#111', marginBottom: 2 },
  exerciseMeta: { fontSize: 12, color: '#aaa', marginBottom: 4 },
  previewHint: { fontSize: 14, color: '#ddd', fontWeight: '600', paddingLeft: 4 },
  previewHintActive: { color: COLOR },
  addBtn: {
    borderTopWidth: 1, borderTopColor: '#f0f0f3',
    paddingVertical: 11, alignItems: 'center', backgroundColor: '#f9fafb',
  },
  addBtnActive: { backgroundColor: '#eef2ff' },
  addBtnText: { fontSize: 14, fontWeight: '700', color: COLOR },
  addBtnTextActive: { color: COLOR },
})
