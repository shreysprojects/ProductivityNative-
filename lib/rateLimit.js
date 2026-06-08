import AsyncStorage from '@react-native-async-storage/async-storage'

// Per-user, per-feature daily usage + cooldown limiter backed by AsyncStorage.
// IMPORTANT: a successful consume increments the counter immediately, BEFORE any
// moderation/AI call, so a blocked or warned attempt still uses up the limit.

function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Checks the limit and, if allowed, consumes one use.
 * @returns {Promise<{allowed: boolean, reason?: string, remaining?: number}>}
 *   - Cooldown or daily-cap blocks return { allowed:false } and DO NOT consume.
 *   - Otherwise the use is consumed (count++ and last-timestamp set) and { allowed:true } is returned.
 */
export async function consumeRateLimit(userId, feature, { maxPerDay, cooldownMs = 0 }) {
  const key = `@rl_${feature}_${userId ?? 'anon'}`
  let state = { date: todayKey(), count: 0, last: 0 }
  try {
    const raw = await AsyncStorage.getItem(key)
    if (raw) {
      const p = JSON.parse(raw)
      if (p && typeof p === 'object') state = { date: p.date, count: p.count ?? 0, last: p.last ?? 0 }
    }
  } catch {}

  const today = todayKey()
  if (state.date !== today) state = { date: today, count: 0, last: 0 }

  const now = Date.now()

  if (cooldownMs > 0 && state.last && (now - state.last) < cooldownMs) {
    const secs = Math.ceil((cooldownMs - (now - state.last)) / 1000)
    const wait = secs >= 60 ? `${Math.ceil(secs / 60)} minute(s)` : `${secs} second${secs !== 1 ? 's' : ''}`
    return { allowed: false, reason: `Please wait ${wait} before trying again.` }
  }

  if (state.count >= maxPerDay) {
    return { allowed: false, reason: `You've reached the daily limit of ${maxPerDay}. Please try again tomorrow.` }
  }

  state.count += 1
  state.last = now
  try { await AsyncStorage.setItem(key, JSON.stringify(state)) } catch {}
  return { allowed: true, remaining: maxPerDay - state.count }
}
