import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'
import { getProfile, checkUsernameAvailable, upsertProfile } from './profileStorage'

const AuthContext = createContext(null)

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
    if (data.user) {
      const username = data.user.user_metadata?.username
      if (username) {
        try { await upsertProfile(data.user.id, { username, bio: '', avatar_url: '' }) } catch {}
      }
      await loadProfile(data.user.id)
    }
  }

  async function resendSignUpCode(email) {
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim().toLowerCase() })
    if (error) throw new Error(error.message)
  }

  async function signIn({ email, password }) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)
  }

  async function signInWithGoogle(idToken) {
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    })
    if (error) throw new Error(error.message)
  }

  async function signInWithApple(credential) {
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
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

  async function signOut() {
    await supabase.auth.signOut()
  }

  async function deleteAccount() {
    if (user?.id) {
      await supabase.storage.from('avatars').remove([`${user.id}/avatar.jpg`]).catch(() => {})
    }
    const { error } = await supabase.rpc('delete_own_account')
    if (error) throw new Error(error.message)
    await supabase.auth.signOut()
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
      profile, profileLoading, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
