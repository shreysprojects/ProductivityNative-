import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  View, Text, Pressable, StyleSheet, ScrollView,
  Modal, TextInput, Alert, KeyboardAvoidingView, Platform,
  Animated, PanResponder, Keyboard, Dimensions,
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
  getRoutineNames, getRoutineSettings, getHiddenDefaults, getRoutineGroupMap,
} from '../../lib/storage'
import { readingStats } from '../../lib/textStats'
import { getClassChecks, setClassCheck, classCheckKey } from '../../lib/classChecks'
import DayLogTimeline from '../../components/DayLogTimeline'
import ScanScheduleModal from '../../components/ScanScheduleModal'
import ClassAttendancePrompt from '../../components/ClassAttendancePrompt'
import { syncClassNotifications } from '../../lib/classNotifications'
import {
  getLogSettings, getAllTimeLogs, slotStarts, DEFAULT_LOG_SETTINGS,
  autoLogSpan, dismissAutoLog, unloggedMarkers, timeToMins, nowMins,
} from '../../lib/timeLogging'

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

// To-do buckets — how soon you mean to get to something, rather than a date.
const BUCKETS = [
  { key: 'today',     label: 'Today',     emoji: '☀️', hint: 'Things to get to later today' },
  { key: 'week',      label: 'Week',      emoji: '🗓️', hint: 'Things to do sometime this week' },
  { key: 'anytime',   label: 'Anytime',   emoji: '📚', hint: 'No deadline — whenever you get to it' },
  { key: 'ambitious', label: 'Ambitious', emoji: '🚀', hint: 'Big long-term goals worth chipping away at' },
]
// Only near-term buckets take a deadline; "anytime" and "ambitious" are the
// buckets you put things in precisely because they have no clock on them.
const DEADLINE_BUCKETS = ['today', 'week']

const WEEK_DAY_BTNS = [
  { label: 'M',  value: 1 },
  { label: 'T',  value: 2 },
  { label: 'W',  value: 3 },
  { label: 'Th', value: 4 },
  { label: 'F',  value: 5 },
  { label: 'Sa', value: 6 },
  { label: 'Su', value: 0 },
]

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

function addMinsToTime(t, mins) {
  const [h, m] = t.split(':').map(Number)
  const tot = h * 60 + m + mins
  return `${String(Math.floor(tot / 60) % 24).padStart(2,'0')}:${String(tot % 60).padStart(2,'0')}`
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

function formatDuration(startTime, endTime) {
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  const mins = Math.max(0, (eh * 60 + em) - (sh * 60 + sm))
  const hours = Math.floor(mins / 60)
  const rest = mins % 60
  if (!hours) return `${rest}m`
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

// Which routines each weekday expects (index = Date#getDay, 0 = Sunday):
// every non-hidden Every-day routine whose schedule includes that day.
// Whenever routines have no schedule, so they only count on days they were
// actually started. Falls back to "nothing expected" if the reads fail, so the
// grid still reflects whatever was started.
async function loadDueByWeekday(userId) {
  const due = Array.from({ length: 7 }, () => [])
  try {
    const names = await getRoutineNames(userId)
    const [settings, hidden, groups] = await Promise.all([
      Promise.all(names.map(n => getRoutineSettings(userId, n))),
      getHiddenDefaults(userId),
      getRoutineGroupMap(userId),
    ])
    names.forEach((name, i) => {
      if (hidden.includes(name) || (groups[name] ?? 'everyday') !== 'everyday') return
      const active = settings[i]?.activeDays ?? []
      // Routine schedules are Monday-first; getDay() is Sunday-first.
      for (let dow = 0; dow < 7; dow++) if (active[(dow + 6) % 7]) due[dow].push(name)
    })
  } catch {}
  return due
}

// A day's ring. Green only when every routine that was due that day — plus any
// other routine that was started — reached 100%. Orange when something was
// started but the day fell short of that. Nothing when nothing was started.
function dayRingStatus(rows, dueNames) {
  const expected = new Set(dueNames)
  const pct = new Map()
  for (const r of rows) {
    expected.add(r.routine)
    pct.set(r.routine, Math.max(pct.get(r.routine) ?? 0, r.completion ?? 0))
  }
  if (expected.size === 0) return null
  const anyProgress = rows.some(r => (r.completion ?? 0) > 0)
  for (const name of expected) {
    if ((pct.get(name) ?? 0) < 100) return anyProgress ? 'partial' : null
  }
  return 'complete'
}

function pctColor(p) {
  if (p >= 100) return '#10b981'
  if (p >= 50)  return '#f59e0b'
  return '#ef4444'
}

// ── To-do deadlines ────────────────────────────────────────────────────────
// 'YYYY-MM-DD HH:MM' for a time, or 'YYYY-MM-DD' meaning end of that day.

function nowStamp() {
  const d = new Date()
  return `${todayStr()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function deadlineStamp(d) {
  return d.length === 10 ? `${d} 23:59` : d
}

function isOverdue(t) {
  return !t.done && !!t.deadline && deadlineStamp(t.deadline) < nowStamp()
}

function weekdayLabel(ds) {
  return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })
}

function deadlineLabel(d) {
  if (d.length === 10) {
    return d === todayStr() ? 'by end of today' : `by ${weekdayLabel(d)}`
  }
  const [day, hm] = d.split(' ')
  const [h, m] = hm.split(':').map(Number)
  const time = hm === '23:59' ? 'end of day' : fmtTime(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`)
  return day === todayStr() ? `by ${time}` : `by ${weekdayLabel(day)} ${time}`
}

// Remaining half-hours today, or the next 7 days for week-bucket items.
function deadlineOptions(bucket) {
  if (bucket === 'today') {
    const d = new Date()
    const first = Math.ceil((d.getHours() * 60 + d.getMinutes() + 1) / 30) * 30
    const opts = []
    for (let t = first; t <= 1410; t += 30) {
      const hh = String(Math.floor(t / 60)).padStart(2, '0')
      const mm = String(t % 60).padStart(2, '0')
      opts.push({ value: `${todayStr()} ${hh}:${mm}`, label: fmtTime(`${hh}:${mm}`) })
    }
    opts.push({ value: `${todayStr()} 23:59`, label: 'End of today' })
    return opts
  }
  return Array.from({ length: 7 }, (_, i) => {
    const key = addDays(todayStr(), i)
    const label = i === 0 ? 'Today'
      : i === 1 ? 'Tomorrow'
      : new Date(key + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })
    return { value: key, label }
  })
}

