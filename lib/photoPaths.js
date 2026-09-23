// Pure helpers for routine photo storage: the cap, the bucket name, and the
// conversions between a stored URL and the object path behind it.
//
// Like runSteps.js this module deliberately has no imports so tests can load it
// in plain Node. Anything needing Supabase or the filesystem belongs in
// photoStorage.js instead.

// Must match the 10 hard-coded in the routine_photos limit trigger
// (supabase/migrations/20260821090000_routine_photos.sql). The database is the
// real enforcement; this is here to warn before the upload rather than after.
export const MAX_ROUTINE_PHOTOS = 10

export const ROUTINE_PHOTO_BUCKET = 'routine-photos'

// The database raises this when the cap is hit.
export const PHOTO_LIMIT_ERROR = 'routine_photo_limit_reached'

// Uploaded photos are https URLs; photos picked before this feature existed are
// still file:// paths in the app's document directory, and both have to keep
// rendering.
export function isRemotePhoto(uri) {
  return typeof uri === 'string' && /^https?:\/\//i.test(uri)
}

// Pull the storage object path back out of a public URL, which looks like
//   https://<project>.supabase.co/storage/v1/object/public/routine-photos/<uid>/<file>.jpg
// Returns null for anything that is not a URL in this bucket, so callers can
// tell "delete from storage" apart from "delete a local file".
export function storagePathFromUrl(url) {
  if (!isRemotePhoto(url)) return null
  const marker = `/${ROUTINE_PHOTO_BUCKET}/`
  const at = url.indexOf(marker)
  if (at === -1) return null
  const path = url.slice(at + marker.length).split('?')[0]
  if (!path) return null
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

// Object name for a new upload. The uid prefix is what the storage policies
// check, so it must stay the first path segment.
export function routinePhotoPath(userId, seed, random) {
  return `${userId}/${seed}_${random}.jpg`
}

// Saved-meal ingredient pictures live in the same bucket, one folder down.
// They have no ledger row, so they do not count against the routine photo
// cap, and the folder keeps them out of the top-level listing the slot
// reconciler reads.
export function ingredientPhotoPath(userId, seed, random) {
  return `${userId}/ingredients/${seed}_${random}.jpg`
}

// Counts only what the cap counts: photos actually living in the bucket.
// Local photos from older versions are not uploaded and so do not use a slot.
export function countRemotePhotos(tasks) {
  let n = 0
  for (const t of tasks ?? []) {
    if (isRemotePhoto(t?.image)) n++
    for (const st of t?.subTasks ?? []) {
      if (isRemotePhoto(st?.image)) n++
    }
  }
  return n
}

// Every photo URI referenced by a task list, remote or local. Used to work out
// which uploads are no longer pointed at by anything.
export function collectPhotoUris(tasks) {
  const uris = []
  for (const t of tasks ?? []) {
    if (t?.image) uris.push(t.image)
    for (const st of t?.subTasks ?? []) {
      if (st?.image) uris.push(st.image)
    }
  }
  return uris
}

// Base64 to bytes, without depending on atob being present in the JS engine.
// Supabase storage takes an ArrayBuffer/Uint8Array on React Native; reading the
// file as base64 and decoding here avoids pulling in a polyfill package.
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64ToBytes(b64) {
  const clean = String(b64 ?? '').replace(/[^A-Za-z0-9+/]/g, '')
  const len = clean.length
  const bytes = new Uint8Array(Math.floor((len * 3) / 4))
  let p = 0
  for (let i = 0; i < len; i += 4) {
    const c0 = B64_ALPHABET.indexOf(clean[i])
    const c1 = B64_ALPHABET.indexOf(clean[i + 1])
    const c2 = B64_ALPHABET.indexOf(clean[i + 2])
    const c3 = B64_ALPHABET.indexOf(clean[i + 3])
    bytes[p++] = (c0 << 2) | (c1 >> 4)
    if (c2 !== -1) bytes[p++] = ((c1 & 15) << 4) | (c2 >> 2)
    if (c3 !== -1) bytes[p++] = ((c2 & 3) << 6) | c3
  }
  return p === bytes.length ? bytes : bytes.subarray(0, p)
}
