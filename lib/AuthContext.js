import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import * as Crypto from 'expo-crypto'
import { supabase } from './supabase'
import { getProfile, checkUsernameAvailable, upsertProfile } from './profileStorage'
import { clearBlockedCache } from './blockedStorage'
import { clearQueue, flushQueue, pendingCount } from './syncQueue'
import { clearAllLocalCache } from './cloudSync'

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

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileSetupError, setProfileSetupError] = useState(null)

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null)
      setProfileLoading(false)
      return
    }
    setProfileLoading(true)
    const p = await getProfile(userId)
    setProfile(p)
    setProfileLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = normalizeUser(session?.user ?? null)
      setUser(u)
      setLoading(false)
      loadProfile(u?.id ?? null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = normalizeUser(session?.user ?? null)
      setUser(u)
      if (!u) {
        setProfile(null)
        setProfileLoading(false)
      } else {
        loadProfile(u.id)
      }
    })

    return () => subscription.unsubscribe()
  }, [loadProfile])

  async function signUp({ name, email, password, username }) {
    const cleanUsername = username.toLowerCase().trim()
    const available = await checkUsernameAvailable(cleanUsername)
    if (!available) throw new Error('Username is already taken')

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name: name?.trim() || email.split('@')[0], username: cleanUsername } },
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
    const { error } = await supabase.auth.signInWithPassword({ email, password })
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
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase())
    if (error) throw new Error(error.message)
  }

  async function confirmPasswordReset(email, token, newPassword) {
    const { error: vErr } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: token.trim(),
      type: 'recovery',
    })
    if (vErr) throw new Error(vErr.message)
    const { error: uErr } = await supabase.auth.updateUser({ password: newPassword })
    if (uErr) throw new Error(uErr.message)
  }

  async function signOut({ force = false } = {}) {
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
    await supabase.auth.signOut()
    clearBlockedCache()
    await clearQueue()
    setProfileSetupError(null)
  }

  async function deleteAccount() {
    const deletedId = user?.id
    if (deletedId) {
      await supabase.storage.from('avatars').remove([`${deletedId}/avatar.jpg`]).catch(() => {})
    }
    const { error } = await supabase.rpc('delete_own_account')
    if (error) throw new Error(error.message)
    await supabase.auth.signOut()
    clearBlockedCache()
    await clearQueue()
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
      profile, profileLoading, refreshProfile, profileSetupError,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
