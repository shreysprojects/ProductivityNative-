import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  View, Text, Pressable, StyleSheet, ScrollView,
  Modal, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native'
import * as Notifications from 'expo-notifications'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, router, useLocalSearchParams } from 'expo-router'
import { useAuth } from '../../lib/AuthContext'
import { useTheme } from '../../lib/ThemeContext'
import {
  getHistory, getStreak,
  getCalendarEvents, saveCalendarEvent, deleteCalendarEvent,
  getScheduleItems, saveScheduleItem, deleteScheduleItem,
  getTasks, saveTask, deleteTask,
  getJournalEntries, saveJournalEntry, deleteJournalEntry,
  getWorkoutLog, getMeals,
} from '../../lib/storage'
import { loadHabits } from '../../lib/habitsStorage'

const HABIT_DOT_COLOR = '#f43f5e'

// ── Constants ──────────────────────────────────────────────────────────────

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December']
const DAY_HEADERS = ['S','M','T','W','T','F','S']

const EVENT_TYPES = [
  { id: 'assignment', label: 'Assignment', emoji: '📚', color: '#ef4444' },
  { id: 'meeting',    label: 'Meeting',    emoji: '📅', color: '#3b82f6' },
  { id: 'reminder',   label: 'Reminder',   emoji: '🔔', color: '#8b5cf6' },
  { id: 'other',      label: 'Other',      emoji: '📌', color: '#6b7280' },
]

const SCHEDULE_COLORS = [
  '#ef4444','#f97316','#eab308','#22c55e',
  '#3b82f6','#8b5cf6','#ec4899','#64748b',
]

const MOODS = [
  { key: 'great',   emoji: '😄', label: 'Great'   },
  { key: 'good',    emoji: '😊', label: 'Good'    },
  { key: 'okay',    emoji: '😐', label: 'Okay'    },
  { key: 'down',    emoji: '😔', label: 'Down'    },
  { key: 'bad',     emoji: '😢', label: 'Bad'     },
  { key: 'excited', emoji: '🥳', label: 'Excited' },
]

const PRIORITY = {
  high:   { label: 'High',   color: '#ef4444', emoji: '🔴' },
  medium: { label: 'Medium', color: '#f59e0b', emoji: '🟡' },
  low:    { label: 'Low',    color: '#22c55e', emoji: '🟢' },
  none:   { label: 'None',   color: '#94a3b8', emoji: '⚪' },
}

const WEEK_DAY_BTNS = [
  { label: 'M',  value: 1 },
  { label: 'T',  value: 2 },
  { label: 'W',  value: 3 },
  { label: 'Th', value: 4 },
  { label: 'F',  value: 5 },
  { label: 'Sa', value: 6 },
  { label: 'Su', value: 0 },
]

const HOUR_HEIGHT = 64
const DAY_START   = 7   // 7 AM
const DAY_END     = 21  // 9 PM
const TOTAL_HOURS = DAY_END - DAY_START
const TOTAL_H     = TOTAL_HOURS * HOUR_HEIGHT
const TIME_COL    = 44

// ── Helpers ────────────────────────────────────────────────────────────────

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2) }
function _localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function todayStr() { return _localDate() }
function tomorrowStr() { const d = new Date(); d.setDate(d.getDate() + 1); return _localDate(d) }

function dateStr(y, mo, d) {
  return `${y}-${String(mo + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
}

function addDays(ds, n) {
  const d = new Date(ds + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return _localDate(d)
}

function getWeekStart(ds) {
  const d = new Date(ds + 'T12:00:00')
  const dow = d.getDay()
  const diff = dow === 0 ? -6 : 1 - dow
  d.setDate(d.getDate() + diff)
  return _localDate(d)
}

function timeToY(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return ((h * 60 + m) - DAY_START * 60) * HOUR_HEIGHT / 60
}

function timeDurH(s, e) {
  const [sh, sm] = s.split(':').map(Number)
  const [eh, em] = e.split(':').map(Number)
  return ((eh * 60 + em) - (sh * 60 + sm)) * HOUR_HEIGHT / 60
}

function addMinsToTime(t, mins) {
  const [h, m] = t.split(':').map(Number)
  const tot = h * 60 + m + mins
  return `${String(Math.floor(tot / 60) % 24).padStart(2,'0')}:${String(tot % 60).padStart(2,'0')}`
}

function hourLabel(h) {
  if (h === 0)  return '12 AM'
  if (h === 12) return '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

function formatWeekRange(ws) {
  const s = new Date(ws + 'T12:00:00')
  const e = new Date(ws + 'T12:00:00')
  e.setDate(e.getDate() + 6)
  const o = { month: 'short', day: 'numeric' }
  return `${s.toLocaleDateString('en-US', o)} – ${e.toLocaleDateString('en-US', { ...o, year: 'numeric' })}`
}

function parseDateInput(str) {
  const p = str.trim().split('/')
  if (p.length !== 3) return null
  const [mo, da, yr] = p.map(Number)
  if (!mo || !da || !yr || mo > 12 || da > 31 || yr < 2020 || yr > 2050) return null
  return `${yr}-${String(mo).padStart(2,'0')}-${String(da).padStart(2,'0')}`
}

function fmtDateForInput(iso) {
  const [y, mo, d] = iso.split('-')
  return `${mo}/${d}/${y}`
}

function buildSlots(year, month) {
  const dim = new Date(year, month + 1, 0).getDate()
  const fd  = new Date(year, month, 1).getDay()
  const slots = [...Array(fd).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)]
  while (slots.length % 7 !== 0) slots.push(null)
  const rows = []
  for (let i = 0; i < slots.length; i += 7) rows.push(slots.slice(i, i + 7))
  return rows
}

function formatDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })
}

function formatDateShort(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

function fmtTime(t) {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  const ap = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ap}`
}

function pctColor(p) {
  if (p >= 100) return '#10b981'
  if (p >= 50)  return '#f59e0b'
  return '#ef4444'
}

function parseFormTime(h, m, ap) {
  const hi = parseInt(h, 10), mi = parseInt(m, 10)
  if (isNaN(hi) || isNaN(mi) || hi < 1 || hi > 12 || mi < 0 || mi > 59) return null
  let h24 = hi
  if (ap === 'PM' && hi < 12) h24 += 12
  if (ap === 'AM' && hi === 12) h24 = 0
  return `${String(h24).padStart(2,'0')}:${String(mi).padStart(2,'0')}`
}

// ── Time input sub-component ───────────────────────────────────────────────

