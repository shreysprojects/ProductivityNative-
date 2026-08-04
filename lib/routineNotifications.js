import * as Notifications from 'expo-notifications'
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

// Schedule a weekly repeating notification at each routine's start time, per
// its active days (and per-day times when set). Whenever-group and hidden
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
      s.activeDays.forEach((on, day) => {
        if (!on) return
        const mins = s.perDayMode ? (s.dayTimes?.[day] ?? s.startTimeMinutes) : s.startTimeMinutes
        slots.push({ name: n, day, mins })
      })
    })

    // Nothing changed since the last successful sync → done.
    const fp = JSON.stringify(slots)
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

    await Promise.all(slots.map(slot =>
      Notifications.scheduleNotificationAsync({
        identifier: `routine-${slot.name}-${slot.day}`,
        content: {
          title: `${routineTheme(slot.name).emoji}  ${slot.name} routine`,
          body: `It's ${fmtTime(slot.mins)} — time to start your ${slot.name} routine!`,
          sound: true,
        },
        trigger: {
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