// Inverse of parseFormTime: "14:30" → the h/m/ap form-field values.
function formTimeParts(t) {
  const [h, m] = String(t ?? '8:00').split(':').map(Number)
  return { h: String(h % 12 || 12), m: String(m).padStart(2, '0'), ap: h >= 12 ? 'PM' : 'AM' }
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

  // View. Month, Day and To-do are sections of one scrolling page: the tab bar
  // highlights the section under the toolbar and a tap jumps to it. Time log
  // is its own pane, since the timeline is a list in its own right.
  const [viewMode, setViewMode] = useState('month')
  const [activeSection, setActiveSection] = useState('month')
  const pageScrollRef = useRef(null)
  const sectionY = useRef({ day: 0, tasks: 0 })   // section offsets in the page
  const pendingSection = useRef(null)               // jump to make once the page mounts
  const ignoreScrollUntil = useRef(0)               // a tap's own scroll must not re-highlight

  // Month view
  const [viewDate, setViewDate] = useState({ year: now.getFullYear(), month: now.getMonth() })
  const [completionMap, setCompletionMap] = useState({})
  const [dayStatus, setDayStatus] = useState({})   // date -> 'complete' | 'partial'
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

  // Add / edit class modal (editingClass null = adding a new one)
  const [classOpen, setClassOpen] = useState(false)
  const [editingClass, setEditingClass] = useState(null)
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

  // Drag-down-to-dismiss for the class sheet. Tapping a class autofocuses the
  // course-name field, so the sheet opens with the keyboard up and almost no
  // backdrop left to tap — the grabber has to be a real handle, not decoration.
  const classDragY   = useRef(new Animated.Value(0)).current
  // Backdrop fades with the pull so a drag reads as a dismissal, not a nudge.
  const classBackdrop = useRef(classDragY.interpolate({
    inputRange: [0, 260], outputRange: [1, 0], extrapolate: 'clamp',
  })).current
  // Pulling the form itself only dismisses when it is already scrolled to the
  // top; anywhere else the ScrollView keeps the gesture.
  const classAtTop   = useRef(true)

  // To-dos
  const [tasks, setTasks]               = useState([])
  const [bucket, setBucket]             = useState('today')
  const [draftTodo, setDraftTodo]       = useState('')
  const [deadlinePick, setDeadlinePick] = useState(null) // task whose deadline is being set
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [editingTask, setEditingTask]   = useState(null)
  const [tTitle, setTTitle]             = useState('')
  const [tDesc, setTDesc]               = useState('')
  const [tDueDateRaw, setTDueDateRaw]   = useState('')
  const [tPriority, setTPriority]       = useState('none')
  const [tSaving, setTSaving]           = useState(false)

  // Time logging
  const [logSettings, setLogSettings] = useState(DEFAULT_LOG_SETTINGS)
  const [logCounts, setLogCounts]     = useState({})  // day -> logged slot count
  const [logDay, setLogDay]           = useState(todayStr())
  const [scanOpen, setScanOpen]       = useState(false)
  // Bumped whenever something outside DayLogTimeline writes to the log, so it
  // re-reads instead of showing a stale day.
  const [logRefresh, setLogRefresh]   = useState(0)

  // Classes that finished today and haven't been answered for yet.
  const [attendQueue, setAttendQueue] = useState([])
  // Classes ticked off on the Day section: { `${scheduleId}|${day}`: true }.
  const [classChecks, setClassChecks] = useState({})
  // "Ask me later" holds off until the next app launch, so dismissing doesn't
  // re-prompt every time this tab regains focus.
  const attendSnoozed = useRef(false)

  // Journal
  const [journalEntries, setJournalEntries] = useState({})
  const [journalOpen, setJournalOpen]       = useState(false)
  const [jReadOnly, setJReadOnly]           = useState(false)
  const [jDate, setJDate]                   = useState(null)
  const [jMood, setJMood]                   = useState(null)
  const [jText, setJText]                   = useState('')
  const [jSaving, setJSaving]               = useState(false)

  // Load state
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Per-date detail extras
  const [selectedWorkout, setSelectedWorkout] = useState(null)
  const [selectedMeals, setSelectedMeals]     = useState([])

  useEffect(() => {
    Notifications.getPermissionsAsync()
      .then(({ status }) => setHasPerm(status === 'granted'))
      .catch(() => {})
  }, [])

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
      const [hist, str, evts, sched, taskList, jEntries, lSettings, allLogs, dueByWeekday, checks] = await Promise.all([
        getHistory(user.id), getStreak(user.id),
        getCalendarEvents(user.id), getScheduleItems(user.id),
        getTasks(user.id), getJournalEntries(user.id),
        getLogSettings(user.id),
        // Never let the time-log sync take the whole calendar down with it.
        getAllTimeLogs(user.id).catch(() => ({})),
        loadDueByWeekday(user.id),
        getClassChecks(user.id).catch(() => ({})),
      ])
      setClassChecks(checks)
      setLogSettings(lSettings)
      const counts = {}
      for (const [d, slots] of Object.entries(allLogs)) counts[d] = Object.keys(slots).length
      setLogCounts(counts)
      const map = {}, byDate = {}
      hist.forEach(h => {
        if (!map[h.date] || map[h.date] < h.completion) map[h.date] = h.completion
        if (!byDate[h.date]) byDate[h.date] = []
        byDate[h.date].push(h)
      })
      setCompletionMap(map)
      setHistoryByDate(byDate)
      const status = {}
      for (const [date, rows] of Object.entries(byDate)) {
        const dow = new Date(date + 'T12:00:00').getDay()
        const ring = dayRingStatus(rows, dueByWeekday[dow])
        if (ring) status[date] = ring
      }
      setDayStatus(status)
      setStreak(str)
      setEvents(evts)
      setScheduleItems(sched)
      setTasks(taskList)
      setJournalEntries(jEntries)
      // A routine finished on another screen may have written itself into the
      // log while this tab was in the background.
      setLogRefresh(n => n + 1)
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
        setJReadOnly(false) // this path always opens today
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

  // The day strip always shows the week containing the selected day. Derived
  // rather than stored, so stepping into a neighbouring week can't render one
  // frame against the old week's days.
  const weekDays = useMemo(() => {
    const ws = getWeekStart(logDay)
    return Array.from({ length: 7 }, (_, i) => addDays(ws, i))
  }, [logDay])

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
        // Defensive: one malformed row must not take the whole tab down.
        if (!Array.isArray(item?.days) || !item.startTime || !item.endTime) continue
        if (!item.days.includes(dow)) continue
        if (item.semesterStart && day < item.semesterStart) continue
        if (item.semesterEnd   && day > item.semesterEnd)   continue
        dayEvs.push({
          id: item.id + '|' + day, title: item.title, kind: 'class',
          startTime: item.startTime, endTime: item.endTime,
          color: item.color, location: item.location ?? null,
          meta: item.meta ?? null,
          _scheduleId: item.id,
        })
      }

      result[day] = dayEvs.sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
    }
    return result
  }, [weekDays, events, scheduleItems])

  // The Schedule pane describes a recurring weekly timetable, so it reads as
  // weekdays rather than dates. Any day of the week can appear, but a day
  // earns its chip by having something on it — an empty day stays hidden until
  // a class is added. The day you're currently on is always shown, so arrowing
  // onto a free day can't strand you with no chip selected.
  // "Day" is the schedule view now that Time log has its own top-bar tab.
  // The Day section's strip only shows days that have classes (the Time log
  // pane's strip shows the whole week).
  const scheduleStripDays = useMemo(() => {
    const busy = d => (weekEventsByDay[d]?.length ?? 0) > 0
    // Nothing scheduled all week: show the whole week rather than a lone chip.
    if (!weekDays.some(busy)) return weekDays
    return weekDays.filter(d => busy(d) || d === logDay)
  }, [weekDays, logDay, weekEventsByDay])

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

  // Open items first (earliest deadline up top, undated after), done last.
  const bucketTasks = useMemo(() => (
    tasks
      .filter(t => (t.bucket ?? 'today') === bucket)
      .sort((a, b) => {
        if (!!a.done !== !!b.done) return a.done ? 1 : -1
        const ka = a.deadline ? deadlineStamp(a.deadline) : '9999'
        const kb = b.deadline ? deadlineStamp(b.deadline) : '9999'
        if (ka !== kb) return ka < kb ? -1 : 1
        return (a.createdAt ?? 0) - (b.createdAt ?? 0)
      })
  ), [tasks, bucket])

  const bucketCounts = useMemo(() => {
    const c = {}
    for (const t of tasks) {
      if (t.done) continue
      const b = t.bucket ?? 'today'
      c[b] = (c[b] ?? 0) + 1
    }
    return c
  }, [tasks])

  const slotsPerDay = useMemo(() => slotStarts(logSettings).length, [logSettings])

  // ── Handlers ──────────────────────────────────────────────────────────────

  function scrollToSection(section) {
    const y = section === 'month' ? 0 : Math.max(0, (sectionY.current[section] ?? 0) - 6)
    ignoreScrollUntil.current = Date.now() + 600
    pageScrollRef.current?.scrollTo({ y, animated: true })
  }

  function switchView(mode) {
    if (mode === 'log') {
      if (selected) setLogDay(selected)
      setViewMode('log')
      return
    }
    // A date picked in the month grid carries over to the Day section.
    if (mode === 'day' && selected) setLogDay(selected)
    setActiveSection(mode)
    if (viewMode === 'month') {
      scrollToSection(mode)
    } else {
      // Coming back from the Time log: the page mounts a frame later, so the
      // jump waits for its first layout (onContentSizeChange).
      pendingSection.current = mode
      setViewMode('month')
    }
  }

  function flushPendingScroll() {
    const section = pendingSection.current
    if (!section) return
    pendingSection.current = null
    requestAnimationFrame(() => scrollToSection(section))
  }

  // The highlighted tab follows whichever section is under the toolbar. The
  // end of the page counts as To-do, so a short list still lights its tab up
  // even though it can't reach the top of the screen.
  function onPageScroll(e) {
    if (Date.now() < ignoreScrollUntil.current) return
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent
    const scrolls = contentSize.height > layoutMeasurement.height + 40
    const atEnd = scrolls && contentOffset.y + layoutMeasurement.height >= contentSize.height - 4
    const y = contentOffset.y + 72
    const next = atEnd || y >= sectionY.current.tasks ? 'tasks'
      : y >= sectionY.current.day ? 'day'
      : 'month'
    setActiveSection(prev => (prev === next ? prev : next))
  }

  function openAdd() {
    setNewTitle(''); setNewType('reminder')
    setNewH('12'); setNewM('00'); setNewAp('PM')
    setAllDay(false); setAddOpen(true)
  }

  function openAddClass() {
    setEditingClass(null)
    setCTitle(''); setCLoc(''); setCDays([])
    setCSH('8'); setCSM('00'); setCSAp('AM')
    setCEH('9'); setCEM('00'); setCEAp('AM')
    setCColor('#3b82f6'); setCFrom(''); setCTo('')
    classDragY.setValue(0)
    classAtTop.current = true
    setClassOpen(true)
  }

  function openEditClass(item) {
    const st = formTimeParts(item.startTime), et = formTimeParts(item.endTime)
    setEditingClass(item)
    setCTitle(item.title); setCLoc(item.location ?? ''); setCDays(item.days ?? [])
    setCSH(st.h); setCSM(st.m); setCSAp(st.ap)
    setCEH(et.h); setCEM(et.m); setCEAp(et.ap)
    setCColor(item.color ?? '#3b82f6')
    setCFrom(item.semesterStart ? fmtDateForInput(item.semesterStart) : '')
    setCTo(item.semesterEnd ? fmtDateForInput(item.semesterEnd) : '')
    classDragY.setValue(0)
    classAtTop.current = true
    setClassOpen(true)
  }

  // Slide the sheet the rest of the way out, then unmount it. The travel is a
  // screen height rather than the measured sheet height because dismissing the
  // keyboard re-lays the sheet out taller mid-animation. Resetting the offset
  // after the modal is gone keeps the next open from starting off screen.
  const closeClassSheet = useCallback(() => {
    Keyboard.dismiss()
    Animated.timing(classDragY, {
      toValue: Dimensions.get('window').height, duration: 180, useNativeDriver: true,
    }).start(() => {
      setClassOpen(false)
      setEditingClass(null)
      classDragY.setValue(0)
    })
  }, [classDragY])

  // Shared drag behaviour for both grab points. The keyboard is dismissed the
  // moment a drag starts: it is what the user is reaching past, and the sheet
  // cannot travel down into space the keyboard still occupies.
  const classDragHandlers = useRef({
    onPanResponderGrant: () => { Keyboard.dismiss() },
    onPanResponderMove: (_, g) => { classDragY.setValue(Math.max(0, g.dy)) },
    // The ScrollView asks for the gesture back once it starts moving; refusing
    // keeps a pull that began as a dismissal a dismissal.
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_, g) => {
      // A long pull or a quick flick closes; anything shorter snaps back.
      if (g.dy > 120 || (g.dy > 40 && g.vy > 0.6)) closeClassSheet()
      else Animated.spring(classDragY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start()
    },
    onPanResponderTerminate: () => {
      Animated.spring(classDragY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start()
    },
  }).current

  // The grabber and title: always draggable, wherever the form is scrolled to.
  const classHandlePan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    ...classDragHandlers,
  })).current

  // The form body: claims the gesture only on a clear downward pull from the
  // top of the scroll, so ordinary scrolling and field taps are untouched.
  const classBodyPan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) =>
      classAtTop.current && g.dy > 8 && g.dy > Math.abs(g.dx),
    ...classDragHandlers,
  })).current

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
    // Spreading the original first keeps fields the form doesn't own (id,
    // scan meta like course code/type) when editing.
    const item = {
      ...(editingClass ?? {}),
      id: editingClass?.id ?? genId(), title: cTitle.trim(),
      location: cLoc.trim() || null,
      days: cDays, startTime, endTime, color: cColor,
      semesterStart, semesterEnd,
    }
    // A club meeting's card shows meta.courseCode, so a rename here has to
    // reach it too (the club itself is renamed from the Routines page).
    if (item.meta?.type === 'Club') {
      item.meta = { ...item.meta, courseCode: item.title, courseName: item.title }
    }
    await saveScheduleItem(user.id, item)
    setScheduleItems(prev => editingClass
      ? prev.map(i => i.id === item.id ? item : i)
      : [...prev, item])
    setClassOpen(false); setCeSaving(false); setEditingClass(null)
  }

  function handleDeleteClass() {
    const item = editingClass
    if (!item) return
    Alert.alert('Delete Class', `Remove "${item.title}" from your schedule?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await deleteScheduleItem(user.id, item.id)
          setScheduleItems(prev => prev.filter(i => i.id !== item.id))
          setClassOpen(false); setEditingClass(null)
        },
      },
    ])
  }

  function handleWeekEventPress(ev) {
    // Tapping a class opens it for editing; delete lives inside that menu.
    if (ev.kind === 'class') {
      const item = scheduleItems.find(i => i.id === ev._scheduleId)
      if (item) { openEditClass(item); return }
    }
    const timeRange = `${fmtTime(ev.startTime)} – ${fmtTime(ev.endTime)}`
    const body = [timeRange, ev.location].filter(Boolean).join('\n')
    Alert.alert(ev.title, body, [
      { text: 'Close', style: 'cancel' },
      {
        text: 'Delete Event',
        style: 'destructive',
        onPress: async () => {
          if (ev.notifId) { try { await Notifications.cancelScheduledNotificationAsync(ev.notifId) } catch {} }
          await deleteCalendarEvent(user.id, ev.id)
          setEvents(prev => prev.filter(e => e.id !== ev.id))
        },
      },
    ])
  }

  async function addQuickTodo() {
    const title = draftTodo.trim()
    if (!title) return
    setDraftTodo('')
    const task = {
      id: genId(), title, description: null, dueDate: null,
      priority: 'none', done: false, createdAt: Date.now(),
      bucket, deadline: null,
    }
    setTasks(prev => [...prev, task])
    await saveTask(user.id, task)
  }

  async function setTaskDeadline(value) {
    const updated = { ...deadlinePick, deadline: value }
    setDeadlinePick(null)
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
    await saveTask(user.id, updated)
  }

  // Keep the "class starts soon" reminders in step with the timetable. Keyed
  // off scheduleItems so every path that changes it — load, scan import, edit,
  // delete — re-syncs; the sync itself no-ops when nothing actually changed.
  useEffect(() => {
    if (!user) return
    syncClassNotifications(user.id).catch(() => {})
  }, [user, scheduleItems])

  // ── Class attendance → time log ───────────────────────────────────────────
  // Queue up today's classes that have already ended and haven't been answered
  // for. Rebuilt whenever the schedule reloads (i.e. on tab focus), so a class
  // that finished while the app sat open is picked up next time you land here.
  useEffect(() => {
    if (!user || !logSettings.enabled || attendSnoozed.current) return
    const day = todayStr()
    const dow = new Date(day + 'T12:00:00').getDay()
    const now = nowMins()
    const ended = scheduleItems.filter(i => {
      if (!Array.isArray(i.days) || !i.days.includes(dow)) return false
      if (i.semesterStart && day < i.semesterStart) return false
      if (i.semesterEnd   && day > i.semesterEnd)   return false
      const end = timeToMins(i.endTime)
      return end !== null && end <= now
    })
    if (ended.length === 0) { setAttendQueue(q => q.length ? [] : q); return }

    let cancelled = false
    unloggedMarkers(user.id, ended.map(i => `class:${i.id}:${day}`))
      .then(pending => {
        if (cancelled) return
        const open = new Set(pending)
        setAttendQueue(ended.filter(i => open.has(`class:${i.id}:${day}`)).map(i => ({ ...i, day })))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [user, scheduleItems, logSettings.enabled])

  // Write an attended class onto the time log (once per class per day; the
  // marker is claimed even when logging is off, so the prompt won't re-ask).
  async function logAttendedClass(scheduleId, day, title, startTime, endTime) {
    const start = timeToMins(startTime)
    if (start === null) return
    const end = timeToMins(endTime)
    const written = await autoLogSpan(user.id, `class:${scheduleId}:${day}`, {
      day,
      startMins: start,
      durationMins: Math.max(0, (end ?? start) - start),
      text: title,
      kind: 'class',
    }).catch(() => 0)
    if (written > 0) {
      setLogCounts(prev => ({ ...prev, [day]: (prev[day] ?? 0) + written }))
      setLogRefresh(n => n + 1)
    }
  }

  async function answerAttendance(attended) {
    const item = attendQueue[0]
    if (!item) return
    setAttendQueue(q => q.slice(1))
    const marker = `class:${item.id}:${item.day}`
    if (!attended || timeToMins(item.startTime) === null) {
      dismissAutoLog(user.id, marker).catch(() => {})
      return
    }
    // Attended: the class turns green on the Day section as well.
    const key = classCheckKey(item.id, item.day)
    setClassChecks(prev => ({ ...prev, [key]: true }))
    setClassCheck(user.id, key, true).catch(() => {})
    await logAttendedClass(item.id, item.day, item.title, item.startTime, item.endTime)
  }

  // Tick a class off for the day shown. A tick also counts as attended: it
  // goes on the time log (if logging is on) and the after-class prompt won't
  // ask about it. An untick only clears the tick.
  async function toggleClassCheck(ev) {
    const day = logDay
    const key = classCheckKey(ev._scheduleId, day)
    const on = !classChecks[key]
    setClassChecks(prev => ({ ...prev, [key]: on }))
    try {
      await setClassCheck(user.id, key, on)
    } catch (e) {
      setClassChecks(prev => ({ ...prev, [key]: !on }))
      Alert.alert('Could not save', String(e?.message ?? e))
      return
    }
    if (on) {
      setAttendQueue(q => q.filter(i => !(i.id === ev._scheduleId && i.day === day)))
      await logAttendedClass(ev._scheduleId, day, ev.title, ev.startTime, ev.endTime)
    }
  }

  function snoozeAttendance() {
    attendSnoozed.current = true
    setAttendQueue([])
  }

  // A scan is a fresh timetable: it REPLACES the class schedule, so stale
  // classes from last term can't pile up next to the new ones.
  async function handleImportClasses(items) {
    const previous = scheduleItems
    const doImport = async () => {
      setScanOpen(false)
      const saved = items.map(i => ({ ...i, id: genId(), semesterStart: null, semesterEnd: null }))
      setScheduleItems(saved)
      for (const item of previous) await deleteScheduleItem(user.id, item.id)
      for (const item of saved) await saveScheduleItem(user.id, item)
      // Land on today's classes so the result of the scan is what's on screen.
      setLogDay(today)
      switchView('day')
      Alert.alert(
        'Schedule updated',
        `Your schedule now has ${saved.length} recurring class${saved.length === 1 ? '' : 'es'}.`
      )
    }
    if (previous.length === 0) { await doImport(); return }
    Alert.alert(
      'Replace your schedule?',
      `This removes the ${previous.length} class${previous.length === 1 ? '' : 'es'} currently on your schedule and adds the ${items.length} scanned one${items.length === 1 ? '' : 's'}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', style: 'destructive', onPress: () => { doImport() } },
      ]
    )
  }

  // New to-dos come from the quick-add row; this editor is for the details
  // (description, priority, due date) once an item exists.
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
      bucket: editingTask?.bucket ?? bucket,
      deadline: editingTask?.deadline ?? null,
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

  // Writing is limited to the last 3 days, but reading is not: an entry from
  // any past day opens the same full-screen page in read-only mode.
  function openJournal(date) {
    const canWrite = date <= today && date >= addDays(today, -2)
    const existing = journalEntries[date]
    if (!canWrite && !existing) return
    setJReadOnly(!canWrite)
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

  const dayClasses = weekEventsByDay[logDay] ?? []
  const openTaskCount = tasks.filter(t => !t.done).length

  // Day navigation shared by the Day section (weekday names, only the days
  // with classes) and the Time log pane (dates plus how many slots are logged).
  const renderDayPicker = (scheduleMode) => (
    <>
      <View style={s.dayNav}>
        <Pressable onPress={() => setLogDay(d => addDays(d, -1))} hitSlop={10} style={s.dayNavArrowBtn}>
          <Text style={[s.dayNavArrow, { color: theme.accent }]}>‹</Text>
        </Pressable>
        {/* The title is the jump-to-today control — accented while you're
            away from today to show it does something. */}
        <Pressable onPress={() => setLogDay(today)} hitSlop={10} style={{ flex: 1 }}>
          <Text
            style={[s.dayNavTitle, { color: logDay === today ? theme.text : theme.accent }]}
            numberOfLines={1}
          >
            {logDay === today
              ? 'Today'
              : scheduleMode
                ? new Date(logDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })
                : formatDateShort(logDay)}
          </Text>
        </Pressable>
        <Pressable onPress={() => setLogDay(d => addDays(d, 1))} hitSlop={10} style={s.dayNavArrowBtn}>
          <Text style={[s.dayNavArrow, { color: theme.accent }]}>›</Text>
        </Pressable>
      </View>

      <View style={s.dayStrip}>
        {(scheduleMode ? scheduleStripDays : weekDays).map(d => {
          const active  = d === logDay
          const isToday = d === today
          const dObj = new Date(d + 'T12:00:00')
          const count = scheduleMode
            ? (weekEventsByDay[d]?.length ?? 0)
            : (logCounts[d] ?? 0)
          return (
            <Pressable
              key={d}
              onPress={() => setLogDay(d)}
              style={[s.dayChip, {
                backgroundColor: active ? theme.accent : 'transparent',
                // Selected reads as a fill, today as a ring; the border is
                // always present so highlighting can't resize the chip.
                borderColor: !active && isToday ? theme.accent : 'transparent',
              }]}
            >
              <Text style={[s.dayChipName, {
                color: active ? '#fff' : isToday ? theme.accent : theme.subtext,
              }]}>
                {dObj.toLocaleDateString('en-US', { weekday: 'short' })}
              </Text>
              {!scheduleMode && (
                <Text style={[s.dayChipNum, {
                  color: active ? '#fff' : isToday ? theme.accent : theme.text,
                }]}>
                  {dObj.getDate()}
                </Text>
              )}
              <View style={[s.dayChipCount, { backgroundColor: active ? '#ffffff2e' : theme.accent + '15' }]}>
                <Text style={[s.dayChipCountText, { color: active ? '#fff' : theme.accent }]}>{count}</Text>
              </View>
            </Pressable>
          )
        })}
      </View>
    </>
  )

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
          {[['month', 'Month'], ['day', 'Day'], ['tasks', 'To-do'], ...(logSettings.enabled ? [['log', 'Time log']] : [])].map(([mode, label]) => {
            const active = viewMode === 'log' ? mode === 'log' : mode === activeSection
            return (
              <Pressable
                key={mode}
                style={[s.toggleOpt, active && { backgroundColor: theme.accent }]}
                onPress={() => switchView(mode)}
              >
                <Text style={[s.toggleOptText, { color: active ? '#fff' : theme.subtext }]}>
                  {label}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      {/* ── The page: Month, then Day, then To-do ──────────────────────────── */}
      {viewMode === 'month' && (
        <ScrollView
          ref={pageScrollRef}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          scrollEventThrottle={32}
          onScroll={onPageScroll}
          onContentSizeChange={flushPendingScroll}
        >

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
                  const ring = dayStatus[ds]
                  const isToday = ds === today
                  const isFuture = ds > today
                  const isSelected = ds === selected
                  // Green only when every routine due that day was finished.
                  const completed = ring === 'complete', partial = ring === 'partial'
                  const filled = completed || partial
                  const dayEvTypes = [...new Set((eventsByDate[ds] || []).map(e => e.type))]

                  return (
                    <Pressable key={di} style={s.dayCell} onPress={() => setSelected(isSelected ? null : ds)}>
                      <View style={[
                        s.dayCircle,
                        completed && s.circleComplete,
                        partial && s.circlePartial,
                        isToday && !filled && { borderWidth: 2, borderColor: theme.accent },
                        isSelected && !filled && { backgroundColor: theme.accent + '22' },
                      ]}>
                        <Text style={[
                          s.dayNum, { color: theme.text },
                          filled && { color: '#fff', fontWeight: '700' },
                          isToday && !filled && { color: theme.accent, fontWeight: '700' },
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
                        {logSettings.enabled && logCounts[ds] > 0 && (
                          <View style={[s.eventDot, { backgroundColor: '#14b8a6' }]} />
                        )}
                      </View>
                    </Pressable>
                  )
                })}
              </View>
            ))}

            <View style={[s.legendDivider, { backgroundColor: theme.divider }]} />
            <View style={s.legend}>
              {[['#10b981','All routines done'],['#f59e0b','Partial'],[theme.accent,'Event'],['#8b5cf6','Task'],['#0ea5e9','Journal'],...(logSettings.enabled ? [['#14b8a6','Logged']] : [])].map(([c, l]) => (
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

              {/* How much of the day you logged */}
              {logSettings.enabled && slotsPerDay > 0 && selected <= today && (() => {
                const done = logCounts[selected] ?? 0
                const pct = Math.round((done / slotsPerDay) * 100)
                return (
                  <Pressable
                    style={[s.logStatRow, { backgroundColor: '#14b8a610', borderColor: '#14b8a640' }]}
                    onPress={() => { setLogDay(selected); setViewMode('log') }}
                  >
                    <Text style={s.logStatEmoji}>⏱</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.logStatText, { color: theme.text }]}>
                        <Text style={{ color: '#14b8a6', fontWeight: '800' }}>{done}/{slotsPerDay}</Text>
                        {' slots logged'}
                      </Text>
                      <View style={[s.logStatTrack, { backgroundColor: theme.isDark ? '#ffffff14' : '#00000010' }]}>
                        <View style={[s.logStatFill, { width: `${pct}%`, backgroundColor: '#14b8a6' }]} />
                      </View>
                    </View>
                    <Text style={[s.logStatPct, { color: '#14b8a6' }]}>{pct}%</Text>
                  </Pressable>
                )
              })()}
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
                        onPress={() => openJournal(selected)}
                      >
                        {entry.mood && (
                          <Text style={{ fontSize: 20, marginBottom: 4 }}>
                            {MOODS.find(m => m.key === entry.mood)?.emoji}
                          </Text>
                        )}
                        {entry.text ? (
                          <>
                            <Text style={[s.journalPreviewText, { color: theme.subtext }]} numberOfLines={3}>
                              {entry.text}
                            </Text>
                            <Text style={[s.journalPreviewStats, { color: theme.muted }]}>
                              {readingStats(entry.text)}
                              {!canWrite && <Text style={{ color: theme.accent }}>  ·  Tap to read</Text>}
                            </Text>
                          </>
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
          {/* ── Day: the chosen day's classes ── */}
          <View style={s.pageSection} onLayout={e => { sectionY.current.day = e.nativeEvent.layout.y }}>
            <View style={s.pageSectionHeading}>
              <View style={{ flex: 1 }}>
                <Text style={[s.dayScheduleTitle, { color: theme.text }]}>
                  {new Date(logDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })}
                  {logDay === today && <Text style={{ color: theme.accent }}> · Today</Text>}
                </Text>
                <Text style={[s.dayScheduleCount, { color: theme.subtext }]}>
                  {dayClasses.length} {dayClasses.length === 1 ? 'class' : 'classes'}
                </Text>
              </View>
              <View style={s.toggleActions}>
                <Pressable
                  style={[s.toggleActionBtn, { backgroundColor: theme.accent + '20' }]}
                  onPress={() => setScanOpen(true)}
                >
                  <Text style={[s.toggleActionText, { color: theme.accent }]}>✦ Scan</Text>
                </Pressable>
                <Pressable
                  style={[s.toggleActionBtn, { backgroundColor: theme.accent }]}
                  onPress={openAddClass}
                >
                  <Text style={[s.toggleActionText, { color: '#fff' }]}>＋ Class</Text>
                </Pressable>
              </View>
            </View>

            <View style={[s.dayPickerCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              {renderDayPicker(true)}
            </View>

            <View style={s.dayScheduleList}>
              {dayClasses.length === 0 ? (
                <View style={[s.dayScheduleEmpty, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
                  <Text style={s.dayScheduleEmptyIcon}>☀️</Text>
                  <Text style={[s.dayScheduleEmptyTitle, { color: theme.text }]}>No classes scheduled</Text>
                  <Text style={[s.dayScheduleEmptyText, { color: theme.subtext }]}>Enjoy the open time, or add a class above.</Text>
                </View>
              ) : dayClasses.map(ev => {
                const courseCode = ev.meta?.courseCode || (ev.kind === 'event' ? 'EVENT' : ev.title)
                const classType = ev.meta?.type || (ev.kind === 'event' ? 'Calendar' : 'Class')
                const courseName = ev.meta?.courseName && ev.meta.courseName !== courseCode
                  ? ev.meta.courseName
                  : ev.title
                // A ticked class goes green. Only classes (not one-off events)
                // can be ticked, and only for today or earlier.
                const canCheck = ev.kind === 'class' && logDay <= today
                const checked = canCheck && !!classChecks[classCheckKey(ev._scheduleId, logDay)]
                const accent = checked ? '#10b981' : ev.color
                return (
                  <View key={ev.id} style={s.dayClassRow}>
                    <View style={s.dayClassTimeCol}>
                      <Text style={[s.dayClassStart, { color: theme.subtext }]}>{fmtTime(ev.startTime)}</Text>
                      <View style={[s.dayClassTimeLine, { backgroundColor: theme.divider }]} />
                      <Text style={[s.dayClassEnd, { color: theme.muted }]}>{fmtTime(ev.endTime)}</Text>
                    </View>
                    <Pressable
                      onPress={() => handleWeekEventPress(ev)}
                      style={[s.dayClassCard, {
                        backgroundColor: accent + (theme.isDark ? '24' : '16'),
                        borderLeftColor: accent,
                        borderColor: accent + '40',
                      }]}
                    >
                      <View style={s.dayClassTopRow}>
                        <View style={[s.dayCoursePill, { backgroundColor: accent }]}>
                          <Text style={s.dayCoursePillText} numberOfLines={1}>{courseCode}</Text>
                        </View>
                        <View style={[s.dayTypePill, { backgroundColor: accent + '20' }]}>
                          <Text style={[s.dayTypePillText, { color: accent }]}>{classType}</Text>
                        </View>
                        <Text style={[s.dayDuration, { color: accent }]}>{formatDuration(ev.startTime, ev.endTime)}</Text>
                        {canCheck && (
                          <Pressable
                            onPress={() => toggleClassCheck(ev)}
                            hitSlop={10}
                            style={[s.dayCheck, {
                              borderColor: checked ? '#10b981' : ev.color + '80',
                              backgroundColor: checked ? '#10b981' : 'transparent',
                            }]}
                          >
                            {checked && <Text style={s.dayCheckMark}>✓</Text>}
                          </Pressable>
                        )}
                      </View>
                      <Text style={[s.dayClassName, { color: theme.text }]} numberOfLines={2}>{courseName}</Text>
                      {!!ev.location && (
                        <Text style={[s.dayClassLocation, { color: theme.subtext }]} numberOfLines={1}>⌖ {ev.location}</Text>
                      )}
                      <Text style={[s.dayClassRange, { color: theme.muted }]}>
                        {fmtTime(ev.startTime)} – {fmtTime(ev.endTime)}
                        {checked && <Text style={s.dayClassDone}>   ✓ Attended</Text>}
                      </Text>
                    </Pressable>
                  </View>
                )
              })}
            </View>
          </View>

          {/* ── To-do ── */}
          <View style={s.pageSection} onLayout={e => { sectionY.current.tasks = e.nativeEvent.layout.y }}>
            <View style={s.pageSectionHeading}>
              <View style={{ flex: 1 }}>
                <Text style={[s.dayScheduleTitle, { color: theme.text }]}>To-do</Text>
                <Text style={[s.dayScheduleCount, { color: theme.subtext }]}>
                  {openTaskCount === 0 ? 'Nothing open' : `${openTaskCount} open`}
                </Text>
              </View>
            </View>

            <View style={s.bucketBar}>
              {BUCKETS.map(b => {
                const active = b.key === bucket
                const count = bucketCounts[b.key] ?? 0
                return (
                  <Pressable
                    key={b.key}
                    onPress={() => setBucket(b.key)}
                    style={[s.bucketBtn, {
                      backgroundColor: active ? theme.accent : theme.card,
                      borderColor: active ? theme.accent : theme.cardBorder,
                    }]}
                  >
                    <Text style={s.bucketEmoji}>{b.emoji}</Text>
                    <Text style={[s.bucketLabel, { color: active ? '#fff' : theme.subtext }]}>
                      {b.label}{count > 0 ? ` ${count}` : ''}
                    </Text>
                  </Pressable>
                )
              })}
            </View>

            <View style={[s.addTodoRow, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <TextInput
                value={draftTodo}
                onChangeText={setDraftTodo}
                placeholder={`Add to ${BUCKETS.find(b => b.key === bucket).label}…`}
                placeholderTextColor={theme.muted}
                returnKeyType="done"
                onSubmitEditing={addQuickTodo}
                style={[s.addTodoInput, { color: theme.text }]}
              />
              <Pressable onPress={addQuickTodo} hitSlop={8}>
                <Text style={[s.addTodoPlus, { color: draftTodo.trim() ? theme.accent : theme.muted }]}>＋</Text>
              </Pressable>
            </View>

            {bucketTasks.length === 0 ? (
              <View style={[s.taskEmptyCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
                <Text style={{ fontSize: 32, textAlign: 'center', marginBottom: 8 }}>
                  {BUCKETS.find(b => b.key === bucket).emoji}
                </Text>
                <Text style={[s.emptyText, { color: theme.muted, textAlign: 'center' }]}>
                  {BUCKETS.find(b => b.key === bucket).hint}
                </Text>
              </View>
            ) : bucketTasks.map(task => {
              const pri = PRIORITY[task.priority] ?? PRIORITY.none
              const overdue = isOverdue(task)
              const canDeadline = DEADLINE_BUCKETS.includes(task.bucket ?? 'today')
              return (
                <Pressable
                  key={task.id}
                  style={[s.taskRow, {
                    backgroundColor: theme.card,
                    borderColor: overdue ? '#ef4444' : theme.cardBorder,
                    borderLeftColor: pri.color,
                    opacity: task.done ? 0.55 : 1,
                  }]}
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
                    {task.deadline ? (
                      <Text style={[s.taskDueLabel, { color: overdue ? '#ef4444' : theme.subtext }]}>
                        {overdue ? `⚠ overdue — was ${deadlineLabel(task.deadline)}` : `⏰ ${deadlineLabel(task.deadline)}`}
                      </Text>
                    ) : null}
                  </View>
                  <View style={s.taskRowRight}>
                    {canDeadline && !task.done && (
                      <Pressable onPress={() => setDeadlinePick(task)} hitSlop={10}>
                        <Text style={{ fontSize: 15, opacity: task.deadline ? 1 : 0.45 }}>⏰</Text>
                      </Pressable>
                    )}
                    <View style={[s.taskPriorityDot, { backgroundColor: pri.color }]} />
                    <Pressable onPress={() => handleDeleteTask(task)} hitSlop={12}>
                      <Text style={s.deleteBtnText}>✕</Text>
                    </Pressable>
                  </View>
                </Pressable>
              )
            })}
          </View>
        </ScrollView>
      )}

      {/* ── Time log pane ──────────────────────────────────────────────────── */}
      {viewMode === 'log' && (
        <View style={[s.dayPicker, { backgroundColor: theme.card, borderBottomColor: theme.divider }]}>
          {renderDayPicker(false)}
        </View>
      )}

      {/* Time log — one row per slot for the chosen day. */}
      {viewMode === 'log' && logSettings.enabled && (
        <DayLogTimeline
          key={logDay}
          userId={user.id}
          day={logDay}
          todayStr={today}
          settings={logSettings}
          refreshKey={logRefresh}
          onImported={load}
          onCountsChange={(filled) => setLogCounts(prev => (
            prev[logDay] === filled ? prev : { ...prev, [logDay]: filled }
          ))}
        />
      )}

      {/* ── To-do view ────────────────────────────────────────────────────── */}

      {/* ── Deadline picker ───────────────────────────────────────────────── */}
      <Modal visible={deadlinePick !== null} transparent animationType="fade" onRequestClose={() => setDeadlinePick(null)}>
        <Pressable style={s.pickerBackdrop} onPress={() => setDeadlinePick(null)}>
          <View style={[s.pickerCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <Text style={[s.pickerTitle, { color: theme.text }]} numberOfLines={1}>
              Deadline for "{deadlinePick?.title}"
            </Text>
            <ScrollView style={{ maxHeight: 360 }}>
              <Pressable
                onPress={() => setTaskDeadline(null)}
                style={[s.pickerRow, !deadlinePick?.deadline && { backgroundColor: theme.accent + '22' }]}
              >
                <Text style={{ color: !deadlinePick?.deadline ? theme.accent : theme.text, fontWeight: !deadlinePick?.deadline ? '700' : '500', fontSize: 14 }}>
                  No deadline
                </Text>
              </Pressable>
              {(deadlinePick ? deadlineOptions(deadlinePick.bucket ?? 'today') : []).map(opt => {
                const sel = deadlinePick?.deadline === opt.value
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setTaskDeadline(opt.value)}
                    style={[s.pickerRow, sel && { backgroundColor: theme.accent + '22' }]}
                  >
                    <Text style={{ color: sel ? theme.accent : theme.text, fontWeight: sel ? '700' : '500', fontSize: 14 }}>
                      {opt.label}
                    </Text>
                    {sel && <Text style={{ color: theme.accent, fontWeight: '800' }}>✓</Text>}
                  </Pressable>
                )
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <ScanScheduleModal
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
        onImport={handleImportClasses}
      />

      {attendQueue.length > 0 && !scanOpen && !classOpen && (
        <ClassAttendancePrompt
          item={attendQueue[0]}
          index={0}
          total={attendQueue.length}
          onAttended={() => answerAttendance(true)}
          onSkipped={() => answerAttendance(false)}
          onClose={snoozeAttendance}
        />
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

      {/* ── Add / Edit Class modal ─────────────────────────────────────────── */}
      <Modal visible={classOpen} transparent animationType="slide" onRequestClose={closeClassSheet}>
        <KeyboardAvoidingView style={s.modalKAV} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFillObject, s.modalBg, { opacity: classBackdrop }]}
          />
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeClassSheet} />
          <Animated.View
            style={[s.modalSheet, s.classSheet, {
              backgroundColor: theme.card,
              transform: [{ translateY: classDragY }],
            }]}
          >
            {/* Grab area: the whole header, not just the 4px bar, so the sheet
                can be pulled down even with the keyboard covering the rest. */}
            <View {...classHandlePan.panHandlers} style={s.sheetGrabArea}>
              <View style={[s.modalHandle, { backgroundColor: theme.divider }]} />
              <Text style={[s.modalTitle, { color: theme.text }]}>{editingClass ? 'Edit Class' : 'Add Class'}</Text>
            </View>
            <View {...classBodyPan.panHandlers} style={s.sheetFormWrap}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                bounces={false}
                scrollEventThrottle={16}
                onScroll={e => { classAtTop.current = e.nativeEvent.contentOffset.y <= 0 }}
              >
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
                  <Text style={s.saveBtnText}>
                    {cSaving ? 'Saving…' : editingClass ? 'Save Changes' : 'Add to Schedule'}
                  </Text>
                </Pressable>
                {!!editingClass && (
                  <Pressable onPress={handleDeleteClass} hitSlop={8} style={s.deleteClassBtn}>
                    <Text style={s.deleteClassText}>Delete Class</Text>
                  </Pressable>
                )}
              </ScrollView>
            </View>
          </Animated.View>
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
            {jReadOnly ? (
              // Spacer the width of the Save button, so the title stays centered.
              <View style={{ width: 44 }} />
            ) : (
              <Pressable onPress={handleSaveJournal} disabled={jSaving} hitSlop={12}>
                <Text style={[s.journalSave, { opacity: jSaving ? 0.5 : 1 }]}>
                  {jSaving ? 'Saving…' : 'Save'}
                </Text>
              </Pressable>
            )}
          </View>

          <View style={s.journalBody}>
            {/* Reading an old entry with no mood: skip the empty picker. */}
            {(!jReadOnly || jMood) && (
              <>
                <Text style={[s.fieldLabel, { color: theme.muted }]}>MOOD</Text>
                <View style={s.moodRow}>
                  {(jReadOnly ? MOODS.filter(m => m.key === jMood) : MOODS).map(m => (
                    <Pressable
                      key={m.key}
                      disabled={jReadOnly}
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
              </>
            )}

            <View style={s.entryLabelRow}>
              <Text style={[s.fieldLabel, { color: theme.muted }]}>ENTRY</Text>
              <Text style={[s.entryStats, { color: theme.muted }]}>{readingStats(jText)}</Text>
            </View>
            <TextInput
              style={[s.journalTextArea, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
              placeholder={jReadOnly ? '(no text for this day)' : "What's on your mind today?"}
              placeholderTextColor={theme.muted}
              value={jText}
              onChangeText={setJText}
              editable={!jReadOnly}
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
  // Seven entries never fit one row on a phone — wrap instead of letting the
  // last labels get clipped.
  legend: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center',
    columnGap: 14, rowGap: 8, paddingHorizontal: 6,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
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

  // Shared day picker
  dayPicker: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 10 },
  dayNav: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  dayNavArrowBtn: { paddingHorizontal: 8, paddingVertical: 2 },
  dayNavArrow: { fontSize: 26, fontWeight: '700', lineHeight: 28 },
  dayNavTitle: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  dayStrip: { flexDirection: 'row', gap: 5, paddingHorizontal: 10 },
  dayChip: {
    flex: 1, minWidth: 40, alignItems: 'center', gap: 1, paddingVertical: 7,
    borderRadius: 15, borderWidth: 1.5,
  },
  dayChipName: { fontSize: 10.5, fontWeight: '700' },
  dayChipNum: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  dayChipCount: { minWidth: 20, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  dayChipCountText: { fontSize: 10.5, lineHeight: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },

  // Day schedule agenda
  // Day and To-do sit under the month grid on one page; each opens with a
  // heading row (title and count on the left, actions on the right).
  pageSection: { marginTop: 10 },
  pageSectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 2, marginBottom: 12 },
  dayPickerCard: { borderRadius: 20, borderWidth: 1, paddingTop: 2, paddingBottom: 10, marginBottom: 14 },
  dayScheduleList: { gap: 14 },
  dayScheduleTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  dayScheduleCount: { fontSize: 13.5, fontWeight: '600', marginTop: 2 },
  dayScheduleEmpty: { alignItems: 'center', borderRadius: 20, borderWidth: 1, padding: 28, gap: 6 },
  dayScheduleEmptyIcon: { fontSize: 28 },
  dayScheduleEmptyTitle: { fontSize: 16, fontWeight: '800' },
  dayScheduleEmptyText: { fontSize: 12.5, fontWeight: '500', textAlign: 'center' },
  dayClassRow: { flexDirection: 'row', gap: 10, minHeight: 142 },
  dayClassTimeCol: { width: 74, alignItems: 'flex-end' },
  dayClassStart: { fontSize: 12.5, fontWeight: '700', fontVariant: ['tabular-nums'], paddingTop: 12 },
  dayClassTimeLine: { width: 1, flex: 1, marginRight: 5, marginVertical: 7 },
  dayClassEnd: { fontSize: 11.5, fontWeight: '600', fontVariant: ['tabular-nums'], paddingBottom: 8 },
  dayClassCard: { flex: 1, borderRadius: 19, borderWidth: 1, borderLeftWidth: 6, padding: 14, gap: 8 },
  dayClassTopRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dayCoursePill: { maxWidth: '52%', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 5 },
  dayCoursePillText: { color: '#fff', fontSize: 11.5, fontWeight: '900', letterSpacing: 0.5 },
  dayTypePill: { borderRadius: 9, paddingHorizontal: 9, paddingVertical: 5 },
  dayTypePillText: { fontSize: 11, fontWeight: '800' },
  dayDuration: { marginLeft: 'auto', fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  dayClassName: { fontSize: 17, lineHeight: 21, fontWeight: '800', letterSpacing: -0.25 },
  dayClassLocation: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  dayClassRange: { fontSize: 11.5, fontWeight: '600', fontVariant: ['tabular-nums'] },
  dayClassDone: { color: '#10b981', fontWeight: '800' },
  dayCheck: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 2, marginLeft: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  dayCheckMark: { color: '#fff', fontWeight: '900', fontSize: 13, lineHeight: 15 },

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
  // Full-bleed header strip so the grabber's touch target is the whole width,
  // not the 40px bar. Negative margin cancels the sheet's own side padding.
  sheetGrabArea: { marginHorizontal: -24, paddingHorizontal: 24, paddingTop: 4 },
  // Lets the form shrink inside the sheet's maxHeight so the ScrollView stays
  // bounded now that the header sits outside it.
  sheetFormWrap: { flexShrink: 1 },
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
  deleteClassBtn: { alignItems: 'center', paddingVertical: 12, marginBottom: 4 },
  deleteClassText: { fontSize: 14, fontWeight: '700', color: '#ef4444' },

  // Tasks view
  // Week view pane switcher (Time log / Schedule)
  paneBar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  paneBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 12,
    borderBottomWidth: 2.5, borderBottomColor: 'transparent',
  },
  paneBtnText: { fontSize: 13.5, fontWeight: '700' },

  // Time log day picker
  logDayBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  logDayArrowBtn: { paddingHorizontal: 12, paddingVertical: 2 },
  logDayArrow: { fontSize: 26, fontWeight: '700', lineHeight: 30 },
  logDayLabel: { fontSize: 15, fontWeight: '800', textAlign: 'center', letterSpacing: -0.2 },

  // "x/28 slots logged" row in the month day detail
  logStatRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 12,
  },
  logStatEmoji: { fontSize: 17 },
  logStatText: { fontSize: 13, fontWeight: '600' },
  logStatTrack: { height: 6, borderRadius: 3, marginTop: 7, overflow: 'hidden' },
  logStatFill: { height: 6, borderRadius: 3 },
  logStatPct: { fontSize: 14, fontWeight: '800' },

  // To-do buckets
  bucketBar: { flexDirection: 'row', gap: 6, paddingBottom: 8 },
  bucketBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2,
    paddingVertical: 8, borderRadius: 12, borderWidth: 1,
  },
  bucketEmoji: { fontSize: 14 },
  bucketLabel: { fontSize: 10.5, fontWeight: '800' },
  addTodoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 10,
    paddingLeft: 14, paddingRight: 12, paddingVertical: 2,
    borderWidth: 1, borderRadius: 14,
  },
  addTodoInput: { flex: 1, fontSize: 14, paddingVertical: 11 },
  addTodoPlus: { fontSize: 22, fontWeight: '700' },

  // Deadline picker
  pickerBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  pickerCard: { alignSelf: 'stretch', borderWidth: 1, borderRadius: 20, padding: 18 },
  pickerTitle: { fontSize: 15, fontWeight: '800', marginBottom: 10 },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 11, paddingHorizontal: 10, borderRadius: 10,
  },

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
  journalPreviewStats: { fontSize: 11, fontWeight: '600', marginTop: 6 },
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
  entryLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  entryStats: { fontSize: 11, fontWeight: '600', marginBottom: 8, marginTop: 4 },
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
