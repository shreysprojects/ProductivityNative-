import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getScheduleItems, today } from './storage'

// A weekly repeating heads-up shortly before each class meeting. The
// notification handler is registered once in routineNotifications.js — this
// module only schedules.

const PREFIX = 'class-'
const LEAD_MINUTES = 10
// iOS caps an app at 64 PENDING local notifications in total; Android has no
// such limit. A weekly repeat costs one slot however many weeks it runs, so
// the real budget is 64 minus whatever the routine and time-log reminders are
// already holding — measured, not guessed. Two slots stay spare for the
// one-off alarms calendar events schedule as you add them.
const IOS_NOTIF_LIMIT = 64
const IOS_SPARE = 2

// schedule_items.days uses JS day-of-week (0 = Sunday); iOS wants 1 = Sunday.
const iosWeekday = dow => dow + 1

const fmtTime = t => {
  const [h, m] = String(t ?? '').split(':').map(Number)
  if (!Number.isFinite(h)) return ''
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

// 'YYYY-MM-DD' in local time — the form semester dates are stored in, so the
// two compare as plain strings.
const dayOf = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const weekAfter = d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n }

// When a weekly reminder for this weekday and minute of the day would next
// go off.
function nextFire(dow, at) {
  const now = new Date()
  const d = new Date(now)
  d.setHours(Math.floor(at / 60), at % 60, 0, 0)
  d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7))
  return d <= now ? weekAfter(d) : d
}

// One sync at a time: two overlapping runs (the one a schedule change sets
// off, and one started after a scan import finishes saving) could each
// cancel and re-add, and leave the older run's reminders behind.
let syncing = Promise.resolve()

/**
 * Rebuild the class reminders from the current schedule. Safe to call often:
 * a fingerprint makes it a no-op unless the timetable actually changed.
 */
export function syncClassNotifications(userId) {
  const run = syncing.then(() => sync(userId))
  syncing = run.catch(() => {})
  return run
}

async function sync(userId) {
  try {
    const items = await getScheduleItems(userId)
    const todayStr = today()

    const slots = []
    for (const item of items ?? []) {
      if (!Array.isArray(item.days) || !item.startTime) continue
      // A finished semester's classes are stale — a weekly repeat would keep
      // firing for a course that's over.
      if (item.semesterEnd && item.semesterEnd < todayStr) continue
      const [h, m] = String(item.startTime).split(':').map(Number)
      if (!Number.isFinite(h) || !Number.isFinite(m)) continue
      const at = h * 60 + m - LEAD_MINUTES
      if (at < 0) continue // starts within the first 10 minutes of the day
      for (const dow of item.days) {
        if (!Number.isInteger(dow) || dow < 0 || dow > 6) continue
        // A weekly repeat can't be given a first or last date, so the term's
        // bounds are applied here. Before the term starts only its first
        // meeting is scheduled, as a one-off; a later sync (every visit to the
        // calendar) swaps in the weekly repeat once the term is under way. The
        // term's last meeting is a one-off too, so nothing rings after it.
        const next = nextFire(dow, at)
        let fire = next
        for (let w = 0; w < 60 && item.semesterStart && dayOf(fire) < item.semesterStart; w++) fire = weekAfter(fire)
        if (item.semesterStart && dayOf(fire) < item.semesterStart) continue // over a year away
        if (item.semesterEnd && dayOf(fire) > item.semesterEnd) continue
        const once = fire !== next || (!!item.semesterEnd && dayOf(weekAfter(fire)) > item.semesterEnd)
        slots.push({
          id: item.id, dow, at,
          title: item.title, startTime: item.startTime,
          location: item.location ?? null,
          on: once ? fire.getTime() : null,
        })
      }
    }
    // Earliest meeting of the week first, so if the OS budget does run out the
    // classes that lose their reminder are the ones furthest away — you still
    // get warned about everything happening soon, and a later sync (once other
    // reminders free up slots) picks the rest back up.
    slots.sort((a, b) => (a.dow - b.dow) || (a.at - b.at))

    const existing = await Notifications.getAllScheduledNotificationsAsync().catch(() => [])
    const mine = existing.filter(r => r.identifier?.startsWith(PREFIX))
    const heldByOthers = existing.length - mine.length
    const budget = Platform.OS === 'ios'
      ? Math.max(0, IOS_NOTIF_LIMIT - IOS_SPARE - heldByOthers)
      : slots.length
    const capped = slots.slice(0, budget)

    // The budget is part of the fingerprint: freeing up slots elsewhere (say
    // turning off time-log reminders) has to re-run this and pick up the
    // classes that didn't fit before.
    const fp = JSON.stringify({ budget, capped })
    const fpKey = `@class_notif_fp_${userId}`
    const prev = await AsyncStorage.getItem(fpKey).catch(() => null)
    if (prev === fp) return capped.length

    const perm = await Notifications.requestPermissionsAsync()
    const S = Notifications.IosAuthorizationStatus
    const granted = perm.granted ||
      [S.AUTHORIZED, S.PROVISIONAL, S.EPHEMERAL].includes(perm.ios?.status)
    if (!granted) return 0 // retry on a later sync — fingerprint not saved

    // Only class reminders are cleared; routine and time-log notifications are
    // owned by other modules and must survive.
    await Promise.all(mine.map(r => Notifications.cancelScheduledNotificationAsync(r.identifier)))

    await Promise.all(capped.map(slot =>
      Notifications.scheduleNotificationAsync({
        identifier: `${PREFIX}${slot.id}-${slot.dow}`,
        content: {
          title: `🎓  ${slot.title}`,
          body: `Starts at ${fmtTime(slot.startTime)}, in ${LEAD_MINUTES} minutes`
            + (slot.location ? ` · ${slot.location}` : ''),
          sound: true,
        },
        trigger: slot.on
          ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(slot.on) }
          : {
              type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
              weekday: iosWeekday(slot.dow),
              hour: Math.floor(slot.at / 60),
              minute: slot.at % 60,
            },
      })
    ))
    await AsyncStorage.setItem(fpKey, fp).catch(() => {})
    return capped.length
  } catch {
    return 0
  }
}
