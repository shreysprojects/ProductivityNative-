import { useState, useEffect } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, Alert, Modal, KeyboardAvoidingView, Platform, ScrollView } from 'react-native'
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist'
import { router, useLocalSearchParams } from 'expo-router'
import { useAuth } from '../lib/AuthContext'
import {
  getRoutineTemplate, saveRoutineTemplate, markSetupDone,
  addRoutine, getRoutineNames, getRoutineSettings, saveRoutineSettings,
  renameRoutine, shiftRoutinesAfter, RESERVED_ROUTINES,
} from '../lib/storage'
import { routineTheme } from '../lib/themes'

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
  const { name: nameParam } = useLocalSearchParams()

  const isNew = nameParam === 'new'
  const isFirstTime = !nameParam
  const routineName = isNew || isFirstTime ? null : nameParam

  const theme = routineTheme(routineName || 'Morning')

  // Only routines the user created can be renamed (Morning/Fitness/Night are
  // hardcoded throughout the app and keep their names).
  const isDefaultRoutine = !!routineName && RESERVED_ROUTINES.includes(routineName)
  const canRename = !isFirstTime && !isNew && !isDefaultRoutine

  const [editName,         setEditName]         = useState(routineName || '')
  const [customName,       setCustomName]       = useState('')
  const [description,      setDescription]      = useState('')
  const [tasks,            setTasks]            = useState([])
  const [text,             setText]             = useState('')
  const [goalMins,         setGoalMins]         = useState('')
  const [goalSecs,         setGoalSecs]         = useState('')
  const [saving,           setSaving]           = useState(false)
  const [expandedIds,      setExpandedIds]      = useState(new Set())
  const [subInputs,        setSubInputs]        = useState({})
  const [activeDays,       setActiveDays]       = useState([true, true, true, true, true, true, true])
  const [startTimeMinutes, setStartTimeMinutes] = useState(540)
  const [perDayMode,       setPerDayMode]       = useState(false)
  const [dayTimes,         setDayTimes]         = useState(Array(7).fill(540))
  const [taskEmoji,        setTaskEmoji]        = useState(null)
  const [showEmojiPicker,  setShowEmojiPicker]  = useState(false)
  const [emojiTargetId,    setEmojiTargetId]    = useState(null)
  const [emojiQuery,       setEmojiQuery]       = useState('')

  useEffect(() => {
    if (!user) return
    const target = routineName || 'Morning'
    getRoutineTemplate(user.id, target).then(template =>
      setTasks(template.map(t => ({ ...t, subTasks: t.subTasks || [], timeGoalSecs: t.timeGoalSecs ?? (t.timeGoalMins ?? 0) * 60 })))
    )
    if (!isFirstTime) {
      getRoutineSettings(user.id, target).then(s => {
        setActiveDays(s.activeDays)
        setStartTimeMinutes(s.startTimeMinutes)
        setPerDayMode(s.perDayMode)
        setDayTimes(s.dayTimes)
        setDescription(s.description ?? '')
      })
    }
  }, [user, routineName, isFirstTime])

  const totalGoalSecs = tasks.reduce((sum, t) => sum + (t.timeGoalSecs ?? (t.timeGoalMins ?? 0) * 60), 0)

  function addTask() {
    if (!text.trim()) return
    const mins = parseInt(goalMins, 10) || 0
    const secs = Math.min(parseInt(goalSecs, 10) || 0, 59)
    const totalSecs = mins * 60 + secs
    setTasks(prev => [...prev, {
      id: Date.now(), text: text.trim(), subTasks: [],
      timeGoalSecs: totalSecs,
      ...(taskEmoji ? { emoji: taskEmoji } : {}),
    }])
    setText('')
    setGoalMins('')
    setGoalSecs('')
    setTaskEmoji(null)

    // Offer to push later routines back by this task's duration (existing routines only).
    const shiftMin = Math.round(totalSecs / 60)
    if (shiftMin >= 1 && !isNew && !isFirstTime && routineName) {
      maybeShiftLater(shiftMin)
    }
  }

  function maybeShiftLater(shiftMin) {
    Alert.alert(
      'Shift later routines?',
      `This task adds ${shiftMin} min. Push every routine after “${routineName}” later by ${shiftMin} min so they don't overlap?`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: `Shift by ${shiftMin}m`,
          onPress: async () => {
            try {
              const n = await shiftRoutinesAfter(user.id, routineName, shiftMin)
              if (!n) Alert.alert('Nothing to shift', 'There are no routines after this one.')
            } catch (e) {
              Alert.alert('Could not shift', e.message)
            }
          },
        },
      ],
    )
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

  function removeTask(id) {
    setTasks(prev => prev.filter(t => t.id !== id))
    setExpandedIds(prev => { const n = new Set(prev); n.delete(id); return n })
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
      t.id === taskId ? { ...t, subTasks: t.subTasks.filter(st => st.id !== subId) } : t
    ))
  }

  function toggleDay(i) {
    setActiveDays(prev => prev.map((v, j) => j === i ? !v : v))
  }

  function adjustTime(delta) {
    setStartTimeMinutes(prev => ((prev + delta) % 1440 + 1440) % 1440)
  }

  async function save() {
    if (isNew && !customName.trim()) return Alert.alert('Enter a routine name')
    if (canRename && !editName.trim()) return Alert.alert('Enter a routine name')
    if (tasks.length === 0) return Alert.alert('Add at least one task')

    const renaming = canRename && editName.trim() !== routineName
    const finalName = isNew ? customName.trim() : canRename ? editName.trim() : (routineName || 'Morning')

    if (isNew) {
      const existing = await getRoutineNames(user.id)
      if (existing.includes(finalName)) return Alert.alert('A routine with that name already exists')
    }

    setSaving(true)
    try {
      if (renaming) {
        try {
          await renameRoutine(user.id, routineName, finalName)
        } catch (e) {
          setSaving(false)
          return Alert.alert('Could not rename', e.message)
        }
      }
      await saveRoutineTemplate(user.id, finalName, tasks)
      await addRoutine(user.id, finalName)
      if (!isFirstTime) {
        await saveRoutineSettings(user.id, finalName, { activeDays, startTimeMinutes, perDayMode, dayTimes, description: description.trim() })
      }
      if (isFirstTime) await markSetupDone(user.id)
      // First-time setup hands off to onboarding; a rename re-points to the new
      // route; otherwise return to wherever the user opened this from.
      if (isFirstTime) router.replace('/onboarding')
      else if (renaming) router.replace('/routine/' + encodeURIComponent(finalName))
      else if (router.canGoBack()) router.back()
      else router.replace('/(tabs)')
    } finally {
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
  }

  function renderItem({ item: task, drag, isActive, getIndex }) {
    const i = getIndex() ?? 0
    const expanded = expandedIds.has(task.id)
    return (
      <ScaleDecorator activeScale={0.97}>
        <View style={[
          s.taskCard,
          isActive && s.taskCardActive,
          isFirstTime && { borderLeftWidth: 4, borderLeftColor: theme.color + 'cc', marginHorizontal: 20 },
        ]}>
          <Pressable
            onLongPress={drag}
            disabled={isActive}
            delayLongPress={200}
            style={s.taskRow}
          >
            <View style={[s.num, { backgroundColor: theme.color }]}>
              <Text style={[s.numText, { color: '#fff' }]}>{i + 1}</Text>
            </View>
            <Pressable
              style={[s.taskEmojiBadge, task.emoji
                ? { backgroundColor: theme.bg }
                : { borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.color + '44' }
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
              <View style={[s.goalBadge, { backgroundColor: theme.bg }]}>
                <Text style={[s.goalBadgeText, { color: theme.color }]}>{fmtGoalSecs(task.timeGoalSecs)}</Text>
              </View>
            )}
            <Pressable onPress={() => toggleExpand(task.id)} hitSlop={8} style={s.expandBtn}>
              <Text style={[s.expandBtnText, { color: theme.color }]}>{expanded ? '▲' : '⊕'}</Text>
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
                    ? { backgroundColor: theme.bg }
                    : { borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.color + '44' }
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
                  placeholderTextColor="#ccc"
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
                    placeholderTextColor="#ccc"
                    keyboardType="number-pad"
                    value={Math.floor((task.timeGoalSecs ?? 0) / 60) > 0 ? String(Math.floor((task.timeGoalSecs ?? 0) / 60)) : ''}
                    onChangeText={v => updateTaskGoalMins(task.id, v)}
                    maxLength={3}
                  />
                  <Text style={s.goalUnit}>m</Text>
                  <TextInput
                    style={s.goalInput}
                    placeholder="0"
                    placeholderTextColor="#ccc"
                    keyboardType="number-pad"
                    value={(task.timeGoalSecs ?? 0) % 60 > 0 ? String((task.timeGoalSecs ?? 0) % 60) : ''}
                    onChangeText={v => updateTaskGoalSecs(task.id, v)}
                    maxLength={2}
                  />
                  <Text style={s.goalUnit}>s</Text>
                </View>
              </View>

              {task.subTasks.map(st => (
                <View key={st.id} style={s.subRow}>
                  <View style={[s.subDot, { backgroundColor: theme.color + '66' }]} />
                  <Text style={s.subText}>{st.text}</Text>
                  <Pressable onPress={() => removeSubTask(task.id, st.id)} hitSlop={8}>
                    <Text style={s.remove}>✕</Text>
                  </Pressable>
                </View>
              ))}
              <View style={s.subAddRow}>
                <TextInput
                  style={s.subInput}
                  placeholder="Add a step…"
                  placeholderTextColor="#ccc"
                  value={subInputs[task.id] || ''}
                  onChangeText={v => setSubInputs(prev => ({ ...prev, [task.id]: v }))}
                  onSubmitEditing={() => addSubTask(task.id)}
                  returnKeyType="done"
                />
                <Pressable style={[s.subAddBtn, { backgroundColor: theme.bg }]} onPress={() => addSubTask(task.id)}>
                  <Text style={[s.subAddBtnText, { color: theme.color }]}>+</Text>
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
          {canRename && (
            <View style={s.renameWrap}>
              <Text style={[s.renameLabel, { color: theme.color }]}>ROUTINE NAME</Text>
              <TextInput
                style={[s.nameInput, { borderColor: theme.color + '66' }]}
                value={editName}
                onChangeText={setEditName}
                placeholder="Routine name"
                placeholderTextColor="#bbb"
                returnKeyType="done"
              />
            </View>
          )}
        </>
      )}

      {isNew && (
        <TextInput
          style={[s.nameInput, { borderColor: theme.color + '66' }]}
          placeholder="Routine name (e.g. Evening Walk)"
          placeholderTextColor="#bbb"
          value={customName}
          onChangeText={setCustomName}
          returnKeyType="done"
        />
      )}

      {!isFirstTime && (
        <View style={s.descWrap}>
          <Text style={[s.renameLabel, { color: theme.color }]}>DESCRIPTION</Text>
          <TextInput
            style={[s.descInput, { borderColor: theme.color + '44' }]}
            placeholder="What's this routine for? (optional)"
            placeholderTextColor="#bbb"
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={140}
          />
        </View>
      )}

      {!isFirstTime && (
        <View style={[s.scheduleCard, { borderColor: theme.color + '33' }]}>
          <View style={s.scheduleHeaderRow}>
            <Text style={[s.scheduleLabel, { color: theme.color }]}>SCHEDULE</Text>
            <Pressable
              onPress={() => {
                if (!perDayMode) setDayTimes(Array(7).fill(startTimeMinutes))
                setPerDayMode(p => !p)
              }}
              style={[s.perDayBtn, perDayMode && { backgroundColor: theme.color }]}
            >
              <Text style={[s.perDayBtnText, { color: perDayMode ? '#fff' : '#555' }]}>Per day</Text>
            </Pressable>
          </View>

          <View style={s.daysRow}>
            {DAY_INITIALS.map((d, i) => (
              <Pressable
                key={i}
                style={[s.dayCircle, activeDays[i] ? { backgroundColor: theme.color } : s.dayCircleOff]}
                onPress={() => toggleDay(i)}
              >
                <Text style={[s.dayInitial, { color: activeDays[i] ? '#fff' : '#bbb' }]}>{d}</Text>
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
                  <Text style={[s.timeValue, { color: theme.color }]}>{fmtTime(dayTimes[i])}</Text>
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
                  <Text style={[s.timeValue, { color: theme.color }]}>{fmtTime(startTimeMinutes)}</Text>
                  <Pressable style={s.timeBtn} onPress={() => adjustTime(15)}>
                    <Text style={s.timeBtnText}>+</Text>
                  </Pressable>
                </View>
              </View>
              {totalGoalSecs > 0 && (
                <Text style={s.endTimeText}>
                  {fmtTime(startTimeMinutes)} – {fmtTime(startTimeMinutes + totalGoalSecs / 60)}
                  {'  ·  '}{fmtDuration(Math.round(totalGoalSecs / 60))} total
                </Text>
              )}
            </>
          )}
        </View>
      )}
    </View>
  )

  const listFooter = (
    <View>
      <View style={[s.addSection, isFirstTime && { marginHorizontal: 20 }]}>
        <View style={s.addNameRow}>
          <Pressable
            style={[s.addEmojiBtn, { borderColor: theme.color + '55', backgroundColor: taskEmoji ? theme.bg : '#fff' }]}
            onPress={() => openEmojiPicker(null)}
          >
            <Text style={s.addEmojiBtnText}>{taskEmoji || '📋'}</Text>
          </Pressable>
          <TextInput
            style={s.input}
            placeholder="Add a task…"
            placeholderTextColor="#bbb"
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
            placeholderTextColor="#ccc"
            keyboardType="number-pad"
            value={goalMins}
            onChangeText={setGoalMins}
            maxLength={3}
          />
          <TextInput
            style={s.secsInput}
            placeholder="sec"
            placeholderTextColor="#ccc"
            keyboardType="number-pad"
            value={goalSecs}
            onChangeText={setGoalSecs}
            maxLength={2}
          />
          <Pressable style={[s.addBtn, { backgroundColor: theme.color }]} onPress={addTask}>
            <Text style={s.addBtnText}>+</Text>
          </Pressable>
        </View>
      </View>

      <Pressable
        style={[
          s.btn,
          { backgroundColor: theme.color },
          isFirstTime && s.btnFirst,
          saving && { opacity: 0.6 },
        ]}
        onPress={save}
        disabled={saving}
      >
        <Text style={[s.btnText, isFirstTime && s.btnTextFirst]}>
          {saving ? 'Saving…' : isFirstTime ? "Let's go! 🚀" : isNew ? 'Create Routine' : 'Save changes'}
        </Text>
      </Pressable>

      {isFirstTime && (
        <Pressable style={s.skipBtn} onPress={async () => { try { await markSetupDone(user.id) } catch (e) { Alert.alert('Error', e.message); return } router.replace('/(tabs)') }}>
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
        onRequestClose={() => { setShowEmojiPicker(false); setEmojiTargetId(null) }}
      >
        <KeyboardAvoidingView style={s.emojiOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => { setShowEmojiPicker(false); setEmojiTargetId(null) }} />
          <View style={s.emojiSheet}>
            <View style={[s.emojiHandle, { backgroundColor: '#ddd' }]} />
            <View style={s.emojiHeaderRow}>
              <Text style={s.emojiHeaderTitle}>Choose an icon</Text>
              {(emojiTargetId !== null
                ? tasks.find(t => t.id === emojiTargetId)?.emoji
                : taskEmoji) && (
                <Pressable onPress={clearEmoji} hitSlop={8}>
                  <Text style={[s.emojiClearBtn, { color: theme.color }]}>Clear</Text>
                </Pressable>
              )}
            </View>

            <TextInput
              style={s.emojiSearch}
              placeholder="Search  (e.g. run, coffee, book…)"
              placeholderTextColor="#aaa"
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
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f6f7fb' },
  content: { padding: 24, paddingTop: 56, paddingBottom: 40 },
  contentFirst: { paddingBottom: 48 },
  back: { marginBottom: 20 },
  backText: { color: '#4f46e5', fontSize: 15, fontWeight: '600' },
  title: { fontSize: 26, fontWeight: '800', color: '#111', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 24, lineHeight: 20 },

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
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    fontSize: 17, fontWeight: '600', borderWidth: 2, color: '#111', marginBottom: 20,
  },
  renameWrap: { marginTop: 4 },
  renameLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 },

  descWrap: { marginTop: 4 },
  descInput: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14, paddingTop: 12,
    fontSize: 14, fontWeight: '500', borderWidth: 2, color: '#111', marginBottom: 20,
    minHeight: 64, textAlignVertical: 'top',
  },

  scheduleCard: {
    backgroundColor: '#fff', borderRadius: 18, padding: 16,
    borderWidth: 1.5, marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  scheduleHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  scheduleLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  perDayBtn: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#ebebf5' },
  perDayBtnText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  perDayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  perDayName: { fontSize: 13, fontWeight: '600', color: '#888', width: 36 },
  daysRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  dayCircle: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  dayCircleOff: { backgroundColor: '#f0f0f3' },
  dayInitial: { fontSize: 12, fontWeight: '800' },
  dayCheck: { fontSize: 7, color: '#fff', fontWeight: '800', marginTop: 1 },

  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  timeRowLabel: { fontSize: 13, fontWeight: '600', color: '#888' },
  timeStepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  timeBtn: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: '#f0f0f3',
    alignItems: 'center', justifyContent: 'center',
  },
  timeBtnText: { fontSize: 20, color: '#555', fontWeight: '300', lineHeight: 24 },
  timeValue: { fontSize: 17, fontWeight: '700', minWidth: 90, textAlign: 'center' },
  endTimeText: { fontSize: 12, color: '#aaa', textAlign: 'center', fontWeight: '500' },

  taskCard: {
    backgroundColor: '#fff', borderRadius: 14,
    marginBottom: 10, borderWidth: 1, borderColor: '#f0f0f3', overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  taskCardActive: {
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 8,
    borderColor: '#e0e0f5',
  },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  num: {
    width: 30, height: 30, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  numText: { fontSize: 13, fontWeight: '800' },
  taskText: { flex: 1, fontSize: 15, color: '#222', fontWeight: '500' },
  goalBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  goalBadgeText: { fontSize: 11, fontWeight: '800' },
  expandBtn: { paddingHorizontal: 4 },
  expandBtnText: { fontSize: 16 },
  remove: { color: '#ccc', fontSize: 16, paddingHorizontal: 4 },

  subSection: { borderTopWidth: 1, borderTopColor: '#f6f7fb', paddingHorizontal: 14, paddingBottom: 12 },
  editNameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f6f7fb' },
  editNameInput: { flex: 1, fontSize: 15, fontWeight: '600', color: '#111', paddingVertical: 6, paddingHorizontal: 2, borderBottomWidth: 1.5, borderBottomColor: '#e0e0f5' },

  goalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f6f7fb',
  },
  goalLabel: { fontSize: 13, fontWeight: '600', color: '#888' },
  goalInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  goalInput: {
    width: 56, backgroundColor: '#f6f7fb', borderRadius: 9,
    paddingHorizontal: 10, paddingVertical: 7, fontSize: 15,
    fontWeight: '700', color: '#111', textAlign: 'center',
    borderWidth: 1, borderColor: '#e5e7eb',
  },
  goalUnit: { fontSize: 13, fontWeight: '600', color: '#aaa' },

  subRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, paddingLeft: 8 },
  subDot: { width: 7, height: 7, borderRadius: 4 },
  subText: { flex: 1, fontSize: 14, color: '#555' },
  subAddRow: { flexDirection: 'row', gap: 8, marginTop: 8, paddingLeft: 8 },
  subInput: {
    flex: 1, backgroundColor: '#f6f7fb', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: '#111',
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
    flex: 1, backgroundColor: '#fff', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, borderWidth: 1, borderColor: '#e6e6ef', color: '#111',
  },
  minsInput: {
    width: 52, backgroundColor: '#fff', borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 12,
    fontSize: 13, fontWeight: '600', borderWidth: 1, borderColor: '#e6e6ef',
    color: '#111', textAlign: 'center',
  },
  secsInput: {
    width: 46, backgroundColor: '#fff', borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 12,
    fontSize: 13, fontWeight: '600', borderWidth: 1, borderColor: '#e6e6ef',
    color: '#111', textAlign: 'center',
  },
  addBtn: {
    borderRadius: 14, width: 48, alignItems: 'center', justifyContent: 'center', height: 48,
  },
  addBtnText: { color: '#fff', fontSize: 26, fontWeight: '300', lineHeight: 32 },

  emojiOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  emojiSheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 10, paddingHorizontal: 20, paddingBottom: 44,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 16,
  },
  emojiHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 18 },
  emojiHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  emojiHeaderTitle: { fontSize: 17, fontWeight: '700', color: '#111' },
  emojiClearBtn: { fontSize: 14, fontWeight: '600' },
  emojiSearch: {
    backgroundColor: '#f6f7fb', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, color: '#111', marginBottom: 12,
  },
  emojiScroll: { maxHeight: 420 },
  emojiCatLabel: {
    fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#9ca3af',
    marginTop: 14, marginBottom: 8,
  },
  emojiNoResults: {
    fontSize: 14, color: '#9ca3af', textAlign: 'center', paddingVertical: 28,
  },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-start' },
  emojiItem: {
    width: 52, height: 52, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#f6f7fb',
  },
  emojiItemText: { fontSize: 28 },
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
  skipText: { color: '#999', fontSize: 15, fontWeight: '600' },
})
