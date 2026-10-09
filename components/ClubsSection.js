import { useState, useCallback, useRef } from 'react'
import {
  View, Text, TextInput, Pressable, Modal, ScrollView, StyleSheet,
  Alert, KeyboardAvoidingView, Platform, Animated, PanResponder, Keyboard, Dimensions,
} from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useTheme } from '../lib/ThemeContext'
import { getClubs, saveClub, deleteClub } from '../lib/clubsStorage'
import { getScheduleItems, saveScheduleItem, deleteScheduleItem } from '../lib/storage'
import { syncClassNotifications } from '../lib/classNotifications'

// Clubs & societies on the Routines home page. Each club can have weekly
// meetings; a meeting is saved as an ordinary schedule item tagged in meta,
// so it shows on the calendar as a class in the slot and room given here and
// gets the same reminders and attendance prompts.

const CLUB_COLOR = '#8b5cf6'
const CLUB_EMOJIS = ['🎓', '🤝', '🎭', '⚽', '🏀', '🎨', '💻', '🎵', '📚', '🌍', '🧪', '🎤', '♟️', '🏛️']
const DAY_BTNS = [
  { label: 'M', value: 1 }, { label: 'T', value: 2 }, { label: 'W', value: 3 }, { label: 'Th', value: 4 },
  { label: 'F', value: 5 }, { label: 'Sa', value: 6 }, { label: 'Su', value: 0 },
]
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// Each club's meetings share one colour on the calendar.
const MEETING_COLORS = ['#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#22c55e', '#3b82f6', '#eab308', '#ef4444']

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2) }

