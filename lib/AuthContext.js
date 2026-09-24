import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'
import * as Notifications from 'expo-notifications'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { supabase, readStoredSessionUser } from './supabase'
import { getProfile, checkUsernameAvailable, upsertProfile } from './profileStorage'
import { clearBlockedCache } from './blockedStorage'
import { clearQueue, flushQueue, pendingCount } from './syncQueue'
import { clearAllLocalCache } from './cloudSync'
import { removeAllRoutinePhotos } from './photoStorage'

const AuthContext = createContext(null)

/**
 * OIDC nonce pair: the identity provider is given `hashed` so it lands in the
 * id_token, and `raw` goes to signInWithIdToken, which proves the token is ours.
 */
export async function createNoncePair() {
  const raw = `${Crypto.randomUUID()}${Crypto.randomUUID()}`
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw)
  return { raw, hashed }
}

function normalizeUser(supabaseUser) {
  if (!supabaseUser) return null
  return {
    id:    supabaseUser.id,
    email: supabaseUser.email,
    name:  supabaseUser.user_metadata?.name || supabaseUser.email?.split('@')[0] || 'User',
  }
}

// Every auth event (the hourly token refresh included) hands over a fresh
// session. Building a new `user` object each time re-ran every screen effect
// that depends on it: an in-progress workout was re-seeded from last time,
// editors reverted unsaved changes and Settings reloaded mid-edit. The same
// person keeps the same object.
const sameUser = (a, b) =>
  a === b || (!!a && !!b && a.id === b.id && a.email === b.email && a.name === b.name)

const PROFILE_CACHE_KEY = uid => `@profile_${uid}`

