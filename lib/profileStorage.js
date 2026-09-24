import { supabase } from './supabase'
import * as ImagePicker from 'expo-image-picker'
import { findBlockedWord } from './contentFilter'

const AVATAR_UPLOAD_FAILED = 'Could not upload your photo. Please try again.'

// Instant feedback only — the database triggers are what actually enforce this.
function assertClean(text, label) {
  const word = findBlockedWord(text)
  if (word) {
    throw new Error(`Your ${label} contains a word we don't allow ("${word}"). Please edit it and try again.`)
  }
}

/**
 * The user's own profile row, or null when there genuinely is none. Throws
 * when it could not be read: a failed read used to come back as null too,
 * and "no profile" sends people to the set-up-your-profile screen, where
 * saving renamed the account and wiped its bio and photo.
 */
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

export async function checkUsernameAvailable(username, currentUserId = null) {
  const normalized = username.toLowerCase().trim()
  // Goes through a SECURITY DEFINER RPC so we never expose the profiles table.
  // anon can call it (needed during sign-up, before a session exists).
  const { data, error } = await supabase.rpc('username_available', {
    u: normalized,
    exclude_id: currentUserId ?? null,
  })
  if (error) return true // fail open; the UNIQUE constraint is the real guard
  return data === true
}

export async function upsertProfile(userId, { username, bio = '', avatar_url = '', age = null, name = undefined, visibility = undefined }) {
  assertClean(username, 'username')
  assertClean(bio, 'bio')
  if (name !== undefined) assertClean(name, 'name')
  const payload = {
    id: userId,
    username: username.toLowerCase().trim(),
    bio,
    avatar_url,
    updated_at: new Date().toISOString(),
  }
  if (age !== null && age !== undefined) payload.age = age
  if (name !== undefined) payload.name = name.trim()
  if (visibility !== undefined) payload.visibility = visibility
  const { error } = await supabase.from('profiles').upsert(payload)
  if (error) throw error
}

export async function updateVisibility(userId, visibility) {
  const { error } = await supabase
    .from('profiles')
    .update({ visibility })
    .eq('id', userId)
  if (error) throw error
}

export async function updateName(userId, name) {
  assertClean(name, 'name')
  const { error } = await supabase
    .from('profiles')
    .update({ name: name.trim() })
    .eq('id', userId)
  if (error) throw error
}

export async function updateAge(userId, age) {
  const { error } = await supabase
    .from('profiles')
    .update({ age })
    .eq('id', userId)
  if (error) throw error
}

// Only the photo. Changing the picture used to upsert the whole profile from
// the Settings form, committing an unsaved (possibly invalid or taken)
// username along with it.
export async function updateAvatarUrl(userId, avatarUrl) {
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: avatarUrl ?? '' })
    .eq('id', userId)
  if (error) throw error
}

export async function updateBio(userId, bio) {
  assertClean(bio, 'bio')
  const { error } = await supabase
    .from('profiles')
    .update({ bio })
    .eq('id', userId)
  if (error) throw error
}

export async function pickAndUploadAvatar(userId) {
  // No permission request: the system picker needs none (SDK 57), and asking
  // anyway locked out everyone who had once tapped "Don't Allow".
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.6,
    base64: true,
  })
  if (result.canceled) return null

  const asset = result.assets[0]
  if (!asset.base64) throw new Error('Could not read that photo. Please pick a different one.')

  // The avatars bucket is write-protected: the edge function moderates the image
  // and stores it with the service role.
  const { data, error } = await supabase.functions.invoke('openai-proxy', {
    body: { action: 'upload_avatar', base64: asset.base64 },
  })

  let body = data
  if (error) {
    // Non-2xx responses land here — the real reason is in the body.
    try { body = await error.context?.json() } catch { body = null }
  }
  if (body?.error) throw new Error(body.reason ?? AVATAR_UPLOAD_FAILED)
  if (error || !body?.url) throw new Error(AVATAR_UPLOAD_FAILED)

  return `${body.url}?t=${Date.now()}`
}
