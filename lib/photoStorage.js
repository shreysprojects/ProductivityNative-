import * as FileSystem from 'expo-file-system/legacy'
import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { supabase } from './supabase'
import { trySync } from './syncQueue'
import {
  MAX_ROUTINE_PHOTOS, ROUTINE_PHOTO_BUCKET, PHOTO_LIMIT_ERROR,
  routinePhotoPath, storagePathFromUrl, base64ToBytes,
} from './photoPaths'

export { MAX_ROUTINE_PHOTOS } from './photoPaths'

// Fitness progress photos: one per date, copied into the app's document
// directory so they survive cache clears. Index lives in AsyncStorage:
// { [YYYY-MM-DD]: fileUri }

const key = (uid) => `@fit_photos_${uid}`
const passKey = (uid) => `fitpass_${uid}`
const PHOTO_DIR = FileSystem.documentDirectory + 'fitphotos/'

export async function getFitPhotos(userId) {
  try {
    const raw = await AsyncStorage.getItem(key(userId))
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

// The index is read-modify-written, so every update runs one at a time.
let indexChain = Promise.resolve()

function withIndex(fn) {
  const run = indexChain.then(fn, fn)
  indexChain = run.then(() => {}, () => {})
  return run
}

export async function saveFitPhoto(userId, date, srcUri) {
  await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true }).catch(() => {})
  const dest = `${PHOTO_DIR}${userId}_${date}_${Date.now()}.jpg`
  await FileSystem.copyAsync({ from: srcUri, to: dest })
  return withIndex(async () => {
    const map = await getFitPhotos(userId)
    const previous = map[date]
    map[date] = dest
    try {
      await AsyncStorage.setItem(key(userId), JSON.stringify(map))
    } catch (e) {
      await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {})
      throw e
    }
    // Replace any previous photo for the same day, once the new one is indexed
    if (previous && previous !== dest) await FileSystem.deleteAsync(previous, { idempotent: true }).catch(() => {})
    return dest
  })
}

export async function deleteFitPhoto(userId, date) {
  return withIndex(async () => {
    const map = await getFitPhotos(userId)
    const uri = map[date]
    if (!uri) return
    delete map[date]
    await AsyncStorage.setItem(key(userId), JSON.stringify(map))
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})
  })
}

// ── Routine task / step photos ─────────────────────────────────────────────
// A task, and each step inside it, can carry one picture (exercise form, how
// the finished room should look). These are uploaded to the routine-photos
// bucket so they survive a reinstall and show up on every device; the task JSON
// stores the resulting public URL.
//
// The account is capped at MAX_ROUTINE_PHOTOS. The database enforces it — see
// the routine_photos limit trigger — and the checks here exist only to fail
// early with a message worth reading.

const STEP_IMG_DIR = FileSystem.documentDirectory + 'routinestepimgs/'

// Supabase query builders are PromiseLike — they implement then() but not
// catch(), so calling .catch() on one throws instead of swallowing the error.
// Cleanup paths that genuinely do not care whether they succeeded go through
// here.
function quietly(thenable) {
  return Promise.resolve(thenable).then(() => {}, () => {})
}

// How many uploads this account is currently using.
export async function countRoutinePhotos(userId) {
  // Opportunistic housekeeping first, so a slot freed while offline (or
  // leaked by an older app version) is back before the number is shown or
  // checked against the cap.
  await reconcileRoutinePhotoSlots(userId)
  const { count, error } = await supabase
    .from('routine_photos')
    .select('path', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (error) throw new Error('Could not check how many photos you have. Check your connection.')
  return count ?? 0
}

// Shrinks the picture, claims a slot, then uploads. Returns the public URL.
// Throws with a message meant for an alert.
export async function uploadRoutinePhoto(userId, srcUri) {
  // ~1280px wide JPEG keeps a full-width phone picture sharp at roughly 200 KB.
  let shrunk
  try {
    shrunk = await manipulateAsync(
      srcUri,
      [{ resize: { width: 1280 } }],
      { compress: 0.7, format: SaveFormat.JPEG, base64: true }
    )
  } catch {
    throw new Error('Could not read that picture. Please try another one.')
  }
  if (!shrunk?.base64) throw new Error('Could not read that picture. Please try another one.')

  // Same gate the avatar path goes through: the picture is checked by the
  // moderation edge function before any bytes reach the public bucket. This
  // fails CLOSED — no verdict, no upload — because the bucket is public and
  // nothing reviews it afterwards.
  const { data: verdict, error: modErr } = await supabase.functions.invoke('openai-proxy', {
    body: { action: 'moderate_image', base64: shrunk.base64 },
  })
  if (modErr || !verdict) {
    throw new Error('Could not check that photo right now. Check your connection and try again.')
  }
  if (verdict.flagged) {
    throw new Error('That photo may not be appropriate to share. Please choose a different one.')
  }

  const path = routinePhotoPath(userId, Date.now(), Math.random().toString(36).slice(2, 8))

  // Bytes move first, the ledger row second. If the app dies between the two,
  // the wreckage is an orphaned object — invisible, costing only storage, and
  // swept up by reconcileRoutinePhotoSlots — instead of the old failure mode:
  // a claimed slot pointing at nothing, which quietly shrank the photo cap
  // for good. The limit trigger still rejects the eleventh row; being over
  // the cap now just costs one doomed upload before the friendly error.
  const { error: upErr } = await supabase.storage
    .from(ROUTINE_PHOTO_BUCKET)
    .upload(path, base64ToBytes(shrunk.base64), { contentType: 'image/jpeg', upsert: false })
  if (upErr) {
    throw new Error('Could not upload that photo. Check your connection and try again.')
  }

  const { error: rowErr } = await supabase
    .from('routine_photos')
    .insert({ path, user_id: userId })
  if (rowErr) {
    // The slot claim failed, so the object must not linger. Best-effort: if
    // this delete dies too, reconcile catches the orphan later.
    await quietly(supabase.storage.from(ROUTINE_PHOTO_BUCKET).remove([path]))
    if (String(rowErr.message ?? '').includes(PHOTO_LIMIT_ERROR)) {
      throw new Error(
        `You've used all ${MAX_ROUTINE_PHOTOS} routine photos. Remove one from a task or step to free up a slot.`
      )
    }
    throw new Error('Could not save that photo. Check your connection and try again.')
  }

  const { data } = supabase.storage.from(ROUTINE_PHOTO_BUCKET).getPublicUrl(path)
  if (!data?.publicUrl) {
    await quietly(supabase.storage.from(ROUTINE_PHOTO_BUCKET).remove([path]))
    await quietly(supabase.from('routine_photos').delete().eq('path', path))
    throw new Error('Could not save that photo. Please try again.')
  }
  return data.publicUrl
}

// Removes a photo wherever it lives: an uploaded one frees its slot, one saved
// by an older version is just a file on this device. Safe to call with null.
export function deleteStepImage(uri) {
  if (!uri) return
  const path = storagePathFromUrl(uri)
  if (!path) {
    FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})
    return
  }
  // The ledger row IS the slot, so its delete rides the sync queue: done
  // offline it lands on the next flush, instead of silently keeping the slot
  // consumed until the user hits the 10-photo cap with fewer than 10 photos.
  // The storage object stays best-effort — an orphaned file costs bytes, not
  // a slot — and reconcileRoutinePhotoSlots retries it later.
  const owner = path.split('/')[0] // uid is the first path segment (routinePhotoPath)
  trySync('routine_photos', 'delete', null, { user_id: owner, path })
  quietly(supabase.storage.from(ROUTINE_PHOTO_BUCKET).remove([path]))
}