// Reminder bookkeeping to forget on sign-out, so the next sign-in (by anyone)
// reschedules from its own data instead of trusting a stale fingerprint. The
// time-log key is per device: without it, timeLogging reschedules on its next
// read, where otherwise it waited for a settings change.
const NOTIF_FP_KEYS = uid => [
  `@routine_notif_fp_${uid}`, `@class_notif_fp_${uid}`, '@time_log_reminder_layout',
]

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)
  // Set when the profile could not be READ (as opposed to not existing).
  // Screens must not treat that as "no profile" (see (tabs)/_layout).
  const [profileError, setProfileError] = useState(null)
  const [profileSetupError, setProfileSetupError] = useState(null)

  // Only the newest profile load may land: a slow load for the previous
  // account (or one started before sign-out) must not overwrite the current.
  const profileReq = useRef(0)
  const profileUser = useRef(null)
  // Email of a password-reset code already verified in this session, so a
  // failed password update can be retried without re-spending the code.
  const recoveryVerifiedFor = useRef(null)

  const adoptUser = useCallback(u => {
    setUser(prev => (sameUser(prev, u) ? prev : u))
  }, [])

  const loadProfile = useCallback(async (userId) => {
    const req = ++profileReq.current
    if (!userId) {
      profileUser.current = null
      setProfile(null)
      setProfileError(null)
      setProfileLoading(false)
      return
    }
    // A refresh for the same person keeps the current profile on screen;
    // only a different person goes back to the loading state.
    if (profileUser.current !== userId) {
      setProfile(null)
      setProfileLoading(true)
    }
    try {
      const p = await getProfile(userId)
      if (req !== profileReq.current) return
      profileUser.current = userId
      setProfile(p)
      setProfileError(null)
      // Set-up finished (complete-profile saved a username): the message
      // about it not being finished no longer applies.
      if (p?.username) setProfileSetupError(null)
      if (p) AsyncStorage.setItem(PROFILE_CACHE_KEY(userId), JSON.stringify(p)).catch(() => {})
    } catch (e) {
      if (req !== profileReq.current) return
      // Could not read it. Keep what is known — this session's copy, else the
      // one cached on the device — and never report it as missing.
      if (profileUser.current !== userId) {
        let cached = null
        try {
          const raw = await AsyncStorage.getItem(PROFILE_CACHE_KEY(userId))
          cached = raw ? JSON.parse(raw) : null
        } catch {}
        if (req !== profileReq.current) return
        profileUser.current = userId
        setProfile(cached)
      }
      setProfileError(e)
    } finally {
      if (req === profileReq.current) setProfileLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      let u = normalizeUser(session?.user ?? null)
      if (!u && error && isAuthRetryableFetchError(error)) {
        // Offline with an expired access token: the refresh could not reach
        // the server, but the session is still stored and refreshes once the
        // network is back. Stay signed in on the device copies meanwhile.
        u = normalizeUser(await readStoredSessionUser())
      }
      if (!active) return
      adoptUser(u)
      setLoading(false)
      loadProfile(u?.id ?? null)
    }).catch(() => {
      if (!active) return
      setLoading(false)
      loadProfile(null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const u = normalizeUser(session?.user ?? null)
      // A refresh that fails for lack of network is not a sign-out.
      if (!u && event !== 'SIGNED_OUT') return
      adoptUser(u)
      // Deferred: awaiting other Supabase calls inside this callback can
      // deadlock the auth client.
      setTimeout(() => loadProfile(u?.id ?? null), 0)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [loadProfile, adoptUser])

  async function signUp({ name, email, password, username }) {
    const cleanEmail = String(email ?? '').trim()
    const cleanUsername = username.toLowerCase().trim()
    const available = await checkUsernameAvailable(cleanUsername)
    if (!available) throw new Error('Username is already taken')

    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      // No fallback to the email's local part: it is not a name, and it
      // should not be what the account calls itself.
      options: { data: { ...(name?.trim() ? { name: name.trim() } : {}), username: cleanUsername } },
    })
    if (error) throw new Error(error.message)

    // Email already registered: with "Confirm email" on, Supabase does NOT return an
    // error — it returns an obfuscated user with an empty identities array. Detect that.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new Error('An account with this email already exists. Please sign in instead.')
    }

    // No session → "Confirm email" is on. The username (stored in user metadata) is
    // written to the profile after the user verifies, via confirmSignUp.
    if (!data.session) {
      return { needsConfirmation: true }
    }

    if (data.user) {
      await upsertProfile(data.user.id, { username: cleanUsername, bio: '', avatar_url: '' })
      await loadProfile(data.user.id)
    }
    return { needsConfirmation: false }
  }

  async function confirmSignUp(email, token) {
    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: token.trim(),
      type: 'signup',
    })
    if (error) throw new Error(error.message)
    if (!data.user) return { profileIncomplete: false }

    const username = data.user.user_metadata?.username
    let failure = null
    if (username) {
      try {
        await upsertProfile(data.user.id, { username, bio: '', avatar_url: '' })
      } catch (e) {
        failure = e
      }
    }
    await loadProfile(data.user.id)

    // The account is verified either way — the missing profile is finished on
    // the complete-profile screen, which (tabs) redirects to when it is absent.
    if (failure || !username) {
      setProfileSetupError(
        failure?.message
          ? `Your email is verified, but we couldn't finish setting up your profile: ${failure.message}`
          : 'Your email is verified. Finish setting up your profile to continue.'
      )
      return { profileIncomplete: true }
    }
    setProfileSetupError(null)
    return { profileIncomplete: false }
  }

  async function resendSignUpCode(email) {
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim().toLowerCase() })
    if (error) throw new Error(error.message)
  }

  async function signIn({ email, password }) {
    const { error } = await supabase.auth.signInWithPassword({ email: String(email ?? '').trim(), password })
    if (error) throw new Error(error.message)
  }

  async function signInWithGoogle(idToken, rawNonce) {
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
      ...(rawNonce ? { nonce: rawNonce } : {}),
    })
    if (error) throw new Error(error.message)
  }

  async function signInWithApple(credential, rawNonce) {
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      ...(rawNonce ? { nonce: rawNonce } : {}),
    })
    if (error) throw new Error(error.message)
    if (credential.fullName?.givenName) {
      const name = [credential.fullName.givenName, credential.fullName.familyName]
        .filter(Boolean).join(' ')
      await supabase.auth.updateUser({ data: { name } })
    }
  }

  async function sendPasswordReset(email) {
    recoveryVerifiedFor.current = null
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase())
    if (error) throw new Error(error.message)
  }

  async function confirmPasswordReset(email, token, newPassword) {
    const cleanEmail = email.trim().toLowerCase()
    // The code is single-use and verifying it signs the user in. If the new
    // password is then refused (too weak, same as before, a dropped
    // connection), a retry must only redo the password update: verifying the
    // spent code again always failed with "Token has expired or is invalid".
    if (recoveryVerifiedFor.current !== cleanEmail) {
      const { error: vErr } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: token.trim(),
        type: 'recovery',
      })
      if (vErr) throw new Error(vErr.message)
      recoveryVerifiedFor.current = cleanEmail
    }
    const { error: uErr } = await supabase.auth.updateUser({ password: newPassword })
    if (uErr) throw new Error(uErr.message)
    recoveryVerifiedFor.current = null
  }

  // Reminders belong to the account that set them: routine, class, time-log,
  // event and sleep reminders kept firing — with class rooms and event titles
  // — for whoever used the phone next.
  async function forgetDeviceReminders(userId) {
    try { await Notifications.cancelAllScheduledNotificationsAsync() } catch {}
    if (userId) await AsyncStorage.multiRemove(NOTIF_FP_KEYS(userId)).catch(() => {})
  }

  async function signOut({ force = false } = {}) {
    const userId = user?.id ?? null
    // Last chance to land anything written while offline — the queue is
    // dropped below so it can never replay against a different account.
    await flushQueue()
    // If the flush couldn't land everything (offline, server down), those
    // writes would be silently discarded by the clear below. Refuse unless
    // the caller explicitly forced it, and report how much is at stake so
    // the UI can warn and ask.
    if (!force) {
      const pending = await pendingCount()
      if (pending > 0) return { pendingSync: pending }
    }
    // 'local': sign out this device only (the default also signs out every
    // other device). Its failure is reported, and nothing is cleared: the
    // user is still signed in, so their queued edits must survive.
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) return { error: error.message || 'Could not sign out. Please try again.' }
    clearBlockedCache()
    await clearQueue()
    await forgetDeviceReminders(userId)
    if (userId) await AsyncStorage.removeItem(PROFILE_CACHE_KEY(userId)).catch(() => {})
    recoveryVerifiedFor.current = null
    setProfileSetupError(null)
    return {}
  }

  async function deleteAccount() {
    const deletedId = user?.id
    if (deletedId) {
      // Files first. The rows cascade with the account, but files in the
      // public buckets would stay reachable by URL forever.
      await removeAllRoutinePhotos(deletedId).catch(() => {})
      await supabase.storage.from('avatars').remove([`${deletedId}/avatar.jpg`]).catch(() => {})
    }
    const { error } = await supabase.rpc('delete_own_account')
    if (error) throw new Error(error.message)
    await supabase.auth.signOut({ scope: 'local' })
    clearBlockedCache()
    await clearQueue()
    await forgetDeviceReminders(deletedId)
    await clearAllLocalCache(deletedId)
    setProfileSetupError(null)
  }

  async function refreshProfile() {
    if (user?.id) await loadProfile(user.id)
  }

  return (
    <AuthContext.Provider value={{
      user, loading,
      signUp, confirmSignUp, resendSignUpCode,
      signIn, signInWithGoogle, signInWithApple, signOut, deleteAccount,
      sendPasswordReset, confirmPasswordReset,
      profile, profileLoading, profileError, refreshProfile, profileSetupError,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
