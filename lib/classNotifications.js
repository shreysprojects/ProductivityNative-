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

/**
 * Rebuild the class reminders from the current schedule. Safe to call often:
 * a fingerprint makes it a no-op unless the timetable actually changed.
 */
export async function syncClassNotifications(userId) {
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
        slots.push({
          id: item.id, dow, at,
          title: item.title, startTime: item.startTime,
          location: item.location ?? null,
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
        trigger: {
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
