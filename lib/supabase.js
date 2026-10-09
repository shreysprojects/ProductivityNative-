import { createClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'

// SecureStore only exists on a real device. Anywhere else (web preview,
// static rendering in Node) fall back to a throwaway in-memory store so
// importing this module can never crash the app.
const memory = new Map()
const ExpoSecureStoreAdapter = {
  getItem:    async (key) => { try { return await SecureStore.getItemAsync(key) } catch { return memory.get(key) ?? null } },
  setItem:    async (key, value) => { try { await SecureStore.setItemAsync(key, value) } catch { memory.set(key, value) } },
  removeItem: async (key) => { try { await SecureStore.deleteItemAsync(key) } catch { memory.delete(key) } },
}

// React Native's fetch never gives up on its own: a request on a connection
// that died (a lift, a captive Wi-Fi page) could hang for good and leave its
// screen on a spinner. Every request now has a deadline, after which it fails
// like any other network error and the screen's own handling (Retry, the
// offline queue, staying signed in) takes over.
const REQUEST_TIMEOUT_MS = 30000
// AI calls take a while by nature (a timetable scan, a routine built from a
// survey), so they get longer.
const FUNCTION_TIMEOUT_MS = 180000

function fetchWithTimeout(input, init) {
  // A caller with its own signal (the AI helpers, which set their own limits
  // and cancel when their sheet closes) keeps full control.
  if (init?.signal) return fetch(input, init)
  const url = typeof input === 'string' ? input : String(input?.url ?? input ?? '')
  const ms = url.includes('/functions/v1/') ? FUNCTION_TIMEOUT_MS : REQUEST_TIMEOUT_MS
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer))
}

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      storage: ExpoSecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    global: { fetch: fetchWithTimeout },
  }
)

// The key supabase-js stores the session under by default
// (sb-<project ref>-auth-token).
const SESSION_KEY =
  `sb-${String(process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').match(/^https?:\/\/([^./]+)/)?.[1] ?? ''}-auth-token`

/**
 * The user from the stored session, read straight from storage. Opened
 * offline after the access token has expired, getSession() cannot refresh it
 * and reports no session — although the session is still stored and will
 * refresh the moment the network is back. This lets the app stay signed in
 * (on its device copies) instead of dropping to the login screen.
 */
export async function readStoredSessionUser() {
  try {
    const raw = await ExpoSecureStoreAdapter.getItem(SESSION_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed?.user ?? parsed?.currentSession?.user ?? null
  } catch {
    return null
  }
}
