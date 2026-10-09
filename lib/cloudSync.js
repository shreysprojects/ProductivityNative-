import { refreshFromCloud as refreshCore, clearLocalCache as clearCore } from './storage'
import { refreshFromCloud as refreshGoals, clearLocalCache as clearGoals } from './goalsStorage'
import { clearLocalCache as clearPhotos } from './photoStorage'
import { flushQueue } from './syncQueue'

// The app reads its local cache first and only falls back to Supabase when a
// key is missing, so without an explicit refresh a device that has been used
// once never sees edits made anywhere else. This pulls the server's copy over
// the local one at the points where that matters (sign-in, app foreground).

let refreshing = false

/**
 * Push anything queued offline, then pull the server's copy over the local
 * cache. Flushing first matters: refreshing before the queue drains would
 * overwrite local edits that had not reached the server yet.
 */
export async function syncFromCloud(userId) {
  if (!userId || refreshing) return
  refreshing = true
  try {
    // Pulling the server's copy over the local one is only safe once every
    // local edit has landed. If anything is still queued, leave the cache
    // alone — the next attempt will try again.
    const pending = await flushQueue()
    if (pending) return
    await Promise.allSettled([
      refreshCore(userId),
      refreshGoals(userId),
    ])
  } finally {
    refreshing = false
  }
}

/** Drop every locally cached copy for a user (used after account deletion). */
export async function clearAllLocalCache(userId) {
  if (!userId) return
  await Promise.allSettled([
    clearCore(userId),
    clearGoals(userId),
    clearPhotos(userId),
  ])
}
