import * as FileSystem from 'expo-file-system/legacy'
import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { supabase } from './supabase'
import { trySync, pendingUpserts } from './syncQueue'
import { ROUTINE_PHOTO_BUCKET, storagePathFromUrl, collectPhotoUris } from './photoPaths'

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

const UPLOAD_FAILED = 'Could not upload that photo. Check your connection and try again.'

// The bucket is public, so clients cannot write to it: the openai-proxy
// 'upload_photo' action checks the picture with the moderation model (and
// fails CLOSED — no verdict, no upload), stores it with the service role and,
// for a routine photo, claims the slot whose trigger enforces the cap. Its
// refusals carry a reason worth showing, which is what gets thrown.
async function uploadThroughProxy(base64, kind) {
  const { data, error } = await supabase.functions.invoke('openai-proxy', {
    body: { action: 'upload_photo', kind, base64 },
  })
  let body = data
  if (error) {
    // Non-2xx responses land here — the real reason is in the body.
    try { body = await error.context?.json() } catch { body = null }
  }
  if (body?.error) throw new Error(body.reason ?? UPLOAD_FAILED)
  if (error || !body?.url) throw new Error(UPLOAD_FAILED)
  return body.url
}

// Shrinks the picture and uploads it. Returns the public URL.
// Throws with a message meant for an alert.
export async function uploadRoutinePhoto(userId, srcUri) {
  if (!userId) throw new Error('Sign in to add photos.')
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
  return uploadThroughProxy(shrunk.base64, 'routine')
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
// for wreckage. Cheap (three small requests), never throws, and safe to call
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

    // Slots whose photo no routine uses any more: tasks replaced by an AI
    // rebuild, a deleted routine or alternative, an edit abandoned after the
    // upload. Nothing points at them, so nothing ever deleted them and each
    // one kept a slot for good. Templates are the only thing routine photos
    // are attached to; ones saved offline (still queued) count too.
    const templates = await supabase.from('routine_templates').select('tasks').eq('user_id', userId)
    if (!templates.error) {
      const inUse = new Set()
      const note = tasks => {
        for (const uri of collectPhotoUris(Array.isArray(tasks) ? tasks : [])) {
          const p = storagePathFromUrl(uri)
          if (p) inUse.add(p)
        }
      }
      for (const row of templates.data ?? []) note(row.tasks)
      for (const payload of await pendingUpserts('routine_templates')) note(payload.tasks)
      const unused = rows
        .filter(r => objectPaths.has(r.path) && !inUse.has(r.path) && oldEnough(r.created_at))
        .map(r => r.path)
      if (unused.length) {
        await quietly(supabase.storage.from(ROUTINE_PHOTO_BUCKET).remove(unused))
        await quietly(supabase.from('routine_photos').delete().eq('user_id', userId).in('path', unused))
      }
    }
  } catch {
    // Housekeeping only — nothing here may surface an error to the caller.
  }
}

// ── Saved-meal ingredient photos ───────────────────────────────────────────
// A picture next to an ingredient in a saved meal. Same bucket and the same
// moderation gate as routine photos, under the owner's ingredients/ folder,
// but no ledger row: these are small thumbnails and do not use a routine
// photo slot. The saved meal JSON stores the public URL.
export async function uploadIngredientPhoto(userId, srcUri) {
  if (!userId) throw new Error('Sign in to add photos.')
  let shrunk
  try {
    // A thumbnail next to a name: 640px is plenty and about 60 KB.
    shrunk = await manipulateAsync(
      srcUri,
      [{ resize: { width: 640 } }],
      { compress: 0.7, format: SaveFormat.JPEG, base64: true }
    )
  } catch {
    throw new Error('Could not read that picture. Please try another one.')
  }
  if (!shrunk?.base64) throw new Error('Could not read that picture. Please try another one.')
  // Same moderated path as routine photos, filed under the owner's
  // ingredients/ folder and without a ledger row.
  return uploadThroughProxy(shrunk.base64, 'ingredient')
}

// Every photo this account has in the public bucket, so account deletion
// can take them with it — the ledger rows cascade with the account, but the
// files themselves would otherwise stay reachable by URL forever.
export async function removeAllRoutinePhotos(userId) {
  if (!userId) return
  const bucket = supabase.storage.from(ROUTINE_PHOTO_BUCKET)
  for (const folder of [userId, `${userId}/ingredients`]) {
    for (let round = 0; round < 20; round++) {
      const { data, error } = await bucket.list(folder, { limit: 100 })
      if (error) break
      // Sub-folders come back as entries without an id; only files go.
      const files = (data ?? []).filter(o => o?.id).map(o => `${folder}/${o.name}`)
      if (!files.length) break
      const { error: rmErr } = await bucket.remove(files)
      if (rmErr) break
    }
  }
}

// Best effort, like the storage half of deleteStepImage: a leftover object
// costs bytes, nothing else. Safe to call with null.
export function deleteIngredientPhoto(url) {
  const path = storagePathFromUrl(url)
  if (!path) return
  quietly(supabase.storage.from(ROUTINE_PHOTO_BUCKET).remove([path]))
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
