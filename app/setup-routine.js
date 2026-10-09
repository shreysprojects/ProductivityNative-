import { useState, useEffect, useMemo, useRef } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, Alert, Modal, KeyboardAvoidingView, Platform, ScrollView, Image, ActivityIndicator, Animated } from 'react-native'
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist'
import * as ImagePicker from 'expo-image-picker'
import {
  uploadRoutinePhoto, deleteStepImage, countRoutinePhotos, MAX_ROUTINE_PHOTOS,
} from '../lib/photoStorage'
import { collectPhotoUris, isRemotePhoto } from '../lib/photoPaths'
import { router, useLocalSearchParams, useNavigation } from 'expo-router'
import { useAuth } from '../lib/AuthContext'
import { useTheme } from '../lib/ThemeContext'
import {
  loadRoutineTemplate, saveRoutineTemplate, markSetupDone,
  addRoutine, getRoutineNames, loadRoutineNames, validateRoutineName,
  getRoutineSettings, saveRoutineSettings,
  renameRoutine, RESERVED_ROUTINES, altRoutineName,
  getRoutineGroupMap, saveRoutineGroupMap, getTodayRun,
  getRoutineTemplates, getHiddenDefaults,
} from '../lib/storage'

// Section identities — match the dashboard's Every day / Whenever headers
const EVERYDAY_COLOR = '#f59e0b'
const WHENEVER_COLOR = '#06b6d4'
import { routineTheme } from '../lib/themes'
import ImageViewerModal from '../components/ImageViewerModal'
import { useSheetDrag } from '../lib/useSheetDrag'

const DAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const DAY_NAMES    = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Emoji library for task icons: [emoji, search keywords] grouped by category.
const EMOJI_LIBRARY = [
  {
    category: 'Home & Chores',
    emojis: [
      ['🏠', 'home house'], ['🛏️', 'bed make bed bedroom tidy'], ['🚿', 'shower bathe'],
      ['🛁', 'bath tub soak'], ['🦷', 'teeth brush dental floss'], ['🪥', 'toothbrush teeth brush'],
      ['👕', 'clothes shirt outfit get dressed'], ['🧺', 'laundry basket clothes wash'],
      ['🧹', 'clean sweep broom tidy'], ['🧽', 'scrub sponge dishes clean'], ['🧼', 'soap wash hands'],
      ['🗑️', 'trash garbage bin take out'], ['🍽️', 'dishes plate table wash'], ['🛒', 'groceries shopping cart store'],
      ['🪴', 'plant water houseplant'], ['🔑', 'keys lock leave'], ['🚪', 'door leave out'],
      ['🧻', 'paper towel restock'], ['🪟', 'window open air'], ['🧷', 'organize fix'],
    ],
  },
  {
    category: 'Food & Drink',
    emojis: [
      ['🍳', 'breakfast eggs cook cooking'], ['🥞', 'pancakes breakfast'], ['🥣', 'cereal oatmeal bowl breakfast'],
      ['☕', 'coffee espresso caffeine morning'], ['🍵', 'tea matcha green'], ['💧', 'water hydrate drink'],
      ['🥤', 'smoothie shake drink cup'], ['🧃', 'juice drink box'], ['🥛', 'milk glass'],
      ['🍎', 'apple fruit healthy'], ['🍌', 'banana fruit'], ['🍓', 'strawberry fruit berries'],
      ['🥗', 'salad healthy greens lunch'], ['🥪', 'sandwich lunch'], ['🍱', 'meal prep lunch box bento'],
      ['🍝', 'pasta dinner spaghetti'], ['🍚', 'rice bowl'], ['🍗', 'chicken protein dinner'],
      ['🥩', 'steak meat protein'], ['🥦', 'broccoli vegetables veggies'], ['🥕', 'carrot vegetables veggies'],
      ['🥑', 'avocado healthy fats'], ['🍞', 'bread toast bake'], ['🧊', 'ice cold plunge'],
      ['🍫', 'chocolate snack treat'], ['🍿', 'popcorn snack movie'], ['🎂', 'cake birthday dessert'],
    ],
  },
  {
    category: 'Fitness & Sports',
    emojis: [
      ['🏃', 'run running jog cardio'], ['🚶', 'walk walking steps stroll'], ['💪', 'gym workout muscle strength lift'],
      ['🏋️', 'weights lifting barbell gym'], ['🤸', 'stretch stretching mobility gymnastics'], ['🧘', 'yoga meditate meditation mindfulness breathe'],
      ['🚴', 'bike cycling spin'], ['🏊', 'swim swimming pool laps'], ['🧗', 'climb climbing bouldering'],
      ['⚽', 'soccer football'], ['🏀', 'basketball hoops'], ['🎾', 'tennis racket'],
      ['🏐', 'volleyball'], ['🏈', 'football american'], ['⚾', 'baseball catch'],
      ['🥊', 'boxing punch fight'], ['🥋', 'martial arts karate judo bjj'], ['⛳', 'golf putt'],
      ['🏄', 'surf surfing'], ['🛹', 'skate skateboard'], ['⛷️', 'ski skiing snow'],
      ['🏂', 'snowboard snow'], ['🚣', 'row rowing erg'], ['🩰', 'ballet dance'],
      ['💃', 'dance dancing zumba'], ['🎽', 'marathon race running shirt'], ['⏱️', 'timer stopwatch interval hiit'],
      ['🏆', 'trophy win championship goal'], ['🥇', 'medal first place winner'],
    ],
  },
  {
    category: 'Work & Study',
    emojis: [
      ['💼', 'work job briefcase office'], ['💻', 'laptop computer code coding work'], ['🖥️', 'desktop computer monitor'],
      ['⌨️', 'keyboard typing'], ['📚', 'books study read reading homework'], ['📖', 'book read reading chapter'],
      ['📝', 'write notes journal essay homework'], ['✏️', 'pencil write sketch'], ['📓', 'notebook notes'],
      ['📔', 'journal diary reflect'], ['🗂️', 'files organize admin'], ['📁', 'folder documents'],
      ['📊', 'chart data report analytics'], ['📈', 'growth stocks progress invest'], ['🧮', 'math budget calculate'],
      ['🎓', 'school graduate learn course'], ['🏫', 'school class lecture'], ['🔬', 'science lab research'],
      ['🧪', 'chemistry experiment test'], ['🌐', 'internet web language online'], ['🗣️', 'speak speaking language practice talk'],
      ['📞', 'call phone meeting'], ['✉️', 'email mail inbox letters'], ['📅', 'calendar schedule plan planning'],
      ['⏰', 'alarm wake up early morning clock'], ['🕐', 'clock time hour'], ['🎯', 'goal target focus aim'],
      ['✅', 'done check complete task'], ['📋', 'clipboard checklist todo list'], ['💡', 'idea brainstorm lightbulb'],
      ['🧠', 'brain think memory learn mental'], ['🤖', 'ai robot automation'], ['💰', 'money savings finance budget'],
      ['💳', 'card pay bills payment'], ['🏦', 'bank banking finance'],
    ],
  },
  {
    category: 'Health & Self-care',
    emojis: [
      ['💊', 'medicine vitamins pills supplements meds'], ['🩺', 'doctor checkup appointment health'], ['🩹', 'bandage first aid'],
      ['🧴', 'skincare lotion moisturizer sunscreen spf'], ['🧖', 'spa sauna facial self care'], ['💆', 'massage relax head'],
      ['💅', 'nails manicure grooming'], ['💇', 'haircut hair salon'], ['🪒', 'shave razor grooming'],
      ['🪞', 'mirror looks grooming get ready'], ['✨', 'sparkle glow looks shine'], ['❤️', 'heart love health'],
      ['🫁', 'lungs breathe breathing breathwork'], ['😴', 'sleep nap rest tired'], ['🛌', 'sleep bed rest lie down'],
      ['🙏', 'gratitude pray prayer thanks worship'], ['😊', 'smile happy mood positive'], ['🍃', 'calm zen peace leaf'],
      ['📵', 'no phone digital detox screen free'], ['🔕', 'mute silence quiet do not disturb'], ['🚭', 'no smoking quit'],
      ['🌡️', 'temperature sick fever'],
    ],
  },
  {
    category: 'Nature & Outdoors',
    emojis: [
      ['☀️', 'sun sunlight morning sunshine'], ['🌅', 'sunrise dawn morning'], ['🌄', 'sunrise mountain morning'],
      ['🌇', 'sunset evening dusk'], ['🌙', 'moon night evening'], ['⭐', 'star night'],
      ['🌟', 'star shine glow'], ['🌸', 'flower blossom spring'], ['🌹', 'rose flower'],
      ['🌻', 'sunflower flower'], ['🌿', 'herb plant nature green'], ['🌱', 'sprout grow growth seedling'],
      ['🌳', 'tree park nature forest'], ['⛰️', 'mountain hike hiking'], ['🏕️', 'camping tent outdoors'],
      ['🏖️', 'beach sand vacation'], ['🌊', 'wave ocean sea cold plunge'], ['🌧️', 'rain rainy weather'],
      ['⛅', 'cloud cloudy weather'], ['❄️', 'snow winter cold'], ['🍂', 'autumn fall leaves'],
      ['🐕', 'dog puppy pet walk'], ['🐈', 'cat kitten pet'], ['🐾', 'pets paws animal'],
      ['🐦', 'bird birdwatching'], ['🦮', 'dog walk guide'],
    ],
  },
  {
    category: 'Travel & Places',
    emojis: [
      ['🚗', 'car drive driving commute'], ['🚌', 'bus commute transit'], ['🚆', 'train commute metro'],
      ['✈️', 'plane flight travel airport'], ['🚲', 'bicycle bike commute ride'], ['🛴', 'scooter ride'],
      ['⛽', 'gas fuel station'], ['🗺️', 'map trip plan explore'], ['🧳', 'luggage pack packing travel'],
      ['⛪', 'church worship mass'], ['🕌', 'mosque prayer'], ['🛕', 'temple worship'],
      ['🕍', 'synagogue worship'], ['🏥', 'hospital appointment clinic'], ['🏢', 'office building work'],
      ['🏪', 'store shop errand'], ['📍', 'location place errand'],
    ],
  },
  {
    category: 'Hobbies & Fun',
    emojis: [
      ['🎵', 'music song listen'], ['🎧', 'headphones podcast audiobook music'], ['🎸', 'guitar practice music'],
      ['🎹', 'piano keys practice music'], ['🥁', 'drums practice music'], ['🎤', 'sing singing karaoke voice'],
      ['🎨', 'art paint drawing creative'], ['🖌️', 'paint brush art'], ['📷', 'photo camera photography'],
      ['🎮', 'game gaming video games'], ['♟️', 'chess strategy board'], ['🧩', 'puzzle jigsaw'],
      ['🎬', 'movie film watch cinema'], ['📺', 'tv show watch series'], ['🎭', 'theater drama acting'],
      ['🧶', 'knit yarn crochet craft'], ['🪡', 'sew sewing craft'], ['🎣', 'fishing fish'],
      ['🎲', 'board games dice family'], ['🃏', 'cards poker game'], ['📻', 'radio listen'],
      ['📱', 'phone social media apps'], ['🛍️', 'shopping mall buy'], ['🚀', 'rocket project launch side hustle'],
    ],
  },
  {
    category: 'People & Social',
    emojis: [
      ['👨‍👩‍👧', 'family time kids'], ['👶', 'baby infant childcare'], ['🧒', 'kids children'],
      ['👥', 'friends social people meet'], ['🤝', 'meeting handshake network'], ['💬', 'chat talk text conversation'],
      ['🎉', 'party celebrate celebration'], ['🥳', 'celebrate party birthday'], ['🎁', 'gift present giving'],
      ['💌', 'letter love note write'], ['💑', 'date partner couple love'], ['📣', 'announce share post'],
    ],
  },
  {
    category: 'Symbols',
    emojis: [
      ['🔥', 'fire streak hot motivation'], ['⚡', 'energy power fast lightning'], ['💯', 'hundred percent perfect'],
      ['🎆', 'fireworks celebration'], ['🏁', 'finish start race flag'], ['🚫', 'no stop avoid quit'],
      ['❗', 'important priority urgent'], ['❓', 'question review'], ['🔔', 'bell reminder notification'],
      ['🔋', 'battery recharge energy rest'], ['♻️', 'recycle repeat habit'], ['🔄', 'repeat routine cycle sync'],
      ['⚖️', 'balance scale weigh weight'], ['🧲', 'magnet focus attract'], ['➕', 'plus add more'],
      ['🔒', 'lock secure private'],
    ],
  },
]

