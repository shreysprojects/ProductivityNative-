import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

function _localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

export async function getProductivitySessions(userId, limit = 30) {
  const key = `@prod_sessions_${userId}`
  try {
    const raw = await AsyncStorage.getItem(key)
    if (raw !== null) {
      const all = JSON.parse(raw)
      return all.slice(0, limit)
    }
  } catch {}
  try {
    const { data } = await supabase
      .from('productivity_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(limit)
    if (data) {
      const sessions = data.map(r => ({
        id: r.id,
        date: r.date,
        taskDesc: r.task_desc,
        goalMins: r.goal_mins,
        actualMins: r.actual_mins,
        rating: r.rating,
        notes: r.notes ?? '',
        startedAt: r.started_at,
        endedAt: r.ended_at,
      }))
      await AsyncStorage.setItem(key, JSON.stringify(sessions)).catch(() => {})
      return sessions
    }
  } catch {}
  return []
}

export async function saveProductivitySession(userId, session) {
  const key = `@prod_sessions_${userId}`
  const sessions = await getProductivitySessions(userId, 200)
  const saved = { ...session, id: session.id ?? genId() }
  sessions.unshift(saved)
  await AsyncStorage.setItem(key, JSON.stringify(sessions)).catch(() => {})
  try {
    await supabase.from('productivity_sessions').insert({
      id: saved.id,
      user_id: userId,
      date: saved.date,
      task_desc: saved.taskDesc,
      goal_mins: saved.goalMins,
      actual_mins: saved.actualMins,
      rating: saved.rating,
      notes: saved.notes ?? '',
      started_at: saved.startedAt,
      ended_at: saved.endedAt,
    })
  } catch {}
  return saved
}

export async function clearProductivitySessions(userId) {
  await AsyncStorage.removeItem(`@prod_sessions_${userId}`).catch(() => {})
  try { await supabase.from('productivity_sessions').delete().eq('user_id', userId) } catch {}
}

export async function getTodayProductiveMinutes(userId) {
  const sessions = await getProductivitySessions(userId, 50)
  const today = _localDate()
  return sessions
    .filter(s => s.date === today)
    .reduce((sum, s) => sum + (s.actualMins ?? 0), 0)
}
