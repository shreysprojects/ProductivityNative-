import { supabase } from './supabase'
import * as ImagePicker from 'expo-image-picker'

async function moderateImage(base64Jpeg) {
  try {
    const { data } = await supabase.functions.invoke('openai-proxy', {
      body: { action: 'moderate_image', base64: base64Jpeg },
    })
    if (data?.flagged) {
      throw new Error('Your profile picture contains inappropriate content and cannot be uploaded.')
    }
  } catch (e) {
    if (e.message?.startsWith('Your profile picture')) throw e
    // Network/function errors are non-blocking — let the upload proceed
  }
}

export async function getProfile(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
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

export async function updateBio(userId, bio) {
  const { error } = await supabase
    .from('profiles')
    .update({ bio })
    .eq('id', userId)
  if (error) throw error
}

export async function pickAndUploadAvatar(userId) {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!perm.granted) throw new Error('Photo library access denied.')

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.6,
    base64: true,
  })
  if (result.canceled) return null

  const asset = result.assets[0]
  if (asset.base64) await moderateImage(asset.base64)

  const uri = asset.uri
  const path = `${userId}/avatar.jpg`

  const formData = new FormData()
  formData.append('file', { uri, name: 'avatar.jpg', type: 'image/jpeg' })

  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, formData, { upsert: true, contentType: 'image/jpeg' })
  if (error) throw error

  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  return `${data.publicUrl}?t=${Date.now()}`
}