function fmtTime(mins) {
  const total = ((mins % 1440) + 1440) % 1440
  const h = Math.floor(total / 60)
  const m = total % 60
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

function fmtDuration(mins) {
  if (mins <= 0) return ''
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

function fmtGoalSecs(s) {
  if (!s) return ''
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m > 0 && sec > 0) return `${m}m ${sec}s`
  if (m > 0) return `${m}m`
  return `${sec}s`
}

export default function SetupRoutine() {
  const { user } = useAuth()
  const { theme } = useTheme()
  const s = useMemo(() => makeStyles(theme), [theme])
  const { name: nameParam, variant: variantParam, create: createParam } = useLocalSearchParams()

  // A new routine opens with create=1. It used to be the name "new", which
  // left a routine actually called "new" impossible to edit: opening it
  // started a blank routine instead.
  const isNew = createParam === '1'
  const isFirstTime = !isNew && !nameParam
  const routineName = isNew || isFirstTime ? null : nameParam
  // variant=alt edits the routine's alternative version: tasks only — the
  // name, description, and schedule belong to the routine and stay shared.
  const isAltVariant = !!routineName && variantParam === 'alt'

  const accent = routineTheme(routineName || 'Morning')

  // Only routines the user created can be renamed (Morning/Fitness/Night are
  // hardcoded throughout the app and keep their names).
  const isDefaultRoutine = !!routineName && RESERVED_ROUTINES.includes(routineName)
  const canRename = !isFirstTime && !isNew && !isDefaultRoutine && !isAltVariant

  const [editName,         setEditName]         = useState(routineName || '')
  const [customName,       setCustomName]       = useState('')
  const [description,      setDescription]      = useState('')
  const [tasks,            setTasks]            = useState([])
  const [text,             setText]             = useState('')
  const [goalMins,         setGoalMins]         = useState('')
  const [goalSecs,         setGoalSecs]         = useState('')
  const [saving,           setSaving]           = useState(false)
  const [expandedIds,      setExpandedIds]      = useState(new Set())
  const [expandedSubKeys,  setExpandedSubKeys]  = useState(new Set())
  const [photoViewer,      setPhotoViewer]      = useState(null)
  const [uploadingPhoto,   setUploadingPhoto]   = useState(false)
  const [subInputs,        setSubInputs]        = useState({})
  const [activeDays,       setActiveDays]       = useState([true, true, true, true, true, true, true])
  const [startTimeMinutes, setStartTimeMinutes] = useState(540)
  const [perDayMode,       setPerDayMode]       = useState(false)
  const [dayTimes,         setDayTimes]         = useState(Array(7).fill(540))
  const [taskEmoji,        setTaskEmoji]        = useState(null)
  const [newGroup,         setNewGroup]         = useState('everyday') // new routines: which dashboard section
  const [routineGroup,     setRoutineGroup]     = useState('everyday') // existing routines: their saved section
  const [showEmojiPicker,  setShowEmojiPicker]  = useState(false)
  const [emojiTargetId,    setEmojiTargetId]    = useState(null)
  const [emojiQuery,       setEmojiQuery]       = useState('')
  const [runInProgress,    setRunInProgress]    = useState(false)
  // "Copy to another routine": the task being copied, the routines it can go
  // to (null while they load), and whether a copy is in flight.
  const [copyTask,         setCopyTask]         = useState(null)
  const [copyTargets,      setCopyTargets]      = useState(null)
  const [copying,          setCopying]          = useState(false)
  // Pull-down-to-dismiss for the two sheets.
  const emojiDrag = useSheetDrag(() => { setShowEmojiPicker(false); setEmojiTargetId(null) }, { visible: showEmojiPicker })
  const copyDrag = useSheetDrag(() => { if (!copying) setCopyTask(null) }, { visible: !!copyTask })

  // Nothing can be added or saved until the routine has loaded: a save from
  // the empty placeholder list would replace the real one.
  const [loaded, setLoaded] = useState(false)
  // Set before Save's first await, so a double tap can't start a second save.
  const savingRef = useRef(false)
  // Photos. Nothing is deleted while editing: the photos the saved routine
  // used (savedPhotosRef) and this visit's uploads (uploadsRef) are sorted
  // out once a save lands, or on leaving without one — so backing out never
  // leaves the saved routine pointing at a deleted picture.
  const savedPhotosRef = useRef([])
  const uploadsRef = useRef(new Set())
  // Minutes each task added here asked the later routines to move by (see
  // maybeShiftLater); applied on save, for the tasks still in the list.
  const shiftForTaskRef = useRef({})

  // Whenever routines have no day/time schedule.
  const isWhenever = isNew ? newGroup === 'whenever' : routineGroup === 'whenever'

  useEffect(() => {
    if (!user?.id) return
    // A brand new routine starts blank; only first-time setup seeds from Morning.
    if (isNew) {
      setTasks([])
      setDescription('')
      setLoaded(true)
      return
    }
    const target = routineName || 'Morning'
    Promise.all([
      // The strict read: offline on a device that never cached this routine
      // it fails (and the editor stays disabled) instead of showing the
      // stock tasks, which Save would then write over the real routine.
      loadRoutineTemplate(user.id, isAltVariant ? altRoutineName(target) : target),
      isFirstTime ? null : getRoutineSettings(user.id, target),
    ]).then(([template, settings]) => {
      const loadedTasks = template.map(t => ({ ...t, subTasks: t.subTasks || [], timeGoalSecs: t.timeGoalSecs ?? (t.timeGoalMins ?? 0) * 60 }))
      savedPhotosRef.current = collectPhotoUris(loadedTasks)
      setTasks(loadedTasks)
      if (settings) {
        setActiveDays(settings.activeDays)
        setStartTimeMinutes(settings.startTimeMinutes)
        setPerDayMode(settings.perDayMode)
        setDayTimes(settings.dayTimes)
        setDescription(settings.description ?? '')
      }
      setLoaded(true)
    }).catch(() => Alert.alert('Could not load this routine', 'Go back and try again.'))
    if (routineName) {
      getRoutineGroupMap(user.id).then(m => setRoutineGroup(m[routineName] ?? 'everyday'))
    }
    // Editing mid-routine is allowed, so say what happens to today's progress.
    getTodayRun(user.id, isAltVariant ? altRoutineName(target) : target)
      .then(run => setRunInProgress(!!run && !run.finished))
      .catch(() => {})
  }, [user?.id, routineName, isFirstTime, isNew])

  // ── Unsaved changes ────────────────────────────────────────────────────────
  // Everything Save writes, compared with how it looked once loaded.
  const draft = JSON.stringify([tasks, description, activeDays, startTimeMinutes, perDayMode, dayTimes, editName, customName, newGroup])
  const loadedDraftRef = useRef(null)
  useEffect(() => {
    if (loaded && loadedDraftRef.current === null) loadedDraftRef.current = draft
  }, [loaded])   // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = loadedDraftRef.current !== null && draft !== loadedDraftRef.current
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  // Set once leaving is settled (saved, or discarded on purpose) so the guard
  // below lets the screen go.
  const leavingRef = useRef(false)

  const navigation = useNavigation()

  // Leaving with unsaved changes (← Back, Android back, anything else that
  // removes the screen) asks first. The iOS swipe-back can't be stopped once
  // it has started, so it's switched off while there's something to lose.
  useEffect(() => {
    return navigation.addListener('beforeRemove', e => {
      if (leavingRef.current) return
      if (!dirtyRef.current) {
        // Nothing to lose. (A save of an unchanged routine may still be
        // finishing; it sees the screen has gone and doesn't navigate.)
        leavingRef.current = true
        releaseUploads()
        return
      }
      e.preventDefault()
      // Mid-save the screen stays; the save decides where to go.
      if (savingRef.current) return
      Alert.alert('Discard changes?', 'You have unsaved changes to this routine.', [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard', style: 'destructive',
          onPress: () => {
            leavingRef.current = true
            releaseUploads()
            navigation.dispatch(e.data.action)
          },
        },
      ])
    })
  }, [navigation])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !dirty })
  }, [navigation, dirty])

  // Leaving without saving: this visit's uploads were never saved anywhere.
  function releaseUploads() {
    for (const uri of uploadsRef.current) {
      if (!savedPhotosRef.current.includes(uri)) deleteStepImage(uri)
    }
    uploadsRef.current.clear()
  }

  // After a save lands: every photo the routine used or this visit uploaded
  // that the saved tasks no longer show is freed — unless the other version
  // of the routine (main or alternative, which "copy from main" can leave
  // sharing a photo) still shows it.
  async function releaseUnusedPhotos(savedTasks, otherVersion) {
    const keep = new Set(collectPhotoUris(savedTasks))
    if (otherVersion) {
      // If the other version can't be read, nothing is deleted: a photo it
      // shares would break. Truly unused ones are freed later by the slot
      // sweep in photoStorage.
      let other
      try { other = await loadRoutineTemplate(user.id, otherVersion) } catch { return }
      collectPhotoUris(other).forEach(uri => keep.add(uri))
    }
    for (const uri of new Set([...savedPhotosRef.current, ...uploadsRef.current])) {
      if (!keep.has(uri)) deleteStepImage(uri)
    }
  }

  // How many of the account's photo slots are in use. The cap is enforced in
  // the database; this is what lets the button say so before the user picks.
  const [photoCount, setPhotoCount] = useState(null)

  function refreshPhotoCount() {
    if (!user?.id) return
    countRoutinePhotos(user.id).then(setPhotoCount).catch(() => setPhotoCount(null))
  }

  useEffect(refreshPhotoCount, [user])

  const photoLimitReached = photoCount !== null && photoCount >= MAX_ROUTINE_PHOTOS
  // A photo taken off here keeps its slot until the change is saved.
  const inUsePhotos = new Set(collectPhotoUris(tasks))
  const slotsFreedOnSave = [...savedPhotosRef.current, ...uploadsRef.current]
    .some(uri => isRemotePhoto(uri) && !inUsePhotos.has(uri))

  // Label for the add-photo control, which doubles as the place the user finds
  // out how many slots are left.
  function addPhotoLabel(what) {
    if (uploadingPhoto) return 'Uploading…'
    if (photoLimitReached) {
      return slotsFreedOnSave
        ? `📷  ${MAX_ROUTINE_PHOTOS}/${MAX_ROUTINE_PHOTOS} photos used — save to free the ones you removed`
        : `📷  ${MAX_ROUTINE_PHOTOS}/${MAX_ROUTINE_PHOTOS} photos used — remove one first`
    }
    const used = photoCount === null ? '' : `  (${photoCount}/${MAX_ROUTINE_PHOTOS})`
    return `📷  Add photo${what}${used}`
  }

  const totalGoalSecs = tasks.reduce((sum, t) => sum + (t.timeGoalSecs ?? (t.timeGoalMins ?? 0) * 60), 0)

  function addTask() {
    if (!loaded || !text.trim()) return
    const mins = parseInt(goalMins, 10) || 0
    const secs = Math.min(parseInt(goalSecs, 10) || 0, 59)
    const totalSecs = mins * 60 + secs
    const id = Date.now()
    setTasks(prev => [...prev, {
      id, text: text.trim(), subTasks: [],
      timeGoalSecs: totalSecs,
      ...(taskEmoji ? { emoji: taskEmoji } : {}),
    }])
    setText('')
    setGoalMins('')
    setGoalSecs('')
    setTaskEmoji(null)

    // Offer to push later routines back by this task's duration (existing routines
    // only — alternatives replace the main and Whenever routines have no slot in
    // the day, so neither shifts the schedule).
    const shiftMin = Math.round(totalSecs / 60)
    if (shiftMin >= 1 && !isNew && !isFirstTime && routineName && !isAltVariant && !isWhenever) {
      maybeShiftLater(id, shiftMin)
    }
  }

  // The shift waits for Save, like every other change here, and is tied to
  // the task: remove the task before saving and the shift goes with it.
  function maybeShiftLater(taskId, shiftMin) {
    Alert.alert(
      'Shift later routines?',
      `This task adds ${shiftMin} min. When you save, push the routines that start after “${routineName}” later by ${shiftMin} min so they don't overlap?`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: `Shift by ${shiftMin}m`,
          onPress: () => { shiftForTaskRef.current[taskId] = shiftMin },
        },
      ],
    )
  }

  // Push the routines that start after this one — by the clock, not by list
  // order — `delta` minutes later. Whenever and hidden routines have no slot
  // in the day, so they stay put.
  async function shiftLaterRoutines(name, from, delta) {
    const [names, groupMap, hidden] = await Promise.all([
      loadRoutineNames(user.id), getRoutineGroupMap(user.id), getHiddenDefaults(user.id),
    ])
    const wrap = v => (((v + delta) % 1440) + 1440) % 1440
    for (const n of names) {
      if (n === name || hidden.includes(n) || (groupMap[n] ?? 'everyday') !== 'everyday') continue
      const prev = await getRoutineSettings(user.id, n)
      if (prev.startTimeMinutes <= from) continue
      await saveRoutineSettings(user.id, n, {
        ...prev,
        startTimeMinutes: wrap(prev.startTimeMinutes),
        dayTimes: (prev.dayTimes ?? []).map(wrap),
      })
    }
  }

  function openEmojiPicker(targetId) {
    setEmojiTargetId(targetId ?? null)
    setEmojiQuery('')
    setShowEmojiPicker(true)
  }

  function pickEmoji(emoji) {
    if (emojiTargetId === null) {
      setTaskEmoji(emoji)
    } else {
      setTasks(prev => prev.map(t => t.id === emojiTargetId ? { ...t, emoji } : t))
    }
    setShowEmojiPicker(false)
    setEmojiTargetId(null)
  }

  function clearEmoji() {
    if (emojiTargetId === null) {
      setTaskEmoji(null)
    } else {
      setTasks(prev => prev.map(t => t.id === emojiTargetId ? { ...t, emoji: undefined } : t))
    }
    setShowEmojiPicker(false)
    setEmojiTargetId(null)
  }

  // The task's photos (and its steps') are freed on save, not here.
  function removeTask(id) {
    setTasks(prev => prev.filter(t => t.id !== id))
    setExpandedIds(prev => { const n = new Set(prev); n.delete(id); return n })
  }

  // ── Copy a task into another routine ──────────────────────────────────────
  // The copy lands at the end of the chosen routine straight away; it does not
  // wait for this editor's Save. Photos stay behind: each is stored once per
  // account and deleted along with the task that owns it, so a shared
  // reference would break the moment either copy was removed.
  async function openCopySheet(task) {
    setCopyTask(task)
    setCopyTargets(null)
    try {
      const [names, hidden] = await Promise.all([getRoutineNames(user.id), getHiddenDefaults(user.id)])
      const visible = names.filter(n => !hidden.includes(n))
      // An alternative is offered only once it has tasks, so copying can't
      // quietly bring an alt routine into existence.
      const alts = await getRoutineTemplates(user.id, visible.map(altRoutineName))
      const current = routineName ? (isAltVariant ? altRoutineName(routineName) : routineName) : null
      const targets = []
      for (const n of visible) {
        const emoji = routineTheme(n).emoji ?? '📋'
        if (n !== current) targets.push({ key: n, label: n, emoji })
        const alt = altRoutineName(n)
        if (alt !== current && (alts[alt]?.length ?? 0) > 0) targets.push({ key: alt, label: `Alt ${n}`, emoji })
      }
      setCopyTargets(targets)
    } catch (e) {
      setCopyTask(null)
      Alert.alert('Could not load routines', e.message)
    }
  }

  async function copyTaskTo(target) {
    if (!copyTask || !user?.id) return
    setCopying(true)
    try {
      const stamp = Date.now()
      // Rebuilt field by field rather than spread, so the ids are fresh and
      // nothing routine-specific (photos, integration markers) travels along.
      const copy = {
        id: stamp,
        text: copyTask.text,
        timeGoalSecs: copyTask.timeGoalSecs ?? (copyTask.timeGoalMins ?? 0) * 60,
        subTasks: (copyTask.subTasks ?? []).map((st, i) => ({ id: stamp + 1 + i, text: st.text })),
        ...(copyTask.emoji ? { emoji: copyTask.emoji } : {}),
      }
      // Strict: appending to a template that couldn't be read would save the
      // stock tasks plus this copy over the real routine.
      const existing = await loadRoutineTemplate(user.id, target.key)
      await saveRoutineTemplate(user.id, target.key, [...existing, copy])
      setCopyTask(null)
      Alert.alert('Copied', `“${copy.text}” is now the last task in ${target.label}.`)
    } catch (e) {
      Alert.alert('Could not copy', e.message)
    } finally {
      setCopying(false)
    }
  }

  // Shared by task photos and step photos: let the user pick, and upload it.
  // (The system picker needs no photo library permission.) Returns the stored
  // URL, or null if the user backed out or it could not be saved — in which
  // case the reason has been shown already.
  async function pickAndStoreImage() {
    if (!user?.id) {
      Alert.alert('Not signed in', 'Sign in to add photos to your routine.')
      return null
    }
    if (savingRef.current) return null
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 0.6,
    })
    const uri = result.canceled ? null : result.assets?.[0]?.uri
    if (!uri) return null

    setUploadingPhoto(true)
    try {
      const stored = await uploadRoutinePhoto(user.id, uri)
      // The screen was left while it uploaded: nothing will ever use it.
      if (leavingRef.current) {
        deleteStepImage(stored)
        return null
      }
      uploadsRef.current.add(stored)
      return stored
    } catch (err) {
      Alert.alert('Could not add photo', err?.message ?? 'Please try again.')
      return null
    } finally {
      setUploadingPhoto(false)
    }
  }

  // Replacing or removing a photo only changes the task; the old photo is
  // freed on save (see releaseUnusedPhotos).
  async function pickTaskImage(taskId) {
    const stored = await pickAndStoreImage()
    if (!stored) return
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, image: stored } : t))
    refreshPhotoCount()
  }

  function removeTaskImage(taskId) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, image: null } : t))
  }

  // Each step inside a task carries its own photo, independent of the task's.
  function mapSubTask(taskId, subId, fn) {
    setTasks(prev => prev.map(t => t.id !== taskId ? t : {
      ...t,
      subTasks: t.subTasks.map(st => st.id !== subId ? st : fn(st)),
    }))
  }

  async function pickSubTaskImage(taskId, subId) {
    const stored = await pickAndStoreImage()
    if (!stored) return
    mapSubTask(taskId, subId, st => ({ ...st, image: stored }))
    refreshPhotoCount()
  }

  function removeSubTaskImage(taskId, subId) {
    mapSubTask(taskId, subId, st => ({ ...st, image: null }))
  }

  const subKey = (taskId, subId) => `${taskId}:${subId}`

  function toggleSubExpand(taskId, subId) {
    const key = subKey(taskId, subId)
    setExpandedSubKeys(prev => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  }

  function toggleExpand(id) {
    setExpandedIds(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function updateTaskGoalMins(taskId, val) {
    const mins = parseInt(val, 10) || 0
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, timeGoalSecs: mins * 60 + ((t.timeGoalSecs ?? 0) % 60) } : t
    ))
  }

  function updateTaskGoalSecs(taskId, val) {
    const secs = Math.min(parseInt(val, 10) || 0, 59)
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, timeGoalSecs: Math.floor((t.timeGoalSecs ?? 0) / 60) * 60 + secs } : t
    ))
  }

  function addSubTask(taskId) {
    const val = (subInputs[taskId] || '').trim()
    if (!val) return
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, subTasks: [...t.subTasks, { id: Date.now(), text: val }] } : t
    ))
    setSubInputs(prev => ({ ...prev, [taskId]: '' }))
  }

  function removeSubTask(taskId, subId) {
    setTasks(prev => prev.map(t =>
      t.id !== taskId ? t : { ...t, subTasks: t.subTasks.filter(st => st.id !== subId) }
    ))
    setExpandedSubKeys(prev => { const n = new Set(prev); n.delete(subKey(taskId, subId)); return n })
  }

  // Step order is the order they are ticked (and their photos revealed) in a
  // run, so each step gets up/down arrows. delta is -1 (up) or +1 (down); a
  // move past either end is a no-op.
  function moveSubTask(taskId, subId, delta) {
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t
      const from = t.subTasks.findIndex(st => st.id === subId)
      const to = from + delta
      if (from < 0 || to < 0 || to >= t.subTasks.length) return t
      const subTasks = [...t.subTasks]
      ;[subTasks[from], subTasks[to]] = [subTasks[to], subTasks[from]]
      return { ...t, subTasks }
    }))
  }

  function toggleDay(i) {
    setActiveDays(prev => prev.map((v, j) => j === i ? !v : v))
  }

  function adjustTime(delta) {
    setStartTimeMinutes(prev => ((prev + delta) % 1440 + 1440) % 1440)
  }

  async function save() {
    if (savingRef.current || !loaded || uploadingPhoto) return

    const renaming = canRename && editName.trim() !== routineName
    const finalName = isNew ? customName.trim() : canRename ? editName.trim() : (routineName || 'Morning')
    // A new or changed name meets the one naming rule. The parts that need
    // no network (blank, too long, characters the app can't route, reserved
    // words) are checked first.
    const naming = isNew || renaming
    if (naming) {
      const invalid = validateRoutineName(finalName)
      if (invalid) return Alert.alert(invalid)
    }
    if (tasks.length === 0) return Alert.alert('Add at least one task')

    savingRef.current = true
    setSaving(true)
    try {
      if (naming) {
        // Duplicates against a fresh read of the list: offline this refuses,
        // where checking against a guess could save over an existing routine.
        const invalid = validateRoutineName(finalName, await loadRoutineNames(user.id), { currentName: routineName })
        if (invalid) return Alert.alert(invalid)
      }

      if (isNew) {
        // Onto the list before anything is saved under the name.
        await addRoutine(user.id, finalName)
        const gMap = await getRoutineGroupMap(user.id)
        await saveRoutineGroupMap(user.id, { ...gMap, [finalName]: newGroup })
      }
      if (renaming) {
        try {
          await renameRoutine(user.id, routineName, finalName)
        } catch (e) {
          return Alert.alert('Could not rename', e.message)
        }
      }
      // The schedule is device-local and the template is kept on the device
      // (queued when offline), so a plain edit made offline is saved rather
      // than failed.
      if (!isFirstTime && !isAltVariant) {
        await saveRoutineSettings(user.id, finalName, { activeDays, startTimeMinutes, perDayMode, dayTimes, description: description.trim() })
      }
      await saveRoutineTemplate(user.id, isAltVariant ? altRoutineName(finalName) : finalName, tasks)
      if (isFirstTime) await markSetupDone(user.id)

      const shiftBy = tasks.reduce((sum, t) => sum + (shiftForTaskRef.current[t.id] ?? 0), 0)
      if (shiftBy > 0) {
        try {
          await shiftLaterRoutines(finalName, startTimeMinutes, shiftBy)
        } catch (e) {
          Alert.alert('Could not shift', e.message)
        }
      }

      const alreadyLeft = leavingRef.current
      leavingRef.current = true
      const otherVersion = isNew || isFirstTime ? null : isAltVariant ? finalName : altRoutineName(finalName)
      releaseUnusedPhotos(tasks, otherVersion).catch(() => {})
      if (alreadyLeft) return
      // First-time setup hands off to onboarding; a rename goes back to Home
      // and opens the renamed routine from there, so the old name's screen
      // isn't left underneath; otherwise return to wherever the user opened
      // this from.
      if (isFirstTime) router.replace('/onboarding')
      else if (renaming) {
        router.dismissTo('/(tabs)')
        router.push({ pathname: '/routine/[name]', params: { name: finalName } })
      }
      else if (router.canGoBack()) router.back()
      else router.replace('/(tabs)')
    } catch (e) {
      // addRoutine and friends refuse loudly when the routine list can't be
      // read safely — surface that instead of dying as an unhandled rejection.
      return Alert.alert(renaming ? 'Could not rename' : 'Could not save', e.message)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  let title = 'Edit Routine'
  let subtitle = 'Hold ☰ to drag tasks into a new order. Tap ⊕ to expand.'
  if (isFirstTime) {
    title = 'Set up your Morning Routine'
    subtitle = 'These tasks run in order each morning. Tap ⊕ to add steps inside a task.'
  } else if (isNew) {
    title = 'New Routine'
    subtitle = 'Give your routine a name, set a schedule, and add your tasks.'
  } else if (isAltVariant) {
    title = `Alt ${routineName} Routine`
    subtitle = 'A lighter fallback for days you can\'t do the main routine. Hold ☰ to reorder tasks.'
  }

  function renderItem({ item: task, drag, isActive, getIndex }) {
    const i = getIndex() ?? 0
    const expanded = expandedIds.has(task.id)
    return (
      <ScaleDecorator activeScale={0.97}>
        <View style={[
          s.taskCard,
          isActive && s.taskCardActive,
          isFirstTime && { borderLeftWidth: 4, borderLeftColor: accent.color + 'cc', marginHorizontal: 20 },
        ]}>
          <Pressable
            onLongPress={drag}
            disabled={isActive}
            delayLongPress={200}
            style={s.taskRow}
          >
            <View style={[s.num, { backgroundColor: accent.color }]}>
              <Text style={[s.numText, { color: '#fff' }]}>{i + 1}</Text>
            </View>
            <Pressable
              style={[s.taskEmojiBadge, task.emoji
                ? { backgroundColor: accent.bg }
                : { borderWidth: 1.5, borderStyle: 'dashed', borderColor: accent.color + '44' }
              ]}
              onPress={() => openEmojiPicker(task.id)}
              hitSlop={6}
            >
              <Text style={{ fontSize: task.emoji ? 17 : 14, opacity: task.emoji ? 1 : 0.45 }}>
                {task.emoji || '＋'}
              </Text>
            </Pressable>
            <Text style={s.taskText}>{task.text}</Text>
            {task.timeGoalSecs > 0 && (
              <View style={[s.goalBadge, { backgroundColor: accent.bg }]}>
                <Text style={[s.goalBadgeText, { color: accent.color }]}>{fmtGoalSecs(task.timeGoalSecs)}</Text>
              </View>
            )}
            <Pressable onPress={() => toggleExpand(task.id)} hitSlop={8} style={s.expandBtn}>
              <Text style={[s.expandBtnText, { color: accent.color }]}>{expanded ? '▲' : '⊕'}</Text>
            </Pressable>
            <Pressable onPress={() => removeTask(task.id)} hitSlop={8}>
              <Text style={s.remove}>✕</Text>
            </Pressable>
          </Pressable>

          {expanded && (
            <View style={s.subSection}>
              {/* Name + icon edit */}
              <View style={s.editNameRow}>
                <Pressable
                  style={[s.taskEmojiBadge, task.emoji
                    ? { backgroundColor: accent.bg }
                    : { borderWidth: 1.5, borderStyle: 'dashed', borderColor: accent.color + '44' }
                  ]}
                  onPress={() => openEmojiPicker(task.id)}
                  hitSlop={6}
                >
                  <Text style={{ fontSize: task.emoji ? 17 : 14, opacity: task.emoji ? 1 : 0.45 }}>
                    {task.emoji || '＋'}
                  </Text>
                </Pressable>
                <TextInput
                  style={s.editNameInput}
                  value={task.text}
                  onChangeText={v => setTasks(prev => prev.map(t => t.id === task.id ? { ...t, text: v } : t))}
                  placeholder="Task name"
                  placeholderTextColor={theme.muted}
                  returnKeyType="done"
                  selectTextOnFocus
                />
              </View>

              <View style={s.goalRow}>
                <Text style={s.goalLabel}>⏱ Time Goal</Text>
                <View style={s.goalInputWrap}>
                  <TextInput
                    style={s.goalInput}
                    placeholder="0"
                    placeholderTextColor={theme.muted}
                    keyboardType="number-pad"
                    value={Math.floor((task.timeGoalSecs ?? 0) / 60) > 0 ? String(Math.floor((task.timeGoalSecs ?? 0) / 60)) : ''}
                    onChangeText={v => updateTaskGoalMins(task.id, v)}
                    maxLength={3}
                  />
                  <Text style={s.goalUnit}>m</Text>
                  <TextInput
                    style={s.goalInput}
                    placeholder="0"
                    placeholderTextColor={theme.muted}
                    keyboardType="number-pad"
                    value={(task.timeGoalSecs ?? 0) % 60 > 0 ? String((task.timeGoalSecs ?? 0) % 60) : ''}
                    onChangeText={v => updateTaskGoalSecs(task.id, v)}
                    maxLength={2}
                  />
                  <Text style={s.goalUnit}>s</Text>
                </View>
              </View>

              <Pressable style={s.copyRow} onPress={() => openCopySheet(task)} hitSlop={6}>
                <Text style={[s.copyRowText, { color: accent.color }]}>⧉  Copy to another routine</Text>
                <Text style={[s.copyRowChevron, { color: accent.color }]}>›</Text>
              </Pressable>

              {/* Optional picture, shown full-width on the run card */}
              {task.image ? (
                <View style={s.photoWrap}>
                  <Pressable onPress={() => setPhotoViewer(task.image)}>
                    <Image source={{ uri: task.image }} style={s.photoThumb} resizeMode="cover" />
                  </Pressable>
                  <View style={s.photoBtnRow}>
                    <Pressable onPress={() => pickTaskImage(task.id)} hitSlop={6}>
                      <Text style={[s.photoBtnText, { color: accent.color }]}>Change photo</Text>
                    </Pressable>
                    <Pressable onPress={() => removeTaskImage(task.id)} hitSlop={6}>
                      <Text style={[s.photoBtnText, { color: '#ef4444' }]}>Remove</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  style={s.photoAddRow}
                  onPress={() => pickTaskImage(task.id)}
                  disabled={uploadingPhoto || photoLimitReached}
                  hitSlop={6}
                >
                  <Text style={[s.photoBtnText, {
                    color: photoLimitReached ? theme.muted : accent.color,
                    opacity: uploadingPhoto ? 0.6 : 1,
                  }]}>
                    {addPhotoLabel(' to this task')}
                  </Text>
                </Pressable>
              )}

              {task.subTasks.map((st, si) => {
                const subOpen = expandedSubKeys.has(subKey(task.id, st.id))
                const isFirst = si === 0
                const isLast = si === task.subTasks.length - 1
                return (
                  <View key={st.id}>
                    <View style={s.subRow}>
                      <View style={[s.subDot, { backgroundColor: accent.color + '66' }]} />
                      <Text style={s.subText}>{st.text}</Text>
                      {!!st.image && <Text style={s.subPhotoFlag}>📷</Text>}
                      {/* Reorder: up and down swap with the neighbouring step */}
                      {task.subTasks.length > 1 && (
                        <View style={s.subMoveGroup}>
                          <Pressable
                            onPress={() => moveSubTask(task.id, st.id, -1)}
                            disabled={isFirst}
                            hitSlop={{ top: 6, bottom: 2, left: 6, right: 4 }}
                            style={s.subMoveBtn}
                          >
                            <Text style={[s.subMoveText, { color: isFirst ? theme.divider : accent.color }]}>▲</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => moveSubTask(task.id, st.id, 1)}
                            disabled={isLast}
                            hitSlop={{ top: 2, bottom: 6, left: 4, right: 6 }}
                            style={s.subMoveBtn}
                          >
                            <Text style={[s.subMoveText, { color: isLast ? theme.divider : accent.color }]}>▼</Text>
                          </Pressable>
                        </View>
                      )}
                      <Pressable onPress={() => toggleSubExpand(task.id, st.id)} hitSlop={8}>
                        <Text style={[s.subExpand, { color: accent.color }]}>{subOpen ? '▲' : '⊕'}</Text>
                      </Pressable>
                      <Pressable onPress={() => removeSubTask(task.id, st.id)} hitSlop={8}>
                        <Text style={s.remove}>✕</Text>
                      </Pressable>
                    </View>

                    {/* Per-step photo, shown in the routine once the steps above it are ticked */}
                    {subOpen && (
                      <View style={[s.subPhotoBox, { borderLeftColor: accent.color + '44' }]}>
                        {st.image ? (
                          <View style={s.photoWrap}>
                            <Pressable onPress={() => setPhotoViewer(st.image)}>
                              <Image source={{ uri: st.image }} style={s.photoThumb} resizeMode="cover" />
                            </Pressable>
                            <View style={s.photoBtnRow}>
                              <Pressable onPress={() => pickSubTaskImage(task.id, st.id)} hitSlop={6}>
                                <Text style={[s.photoBtnText, { color: accent.color }]}>Change photo</Text>
                              </Pressable>
                              <Pressable onPress={() => removeSubTaskImage(task.id, st.id)} hitSlop={6}>
                                <Text style={[s.photoBtnText, { color: '#ef4444' }]}>Remove</Text>
                              </Pressable>
                            </View>
                          </View>
                        ) : (
                          <Pressable
                            style={s.photoAddRow}
                            onPress={() => pickSubTaskImage(task.id, st.id)}
                            disabled={uploadingPhoto || photoLimitReached}
                            hitSlop={6}
                          >
                            <Text style={[s.photoBtnText, {
                              color: photoLimitReached ? theme.muted : accent.color,
                              opacity: uploadingPhoto ? 0.6 : 1,
                            }]}>
                              {addPhotoLabel(' to this step')}
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    )}
                  </View>
                )
              })}
              <View style={s.subAddRow}>
                <TextInput
                  style={s.subInput}
                  placeholder="Add a step…"
                  placeholderTextColor={theme.muted}
                  value={subInputs[task.id] || ''}
                  onChangeText={v => setSubInputs(prev => ({ ...prev, [task.id]: v }))}
                  onSubmitEditing={() => addSubTask(task.id)}
                  returnKeyType="done"
                />
                <Pressable style={[s.subAddBtn, { backgroundColor: accent.bg }]} onPress={() => addSubTask(task.id)}>
                  <Text style={[s.subAddBtnText, { color: accent.color }]}>+</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </ScaleDecorator>
    )
  }

  const listHeader = (
    <View>
      {!isFirstTime && (
        <Pressable onPress={() => router.back()} style={s.back}>
          <Text style={s.backText}>← Back</Text>
        </Pressable>
      )}

      {isFirstTime ? (
        <View style={s.hero}>
          <Text style={s.heroEmoji}>☀️</Text>
          <Text style={s.heroTitle}>Your Morning Routine</Text>
          <Text style={s.heroSub}>Build your ideal morning, one step at a time. Tap ⊕ to set a time goal or add sub-steps to any task.</Text>
        </View>
      ) : (
        <>
          <Text style={s.title}>{title}</Text>
          <Text style={s.subtitle}>{subtitle}</Text>
          {runInProgress && (
            <View style={[s.liveNote, { backgroundColor: accent.color + '14', borderColor: accent.color + '44' }]}>
              <Text style={s.liveNoteEmoji}>▶</Text>
              <Text style={[s.liveNoteText, { color: accent.color }]}>
                This routine is running now. Your changes apply straight away — tasks you've already
                ticked off stay done.
              </Text>
            </View>
          )}
          {canRename && (
            <View style={s.renameWrap}>
              <Text style={[s.renameLabel, { color: accent.color }]}>ROUTINE NAME</Text>
              <TextInput
                style={[s.nameInput, { borderColor: accent.color + '66' }]}
                value={editName}
                onChangeText={setEditName}
                placeholder="Routine name"
                placeholderTextColor={theme.muted}
                returnKeyType="done"
              />
            </View>
          )}
        </>
      )}

      {isNew && (
        <TextInput
          style={[s.nameInput, { borderColor: accent.color + '66' }]}
          placeholder="Routine name (e.g. Evening Walk)"
          placeholderTextColor={theme.muted}
          value={customName}
          onChangeText={setCustomName}
          returnKeyType="done"
        />
      )}

      {/* New routines pick their dashboard section */}
      {isNew && (
        <View style={s.groupPickWrap}>
          <Text style={[s.renameLabel, { color: accent.color }]}>SHOW UNDER</Text>
          <View style={s.groupPickRow}>
            {[
              { key: 'everyday', emoji: '⭐', label: 'Every day', hint: 'Aim to do it daily', color: EVERYDAY_COLOR },
              { key: 'whenever', emoji: '🌊', label: 'Whenever', hint: 'For when you feel like it', color: WHENEVER_COLOR },
            ].map(opt => {
              const active = newGroup === opt.key
              return (
                <Pressable
                  key={opt.key}
                  style={[s.groupPickCard, {
                    borderColor: active ? opt.color : theme.cardBorder,
                    backgroundColor: active ? opt.color + '14' : theme.card,
                  }]}
                  onPress={() => setNewGroup(opt.key)}
                >
                  <Text style={{ fontSize: 18 }}>{opt.emoji}</Text>
                  <Text style={[s.groupPickLabel, { color: active ? opt.color : theme.text }]}>{opt.label}</Text>
                  <Text style={s.groupPickHint}>{opt.hint}</Text>
                </Pressable>
              )
            })}
          </View>
        </View>
      )}

      {!isFirstTime && !isAltVariant && (
        <View style={s.descWrap}>
          <Text style={[s.renameLabel, { color: accent.color }]}>DESCRIPTION</Text>
          <TextInput
            style={[s.descInput, { borderColor: accent.color + '44' }]}
            placeholder="What's this routine for? (optional)"
            placeholderTextColor={theme.muted}
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={140}
          />
        </View>
      )}

      {/* Whenever routines have no schedule — they're done, well, whenever */}
      {!isFirstTime && !isAltVariant && !isWhenever && (
        <View style={[s.scheduleCard, { borderColor: accent.color + '33' }]}>
          <View style={s.scheduleHeaderRow}>
            <Text style={[s.scheduleLabel, { color: accent.color }]}>SCHEDULE</Text>
            <Pressable
              onPress={() => {
                if (!perDayMode) setDayTimes(Array(7).fill(startTimeMinutes))
                setPerDayMode(p => !p)
              }}
              style={[s.perDayBtn, perDayMode && { backgroundColor: accent.color }]}
            >
              <Text style={[s.perDayBtnText, { color: perDayMode ? '#fff' : theme.subtext }]}>Per day</Text>
            </Pressable>
          </View>

          <View style={s.daysRow}>
            {DAY_INITIALS.map((d, i) => (
              <Pressable
                key={i}
                style={[s.dayCircle, activeDays[i] ? { backgroundColor: accent.color } : s.dayCircleOff]}
                onPress={() => toggleDay(i)}
              >
                <Text style={[s.dayInitial, { color: activeDays[i] ? '#fff' : theme.muted }]}>{d}</Text>
                {activeDays[i] && <Text style={s.dayCheck}>✓</Text>}
              </Pressable>
            ))}
          </View>

          {perDayMode ? (
            DAY_NAMES.map((name, i) => !activeDays[i] ? null : (
              <View key={i} style={s.perDayRow}>
                <Text style={s.perDayName}>{name}</Text>
                <View style={s.timeStepper}>
                  <Pressable style={s.timeBtn} onPress={() => setDayTimes(prev => prev.map((t, j) => j === i ? ((t - 15 + 1440) % 1440) : t))}>
                    <Text style={s.timeBtnText}>−</Text>
                  </Pressable>
                  <Text style={[s.timeValue, { color: accent.color }]}>{fmtTime(dayTimes[i])}</Text>
                  <Pressable style={s.timeBtn} onPress={() => setDayTimes(prev => prev.map((t, j) => j === i ? ((t + 15) % 1440) : t))}>
                    <Text style={s.timeBtnText}>+</Text>
                  </Pressable>
                </View>
              </View>
            ))
          ) : (
            <>
              <View style={s.timeRow}>
                <Text style={s.timeRowLabel}>Start</Text>
                <View style={s.timeStepper}>
                  <Pressable style={s.timeBtn} onPress={() => adjustTime(-15)}>
                    <Text style={s.timeBtnText}>−</Text>
                  </Pressable>
                  <Text style={[s.timeValue, { color: accent.color }]}>{fmtTime(startTimeMinutes)}</Text>
                  <Pressable style={s.timeBtn} onPress={() => adjustTime(15)}>
                    <Text style={s.timeBtnText}>+</Text>
                  </Pressable>
                </View>
              </View>
              {totalGoalSecs > 0 && (
                <Text style={s.endTimeText}>
                  {fmtTime(startTimeMinutes)} – {fmtTime(startTimeMinutes + Math.round(totalGoalSecs / 60))}
                  {'  ·  '}{fmtDuration(Math.round(totalGoalSecs / 60))} total
                </Text>
              )}
            </>
          )}
        </View>
      )}

      {!loaded && <ActivityIndicator color={accent.color} style={{ paddingVertical: 24 }} />}
    </View>
  )

  // Save waits for the routine to load and for any photo still uploading.
  const saveBlocked = saving || uploadingPhoto || !loaded

  const listFooter = (
    <View>
      <View style={[s.addSection, isFirstTime && { marginHorizontal: 20 }]}>
        <View style={s.addNameRow}>
          <Pressable
            style={[s.addEmojiBtn, { borderColor: accent.color + '55', backgroundColor: taskEmoji ? accent.bg : theme.input }]}
            onPress={() => openEmojiPicker(null)}
          >
            <Text style={s.addEmojiBtnText}>{taskEmoji || '📋'}</Text>
          </Pressable>
          <TextInput
            style={s.input}
            placeholder="Add a task…"
            placeholderTextColor={theme.muted}
            value={text}
            onChangeText={setText}
            onSubmitEditing={addTask}
            returnKeyType="done"
          />
        </View>
        <View style={s.addTimeRow}>
          <TextInput
            style={s.minsInput}
            placeholder="min"
            placeholderTextColor={theme.muted}
            keyboardType="number-pad"
            value={goalMins}
            onChangeText={setGoalMins}
            maxLength={3}
          />
          <TextInput
            style={s.secsInput}
            placeholder="sec"
            placeholderTextColor={theme.muted}
            keyboardType="number-pad"
            value={goalSecs}
            onChangeText={setGoalSecs}
            maxLength={2}
          />
          <Pressable
            style={[s.addBtn, { backgroundColor: accent.color }, !loaded && { opacity: 0.6 }]}
            onPress={addTask}
            disabled={!loaded}
          >
            <Text style={s.addBtnText}>+</Text>
          </Pressable>
        </View>
      </View>

      <Pressable
        style={[
          s.btn,
          { backgroundColor: accent.color },
          isFirstTime && s.btnFirst,
          saveBlocked && { opacity: 0.6 },
        ]}
        onPress={save}
        disabled={saveBlocked}
      >
        <Text style={[s.btnText, isFirstTime && s.btnTextFirst]}>
          {saving ? 'Saving…'
            : !loaded ? 'Loading…'
            : uploadingPhoto ? 'Uploading photo…'
            : isFirstTime ? "Let's go! 🚀" : isNew ? 'Create Routine' : 'Save changes'}
        </Text>
      </Pressable>

      {isFirstTime && (
        <Pressable
          style={s.skipBtn}
          onPress={async () => {
            try { await markSetupDone(user.id) } catch (e) { Alert.alert('Error', e.message); return }
            // Skipping leaves any edits (and this visit's uploads) behind on purpose.
            leavingRef.current = true
            releaseUploads()
            router.replace('/(tabs)')
          }}
        >
          <Text style={s.skipText}>I'll do this later</Text>
        </Pressable>
      )}
    </View>
  )

  return (
    <KeyboardAvoidingView style={s.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <DraggableFlatList
        data={tasks}
        keyExtractor={item => String(item.id)}
        onDragEnd={({ data }) => setTasks(data)}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={isFirstTime ? s.contentFirst : s.content}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        showsVerticalScrollIndicator={false}
      />

      <Modal
        visible={showEmojiPicker}
        transparent
        animationType="slide"
        onRequestClose={emojiDrag.close}
      >
        <KeyboardAvoidingView style={s.emojiOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={StyleSheet.absoluteFill} onPress={emojiDrag.close} />
          <Animated.View style={[s.emojiSheet, { transform: [{ translateY: emojiDrag.dragY }] }]}>
            <View {...emojiDrag.handlePan.panHandlers} style={emojiDrag.grabStyle}>
              <View style={[s.emojiHandle, { backgroundColor: theme.divider }]} />
            </View>
            <View style={s.emojiHeaderRow}>
              <Text style={s.emojiHeaderTitle}>Choose an icon</Text>
              {(emojiTargetId !== null
                ? tasks.find(t => t.id === emojiTargetId)?.emoji
                : taskEmoji) && (
                <Pressable onPress={clearEmoji} hitSlop={8}>
                  <Text style={[s.emojiClearBtn, { color: accent.color }]}>Clear</Text>
                </Pressable>
              )}
            </View>

            <TextInput
              style={s.emojiSearch}
              placeholder="Search  (e.g. run, coffee, book…)"
              placeholderTextColor={theme.muted}
              value={emojiQuery}
              onChangeText={setEmojiQuery}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
            />

            <ScrollView
              style={s.emojiScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {(() => {
                const q = emojiQuery.trim().toLowerCase()
                if (q) {
                  const results = EMOJI_LIBRARY
                    .flatMap(c => c.emojis)
                    .filter(([e, keywords]) => keywords.includes(q) || e === emojiQuery.trim())
                  return results.length ? (
                    <View style={s.emojiGrid}>
                      {results.map(([e]) => (
                        <Pressable key={e} style={s.emojiItem} onPress={() => pickEmoji(e)}>
                          <Text style={s.emojiItemText}>{e}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : (
                    <Text style={s.emojiNoResults}>No matches for “{emojiQuery.trim()}”</Text>
                  )
                }
                return EMOJI_LIBRARY.map(cat => (
                  <View key={cat.category}>
                    <Text style={s.emojiCatLabel}>{cat.category.toUpperCase()}</Text>
                    <View style={s.emojiGrid}>
                      {cat.emojis.map(([e]) => (
                        <Pressable key={e} style={s.emojiItem} onPress={() => pickEmoji(e)}>
                          <Text style={s.emojiItemText}>{e}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ))
              })()}
              <View style={{ height: 12 }} />
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Pick which routine a task is copied into */}
      <Modal
        visible={!!copyTask}
        transparent
        animationType="slide"
        onRequestClose={copyDrag.close}
      >
        <View style={s.emojiOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={copyDrag.close} />
          <Animated.View style={[s.emojiSheet, { transform: [{ translateY: copyDrag.dragY }] }]}>
            <View {...copyDrag.handlePan.panHandlers} style={copyDrag.grabStyle}>
              <View style={[s.emojiHandle, { backgroundColor: theme.divider }]} />
              <Text style={[s.emojiHeaderTitle, { marginBottom: 6 }]} numberOfLines={2}>
                Copy “{copyTask?.text}” to…
              </Text>
            </View>
            <Text style={s.copyHint}>
              The task goes to the end of the routine you pick, with its icon, time goal and steps. Photos aren't copied.
            </Text>
            {copyTargets === null ? (
              <ActivityIndicator color={accent.color} style={{ paddingVertical: 24 }} />
            ) : copyTargets.length === 0 ? (
              <Text style={s.emojiNoResults}>There's no other routine to copy into yet.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                {copyTargets.map(t => (
                  <Pressable
                    key={t.key}
                    style={[s.copyTarget, copying && { opacity: 0.5 }]}
                    onPress={() => copyTaskTo(t)}
                    disabled={copying}
                  >
                    <Text style={s.copyTargetEmoji}>{t.emoji}</Text>
                    <Text style={s.copyTargetText}>{t.label}</Text>
                    <Text style={[s.copyRowChevron, { color: accent.color }]}>›</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </Animated.View>
        </View>
      </Modal>

      <ImageViewerModal uri={photoViewer} onClose={() => setPhotoViewer(null)} />
    </KeyboardAvoidingView>
  )
}

function makeStyles(theme) { return StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 24, paddingTop: 56, paddingBottom: 40 },
  contentFirst: { paddingBottom: 48 },
  back: { marginBottom: 20 },
  backText: { color: theme.accent, fontSize: 15, fontWeight: '600' },
  title: { fontSize: 26, fontWeight: '800', color: theme.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: theme.subtext, marginBottom: 24, lineHeight: 20 },

  liveNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderRadius: 14, borderWidth: 1, padding: 12, marginTop: -12, marginBottom: 22,
  },
  liveNoteEmoji: { fontSize: 12, marginTop: 2, color: theme.subtext },
  liveNoteText: { flex: 1, fontSize: 12.5, fontWeight: '600', lineHeight: 18 },

  hero: {
    backgroundColor: '#4f46e5',
    paddingTop: 72,
    paddingBottom: 32,
    paddingHorizontal: 28,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    alignItems: 'center',
    marginBottom: 28,
    shadowColor: '#4f46e5',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 10,
  },
  heroEmoji: { fontSize: 56, marginBottom: 16 },
  heroTitle: {
    fontSize: 30, fontWeight: '900', color: '#fff',
    textAlign: 'center', marginBottom: 12, letterSpacing: -0.5,
  },
  heroSub: {
    fontSize: 14, color: 'rgba(255,255,255,0.75)',
    textAlign: 'center', lineHeight: 21, fontWeight: '500',
  },

  nameInput: {
    backgroundColor: theme.input, borderRadius: 14, padding: 14,
    fontSize: 17, fontWeight: '600', borderWidth: 2, color: theme.text, marginBottom: 20,
  },
  renameWrap: { marginTop: 4 },
  renameLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 },

  groupPickWrap: { marginBottom: 20 },
  groupPickRow: { flexDirection: 'row', gap: 10 },
  groupPickCard: {
    flex: 1, borderRadius: 14, borderWidth: 2,
    paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center', gap: 3,
  },
  groupPickLabel: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2 },
  groupPickHint: { fontSize: 11, fontWeight: '500', color: theme.muted, textAlign: 'center' },

  descWrap: { marginTop: 4 },
  descInput: {
    backgroundColor: theme.input, borderRadius: 14, padding: 14, paddingTop: 12,
    fontSize: 14, fontWeight: '500', borderWidth: 2, color: theme.text, marginBottom: 20,
    minHeight: 64, textAlignVertical: 'top',
  },

  scheduleCard: {
    backgroundColor: theme.card, borderRadius: 18, padding: 16,
    borderWidth: 1.5, marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  scheduleHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  scheduleLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  perDayBtn: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: theme.divider },
  perDayBtnText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  perDayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  perDayName: { fontSize: 13, fontWeight: '600', color: theme.subtext, width: 36 },
  daysRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  dayCircle: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  dayCircleOff: { backgroundColor: theme.divider },
  dayInitial: { fontSize: 12, fontWeight: '800' },
  dayCheck: { fontSize: 7, color: '#fff', fontWeight: '800', marginTop: 1 },

  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  timeRowLabel: { fontSize: 13, fontWeight: '600', color: theme.subtext },
  timeStepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  timeBtn: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: theme.divider,
    alignItems: 'center', justifyContent: 'center',
  },
  timeBtnText: { fontSize: 20, color: theme.subtext, fontWeight: '300', lineHeight: 24 },
  timeValue: { fontSize: 17, fontWeight: '700', minWidth: 90, textAlign: 'center' },
  endTimeText: { fontSize: 12, color: theme.muted, textAlign: 'center', fontWeight: '500' },

  taskCard: {
    backgroundColor: theme.card, borderRadius: 14,
    marginBottom: 10, borderWidth: 1, borderColor: theme.cardBorder, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  taskCardActive: {
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 8,
    borderColor: theme.accent + '55',
  },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  num: {
    width: 30, height: 30, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  numText: { fontSize: 13, fontWeight: '800' },
  taskText: { flex: 1, fontSize: 15, color: theme.text, fontWeight: '500' },
  goalBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  goalBadgeText: { fontSize: 11, fontWeight: '800' },
  expandBtn: { paddingHorizontal: 4 },
  expandBtnText: { fontSize: 16 },
  remove: { color: theme.muted, fontSize: 16, paddingHorizontal: 4 },

  subSection: { borderTopWidth: 1, borderTopColor: theme.divider, paddingHorizontal: 14, paddingBottom: 12 },
  editNameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.divider },
  editNameInput: { flex: 1, fontSize: 15, fontWeight: '600', color: theme.text, paddingVertical: 6, paddingHorizontal: 2, borderBottomWidth: 1.5, borderBottomColor: theme.inputBorder },

  goalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.divider,
  },
  goalLabel: { fontSize: 13, fontWeight: '600', color: theme.subtext },
  goalInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  goalInput: {
    width: 56, backgroundColor: theme.input, borderRadius: 9,
    paddingHorizontal: 10, paddingVertical: 7, fontSize: 15,
    fontWeight: '700', color: theme.text, textAlign: 'center',
    borderWidth: 1, borderColor: theme.inputBorder,
  },
  goalUnit: { fontSize: 13, fontWeight: '600', color: theme.muted },

  photoWrap: { marginTop: 10, marginBottom: 4 },
  photoThumb: { width: '100%', height: 140, borderRadius: 14, backgroundColor: theme.divider },
  photoBtnRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, paddingTop: 8 },
  photoAddRow: { paddingVertical: 10, paddingLeft: 2 },
  photoBtnText: { fontSize: 13, fontWeight: '700' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, paddingLeft: 8 },
  subDot: { width: 7, height: 7, borderRadius: 4 },
  subText: { flex: 1, fontSize: 14, color: theme.subtext },
  subPhotoFlag: { fontSize: 12 },
  subMoveGroup: { flexDirection: 'row', alignItems: 'center', gap: 2, marginRight: 2 },
  subMoveBtn: { paddingHorizontal: 3, paddingVertical: 2 },
  subMoveText: { fontSize: 11, fontWeight: '800' },
  subExpand: { fontSize: 15, fontWeight: '800' },
  subPhotoBox: { marginLeft: 12, paddingLeft: 12, borderLeftWidth: 2, marginBottom: 4 },
  subAddRow: { flexDirection: 'row', gap: 8, marginTop: 8, paddingLeft: 8 },
  subInput: {
    flex: 1, backgroundColor: theme.input, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: theme.text,
  },
  subAddBtn: {
    borderRadius: 10, width: 36, alignItems: 'center', justifyContent: 'center',
  },
  subAddBtnText: { fontSize: 22, fontWeight: '400', lineHeight: 26 },

  taskEmojiBadge: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },

  addSection: { marginBottom: 24 },
  addNameRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 },
  addEmojiBtn: {
    width: 44, height: 44, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, flexShrink: 0,
  },
  addEmojiBtnText: { fontSize: 22 },
  addTimeRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginLeft: 52 },

  addRow: { flexDirection: 'row', gap: 8, marginBottom: 24, alignItems: 'center' },
  input: {
    flex: 1, backgroundColor: theme.input, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, borderWidth: 1, borderColor: theme.inputBorder, color: theme.text,
  },
  minsInput: {
    width: 52, backgroundColor: theme.input, borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 12,
    fontSize: 13, fontWeight: '600', borderWidth: 1, borderColor: theme.inputBorder,
    color: theme.text, textAlign: 'center',
  },
  secsInput: {
    width: 46, backgroundColor: theme.input, borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 12,
    fontSize: 13, fontWeight: '600', borderWidth: 1, borderColor: theme.inputBorder,
    color: theme.text, textAlign: 'center',
  },
  addBtn: {
    borderRadius: 14, width: 48, alignItems: 'center', justifyContent: 'center', height: 48,
  },
  addBtnText: { color: '#fff', fontSize: 26, fontWeight: '300', lineHeight: 32 },

  emojiOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  emojiSheet: {
    backgroundColor: theme.card, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 10, paddingHorizontal: 20, paddingBottom: 44,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 16,
  },
  emojiHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 18 },
  emojiHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  emojiHeaderTitle: { fontSize: 17, fontWeight: '700', color: theme.text },
  emojiClearBtn: { fontSize: 14, fontWeight: '600' },
  emojiSearch: {
    backgroundColor: theme.input, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, color: theme.text, marginBottom: 12,
  },
  emojiScroll: { maxHeight: 420 },
  emojiCatLabel: {
    fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: theme.muted,
    marginTop: 14, marginBottom: 8,
  },
  emojiNoResults: {
    fontSize: 14, color: theme.muted, textAlign: 'center', paddingVertical: 28,
  },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-start' },
  emojiItem: {
    width: 52, height: 52, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.input,
  },
  emojiItemText: { fontSize: 28 },

  copyRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.divider,
  },
  copyRowText: { fontSize: 13, fontWeight: '700' },
  copyRowChevron: { fontSize: 18, fontWeight: '700', lineHeight: 20 },
  copyHint: { fontSize: 13, color: theme.subtext, lineHeight: 18, marginBottom: 14 },
  copyTarget: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 12, borderRadius: 14,
    backgroundColor: theme.input, marginBottom: 8,
  },
  copyTargetEmoji: { fontSize: 20 },
  copyTargetText: { flex: 1, fontSize: 15, fontWeight: '600', color: theme.text },
  btn: { borderRadius: 16, padding: 18, alignItems: 'center' },
  btnFirst: {
    padding: 20,
    borderRadius: 20,
    marginHorizontal: 20,
    shadowColor: '#4f46e5',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 8,
  },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 17 },
  btnTextFirst: { fontSize: 18, letterSpacing: 0.3 },
  skipBtn: { alignItems: 'center', paddingVertical: 16, marginHorizontal: 20 },
  skipText: { color: theme.subtext, fontSize: 15, fontWeight: '600' },
}) }