function fmtTime(t) {
  const [h, m] = String(t ?? '').split(':').map(Number)
  if (isNaN(h)) return ''
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function parseFormTime(h, m, ap) {
  const hi = parseInt(h, 10), mi = parseInt(m, 10)
  if (isNaN(hi) || isNaN(mi) || hi < 1 || hi > 12 || mi < 0 || mi > 59) return null
  let h24 = hi
  if (ap === 'PM' && hi < 12) h24 += 12
  if (ap === 'AM' && hi === 12) h24 = 0
  return `${String(h24).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
}

// Sort key: Monday first, then start time.
const meetingOrder = it => `${(it.days?.[0] + 6) % 7}${it.startTime ?? ''}`

function colorFor(clubs, clubId) {
  const i = clubs.findIndex(c => c.id === clubId)
  return MEETING_COLORS[(i < 0 ? 0 : i) % MEETING_COLORS.length]
}

// The schedule item a meeting becomes. Title and meta carry the club's name so
// the calendar's class card shows it in the course pill with a "Club" type.
function meetingItem(club, m, color) {
  return {
    id: genId(),
    title: club.name,
    location: m.location || null,
    days: [m.day],
    startTime: m.startTime,
    endTime: m.endTime,
    color,
    semesterStart: null,
    semesterEnd: null,
    meta: { type: 'Club', clubId: club.id, courseCode: club.name, courseName: club.name },
  }
}

function TimeField({ h, m, ap, onH, onM, onAp, theme }) {
  return (
    <View style={c.timeField}>
      <TextInput
        style={[c.timeInput, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
        value={h} onChangeText={onH} keyboardType="number-pad" maxLength={2} placeholder="8" placeholderTextColor={theme.muted}
      />
      <Text style={[c.timeColon, { color: theme.muted }]}>:</Text>
      <TextInput
        style={[c.timeInput, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
        value={m} onChangeText={onM} keyboardType="number-pad" maxLength={2} placeholder="00" placeholderTextColor={theme.muted}
      />
      <View style={[c.apToggle, { backgroundColor: theme.isDark ? '#1c1c32' : '#f0f0f8' }]}>
        {['AM', 'PM'].map(v => (
          <Pressable key={v} style={[c.apBtn, ap === v && { backgroundColor: CLUB_COLOR }]} onPress={() => onAp(v)}>
            <Text style={[c.apText, { color: ap === v ? '#fff' : theme.subtext }]}>{v}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function ClubEditor({ club, isNew, meetings, theme, onSave, onClose }) {
  const [name, setName]   = useState(club.name ?? '')
  const [emoji, setEmoji] = useState(club.emoji ?? '🎓')
  const [role, setRole]   = useState(club.role ?? '')
  // Existing meetings the user takes off, and new ones waiting for Save.
  const [removed, setRemoved] = useState(new Set())
  const [drafts, setDrafts]   = useState([])
  // The add-meeting form
  const [day, setDay]   = useState(null)
  const [sh, setSH] = useState('6');  const [sm, setSM] = useState('00'); const [sap, setSAp] = useState('PM')
  const [eh, setEH] = useState('7');  const [em, setEM] = useState('00'); const [eap, setEAp] = useState('PM')
  const [loc, setLoc] = useState('')

  function addDraft() {
    if (day === null) { Alert.alert('Pick a day', 'Which day of the week does it meet?'); return }
    const startTime = parseFormTime(sh, sm, sap)
    const endTime = parseFormTime(eh, em, eap)
    if (!startTime || !endTime) { Alert.alert('Check the times', 'Use hours 1 to 12 and minutes 0 to 59.'); return }
    if (endTime <= startTime) { Alert.alert('Check the times', 'The meeting has to end after it starts.'); return }
    setDrafts(prev => [...prev, { tempId: genId(), day, startTime, endTime, location: loc.trim() }])
    setDay(null); setLoc('')
  }

  function save() {
    if (!name.trim()) { Alert.alert('Name the club', 'What is the club or society called?'); return }
    onSave({
      club: { ...club, name: name.trim(), emoji: emoji.trim() || '🎓', role: role.trim() },
      added: drafts,
      removed: [...removed],
      kept: meetings.filter(m => !removed.has(m.id)),
    })
  }

  const live = meetings.filter(m => !removed.has(m.id))

  // Drag-down-to-dismiss, same mechanics as the calendar's class sheet: the
  // handle and title are a real grab area, and the form itself can be pulled
  // down once it is scrolled to the top. Starting a drag closes the keyboard,
  // since that is what the user is reaching past.
  const dragY = useRef(new Animated.Value(0)).current
  const backdrop = useRef(dragY.interpolate({
    inputRange: [0, 260], outputRange: [1, 0], extrapolate: 'clamp',
  })).current
  const atTop = useRef(true)
  // Slide the rest of the way out, then let the parent unmount the modal.
  const closeSheet = () => {
    Keyboard.dismiss()
    Animated.timing(dragY, {
      toValue: Dimensions.get('window').height, duration: 180, useNativeDriver: true,
    }).start(() => onClose())
  }
  // The pan handlers are created once, so they reach the latest close through a ref.
  const closeRef = useRef(closeSheet)
  closeRef.current = closeSheet
  const dragHandlers = useRef({
    onPanResponderGrant: () => { Keyboard.dismiss() },
    onPanResponderMove: (_, g) => { dragY.setValue(Math.max(0, g.dy)) },
    // The ScrollView asks for the gesture back once it starts moving; refusing
    // keeps a pull that began as a dismissal a dismissal.
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_, g) => {
      // A long pull or a quick flick closes; anything shorter snaps back.
      if (g.dy > 120 || (g.dy > 40 && g.vy > 0.6)) closeRef.current()
      else Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start()
    },
    onPanResponderTerminate: () => {
      Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start()
    },
  }).current
  // The handle and title: always draggable.
  const handlePan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    ...dragHandlers,
  })).current
  // The form body: only a clear downward pull from the top of the scroll, so
  // ordinary scrolling and field taps are untouched.
  const bodyPan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => atTop.current && g.dy > 8 && g.dy > Math.abs(g.dx),
    ...dragHandlers,
  })).current

  return (
    <Modal visible transparent animationType="slide" onRequestClose={closeSheet}>
      <KeyboardAvoidingView style={c.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View pointerEvents="none" style={[c.overlayBg, { opacity: backdrop }]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} />
        <Animated.View style={[c.sheet, { backgroundColor: theme.card, transform: [{ translateY: dragY }] }]}>
          <View {...handlePan.panHandlers} style={c.grabArea}>
            <View style={[c.handle, { backgroundColor: theme.divider }]} />
            <Text style={[c.sheetTitle, { color: theme.text }]}>{isNew ? 'Add a club or society' : `Edit ${club.name}`}</Text>
          </View>
          <View {...bodyPan.panHandlers} style={c.bodyWrap}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 8 }}
            bounces={false}
            scrollEventThrottle={16}
            onScroll={e => { atTop.current = e.nativeEvent.contentOffset.y <= 0 }}
          >

            <Text style={[c.fieldLabel, { color: theme.muted }]}>NAME</Text>
            <TextInput
              style={[c.input, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
              placeholder='e.g. "Robotics Society"' placeholderTextColor={theme.muted}
              value={name} onChangeText={setName} returnKeyType="done" autoFocus={isNew}
            />

            <Text style={[c.fieldLabel, { color: theme.muted }]}>ICON</Text>
            <View style={c.emojiRow}>
              {CLUB_EMOJIS.map(e => (
                <Pressable
                  key={e}
                  style={[c.emojiBtn, { backgroundColor: theme.isDark ? '#1c1c32' : '#f0f0f8' }, emoji === e && { borderColor: CLUB_COLOR, backgroundColor: CLUB_COLOR + '22' }]}
                  onPress={() => setEmoji(e)}
                >
                  <Text style={{ fontSize: 18 }}>{e}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[c.fieldLabel, { color: theme.muted }]}>YOUR ROLE (optional)</Text>
            <TextInput
              style={[c.input, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
              placeholder='e.g. "Member", "Treasurer"' placeholderTextColor={theme.muted}
              value={role} onChangeText={setRole} returnKeyType="done"
            />

            <Text style={[c.fieldLabel, { color: theme.muted, marginTop: 6 }]}>WEEKLY MEETINGS</Text>
            <Text style={[c.hint, { color: theme.muted }]}>
              Each one goes on your calendar as a class in that slot and room.
            </Text>
            {live.length === 0 && drafts.length === 0 && (
              <Text style={[c.emptyMeetings, { color: theme.muted }]}>No meetings yet. Add one below if the club meets weekly.</Text>
            )}
            {live.map(m => (
              <View key={m.id} style={[c.meetingRow, { borderBottomColor: theme.divider }]}>
                <View style={[c.meetingDot, { backgroundColor: m.color ?? CLUB_COLOR }]} />
                <Text style={[c.meetingText, { color: theme.text }]}>
                  {DAY_NAMES[m.days?.[0]] ?? '?'} · {fmtTime(m.startTime)} – {fmtTime(m.endTime)}
                  {m.location ? <Text style={{ color: theme.subtext }}>  ·  {m.location}</Text> : null}
                </Text>
                <Pressable onPress={() => setRemoved(prev => new Set(prev).add(m.id))} hitSlop={10}>
                  <Text style={[c.remove, { color: theme.muted }]}>✕</Text>
                </Pressable>
              </View>
            ))}
            {drafts.map(m => (
              <View key={m.tempId} style={[c.meetingRow, { borderBottomColor: theme.divider }]}>
                <View style={[c.meetingDot, { backgroundColor: CLUB_COLOR + '66' }]} />
                <Text style={[c.meetingText, { color: theme.text }]}>
                  {DAY_NAMES[m.day]} · {fmtTime(m.startTime)} – {fmtTime(m.endTime)}
                  {m.location ? <Text style={{ color: theme.subtext }}>  ·  {m.location}</Text> : null}
                  <Text style={{ color: CLUB_COLOR, fontSize: 11, fontWeight: '700' }}>  new</Text>
                </Text>
                <Pressable onPress={() => setDrafts(prev => prev.filter(d => d.tempId !== m.tempId))} hitSlop={10}>
                  <Text style={[c.remove, { color: theme.muted }]}>✕</Text>
                </Pressable>
              </View>
            ))}

            <View style={[c.addMeetingBox, { borderColor: CLUB_COLOR + '44', backgroundColor: CLUB_COLOR + '0d' }]}>
              <Text style={[c.addMeetingTitle, { color: CLUB_COLOR }]}>ADD A MEETING</Text>
              <View style={c.daysRow}>
                {DAY_BTNS.map(d => {
                  const on = day === d.value
                  return (
                    <Pressable
                      key={d.value}
                      style={[c.dayBtn, { backgroundColor: on ? CLUB_COLOR : (theme.isDark ? '#1c1c32' : '#f0f0f8') }]}
                      onPress={() => setDay(on ? null : d.value)}
                    >
                      <Text style={[c.dayBtnText, { color: on ? '#fff' : theme.subtext }]}>{d.label}</Text>
                    </Pressable>
                  )
                })}
              </View>
              <Text style={[c.fieldLabel, { color: theme.muted }]}>STARTS</Text>
              <TimeField h={sh} m={sm} ap={sap} onH={setSH} onM={setSM} onAp={setSAp} theme={theme} />
              <Text style={[c.fieldLabel, { color: theme.muted, marginTop: 10 }]}>ENDS</Text>
              <TimeField h={eh} m={em} ap={eap} onH={setEH} onM={setEM} onAp={setEAp} theme={theme} />
              <Text style={[c.fieldLabel, { color: theme.muted, marginTop: 10 }]}>ROOM / LOCATION (optional)</Text>
              <TextInput
                style={[c.input, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text, marginBottom: 10 }]}
                placeholder='e.g. "Student Union 204"' placeholderTextColor={theme.muted}
                value={loc} onChangeText={setLoc} returnKeyType="done" onSubmitEditing={addDraft}
              />
              <Pressable style={[c.addMeetingBtn, { borderColor: CLUB_COLOR }]} onPress={addDraft}>
                <Text style={[c.addMeetingBtnText, { color: CLUB_COLOR }]}>＋  Add this meeting</Text>
              </Pressable>
            </View>

            <Pressable style={[c.saveBtn, { backgroundColor: CLUB_COLOR }]} onPress={save}>
              <Text style={c.saveBtnText}>{isNew ? 'Add club' : 'Save changes'}</Text>
            </Pressable>
            <Pressable style={c.cancelBtn} onPress={closeSheet}>
              <Text style={[c.cancelText, { color: theme.subtext }]}>Cancel</Text>
            </Pressable>
          </ScrollView>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export default function ClubsSection({ userId }) {
  const { theme } = useTheme()
  const [clubs, setClubs] = useState([])
  const [items, setItems] = useState([])       // every schedule item; meetings are the ones tagged with a clubId
  const [editing, setEditing] = useState(null) // { club, isNew } | null

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const [cl, sc] = await Promise.all([getClubs(userId), getScheduleItems(userId)])
      setClubs(cl)
      setItems(sc)
    } catch {}
  }, [userId])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const meetingsOf = clubId => items
    .filter(i => i?.meta?.clubId === clubId)
    .sort((a, b) => meetingOrder(a).localeCompare(meetingOrder(b)))

  function confirmDelete(club) {
    Alert.alert(`Remove ${club.name}?`, 'Its meetings come off your calendar too.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          const mine = meetingsOf(club.id)
          setClubs(prev => prev.filter(x => x.id !== club.id))
          setItems(prev => prev.filter(i => i?.meta?.clubId !== club.id))
          try {
            await deleteClub(userId, club.id)
            for (const m of mine) await deleteScheduleItem(userId, m.id)
            syncClassNotifications(userId)
          } catch (e) {
            Alert.alert('Could not remove', String(e?.message ?? e))
            load()
          }
        },
      },
    ])
  }

  async function handleSave({ club, added, removed, kept }) {
    setEditing(null)
    const known = clubs.some(x => x.id === club.id) ? clubs : [...clubs, club]
    const color = colorFor(known, club.id)
    try {
      await saveClub(userId, club)
      for (const id of removed) await deleteScheduleItem(userId, id)
      for (const m of added) await saveScheduleItem(userId, meetingItem(club, m, color))
      // A renamed club renames its meetings on the calendar too.
      for (const it of kept) {
        if (it.title !== club.name || it.meta?.courseCode !== club.name) {
          await saveScheduleItem(userId, {
            ...it, title: club.name,
            meta: { ...(it.meta ?? {}), type: 'Club', clubId: club.id, courseCode: club.name, courseName: club.name },
          })
        }
      }
      syncClassNotifications(userId)
    } catch (e) {
      Alert.alert('Could not save', String(e?.message ?? e))
    }
    load()
  }

  return (
    <View>
      <View style={[c.groupHeaderRow, { marginTop: 18 }]}>
        <View style={[c.groupChip, { backgroundColor: CLUB_COLOR + '1c' }]}>
          <Text style={c.groupHeaderEmoji}>🎓</Text>
          <Text style={[c.groupHeaderText, { color: CLUB_COLOR }]}>CLUBS & SOCIETIES</Text>
        </View>
        <Text style={[c.groupHeaderHint, { color: theme.muted }]}>meetings land on your calendar</Text>
        <View style={[c.groupRule, { backgroundColor: CLUB_COLOR + '2a' }]} />
      </View>

      {clubs.length === 0 && (
        <Text style={[c.groupEmptyHint, { color: theme.muted }]}>
          Not in any yet. Add a club, and its weekly meetings show up on your calendar as classes in the room you give.
        </Text>
      )}

      {clubs.map(club => {
        const meetings = meetingsOf(club.id)
        const color = colorFor(clubs, club.id)
        return (
          <View
            key={club.id}
            style={[c.card, {
              backgroundColor: theme.card, borderColor: theme.cardBorder,
              shadowColor: theme.isDark ? 'transparent' : '#0d1b5e',
            }]}
          >
            <View style={[c.cardStripe, { backgroundColor: color }]} />
            <View style={c.cardContent}>
              <View style={c.cardTop}>
                <View style={[c.emojiCircle, { backgroundColor: theme.isDark ? theme.bg : color + '1a' }]}>
                  <Text style={c.emoji}>{club.emoji || '🎓'}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={[c.cardName, { color: theme.text }]}>{club.name}</Text>
                  <Text style={[c.cardStatus, { color: theme.subtext }]}>
                    {club.role ? `${club.role} · ` : ''}
                    {meetings.length === 0 ? 'No weekly meetings' : `${meetings.length} weekly meeting${meetings.length === 1 ? '' : 's'}`}
                  </Text>
                </View>
                <View style={c.cardTopRight}>
                  <Pressable style={[c.cardEditBtn, { borderColor: theme.cardBorder }]} onPress={() => setEditing({ club, isNew: false })} hitSlop={10}>
                    <Text style={[c.cardEditBtnText, { color: color }]}>Edit</Text>
                  </Pressable>
                  <Pressable style={c.cardDeleteBtn} onPress={() => confirmDelete(club)} hitSlop={10}>
                    <Text style={c.cardDeleteBtnIcon}>🗑</Text>
                  </Pressable>
                </View>
              </View>

              {meetings.length > 0 && (
                <View style={[c.meetingList, { borderTopColor: theme.divider }]}>
                  {meetings.map(m => (
                    <View key={m.id} style={c.meetingLine}>
                      <Text style={[c.meetingDay, { color: color }]}>{DAY_NAMES[m.days?.[0]] ?? '?'}</Text>
                      <Text style={[c.meetingLineText, { color: theme.text }]} numberOfLines={1}>
                        {fmtTime(m.startTime)} – {fmtTime(m.endTime)}
                        {m.location ? <Text style={{ color: theme.subtext }}>  ·  {m.location}</Text> : null}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        )
      })}

      <Pressable
        style={[c.addBtn, { borderColor: theme.isDark ? '#28284a' : '#dde0f8' }]}
        onPress={() => setEditing({ club: { id: genId(), name: '', emoji: '🎓', role: '' }, isNew: true })}
      >
        <Text style={[c.addBtnText, { color: CLUB_COLOR }]}>＋  Add Club or Society</Text>
      </Pressable>

      {editing && (
        <ClubEditor
          club={editing.club}
          isNew={editing.isNew}
          meetings={meetingsOf(editing.club.id)}
          theme={theme}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}
    </View>
  )
}

const c = StyleSheet.create({
  // Section header, matching the routine groups above it
  groupHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2, marginBottom: 10, marginTop: 2 },
  groupChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 4 },
  groupHeaderEmoji: { fontSize: 12 },
  groupHeaderText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.7 },
  groupHeaderHint: { fontSize: 11, fontWeight: '500' },
  groupRule: { flex: 1, height: 2, borderRadius: 1, minWidth: 8 },
  groupEmptyHint: { fontSize: 12, lineHeight: 17, paddingHorizontal: 4, marginBottom: 14 },

  // Club card, matching the routine cards
  card: {
    flexDirection: 'row', borderRadius: 22, marginBottom: 14, borderWidth: 2, overflow: 'hidden',
    shadowOffset: { width: 4, height: 5 }, shadowOpacity: 0.18, shadowRadius: 0, elevation: 6,
  },
  cardStripe: { width: 6 },
  cardContent: { flex: 1, padding: 16 },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  emojiCircle: { width: 50, height: 50, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 26 },
  cardName: { fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  cardStatus: { fontSize: 13, marginTop: 2, fontWeight: '500' },
  cardTopRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardEditBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1 },
  cardEditBtnText: { fontSize: 11, fontWeight: '700' },
  cardDeleteBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  cardDeleteBtnIcon: { fontSize: 13 },
  meetingList: { marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, gap: 6 },
  meetingLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  meetingDay: { width: 34, fontSize: 12, fontWeight: '800' },
  meetingLineText: { flex: 1, fontSize: 13, fontWeight: '500' },

  addBtn: { borderRadius: 18, padding: 16, alignItems: 'center', marginTop: 4, borderWidth: 1.5, borderStyle: 'dashed' },
  addBtnText: { fontWeight: '700', fontSize: 15 },

  // Editor sheet
  overlay: { flex: 1, justifyContent: 'flex-end' },
  overlayBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 10, paddingHorizontal: 22, paddingBottom: 34,
    maxHeight: '90%',
  },
  // Full-bleed header strip so the grab target is the whole width, not the
  // 40px bar. Negative margin cancels the sheet's own side padding.
  grabArea: { marginHorizontal: -22, paddingHorizontal: 22, paddingTop: 4 },
  // Lets the form shrink inside the sheet's maxHeight so the ScrollView stays
  // bounded now that the header sits outside it.
  bodyWrap: { flexShrink: 1 },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 18 },
  sheetTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, marginBottom: 14 },
  fieldLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8, marginTop: 4 },
  input: { borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, fontWeight: '500', marginBottom: 14 },
  hint: { fontSize: 12, lineHeight: 17, marginBottom: 8, marginTop: -4 },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  emojiBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  emptyMeetings: { fontSize: 13, fontStyle: 'italic', marginBottom: 10 },
  meetingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1 },
  meetingDot: { width: 8, height: 8, borderRadius: 4 },
  meetingText: { flex: 1, fontSize: 14, fontWeight: '500' },
  remove: { fontSize: 15, paddingHorizontal: 4 },
  addMeetingBox: { borderRadius: 16, borderWidth: 1.5, padding: 14, marginTop: 12 },
  addMeetingTitle: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 10 },
  daysRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  dayBtn: { flex: 1, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  dayBtnText: { fontSize: 12, fontWeight: '800' },
  timeField: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timeInput: { width: 52, borderRadius: 10, borderWidth: 1.5, paddingVertical: 8, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  timeColon: { fontSize: 18, fontWeight: '700' },
  apToggle: { flexDirection: 'row', borderRadius: 10, padding: 3, marginLeft: 6 },
  apBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  apText: { fontSize: 12, fontWeight: '800' },
  addMeetingBtn: { borderRadius: 12, borderWidth: 1.5, paddingVertical: 11, alignItems: 'center' },
  addMeetingBtnText: { fontSize: 14, fontWeight: '700' },
  saveBtn: { borderRadius: 14, padding: 15, alignItems: 'center', marginTop: 18 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  cancelBtn: { alignItems: 'center', paddingVertical: 12 },
  cancelText: { fontSize: 14, fontWeight: '600' },
})
