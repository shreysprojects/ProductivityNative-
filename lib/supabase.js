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
  }
)