function TimeInput({ h, m, ap, onH, onM, onAp, theme }) {
  return (
    <View style={ti.row}>
      <TextInput
        style={[ti.box, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
        placeholder="12" placeholderTextColor={theme.muted}
        value={h} onChangeText={onH} keyboardType="number-pad" maxLength={2}
      />
      <Text style={[ti.colon, { color: theme.text }]}>:</Text>
      <TextInput
        style={[ti.box, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
        placeholder="00" placeholderTextColor={theme.muted}
        value={m} onChangeText={onM} keyboardType="number-pad" maxLength={2}
        onBlur={() => onM(String(parseInt(m || '0', 10)).padStart(2, '0'))}
      />
      <View style={ti.apRow}>
        {['AM', 'PM'].map(v => (
          <Pressable
            key={v}
            style={[ti.apBtn, { backgroundColor: ap === v ? theme.accent : (theme.isDark ? '#1c1c32' : '#e8e8f5') }]}
            onPress={() => onAp(v)}
          >
            <Text style={[ti.apText, { color: ap === v ? '#fff' : theme.muted }]}>{v}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const ti = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  box:   { width: 54, borderRadius: 12, borderWidth: 1, paddingVertical: 10, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  colon: { fontSize: 22, fontWeight: '700' },
  apRow: { flexDirection: 'row', gap: 5, marginLeft: 2 },
  apBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  apText:{ fontSize: 12, fontWeight: '700' },
})

// ── Main component ─────────────────────────────────────────────────────────

export default function CalendarScreen() {
  const { user } = useAuth()
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const today = todayStr()
  const now = new Date()
  const { openJournal: openJournalParam } = useLocalSearchParams()

  // View
  const [viewMode, setViewMode] = useState('month')
  const [weekStart, setWeekStart] = useState(() => getWeekStart(today))

  // Month view
  const [viewDate, setViewDate] = useState({ year: now.getFullYear(), month: now.getMonth() })
  const [completionMap, setCompletionMap] = useState({})
  const [streak, setStreak] = useState({ current: 0, longest: 0 })
  const [selected, setSelected] = useState(null)
  const [historyByDate, setHistoryByDate] = useState({})
  const [events, setEvents] = useState([])
  const [scheduleItems, setScheduleItems] = useState([])

  // Add event modal
  const [addOpen, setAddOpen]     = useState(false)
  const [newTitle, setNewTitle]   = useState('')
  const [newType, setNewType]     = useState('reminder')
  const [newH, setNewH]           = useState('12')
  const [newM, setNewM]           = useState('00')
  const [newAp, setNewAp]         = useState('PM')
  const [allDay, setAllDay]       = useState(false)
  const [saving, setSaving]       = useState(false)
  const [hasPerm, setHasPerm]     = useState(false)

  // Add class modal
  const [classOpen, setClassOpen] = useState(false)
  const [cTitle, setCTitle]       = useState('')
  const [cLoc, setCLoc]           = useState('')
  const [cDays, setCDays]         = useState([])
  const [cSH, setCSH]             = useState('8')
  const [cSM, setCSM]             = useState('00')
  const [cSAp, setCSAp]           = useState('AM')
  const [cEH, setCEH]             = useState('9')
  const [cEM, setCEM]             = useState('00')
  const [cEAp, setCEAp]           = useState('AM')
  const [cColor, setCColor]       = useState('#3b82f6')
  const [cFrom, setCFrom]         = useState('')
  const [cTo, setCTo]             = useState('')
  const [cSaving, setCeSaving]    = useState(false)

  // Tasks
  const [tasks, setTasks]               = useState([])
  const [taskFilter, setTaskFilter]     = useState('active')
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [editingTask, setEditingTask]   = useState(null)
  const [tTitle, setTTitle]             = useState('')
  const [tDesc, setTDesc]               = useState('')
  const [tDueDateRaw, setTDueDateRaw]   = useState('')
  const [tPriority, setTPriority]       = useState('none')
  const [tSaving, setTSaving]           = useState(false)

  // Journal
  const [journalEntries, setJournalEntries] = useState({})
  const [journalOpen, setJournalOpen]       = useState(false)
  const [jDate, setJDate]                   = useState(null)
  const [jMood, setJMood]                   = useState(null)
  const [jText, setJText]                   = useState('')
  const [jSaving, setJSaving]               = useState(false)

  // Habits
  const [habitEventsByDate, setHabitEventsByDate] = useState({})

  // Load state
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Per-date detail extras
  const [selectedWorkout, setSelectedWorkout] = useState(null)
  const [selectedMeals, setSelectedMeals]     = useState([])

  const weekScrollRef = useRef(null)

  const nowY = useMemo(() => {
    const n = new Date()
    return ((n.getHours() * 60 + n.getMinutes()) - DAY_START * 60) * HOUR_HEIGHT / 60
  }, [])

  useEffect(() => {
    Notifications.getPermissionsAsync()
      .then(({ status }) => setHasPerm(status === 'granted'))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (viewMode === 'week') {
      setTimeout(() => {
        weekScrollRef.current?.scrollTo({ y: Math.max(0, nowY - 80), animated: false })
      }, 100)
    }
  }, [viewMode])

  useEffect(() => {
    if (!selected || !user) { setSelectedWorkout(null); setSelectedMeals([]); return }
    Promise.all([
      getWorkoutLog(user.id, selected),
      getMeals(user.id, selected),
    ]).then(([w, m]) => { setSelectedWorkout(w); setSelectedMeals(m ?? []) })
  }, [selected, user])

  const load = useCallback(async () => {
    if (!user) return
    try {
      const [hist, str, evts, sched, taskList, jEntries, habitsData] = await Promise.all([
        getHistory(user.id), getStreak(user.id),
        getCalendarEvents(user.id), getScheduleItems(user.id),
        getTasks(user.id), getJournalEntries(user.id),
        loadHabits(user.id),
      ])
      const map = {}, byDate = {}
      hist.forEach(h => {
        if (!map[h.date] || map[h.date] < h.completion) map[h.date] = h.completion
        if (!byDate[h.date]) byDate[h.date] = []
        byDate[h.date].push(h)
      })
      setCompletionMap(map)
      setHistoryByDate(byDate)
      setStreak(str)
      setEvents(evts)
      setScheduleItems(sched)
      setTasks(taskList)
      setJournalEntries(jEntries)
      const hmap = {}
      for (const habit of habitsData.breaking) {
        for (const entry of habit.history) {
          const d = entry.date.slice(0, 10)
          if (!hmap[d]) hmap[d] = []
          hmap[d].push({ type: entry.type, habitName: habit.name })
        }
      }
      setHabitEventsByDate(hmap)
      setError(false)

      if (openJournalParam) {
        const td = todayStr()
        const existing = jEntries[td]
        setSelected(td)
        const d = new Date(td + 'T12:00:00')
        setViewDate({ year: d.getFullYear(), month: d.getMonth() })
        setJDate(td)
        setJMood(existing?.mood ?? null)
        setJText(existing?.text ?? '')
        setJournalOpen(true)
        router.setParams({ openJournal: undefined })
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [user, openJournalParam])

  useFocusEffect(useCallback(() => { load() }, [load]))

  // ── Computed ──────────────────────────────────────────────────────────────

  const eventsByDate = useMemo(() => {
    const m = {}
    for (const ev of events) {
      if (!m[ev.date]) m[ev.date] = []
      m[ev.date].push(ev)
    }
    return m
  }, [events])

  const tasksByDate = useMemo(() => {
    const m = {}
    for (const t of tasks) {
      if (!t.dueDate) continue
      if (!m[t.dueDate]) m[t.dueDate] = []
      m[t.dueDate].push(t)
    }
    return m
  }, [tasks])

  const weekDays = useMemo(() => (
    Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  ), [weekStart])

  const weekEventsByDay = useMemo(() => {
    const result = {}
    for (const day of weekDays) {
      const dow = new Date(day + 'T12:00:00').getDay()
      const dayEvs = []

      for (const ev of events) {
        if (ev.date === day && ev.time) {
          const ti = EVENT_TYPES.find(t => t.id === ev.type) ?? EVENT_TYPES[3]
          dayEvs.push({
            id: ev.id, title: ev.title, kind: 'event',
            startTime: ev.time, endTime: addMinsToTime(ev.time, 60),
            color: ti.color, location: null, notifId: ev.notifId ?? null,
          })
        }
      }

      for (const item of scheduleItems) {
        if (!item.days.includes(dow)) continue
        if (item.semesterStart && day < item.semesterStart) continue
        if (item.semesterEnd   && day > item.semesterEnd)   continue
        dayEvs.push({
          id: item.id + '|' + day, title: item.title, kind: 'class',
          startTime: item.startTime, endTime: item.endTime,
          color: item.color, location: item.location ?? null,
          _scheduleId: item.id,
        })
      }

      result[day] = dayEvs.sort((a, b) => a.startTime.localeCompare(b.startTime))
    }
    return result
  }, [weekDays, events, scheduleItems])

  const upcomingEvents = useMemo(() => {
    const tomorrow = tomorrowStr()
    return events
      .filter(e => e.date >= today)
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date)
        if (!a.time && !b.time) return 0
        if (!a.time) return 1
        if (!b.time) return -1
        return a.time.localeCompare(b.time)
      })
      .slice(0, 10)
      .map(ev => ({
        ...ev,
        _dateLabel: ev.date === today ? 'Today'
          : ev.date === tomorrow ? 'Tomorrow'
          : formatDateShort(ev.date),
      }))
  }, [events, today])

  const filteredTasks = useMemo(() => {
    const po = { high: 0, medium: 1, low: 2, none: 3 }
    const sorted = [...tasks].sort((a, b) => {
      const pd = (po[a.priority] ?? 3) - (po[b.priority] ?? 3)
      if (pd !== 0) return pd
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate)
      if (a.dueDate) return -1
      if (b.dueDate) return 1
      return b.createdAt - a.createdAt
    })
    switch (taskFilter) {
      case 'today':    return sorted.filter(t => !t.done && t.dueDate === today)
      case 'upcoming': return sorted.filter(t => !t.done && t.dueDate && t.dueDate > today)
      case 'done':     return sorted.filter(t => t.done)
      default:         return sorted.filter(t => !t.done)
    }
  }, [tasks, taskFilter, today])

  // ── Handlers ──────────────────────────────────────────────────────────────

  function switchView(mode) {
    setViewMode(mode)
    if (mode === 'week' && selected) setWeekStart(getWeekStart(selected))
  }

  function openAdd() {
    setNewTitle(''); setNewType('reminder')
    setNewH('12'); setNewM('00'); setNewAp('PM')
    setAllDay(false); setAddOpen(true)
  }

  function openAddClass() {
    setCTitle(''); setCLoc(''); setCDays([])
    setCSH('8'); setCSM('00'); setCSAp('AM')
    setCEH('9'); setCEM('00'); setCEAp('AM')
    setCColor('#3b82f6'); setCFrom(''); setCTo('')
    setClassOpen(true)
  }

  async function handleSaveEvent() {
    if (!newTitle.trim()) { Alert.alert('Missing title'); return }
    const dateForEvent = selected || today
    let time = null, notifId = null
    if (!allDay) {
      time = parseFormTime(newH, newM, newAp)
      if (!time) { Alert.alert('Invalid time', 'Hour: 1–12, Minute: 0–59'); return }
      let permitted = hasPerm
      if (!permitted) {
        try {
          const { status } = await Notifications.requestPermissionsAsync()
          permitted = status === 'granted'
          if (permitted) setHasPerm(true)
        } catch {}
      }
      if (permitted) {
        try {
          const notifyAt = new Date(new Date(`${dateForEvent}T${time}:00`).getTime() - 10 * 60 * 1000)
          if (notifyAt > new Date()) {
            const ti = EVENT_TYPES.find(t => t.id === newType) ?? EVENT_TYPES[2]
            notifId = await Notifications.scheduleNotificationAsync({
              content: { title: `${ti.emoji} ${newTitle.trim()}`, body: 'Starting in 10 minutes', sound: true },
              trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: notifyAt },
            })
          }
        } catch {}
      }
    }
    setSaving(true)
    const ev = { id: genId(), title: newTitle.trim(), date: dateForEvent, time, type: newType, notifyMins: 10, notifId }
    await saveCalendarEvent(user.id, ev)
    setEvents(prev => [...prev, ev])
    setAddOpen(false); setSaving(false)
    setSelected(dateForEvent)
    const d = new Date(dateForEvent + 'T12:00:00')
    setViewDate({ year: d.getFullYear(), month: d.getMonth() })
  }

  function handleDeleteEvent(ev) {
    Alert.alert('Delete Event', `Remove "${ev.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          if (ev.notifId) { try { await Notifications.cancelScheduledNotificationAsync(ev.notifId) } catch {} }
          await deleteCalendarEvent(user.id, ev.id)
          setEvents(prev => prev.filter(e => e.id !== ev.id))
        },
      },
    ])
  }

  async function handleSaveClass() {
    if (!cTitle.trim()) { Alert.alert('Missing title', 'Enter a course name.'); return }
    if (cDays.length === 0) { Alert.alert('No days selected', 'Pick at least one day.'); return }
    const startTime = parseFormTime(cSH, cSM, cSAp)
    if (!startTime) { Alert.alert('Invalid start time'); return }
    const endTime = parseFormTime(cEH, cEM, cEAp)
    if (!endTime) { Alert.alert('Invalid end time'); return }
    if (endTime <= startTime) { Alert.alert('Invalid times', 'End must be after start.'); return }
    let semesterStart = null, semesterEnd = null
    if (cFrom.trim()) {
      semesterStart = parseDateInput(cFrom)
      if (!semesterStart) { Alert.alert('Invalid date', 'Semester start: use MM/DD/YYYY'); return }
    }
    if (cTo.trim()) {
      semesterEnd = parseDateInput(cTo)
      if (!semesterEnd) { Alert.alert('Invalid date', 'Semester end: use MM/DD/YYYY'); return }
    }
    setCeSaving(true)
    const item = {
      id: genId(), title: cTitle.trim(),
      location: cLoc.trim() || null,
      days: cDays, startTime, endTime, color: cColor,
      semesterStart, semesterEnd,
    }
    await saveScheduleItem(user.id, item)
    setScheduleItems(prev => [...prev, item])
    setClassOpen(false); setCeSaving(false)
  }

  function handleWeekEventPress(ev) {
    const timeRange = `${fmtTime(ev.startTime)} – ${fmtTime(ev.endTime)}`
    const body = [timeRange, ev.location].filter(Boolean).join('\n')
    Alert.alert(ev.title, body, [
      { text: 'Close', style: 'cancel' },
      {
        text: ev.kind === 'class' ? 'Delete Class' : 'Delete Event',
        style: 'destructive',
        onPress: async () => {
          if (ev.kind === 'class') {
            await deleteScheduleItem(user.id, ev._scheduleId)
            setScheduleItems(prev => prev.filter(i => i.id !== ev._scheduleId))
          } else {
            if (ev.notifId) { try { await Notifications.cancelScheduledNotificationAsync(ev.notifId) } catch {} }
            await deleteCalendarEvent(user.id, ev.id)
            setEvents(prev => prev.filter(e => e.id !== ev.id))
          }
        },
      },
    ])
  }

  function openAddTask() {
    setEditingTask(null)
    setTTitle(''); setTDesc(''); setTDueDateRaw(''); setTPriority('none')
    setTaskModalOpen(true)
  }

  function openEditTask(task) {
    setEditingTask(task)
    setTTitle(task.title)
    setTDesc(task.description ?? '')
    setTDueDateRaw(task.dueDate ? fmtDateForInput(task.dueDate) : '')
    setTPriority(task.priority ?? 'none')
    setTaskModalOpen(true)
  }

  async function handleSaveTask() {
    if (!tTitle.trim()) { Alert.alert('Missing title'); return }
    let dueDate = null
    if (tDueDateRaw.trim()) {
      dueDate = parseDateInput(tDueDateRaw)
      if (!dueDate) { Alert.alert('Invalid date', 'Use MM/DD/YYYY format'); return }
    }
    setTSaving(true)
    const task = {
      id: editingTask?.id ?? genId(),
      title: tTitle.trim(),
      description: tDesc.trim() || null,
      dueDate,
      priority: tPriority,
      done: editingTask?.done ?? false,
      createdAt: editingTask?.createdAt ?? Date.now(),
    }
    await saveTask(user.id, task)
    setTasks(prev => editingTask ? prev.map(t => t.id === task.id ? task : t) : [...prev, task])
    setTaskModalOpen(false)
    setTSaving(false)
  }

  async function handleToggleTask(task) {
    const updated = { ...task, done: !task.done }
    await saveTask(user.id, updated)
    setTasks(prev => prev.map(t => t.id === task.id ? updated : t))
  }

  function handleDeleteTask(task, closeModal = false) {
    Alert.alert('Delete Task', `Remove "${task.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await deleteTask(user.id, task.id)
        setTasks(prev => prev.filter(t => t.id !== task.id))
        if (closeModal) setTaskModalOpen(false)
      }},
    ])
  }

  function openJournal(date) {
    if (date > today || date < addDays(today, -2)) return
    const existing = journalEntries[date]
    setJDate(date)
    setJMood(existing?.mood ?? null)
    setJText(existing?.text ?? '')
    setJournalOpen(true)
  }

  async function handleDeleteJournal(date) {
    await deleteJournalEntry(user.id, date)
    setJournalEntries(prev => { const n = { ...prev }; delete n[date]; return n })
  }

  async function handleSaveJournal() {
    if (!jText.trim() && !jMood) return
    setJSaving(true)
    const entry = { mood: jMood, text: jText.trim(), updatedAt: Date.now() }
    await saveJournalEntry(user.id, jDate, entry)
    setJournalEntries(prev => ({ ...prev, [jDate]: entry }))
    setJournalOpen(false)
    setJSaving(false)
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  const { year, month } = viewDate
  const rows = buildSlots(year, month)
  const selectedEntries = selected ? (historyByDate[selected] || []) : []
  const selectedEvents  = selected
    ? (eventsByDate[selected] || []).slice().sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
    : []
  const _po = { high: 0, medium: 1, low: 2, none: 3 }
  const selectedTasks = selected
    ? (tasksByDate[selected] || []).slice().sort((a, b) => (_po[a.priority] ?? 3) - (_po[b.priority] ?? 3))
    : []

  // ── JSX ───────────────────────────────────────────────────────────────────

  if (loading) return <View style={[s.page, { backgroundColor: theme.bg }]} />

  if (error) return (
    <View style={[s.page, s.errorPage, { backgroundColor: theme.bg }]}>
      <Text style={[s.errorTitle, { color: theme.text }]}>We couldn't load your calendar</Text>
      <Text style={[s.errorSub, { color: theme.subtext }]}>Check your connection and try again.</Text>
      <Pressable
        style={[s.errorBtn, { backgroundColor: theme.accent }]}
        onPress={() => { setLoading(true); load() }}
      >
        <Text style={s.errorBtnText}>Retry</Text>
      </Pressable>
    </View>
  )

  return (
    <View style={[s.page, { backgroundColor: theme.bg }]}>

      {/* View toggle bar */}
      <View style={[s.toggleBar, { backgroundColor: theme.card, borderBottomColor: theme.divider }]}>
        <View style={[s.togglePill, { backgroundColor: theme.isDark ? '#1c1c32' : '#f0f0f8' }]}>
          {['month', 'week', 'tasks'].map(mode => (
            <Pressable
              key={mode}
              style={[s.toggleOpt, viewMode === mode && { backgroundColor: theme.accent }]}
              onPress={() => switchView(mode)}
            >
              <Text style={[s.toggleOptText, { color: viewMode === mode ? '#fff' : theme.subtext }]}>
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={s.toggleActions}>
          {viewMode === 'week' && (
            <>
              <Pressable
                style={[s.toggleActionBtn, { backgroundColor: theme.accent + '20' }]}
                onPress={() => { setSelected(today); openAdd() }}
              >
                <Text style={[s.toggleActionText, { color: theme.accent }]}>＋ Event</Text>
              </Pressable>
              <Pressable
                style={[s.toggleActionBtn, { backgroundColor: theme.accent }]}
                onPress={openAddClass}
              >
                <Text style={[s.toggleActionText, { color: '#fff' }]}>＋ Class</Text>
              </Pressable>
            </>
          )}
          {viewMode === 'tasks' && (
            <Pressable
              style={[s.toggleActionBtn, { backgroundColor: theme.accent }]}
              onPress={openAddTask}
            >
              <Text style={[s.toggleActionText, { color: '#fff' }]}>＋ Task</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* ── Month view ─────────────────────────────────────────────────────── */}
      {viewMode === 'month' && (
        <ScrollView contentContainerStyle={s.content}>

          {/* Stats */}
          <View style={[s.statRow, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <View style={s.stat}>
              <Text style={[s.statNum, { color: theme.accent }]}>{streak.current}</Text>
              <Text style={[s.statLabel, { color: theme.subtext }]}>Day streak 🔥</Text>
            </View>
            <View style={[s.statDivider, { backgroundColor: theme.divider }]} />
            <View style={s.stat}>
              <Text style={[s.statNum, { color: theme.accent }]}>{streak.longest}</Text>
              <Text style={[s.statLabel, { color: theme.subtext }]}>Best streak</Text>
            </View>
            <View style={[s.statDivider, { backgroundColor: theme.divider }]} />
            <View style={s.stat}>
              <Text style={[s.statNum, { color: theme.accent }]}>{Object.keys(completionMap).length}</Text>
              <Text style={[s.statLabel, { color: theme.subtext }]}>Days logged</Text>
            </View>
          </View>

          {/* Calendar grid */}
          <View style={[s.calCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <View style={s.monthNav}>
              <Pressable onPress={() => { setViewDate(({ year: y, month: mo }) => mo === 0 ? { year: y-1, month: 11 } : { year: y, month: mo-1 }); setSelected(null) }} hitSlop={12} style={s.navBtn}>
                <Text style={[s.navBtnText, { color: theme.accent }]}>‹</Text>
              </Pressable>
              <Text style={[s.monthLabel, { color: theme.text }]}>{MONTHS[month]} {year}</Text>
              <Pressable onPress={() => { setViewDate(({ year: y, month: mo }) => mo === 11 ? { year: y+1, month: 0 } : { year: y, month: mo+1 }); setSelected(null) }} hitSlop={12} style={s.navBtn}>
                <Text style={[s.navBtnText, { color: theme.accent }]}>›</Text>
              </Pressable>
            </View>

            <View style={s.dayHeaderRow}>
              {DAY_HEADERS.map((d, i) => (
                <View key={i} style={s.dayHeaderCell}>
                  <Text style={[s.dayHeaderText, { color: theme.muted }]}>{d}</Text>
                </View>
              ))}
            </View>

            {rows.map((row, ri) => (
              <View key={ri} style={s.weekRow}>
                {row.map((day, di) => {
                  if (!day) return <View key={di} style={s.emptyCell} />
                  const ds = dateStr(year, month, day)
                  const pct = completionMap[ds]
                  const isToday = ds === today
                  const isFuture = ds > today
                  const isSelected = ds === selected
                  const completed = pct >= 100, partial = pct > 0 && pct < 100
                  const dayEvTypes = [...new Set((eventsByDate[ds] || []).map(e => e.type))]

                  return (
                    <Pressable key={di} style={s.dayCell} onPress={() => setSelected(isSelected ? null : ds)}>
                      <View style={[
                        s.dayCircle,
                        completed && s.circleComplete,
                        partial && s.circlePartial,
                        isToday && !pct && { borderWidth: 2, borderColor: theme.accent },
                        isSelected && !pct && { backgroundColor: theme.accent + '22' },
                      ]}>
                        <Text style={[
                          s.dayNum, { color: theme.text },
                          (completed || partial) && { color: '#fff', fontWeight: '700' },
                          isToday && !pct && { color: theme.accent, fontWeight: '700' },
                          isFuture && !isToday && { color: theme.muted },
                        ]}>{day}</Text>
                      </View>
                      <View style={s.eventDotsRow}>
                        {dayEvTypes.slice(0, 3).map(type => {
                          const t = EVENT_TYPES.find(et => et.id === type) ?? EVENT_TYPES[3]
                          return <View key={type} style={[s.eventDot, { backgroundColor: t.color }]} />
                        })}
                        {(tasksByDate[ds] || []).some(t => !t.done) && (
                          <View style={[s.eventDot, { borderRadius: 2, backgroundColor: '#8b5cf6' }]} />
                        )}
                        {journalEntries[ds] && (
                          <View style={[s.eventDot, { backgroundColor: '#0ea5e9' }]} />
                        )}
                        {habitEventsByDate[ds] && (
                          <View style={[s.eventDot, { backgroundColor: HABIT_DOT_COLOR }]} />
                        )}
                      </View>
                    </Pressable>
                  )
                })}
              </View>
            ))}

            <View style={[s.legendDivider, { backgroundColor: theme.divider }]} />
            <View style={s.legend}>
              {[['#10b981','Complete'],['#f59e0b','Partial'],[theme.accent,'Event'],['#8b5cf6','Task'],['#0ea5e9','Journal'],[HABIT_DOT_COLOR,'Habit']].map(([c, l]) => (
                <View key={l} style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: c }, l === 'Task' && { borderRadius: 2 }]} />
                  <Text style={[s.legendText, { color: theme.muted }]}>{l}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Day detail */}
          {selected && (
            <View style={[s.detailCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <View style={s.detailHeader}>
                <Text style={[s.detailDate, { color: theme.text }]}>{formatDate(selected)}</Text>
                <Pressable style={[s.addBtn, { backgroundColor: theme.accent }]} onPress={openAdd}>
                  <Text style={s.addBtnText}>＋ Event</Text>
                </Pressable>
              </View>
              {selectedEvents.map(ev => {
                const ti = EVENT_TYPES.find(t => t.id === ev.type) ?? EVENT_TYPES[3]
                return (
                  <View key={ev.id} style={[s.eventRow, { borderBottomColor: theme.divider }]}>
                    <View style={[s.eventIcon, { backgroundColor: ti.color + '20' }]}>
                      <Text style={s.eventEmoji}>{ti.emoji}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.eventTitle, { color: theme.text }]}>{ev.title}</Text>
                      <Text style={[s.eventMeta, { color: theme.subtext }]}>
                        {fmtTime(ev.time) ?? 'All day'} · {ti.label}{ev.notifId ? '  🔔' : ''}
                      </Text>
                    </View>
                    <Pressable onPress={() => handleDeleteEvent(ev)} hitSlop={12} style={s.deleteBtn}>
                      <Text style={s.deleteBtnText}>✕</Text>
                    </Pressable>
                  </View>
                )
              })}
              {selectedTasks.length > 0 && (
                <>
                  <Text style={[s.sectionLabel, { color: theme.muted }]}>TASKS</Text>
                  {selectedTasks.map(task => {
                    const pri = PRIORITY[task.priority] ?? PRIORITY.none
                    return (
                      <Pressable
                        key={task.id}
                        style={[s.taskDetailRow, { borderBottomColor: theme.divider, opacity: task.done ? 0.6 : 1 }]}
                        onPress={() => openEditTask(task)}
                      >
                        <Pressable
                          style={[s.taskDetailCheck, { borderColor: task.done ? pri.color : theme.cardBorder, backgroundColor: task.done ? pri.color : 'transparent' }]}
                          onPress={() => handleToggleTask(task)}
                          hitSlop={10}
                        >
                          {task.done && <Text style={s.taskCheckmark}>✓</Text>}
                        </Pressable>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.eventTitle, { color: theme.text }, task.done && s.taskTitleDone]}>
                            {task.title}
                          </Text>
                          {task.description ? (
                            <Text style={[s.eventMeta, { color: theme.subtext }]} numberOfLines={1}>
                              {task.description}
                            </Text>
                          ) : null}
                        </View>
                        <View style={[s.taskPriorityDot, { backgroundColor: pri.color }]} />
                      </Pressable>
                    )
                  })}
                </>
              )}
              {/* ── Journal section ── */}
              {(() => {
                const canWrite = selected <= today && selected >= addDays(today, -2)
                const entry = journalEntries[selected]
                if (!canWrite && !entry) return null
                return (
                  <View style={s.journalSection}>
                    <View style={s.journalSectionHeader}>
                      <Text style={[s.sectionLabel, { color: theme.muted }]}>JOURNAL</Text>
                      {canWrite ? (
                        <Pressable onPress={() => openJournal(selected)} hitSlop={10}>
                          <Text style={{ fontSize: 12, fontWeight: '700', color: theme.accent }}>
                            {entry ? 'Edit' : '+ Write'}
                          </Text>
                        </Pressable>
                      ) : entry ? (
                        <Pressable
                          hitSlop={10}
                          onPress={() => Alert.alert(
                            'Delete Entry?',
                            'This journal entry will be permanently deleted.',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Delete', style: 'destructive', onPress: () => handleDeleteJournal(selected) },
                            ]
                          )}
                        >
                          <Text style={{ fontSize: 12, fontWeight: '700', color: '#ef4444' }}>Delete</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    {entry ? (
                      <Pressable
                        style={[s.journalPreview, { backgroundColor: theme.isDark ? '#1c1c32' : '#f4f8ff', borderColor: theme.cardBorder }]}
                        onPress={canWrite ? () => openJournal(selected) : undefined}
                        disabled={!canWrite}
                      >
                        {entry.mood && (
                          <Text style={{ fontSize: 20, marginBottom: 4 }}>
                            {MOODS.find(m => m.key === entry.mood)?.emoji}
                          </Text>
                        )}
                        {entry.text ? (
                          <Text style={[s.journalPreviewText, { color: theme.subtext }]} numberOfLines={3}>
                            {entry.text}
                          </Text>
                        ) : (
                          <Text style={[s.journalPreviewText, { color: theme.muted, fontStyle: 'italic' }]}>
                            (mood only)
                          </Text>
                        )}
                      </Pressable>
                    ) : (
                      <Pressable
                        style={[s.journalEmptyBtn, { borderColor: theme.cardBorder }]}
                        onPress={() => openJournal(selected)}
                      >
                        <Text style={[s.journalEmptyText, { color: theme.muted }]}>
                          Tap to write your entry for this day...
                        </Text>
                      </Pressable>
                    )}
                  </View>
                )
              })()}

              {selectedEntries.length > 0 && (
                <>
                  <Text style={[s.sectionLabel, { color: theme.muted }]}>ROUTINES</Text>
                  {selectedEntries.map(e => (
                    <View key={e.routine} style={[s.routineRow, { borderBottomColor: theme.divider }]}>
                      <View style={[s.routineDot, { backgroundColor: pctColor(e.completion) }]} />
                      <Text style={[s.routineName, { color: theme.text }]}>{e.routine}</Text>
                      <Text style={[s.routinePct, { color: pctColor(e.completion) }]}>{e.completion}%</Text>
                    </View>
                  ))}
                </>
              )}

              {selectedWorkout && (
                <>
                  <Text style={[s.sectionLabel, { color: theme.muted }]}>WORKOUT</Text>
                  <View style={[s.routineRow, { borderBottomColor: theme.divider }]}>
                    <View style={[s.routineDot, { backgroundColor: '#f97316' }]} />
                    <Text style={[s.routineName, { color: theme.text }]}>
                      {selectedWorkout.muscleGroup ?? 'Workout'}
                    </Text>
                    {selectedWorkout.startedAt && selectedWorkout.completedAt ? (
                      <Text style={[s.routinePct, { color: theme.muted, fontWeight: '500' }]}>
                        {(() => {
                          const ms = selectedWorkout.completedAt - selectedWorkout.startedAt
                          const m = Math.floor(ms / 60000)
                          const s = Math.floor((ms % 60000) / 1000)
                          return m > 0 ? `${m}m ${s}s` : `${s}s`
                        })()}
                      </Text>
                    ) : null}
                  </View>
                  {(selectedWorkout.exercises ?? []).filter(ex => !ex.skipped).map((ex, i) => (
                    <View key={i} style={[s.routineRow, { borderBottomColor: theme.divider }]}>
                      <View style={{ width: 8 }} />
                      <Text style={[s.routineName, { color: theme.subtext, fontSize: 13 }]}>{ex.name}</Text>
                      <Text style={[s.routinePct, { color: theme.muted, fontWeight: '500', fontSize: 12 }]}>
                        {(ex.sets ?? []).length} set{(ex.sets ?? []).length !== 1 ? 's' : ''}
                      </Text>
                    </View>
                  ))}
                </>
              )}

              {selectedMeals.length > 0 && (() => {
                const totalCal = selectedMeals.reduce((sum, m) => sum + (Number(m.calories) || 0), 0)
                return (
                  <>
                    <Text style={[s.sectionLabel, { color: theme.muted }]}>
                      NUTRITION{totalCal > 0 ? `  ·  ${totalCal} KCAL` : ''}
                    </Text>
                    {selectedMeals.map((meal, i) => (
                      <View key={i} style={[s.routineRow, { borderBottomColor: theme.divider }]}>
                        <View style={[s.routineDot, { backgroundColor: '#22c55e' }]} />
                        <Text style={[s.routineName, { color: theme.text }]}>{meal.name}</Text>
                        {meal.calories != null && (
                          <Text style={[s.routinePct, { color: theme.muted, fontWeight: '500' }]}>
                            {meal.calories} kcal
                          </Text>
                        )}
                      </View>
                    ))}
                  </>
                )
              })()}

              {(habitEventsByDate[selected] ?? []).length > 0 && (
                <>
                  <Text style={[s.sectionLabel, { color: theme.muted }]}>HABIT EVENTS</Text>
                  {(habitEventsByDate[selected] ?? []).map((ev, i) => (
                    <View key={i} style={[s.routineRow, { borderBottomColor: theme.divider }]}>
                      <View style={[s.routineDot, { backgroundColor: ev.type === 'relapse' ? HABIT_DOT_COLOR : '#10b981' }]} />
                      <Text style={[s.routineName, { color: theme.text }]}>{ev.habitName}</Text>
                      <Text style={[s.routinePct, {
                        color: ev.type === 'relapse' ? HABIT_DOT_COLOR : '#10b981',
                        fontWeight: '600', fontSize: 12,
                      }]}>
                        {ev.type === 'relapse' ? '↩ Relapse' : '✓ Started'}
                      </Text>
                    </View>
                  ))}
                </>
              )}
            </View>
          )}

          {/* Upcoming events */}
          {!selected && (
            <View style={[s.upcomingCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <View style={s.upcomingHeader}>
                <Text style={[s.upcomingTitle, { color: theme.text }]}>Upcoming Events</Text>
                <Pressable style={[s.addBtn, { backgroundColor: theme.accent }]} onPress={() => { setSelected(today); openAdd() }}>
                  <Text style={s.addBtnText}>＋ Add</Text>
                </Pressable>
              </View>
              {upcomingEvents.length === 0 ? (
                <Text style={[s.emptyText, { color: theme.muted }]}>No upcoming events. Tap ＋ Add to schedule one.</Text>
              ) : (
                upcomingEvents.map(ev => {
                  const ti = EVENT_TYPES.find(t => t.id === ev.type) ?? EVENT_TYPES[3]
                  return (
                    <Pressable key={ev.id} style={[s.eventRow, { borderBottomColor: theme.divider }]}
                      onPress={() => { setSelected(ev.date); const d = new Date(ev.date + 'T12:00:00'); setViewDate({ year: d.getFullYear(), month: d.getMonth() }) }}>
                      <View style={[s.eventIcon, { backgroundColor: ti.color + '20' }]}>
                        <Text style={s.eventEmoji}>{ti.emoji}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.eventTitle, { color: theme.text }]}>{ev.title}</Text>
                        <Text style={[s.eventMeta, { color: theme.subtext }]}>
                          {ev._dateLabel}{ev.time ? `  ·  ${fmtTime(ev.time)}` : ''}
                        </Text>
                      </View>
                      <View style={[s.typePill, { backgroundColor: ti.color + '18' }]}>
                        <Text style={[s.typePillText, { color: ti.color }]}>{ti.label}</Text>
                      </View>
                    </Pressable>
                  )
                })
              )}
            </View>
          )}
        </ScrollView>
      )}

      {/* ── Week view ──────────────────────────────────────────────────────── */}
      {viewMode === 'week' && (
        <View style={{ flex: 1 }}>

          {/* Week navigation + day headers */}
          <View style={[s.weekHeader, { backgroundColor: theme.card, borderBottomColor: theme.divider }]}>
            <View style={s.weekNav}>
              <Pressable onPress={() => setWeekStart(ws => addDays(ws, -7))} style={s.weekNavBtn}>
                <Text style={[s.weekNavArrow, { color: theme.accent }]}>‹</Text>
              </Pressable>
              <Text style={[s.weekNavTitle, { color: theme.text }]}>{formatWeekRange(weekStart)}</Text>
              <Pressable
                onPress={() => setWeekStart(getWeekStart(today))}
                style={[s.weekTodayBtn, { backgroundColor: theme.accent + '20' }]}
              >
                <Text style={[s.weekTodayText, { color: theme.accent }]}>Today</Text>
              </Pressable>
              <Pressable onPress={() => setWeekStart(ws => addDays(ws, 7))} style={s.weekNavBtn}>
                <Text style={[s.weekNavArrow, { color: theme.accent }]}>›</Text>
              </Pressable>
            </View>

            <View style={s.weekDayHeaders}>
              <View style={{ width: TIME_COL }} />
              {weekDays.map(d => {
                const isT = d === today
                const dObj = new Date(d + 'T12:00:00')
                return (
                  <View key={d} style={s.weekDayHeader}>
                    <Text style={[s.weekDayName, { color: isT ? theme.accent : theme.subtext }]}>
                      {dObj.toLocaleDateString('en-US', { weekday: 'short' })}
                    </Text>
                    <View style={[s.weekDayNumCircle, isT && { backgroundColor: theme.accent }]}>
                      <Text style={[s.weekDayNum, { color: isT ? '#fff' : theme.text }]}>
                        {dObj.getDate()}
                      </Text>
                    </View>
                  </View>
                )
              })}
            </View>
          </View>

          {/* Time grid */}
          <ScrollView ref={weekScrollRef} style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', height: TOTAL_H }}>

              {/* Time labels */}
              <View style={{ width: TIME_COL }}>
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <View key={i} style={{ position: 'absolute', top: i * HOUR_HEIGHT - 8, width: TIME_COL, alignItems: 'flex-end', paddingRight: 6 }}>
                    <Text style={[s.timeLabel, { color: theme.muted }]}>{hourLabel(DAY_START + i)}</Text>
                  </View>
                ))}
              </View>

              {/* Day columns */}
              <View style={{ flex: 1, flexDirection: 'row' }}>
                {weekDays.map((d, di) => {
                  const isT = d === today
                  const dayEvs = weekEventsByDay[d] || []
                  return (
                    <View
                      key={d}
                      style={[
                        s.dayCol,
                        { borderLeftColor: theme.divider },
                        di === 0 && { borderLeftWidth: 1 },
                        isT && { backgroundColor: theme.accent + '06' },
                      ]}
                    >
                      {/* Hour lines */}
                      {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                        <View key={i} style={[s.hourLine, { top: i * HOUR_HEIGHT, borderTopColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }]} />
                      ))}

                      {/* Current time line */}
                      {isT && nowY >= 0 && nowY <= TOTAL_H && (
                        <View style={[s.nowLine, { top: nowY }]}>
                          <View style={[s.nowDot, { backgroundColor: theme.accent }]} />
                          <View style={[s.nowBar, { backgroundColor: theme.accent }]} />
                        </View>
                      )}

                      {/* Events */}
                      {dayEvs.map(ev => {
                        const top = timeToY(ev.startTime)
                        const height = Math.max(timeDurH(ev.startTime, ev.endTime), 22)
                        if (top < 0 || top > TOTAL_H) return null
                        return (
                          <Pressable
                            key={ev.id}
                            style={[s.eventBlock, {
                              top, height,
                              backgroundColor: ev.color + 'DD',
                              borderLeftColor: ev.color,
                            }]}
                            onPress={() => handleWeekEventPress(ev)}
                          >
                            <Text style={s.eventBlockTitle} numberOfLines={height > 36 ? 2 : 1}>
                              {ev.title}
                            </Text>
                            {height > 34 && (
                              <Text style={s.eventBlockTime} numberOfLines={1}>
                                {fmtTime(ev.startTime)} – {fmtTime(ev.endTime)}
                              </Text>
                            )}
                            {height > 52 && ev.location && (
                              <Text style={s.eventBlockLoc} numberOfLines={1}>{ev.location}</Text>
                            )}
                          </Pressable>
                        )
                      })}
                    </View>
                  )
                })}
              </View>
            </View>
          </ScrollView>
        </View>
      )}

      {/* ── Tasks view ────────────────────────────────────────────────────── */}
      {viewMode === 'tasks' && (
        <View style={{ flex: 1 }}>
          <View style={[s.taskFilterBar, { backgroundColor: theme.card, borderBottomColor: theme.divider }]}>
            {[
              { key: 'active',   label: 'Active',    count: tasks.filter(t => !t.done).length },
              { key: 'today',    label: 'Today',     count: tasks.filter(t => !t.done && t.dueDate === today).length },
              { key: 'upcoming', label: 'Upcoming',  count: tasks.filter(t => !t.done && t.dueDate && t.dueDate > today).length },
              { key: 'done',     label: 'Done',      count: tasks.filter(t => t.done).length },
            ].map(f => (
              <Pressable
                key={f.key}
                style={[s.filterChip, taskFilter === f.key && { backgroundColor: theme.accent }]}
                onPress={() => setTaskFilter(f.key)}
              >
                <Text style={[s.filterChipText, { color: taskFilter === f.key ? '#fff' : theme.subtext }]}>
                  {f.label}{f.count > 0 ? ` (${f.count})` : ''}
                </Text>
              </Pressable>
            ))}
          </View>

          <ScrollView contentContainerStyle={[s.content, { paddingTop: 12 }]}>
            {filteredTasks.length === 0 ? (
              <View style={[s.taskEmptyCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
                <Text style={{ fontSize: 32, textAlign: 'center', marginBottom: 8 }}>
                  {taskFilter === 'done' ? '🎉' : '📋'}
                </Text>
                <Text style={[s.emptyText, { color: theme.muted, textAlign: 'center' }]}>
                  {taskFilter === 'done'     ? 'No completed tasks yet'
                   : taskFilter === 'today'  ? 'Nothing due today'
                   : taskFilter === 'upcoming' ? 'Nothing upcoming'
                   : 'No active tasks — tap ＋ Task to add one'}
                </Text>
              </View>
            ) : filteredTasks.map(task => {
              const pri = PRIORITY[task.priority] ?? PRIORITY.none
              const isOverdue  = task.dueDate && task.dueDate < today && !task.done
              const isDueToday = task.dueDate === today && !task.done
              const dueDateColor = isOverdue ? '#ef4444' : isDueToday ? '#f59e0b' : theme.muted
              const dueDateLabel = task.dueDate
                ? isOverdue   ? `Overdue · ${formatDateShort(task.dueDate)}`
                  : isDueToday ? 'Due today'
                  : task.dueDate === tomorrowStr() ? 'Tomorrow'
                  : formatDateShort(task.dueDate)
                : null
              return (
                <Pressable
                  key={task.id}
                  style={[s.taskRow, { backgroundColor: theme.card, borderColor: theme.cardBorder, borderLeftColor: pri.color, opacity: task.done ? 0.6 : 1 }]}
                  onPress={() => openEditTask(task)}
                >
                  <Pressable
                    style={[s.taskCheck, { borderColor: task.done ? pri.color : theme.cardBorder, backgroundColor: task.done ? pri.color : 'transparent' }]}
                    onPress={() => handleToggleTask(task)}
                    hitSlop={10}
                  >
                    {task.done && <Text style={s.taskCheckmark}>✓</Text>}
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.taskTitle, { color: theme.text }, task.done && s.taskTitleDone]}>
                      {task.title}
                    </Text>
                    {task.description ? (
                      <Text style={[s.taskDesc, { color: theme.subtext }]} numberOfLines={2}>
                        {task.description}
                      </Text>
                    ) : null}
                    {dueDateLabel ? (
                      <Text style={[s.taskDueLabel, { color: dueDateColor }]}>
                        {isOverdue ? '⚠ ' : isDueToday ? '⏰ ' : '📅 '}{dueDateLabel}
                      </Text>
                    ) : null}
                  </View>
                  <View style={s.taskRowRight}>
                    <View style={[s.taskPriorityDot, { backgroundColor: pri.color }]} />
                    <Pressable onPress={() => handleDeleteTask(task)} hitSlop={12}>
                      <Text style={s.deleteBtnText}>✕</Text>
                    </Pressable>
                  </View>
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      )}

      {/* ── Add Event modal ────────────────────────────────────────────────── */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView style={s.modalKAV} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={[StyleSheet.absoluteFillObject, s.modalBg]} onPress={() => setAddOpen(false)} />
          <View style={[s.modalSheet, { backgroundColor: theme.card }]}>
            <View style={[s.modalHandle, { backgroundColor: theme.divider }]} />
            <Text style={[s.modalTitle, { color: theme.text }]}>Add Event</Text>

            <View style={[s.dateBadge, { backgroundColor: theme.isDark ? '#1c1c32' : '#f0f0fa', borderColor: theme.inputBorder }]}>
              <Text style={s.dateBadgeEmoji}>📆</Text>
              <Text style={[s.dateBadgeText, { color: theme.text }]}>{formatDate(selected || today)}</Text>
            </View>
            <Text style={[s.hint, { color: theme.muted }]}>Tap a day on the calendar to change date</Text>

            <Text style={[s.fieldLabel, { color: theme.muted }]}>TITLE</Text>
            <TextInput
              style={[s.titleInput, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
              placeholder='e.g. "Project due", "Team meeting"'
              placeholderTextColor={theme.muted}
              value={newTitle} onChangeText={setNewTitle} autoFocus returnKeyType="done"
            />

            <Text style={[s.fieldLabel, { color: theme.muted }]}>TYPE</Text>
            <View style={s.typeRow}>
              {EVENT_TYPES.map(t => (
                <Pressable key={t.id}
                  style={[s.typeChip, { backgroundColor: newType === t.id ? t.color + '22' : (theme.isDark ? '#1c1c32' : '#f0f0f8'), borderColor: newType === t.id ? t.color : 'transparent' }]}
                  onPress={() => setNewType(t.id)}>
                  <Text style={s.typeChipEmoji}>{t.emoji}</Text>
                  <Text style={[s.typeChipLabel, { color: newType === t.id ? t.color : theme.subtext }]}>{t.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.fieldLabel, { color: theme.muted }]}>TIME</Text>
            {allDay
              ? <View style={[s.allDayBanner, { backgroundColor: theme.input, borderColor: theme.inputBorder }]}>
                  <Text style={[{ fontSize: 14 }, { color: theme.muted }]}>All day — no reminder</Text>
                </View>
              : <TimeInput h={newH} m={newM} ap={newAp} onH={setNewH} onM={setNewM} onAp={setNewAp} theme={theme} />
            }
            <Pressable style={s.allDayToggle} onPress={() => setAllDay(v => !v)}>
              <View style={[s.checkbox, { borderColor: allDay ? theme.accent : theme.inputBorder, backgroundColor: allDay ? theme.accent : 'transparent' }]}>
                {allDay && <Text style={s.checkmark}>✓</Text>}
              </View>
              <Text style={[s.allDayLabel, { color: theme.subtext }]}>All day (skip reminder)</Text>
            </Pressable>
            {!allDay && <Text style={[s.notifHint, { color: theme.muted }]}>🔔 You'll be reminded 10 min before</Text>}

            <Pressable style={[s.saveBtn, { backgroundColor: theme.accent, opacity: saving ? 0.6 : 1 }]} onPress={handleSaveEvent} disabled={saving}>
              <Text style={s.saveBtnText}>{saving ? 'Saving…' : 'Save Event'}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Add Class modal ────────────────────────────────────────────────── */}
      <Modal visible={classOpen} transparent animationType="slide" onRequestClose={() => setClassOpen(false)}>
        <KeyboardAvoidingView style={s.modalKAV} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={[StyleSheet.absoluteFillObject, s.modalBg]} onPress={() => setClassOpen(false)} />
          <View style={[s.modalSheet, s.classSheet, { backgroundColor: theme.card }]}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={[s.modalHandle, { backgroundColor: theme.divider }]} />
              <Text style={[s.modalTitle, { color: theme.text }]}>Add Class</Text>

              <Text style={[s.fieldLabel, { color: theme.muted }]}>COURSE NAME</Text>
              <TextInput
                style={[s.titleInput, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
                placeholder='e.g. "MATH 133-001"'
                placeholderTextColor={theme.muted}
                value={cTitle} onChangeText={setCTitle} autoFocus returnKeyType="next"
              />

              <Text style={[s.fieldLabel, { color: theme.muted }]}>LOCATION (optional)</Text>
              <TextInput
                style={[s.titleInput, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
                placeholder='e.g. "McConnell Engineering B202"'
                placeholderTextColor={theme.muted}
                value={cLoc} onChangeText={setCLoc} returnKeyType="next"
              />

              <Text style={[s.fieldLabel, { color: theme.muted }]}>DAYS</Text>
              <View style={s.daysRow}>
                {WEEK_DAY_BTNS.map(d => {
                  const on = cDays.includes(d.value)
                  return (
                    <Pressable
                      key={d.value}
                      style={[s.dayBtn, { backgroundColor: on ? theme.accent : (theme.isDark ? '#1c1c32' : '#f0f0f8') }]}
                      onPress={() => setCDays(prev => on ? prev.filter(v => v !== d.value) : [...prev, d.value])}
                    >
                      <Text style={[s.dayBtnText, { color: on ? '#fff' : theme.subtext }]}>{d.label}</Text>
                    </Pressable>
                  )
                })}
              </View>

              <Text style={[s.fieldLabel, { color: theme.muted }]}>START TIME</Text>
              <TimeInput h={cSH} m={cSM} ap={cSAp} onH={setCSH} onM={setCSM} onAp={setCSAp} theme={theme} />

              <Text style={[s.fieldLabel, { color: theme.muted, marginTop: 12 }]}>END TIME</Text>
              <TimeInput h={cEH} m={cEM} ap={cEAp} onH={setCEH} onM={setCEM} onAp={setCEAp} theme={theme} />

              <Text style={[s.fieldLabel, { color: theme.muted, marginTop: 12 }]}>COLOR</Text>
              <View style={s.colorRow}>
                {SCHEDULE_COLORS.map(c => (
                  <Pressable
                    key={c}
                    style={[s.colorSwatch, { backgroundColor: c }, cColor === c && s.colorSwatchActive]}
                    onPress={() => setCColor(c)}
                  />
                ))}
              </View>

              <Text style={[s.fieldLabel, { color: theme.muted, marginTop: 12 }]}>SEMESTER DATE RANGE (optional)</Text>
              <View style={s.semRow}>
                <TextInput
                  style={[s.semInput, { flex: 1, backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
                  placeholder="MM/DD/YYYY" placeholderTextColor={theme.muted}
                  value={cFrom} onChangeText={setCFrom} keyboardType="numbers-and-punctuation" maxLength={10}
                />
                <Text style={[s.semArrow, { color: theme.muted }]}>→</Text>
                <TextInput
                  style={[s.semInput, { flex: 1, backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
                  placeholder="MM/DD/YYYY" placeholderTextColor={theme.muted}
                  value={cTo} onChangeText={setCTo} keyboardType="numbers-and-punctuation" maxLength={10}
                />
              </View>
              <Text style={[s.hint, { color: theme.muted }]}>Leave blank to show every week indefinitely</Text>

              <Pressable
                style={[s.saveBtn, { backgroundColor: theme.accent, opacity: cSaving ? 0.6 : 1, marginBottom: 8 }]}
                onPress={handleSaveClass} disabled={cSaving}
              >
                <Text style={s.saveBtnText}>{cSaving ? 'Saving…' : 'Add to Schedule'}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Add / Edit Task modal ──────────────────────────────────────────── */}
      <Modal visible={taskModalOpen} transparent animationType="slide" onRequestClose={() => setTaskModalOpen(false)}>
        <KeyboardAvoidingView style={s.modalKAV} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={[StyleSheet.absoluteFillObject, s.modalBg]} onPress={() => setTaskModalOpen(false)} />
          <View style={[s.modalSheet, s.classSheet, { backgroundColor: theme.card }]}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={[s.modalHandle, { backgroundColor: theme.divider }]} />
              <Text style={[s.modalTitle, { color: theme.text }]}>{editingTask ? 'Edit Task' : 'New Task'}</Text>

              <Text style={[s.fieldLabel, { color: theme.muted }]}>TITLE</Text>
              <TextInput
                style={[s.titleInput, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
                placeholder="What needs to be done?"
                placeholderTextColor={theme.muted}
                value={tTitle} onChangeText={setTTitle} autoFocus returnKeyType="next"
              />

              <Text style={[s.fieldLabel, { color: theme.muted }]}>DESCRIPTION (optional)</Text>
              <TextInput
                style={[s.titleInput, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text, minHeight: 72, textAlignVertical: 'top', paddingTop: 12 }]}
                placeholder="Add notes..."
                placeholderTextColor={theme.muted}
                value={tDesc} onChangeText={setTDesc} multiline
              />

              <Text style={[s.fieldLabel, { color: theme.muted }]}>DUE DATE (optional)</Text>
              <View style={s.dueDatePresets}>
                {[
                  { label: 'Today',     iso: today },
                  { label: 'Tomorrow',  iso: tomorrowStr() },
                  { label: 'Next Week', iso: addDays(today, 7) },
                ].map(p => {
                  const active = parseDateInput(tDueDateRaw) === p.iso
                  return (
                    <Pressable
                      key={p.label}
                      style={[s.dueDatePreset, { borderColor: theme.cardBorder, backgroundColor: active ? theme.accent : (theme.isDark ? '#1c1c32' : '#f0f0f8') }]}
                      onPress={() => setTDueDateRaw(active ? '' : fmtDateForInput(p.iso))}
                    >
                      <Text style={[s.dueDatePresetText, { color: active ? '#fff' : theme.subtext }]}>{p.label}</Text>
                    </Pressable>
                  )
                })}
              </View>
              <TextInput
                style={[s.titleInput, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
                placeholder="or MM/DD/YYYY"
                placeholderTextColor={theme.muted}
                value={tDueDateRaw}
                onChangeText={setTDueDateRaw}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />

              <Text style={[s.fieldLabel, { color: theme.muted }]}>PRIORITY</Text>
              <View style={s.typeRow}>
                {Object.entries(PRIORITY).map(([key, pri]) => (
                  <Pressable
                    key={key}
                    style={[s.typeChip, { backgroundColor: tPriority === key ? pri.color + '22' : (theme.isDark ? '#1c1c32' : '#f0f0f8'), borderColor: tPriority === key ? pri.color : 'transparent' }]}
                    onPress={() => setTPriority(key)}
                  >
                    <Text style={s.typeChipEmoji}>{pri.emoji}</Text>
                    <Text style={[s.typeChipLabel, { color: tPriority === key ? pri.color : theme.subtext }]}>{pri.label}</Text>
                  </Pressable>
                ))}
              </View>

              <Pressable
                style={[s.saveBtn, { backgroundColor: theme.accent, opacity: tSaving ? 0.6 : 1 }]}
                onPress={handleSaveTask} disabled={tSaving}
              >
                <Text style={s.saveBtnText}>{tSaving ? 'Saving…' : editingTask ? 'Update Task' : 'Add Task'}</Text>
              </Pressable>

              {editingTask && (
                <Pressable style={{ alignItems: 'center', paddingVertical: 14 }} onPress={() => handleDeleteTask(editingTask, true)}>
                  <Text style={{ color: '#ef444488', fontSize: 14, fontWeight: '600' }}>Delete task</Text>
                </Pressable>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Journal modal — full-screen editor so long entries stay visible ── */}
      <Modal visible={journalOpen} animationType="slide" onRequestClose={() => setJournalOpen(false)}>
        <KeyboardAvoidingView
          style={[s.journalPage, { backgroundColor: theme.card }]}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={[s.journalHeader, { paddingTop: insets.top + 10 }]}>
            <Pressable onPress={() => setJournalOpen(false)} hitSlop={12}>
              <Text style={[s.journalClose, { color: theme.muted }]}>✕</Text>
            </Pressable>
            <Text style={[s.journalHeaderTitle, { color: theme.text }]} numberOfLines={1}>
              {jDate ? formatDate(jDate) : 'Journal'}
            </Text>
            <Pressable onPress={handleSaveJournal} disabled={jSaving} hitSlop={12}>
              <Text style={[s.journalSave, { opacity: jSaving ? 0.5 : 1 }]}>
                {jSaving ? 'Saving…' : 'Save'}
              </Text>
            </Pressable>
          </View>

          <View style={s.journalBody}>
            <Text style={[s.fieldLabel, { color: theme.muted }]}>MOOD</Text>
            <View style={s.moodRow}>
              {MOODS.map(m => (
                <Pressable
                  key={m.key}
                  style={[
                    s.moodBtn,
                    { borderColor: jMood === m.key ? '#0ea5e9' : theme.cardBorder,
                      backgroundColor: jMood === m.key ? '#0ea5e918' : (theme.isDark ? '#1c1c32' : '#f4f8ff') },
                  ]}
                  onPress={() => setJMood(jMood === m.key ? null : m.key)}
                >
                  <Text style={s.moodBtnEmoji}>{m.emoji}</Text>
                  <Text style={[s.moodBtnLabel, { color: jMood === m.key ? '#0ea5e9' : theme.muted }]}>{m.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.fieldLabel, { color: theme.muted }]}>ENTRY</Text>
            <TextInput
              style={[s.journalTextArea, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
              placeholder="What's on your mind today?"
              placeholderTextColor={theme.muted}
              value={jText}
              onChangeText={setJText}
              multiline
              scrollEnabled
            />
            <View style={{ height: Math.max(insets.bottom, 12) }} />
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: { flex: 1 },

  // Load failure
  errorPage: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2, textAlign: 'center' },
  errorSub: { fontSize: 13, fontWeight: '500', textAlign: 'center', marginTop: 6, lineHeight: 18 },
  errorBtn: { borderRadius: 16, paddingVertical: 13, paddingHorizontal: 30, marginTop: 20 },
  errorBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Toggle bar
  toggleBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    flexWrap: 'wrap', rowGap: 8,
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1,
  },
  togglePill: { flexDirection: 'row', borderRadius: 20, padding: 3 },
  toggleOpt:  { paddingHorizontal: 18, paddingVertical: 7, borderRadius: 17 },
  toggleOptText: { fontSize: 13, fontWeight: '700' },
  toggleActions: { flexDirection: 'row', gap: 8 },
  toggleActionBtn: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 7 },
  toggleActionText: { fontSize: 13, fontWeight: '700' },

  // Month view
  content: { padding: 16, paddingBottom: 36 },
  statRow: { flexDirection: 'row', borderRadius: 18, padding: 16, marginBottom: 14, alignItems: 'center', borderWidth: 1 },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 28, fontWeight: '700' },
  statLabel: { fontSize: 12, marginTop: 2 },
  statDivider: { width: 1, height: 40 },

  calCard: { borderRadius: 20, padding: 16, borderWidth: 1, marginBottom: 14 },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  navBtn: { padding: 4 },
  navBtnText: { fontSize: 26, lineHeight: 30 },
  monthLabel: { fontSize: 17, fontWeight: '700' },

  dayHeaderRow: { flexDirection: 'row', marginBottom: 4 },
  dayHeaderCell: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  dayHeaderText: { fontSize: 12, fontWeight: '600' },

  weekRow: { flexDirection: 'row', marginBottom: 2 },
  emptyCell: { flex: 1 },
  dayCell: { flex: 1, alignItems: 'center', paddingVertical: 2 },
  dayCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  circleComplete: { backgroundColor: '#10b981' },
  circlePartial:  { backgroundColor: '#f59e0b' },
  dayNum: { fontSize: 14, fontWeight: '500' },
  eventDotsRow: { flexDirection: 'row', gap: 2, justifyContent: 'center', marginTop: 2, height: 7 },
  eventDot: { width: 5, height: 5, borderRadius: 3 },
  legendDivider: { height: 1, marginTop: 10, marginBottom: 10 },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 20 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11 },

  addBtn: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1 },
  eventIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  eventEmoji: { fontSize: 18 },
  eventTitle: { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  eventMeta: { fontSize: 12 },
  deleteBtn: { padding: 4 },
  deleteBtnText: { fontSize: 13, color: '#ef4444', fontWeight: '700' },
  emptyText: { fontSize: 14, paddingVertical: 8 },

  detailCard: { borderRadius: 20, padding: 16, borderWidth: 1, marginBottom: 14 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  detailDate: { fontSize: 15, fontWeight: '700', flex: 1, marginRight: 10 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginTop: 16, marginBottom: 6 },
  routineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1 },
  routineDot: { width: 8, height: 8, borderRadius: 4 },
  routineName: { flex: 1, fontSize: 14 },
  routinePct: { fontSize: 14, fontWeight: '700' },

  upcomingCard: { borderRadius: 20, padding: 16, borderWidth: 1, marginBottom: 14 },
  upcomingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  upcomingTitle: { fontSize: 16, fontWeight: '700' },
  typePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  typePillText: { fontSize: 11, fontWeight: '700' },

  // Week view
  weekHeader: { borderBottomWidth: 1 },
  weekNav: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  weekNavBtn: { padding: 4 },
  weekNavArrow: { fontSize: 24, fontWeight: '700', lineHeight: 28 },
  weekNavTitle: { flex: 1, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  weekTodayBtn: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5 },
  weekTodayText: { fontSize: 12, fontWeight: '700' },

  weekDayHeaders: { flexDirection: 'row', paddingBottom: 8, paddingTop: 4 },
  weekDayHeader: { flex: 1, alignItems: 'center', gap: 3 },
  weekDayName: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
  weekDayNumCircle: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  weekDayNum: { fontSize: 14, fontWeight: '700' },

  timeLabel: { fontSize: 10, fontWeight: '500' },
  dayCol: { flex: 1, borderRightWidth: 1, position: 'relative' },
  hourLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1 },

  nowLine: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', zIndex: 10 },
  nowDot: { width: 8, height: 8, borderRadius: 4, marginLeft: -4 },
  nowBar: { flex: 1, height: 1.5 },

  eventBlock: {
    position: 'absolute', left: 1, right: 1,
    borderRadius: 4, borderLeftWidth: 3,
    paddingHorizontal: 4, paddingTop: 3,
    overflow: 'hidden', zIndex: 5,
  },
  eventBlockTitle: { fontSize: 10, fontWeight: '700', color: '#fff' },
  eventBlockTime:  { fontSize: 9,  fontWeight: '500', color: 'rgba(255,255,255,0.85)', marginTop: 1 },
  eventBlockLoc:   { fontSize: 9,  color: 'rgba(255,255,255,0.75)', marginTop: 1 },

  // Modals
  modalKAV: { flex: 1, justifyContent: 'flex-end' },
  modalBg: { backgroundColor: 'rgba(0,0,0,0.45)' },
  modalSheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 8, paddingHorizontal: 24, paddingBottom: 44,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 20,
  },
  classSheet: { maxHeight: '92%' },
  modalHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3, marginBottom: 16 },

  dateBadge: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 12, borderWidth: 1, marginBottom: 4 },
  dateBadgeEmoji: { fontSize: 18 },
  dateBadgeText: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 11, marginBottom: 14 },

  fieldLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8, marginTop: 4 },
  titleInput: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 16 },

  typeRow: { flexDirection: 'row', gap: 6, marginBottom: 16, flexWrap: 'wrap' },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1.5 },
  typeChipEmoji: { fontSize: 14 },
  typeChipLabel: { fontSize: 12, fontWeight: '600' },

  allDayBanner: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8 },
  allDayToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 4 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  checkmark: { color: '#fff', fontWeight: '800', fontSize: 12 },
  allDayLabel: { fontSize: 14, fontWeight: '500' },
  notifHint: { fontSize: 12, marginTop: 4, marginBottom: 12 },

  saveBtn: { borderRadius: 16, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  // Tasks view
  taskFilterBar: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, gap: 8, borderBottomWidth: 1 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  filterChipText: { fontSize: 12, fontWeight: '700' },

  taskEmptyCard: { borderRadius: 20, padding: 24, borderWidth: 1, alignItems: 'center' },
  taskRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 16, borderWidth: 1, borderLeftWidth: 4,
    padding: 14, marginBottom: 10,
  },
  taskCheck: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  taskCheckmark: { color: '#fff', fontSize: 13, fontWeight: '800' },
  taskTitle: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  taskTitleDone: { textDecorationLine: 'line-through', opacity: 0.7 },
  taskDesc: { fontSize: 12, marginBottom: 4, lineHeight: 16 },
  taskDueLabel: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  taskRowRight: { alignItems: 'center', gap: 10 },
  taskPriorityDot: { width: 8, height: 8, borderRadius: 4 },

  taskDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1 },
  taskDetailCheck: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  // Journal
  journalSection: { marginTop: 12 },
  journalSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  journalPreview: { borderRadius: 14, padding: 12, borderWidth: 1 },
  journalPreviewText: { fontSize: 13, lineHeight: 18 },
  journalEmptyBtn: { borderRadius: 14, padding: 12, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center' },
  journalEmptyText: { fontSize: 13, fontStyle: 'italic' },
  moodRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 16 },
  moodBtn: { borderRadius: 14, padding: 10, alignItems: 'center', borderWidth: 1.5, minWidth: 56 },
  moodBtnEmoji: { fontSize: 22 },
  moodBtnLabel: { fontSize: 10, fontWeight: '600', marginTop: 3 },
  journalPage: { flex: 1 },
  journalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 10,
  },
  journalClose: { fontSize: 20, fontWeight: '600', padding: 4 },
  journalHeaderTitle: {
    flex: 1, textAlign: 'center', marginHorizontal: 10,
    fontSize: 17, fontWeight: '700', letterSpacing: -0.3,
  },
  journalSave: { fontSize: 16, fontWeight: '700', color: '#0ea5e9', padding: 4 },
  journalBody: { flex: 1, paddingHorizontal: 24 },
  journalTextArea: {
    flex: 1, borderRadius: 14, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 12, paddingTop: 12,
    fontSize: 15, lineHeight: 22, textAlignVertical: 'top',
  },

  dueDatePresets: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  dueDatePreset: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  dueDatePresetText: { fontSize: 13, fontWeight: '600' },

  // Class modal extras
  daysRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  dayBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12 },
  dayBtnText: { fontSize: 12, fontWeight: '700' },

  colorRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  colorSwatch: { width: 30, height: 30, borderRadius: 15 },
  colorSwatchActive: { borderWidth: 3, borderColor: '#fff', transform: [{ scale: 1.15 }] },

  semRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  semInput: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 },
  semArrow: { fontSize: 18, fontWeight: '600' },
})
