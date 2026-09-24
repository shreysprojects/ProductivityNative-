import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import { supabase } from './supabase'
import { trySync } from './syncQueue'

// Sleep tracking. The Night routine records when the user is going to sleep
// (and, optionally, when they want to be up), the home dashboard offers
// "I woke up" the next time the app opens, and each night lands in a small log.
//
// One blob per account in user_settings under 'sleep', with a device mirror:
// { at, session, logs }. `session` is { sleepAt, wakeGoalAt, notifId } while
// asleep and null otherwise; `logs` is [{ date, sleepAt, wokeAt, minutes,
// wakeGoalAt }], one per sleep (a nap and the night that ended the same day
// are both kept), newest first, capped. Whole-blob last-writer-wins on `at`:
// sleep is set and ended from one phone, so per-field merging would only add
// ways to go wrong.

const KEY = uid => `@sleep_${uid}`
const MAX_LOGS = 60
const EMPTY = { at: 0, session: null, logs: [] }

async function readLocal(userId) {
  try {
    const raw = await AsyncStorage.getItem(KEY(userId))
    if (raw) return { ...EMPTY, ...JSON.parse(raw) }
  } catch {}
  return { ...EMPTY }
}

async function readCloud(userId) {
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('data')
      .eq('user_id', userId)
      .eq('key', 'sleep')
      .maybeSingle()
    if (!error && data?.data) return { ...EMPTY, ...data.data }
  } catch {}
  return null
}

function writeLocal(userId, blob) {
  return AsyncStorage.setItem(KEY(userId), JSON.stringify(blob)).catch(() => {})
}

function push(userId, blob) {
  return trySync('user_settings', 'upsert', {
    user_id: userId, key: 'sleep', data: blob,
    updated_at: new Date().toISOString(),
  })
}

async function save(userId, next) {
  const stamped = { ...next, at: Date.now() }
  await writeLocal(userId, stamped)
  await push(userId, stamped)
  return stamped
}

export async function getSleep(userId) {
  const local = await readLocal(userId)
  const cloud = await readCloud(userId)
  if (!cloud) return local
  if ((cloud.at ?? 0) > (local.at ?? 0)) {
    await writeLocal(userId, cloud)
    return cloud
  }
  return local
}

// ── Formatting ─────────────────────────────────────────────────────────────

export function sleepParts(ms) {
  const mins = Math.max(0, Math.round(ms / 60000))
  return { h: Math.floor(mins / 60), m: mins % 60 }
}

// "7 hours and 20 minutes"
export function sleepDurationText(ms) {
  const { h, m } = sleepParts(ms)
  const hp = `${h} hour${h === 1 ? '' : 's'}`
  const mp = `${m} minute${m === 1 ? '' : 's'}`
  return h > 0 ? `${hp} and ${mp}` : mp
}

// "7h 20m"
export function sleepDurationShort(ms) {
  const { h, m } = sleepParts(ms)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function clockLabel(ms) {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// One entry per date, newest first: the longest sleep that ended that day, so
// a nap never stands in for the night. What "last night" and averages read.
export function nightlyLogs(logs) {
  const byDate = new Map()
  for (const l of logs ?? []) {
    if (!l?.date) continue
    const kept = byDate.get(l.date)
    if (!kept || (l.minutes || 0) > (kept.minutes || 0)) byDate.set(l.date, l)
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date))
}

// ── Wake-up alarm ──────────────────────────────────────────────────────────
// A one-off local notification at the wake goal. Best effort: no permission or
// a scheduling failure just means no alarm, never a failed sleep entry.

async function scheduleWakeAlarm(wakeGoalAt) {
  if (!wakeGoalAt || wakeGoalAt <= Date.now()) return null
  try {
    const perm = await Notifications.requestPermissionsAsync()
    const S = Notifications.IosAuthorizationStatus
    const granted = perm.granted ||
      [S.AUTHORIZED, S.PROVISIONAL, S.EPHEMERAL].includes(perm.ios?.status)
    if (!granted) return null
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: '☀️  Time to wake up',
        body: 'Open LifeLayer and tap "I woke up" to log your sleep.',
        sound: true,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(wakeGoalAt) },
    })
  } catch {
    return null
  }
}

async function cancelWakeAlarm(notifId) {
  if (!notifId) return
  try { await Notifications.cancelScheduledNotificationAsync(notifId) } catch {}
}

// ── Actions ────────────────────────────────────────────────────────────────

export async function startSleep(userId, { sleepAt, wakeGoalAt = null }) {
  const cur = await getSleep(userId)
  await cancelWakeAlarm(cur.session?.notifId)
  const notifId = await scheduleWakeAlarm(wakeGoalAt)
  return save(userId, { ...cur, session: { sleepAt, wakeGoalAt, notifId } })
}

export async function cancelSleep(userId) {
  const cur = await getSleep(userId)
  await cancelWakeAlarm(cur.session?.notifId)
  return save(userId, { ...cur, session: null })
}

export async function wakeUp(userId, wokeAt = Date.now()) {
  const cur = await getSleep(userId)
  const s = cur.session
  if (!s) return cur
  await cancelWakeAlarm(s.notifId)
  const minutes = Math.max(0, Math.round((wokeAt - s.sleepAt) / 60000))
  const d = new Date(wokeAt)
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const entry = { date, sleepAt: s.sleepAt, wokeAt, minutes, wakeGoalAt: s.wakeGoalAt ?? null }
  // Entries are told apart by when the sleep began, not by date: replacing
  // by date let an afternoon nap wipe out the night before it.
  const logs = [entry, ...(cur.logs ?? []).filter(l => l.sleepAt !== s.sleepAt)].slice(0, MAX_LOGS)
  return save(userId, { ...cur, session: null, logs })
}
