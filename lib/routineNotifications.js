import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getRoutineNames, getRoutineSettings, getRoutineGroupMap, getHiddenDefaults } from './storage'
import { routineTheme } from './themes'

// Show routine reminders even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

// App day index: 0 = Monday … 6 = Sunday. iOS weekday: 1 = Sunday … 7 = Saturday.
const iosWeekday = i => (i === 6 ? 1 : i + 2)

const fmtTime = mins => {
  const h = Math.floor(mins / 60), m = mins % 60
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

// iOS keeps only 64 pending local notifications for the whole app, shared
// with class reminders and the time-log prompts (which hold up to 24), so
// routine reminders take at most this many. Android has no such cap.
const IOS_ROUTINE_BUDGET = 24

// Minutes from `now` until a reminder next fires (day null = every day).
function minutesUntil(slot, now) {
  const nowMins = now.getHours() * 60 + now.getMinutes()
  if (slot.day === null) {
    const d = slot.mins - nowMins
    return d > 0 ? d : d + 1440
  }
  const today = (now.getDay() + 6) % 7
  const d = ((slot.day - today + 7) % 7) * 1440 + slot.mins - nowMins
  return d > 0 ? d : d + 7 * 1440
}

// Schedule a weekly repeating notification at each routine's start time, per
// its active days (and per-day times when set) — or one daily notification
// when it runs every day at the same time. Whenever-group and hidden
// routines have no schedule, so they get no reminders. Safe to call often:
// a fingerprint skips the work unless the schedule actually changed.
export async function syncRoutineNotifications(userId) {
  try {
    const [names, groupMap, hidden] = await Promise.all([
      getRoutineNames(userId),
      getRoutineGroupMap(userId),
      getHiddenDefaults(userId),
    ])
    const hiddenSet = new Set(hidden)
    const scheduled = names.filter(n => !hiddenSet.has(n) && (groupMap[n] ?? 'everyday') === 'everyday')
    const settings = await Promise.all(scheduled.map(n => getRoutineSettings(userId, n)))

    const slots = []
    scheduled.forEach((n, i) => {
      const s = settings[i]
      const days = []
      s.activeDays.forEach((on, day) => {
        if (!on) return
        const mins = s.perDayMode ? (s.dayTimes?.[day] ?? s.startTimeMinutes) : s.startTimeMinutes
        days.push({ name: n, day, mins })
      })
      // Every day at one time is a single daily reminder instead of seven.
      if (days.length === 7 && days.every(d => d.mins === days[0].mins)) {
        slots.push({ name: n, day: null, mins: days[0].mins })
      } else {
        slots.push(...days)
      }
    })

    // Over the budget, the reminders due soonest win. Home resyncs at least
    // daily, so the ones left out move up as their days come round.
    const now = new Date()
    const budget = Platform.OS === 'ios' ? IOS_ROUTINE_BUDGET : slots.length
    const soonest = new Set(
      [...slots].sort((a, b) => minutesUntil(a, now) - minutesUntil(b, now)).slice(0, budget)
    )
    const capped = slots.filter(slot => soonest.has(slot))

    // Nothing changed since the last successful sync → done.
    const fp = JSON.stringify(capped)
    const fpKey = `@routine_notif_fp_${userId}`
    const prev = await AsyncStorage.getItem(fpKey).catch(() => null)
    if (prev === fp) return

    const perm = await Notifications.requestPermissionsAsync()
    const S = Notifications.IosAuthorizationStatus
    const granted = perm.granted ||
      [S.AUTHORIZED, S.PROVISIONAL, S.EPHEMERAL].includes(perm.ios?.status)
    if (!granted) return // retry on a later sync — fingerprint not saved

    // Replace every routine notification with the current schedule.
    const existing = await Notifications.getAllScheduledNotificationsAsync()
    await Promise.all(existing
      .filter(r => r.identifier?.startsWith('routine-'))
      .map(r => Notifications.cancelScheduledNotificationAsync(r.identifier)))

    await Promise.all(capped.map(slot =>
      Notifications.scheduleNotificationAsync({
        identifier: `routine-${slot.name}-${slot.day ?? 'daily'}`,
        content: {
          title: `${routineTheme(slot.name).emoji}  ${slot.name} routine`,
          body: `It's ${fmtTime(slot.mins)} — time to start your ${slot.name} routine!`,
          sound: true,
        },
        trigger: slot.day === null
          ? {
            type: Notifications.SchedulableTriggerInputTypes.DAILY,
            hour: Math.floor(slot.mins / 60),
            minute: slot.mins % 60,
          }
          : {
            type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
            weekday: iosWeekday(slot.day),
            hour: Math.floor(slot.mins / 60),
            minute: slot.mins % 60,
          },
      })
    ))
    await AsyncStorage.setItem(fpKey, fp).catch(() => {})
  } catch {}
}