// The ledger and the bucket can disagree after a crash: a slot row whose
// upload never finished (older app versions wrote the row first), or an
// object whose row was deleted while the object delete itself failed. Both
// directions are repaired here. Anything younger than the grace window is
// left alone, so an upload that is mid-flight right now is never mistaken
// for wreckage. Cheap (two small requests), never throws, and safe to call
// opportunistically — countRoutinePhotos runs it before every count.
const RECONCILE_GRACE_MS = 60 * 60 * 1000

export async function reconcileRoutinePhotoSlots(userId) {
  if (!userId) return
  try {
    const [rowsRes, listRes] = await Promise.all([
      supabase.from('routine_photos').select('path, created_at').eq('user_id', userId),
      // The cap is 10, so one page comfortably covers real photos plus strays.
      supabase.storage.from(ROUTINE_PHOTO_BUCKET).list(userId, { limit: 100 }),
    ])
    if (rowsRes.error || listRes.error) return

    const cutoff = Date.now() - RECONCILE_GRACE_MS
    const oldEnough = (iso) => {
      const t = Date.parse(iso ?? '')
      return Number.isFinite(t) && t < cutoff
    }

    const rows = rowsRes.data ?? []
    const objects = listRes.data ?? []
    const objectPaths = new Set(objects.map(o => `${userId}/${o.name}`))
    const rowPaths = new Set(rows.map(r => r.path))

    // Slots with no object behind them — the leak that made users hit the
    // photo cap with fewer photos than the cap visible.
    const deadRows = rows
      .filter(r => !objectPaths.has(r.path) && oldEnough(r.created_at))
      .map(r => r.path)
    if (deadRows.length) {
      await quietly(
        supabase.from('routine_photos').delete().eq('user_id', userId).in('path', deadRows)
      )
    }

    // Objects with no slot — strays from an interrupted upload, or the retry
    // for a storage delete that failed when the photo was removed.
    const strayObjects = objects
      .filter(o => !rowPaths.has(`${userId}/${o.name}`) && oldEnough(o.created_at))
      .map(o => `${userId}/${o.name}`)
    if (strayObjects.length) {
      await quietly(supabase.storage.from(ROUTINE_PHOTO_BUCKET).remove(strayObjects))
    }
  } catch {
    // Housekeeping only — nothing here may surface an error to the caller.
  }
}

// Kept for photos saved before uploading existed, and as the fallback when a
// picture cannot be uploaded.
export async function saveStepImage(srcUri) {
  await FileSystem.makeDirectoryAsync(STEP_IMG_DIR, { intermediates: true }).catch(() => {})
  const dest = `${STEP_IMG_DIR}${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`
  await FileSystem.copyAsync({ from: srcUri, to: dest })
  return dest
}

// ── Passcode protection (stored in the device secure enclave) ──────────────

export async function getPhotoPasscode(userId) {
  try { return await SecureStore.getItemAsync(passKey(userId)) } catch { return null }
}

export async function setPhotoPasscode(userId, code) {
  if (code) await SecureStore.setItemAsync(passKey(userId), code)
  else await SecureStore.deleteItemAsync(passKey(userId)).catch(() => {})
}

/** Wipe this user's photos, index and passcode from the device. */
export async function clearLocalCache(userId) {
  if (!userId) return
  return withIndex(async () => {
    let map = {}
    try { map = await getFitPhotos(userId) } catch {}
    // Files first: the index is the only record of where they live.
    for (const uri of Object.values(map)) {
      if (!uri) continue
      try { await FileSystem.deleteAsync(uri, { idempotent: true }) } catch {}
    }
    try { await AsyncStorage.removeItem(key(userId)) } catch {}
    try { await SecureStore.deleteItemAsync(passKey(userId)) } catch {}
  })
}
