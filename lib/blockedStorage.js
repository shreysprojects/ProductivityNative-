import { supabase } from './supabase'

// Block list (App Store Guideline 1.2: users must be able to block abusive
// users). Rows live in public.blocked_users, RLS-scoped to the blocker.
// The feed also filters server-side via the not_blocked() helper, so hiding
// is not purely cosmetic.

let cache = { userId: null, ids: null }

/** Blocked user ids for this user. Cached in memory for the session. */
export async function getBlockedIds(userId, { force = false } = {}) {
  if (!userId) return []
  if (!force && cache.userId === userId && cache.ids) return cache.ids

  const { data, error } = await supabase
    .from('blocked_users')
    .select('blocked_id')
    .eq('blocker_id', userId)

  // A transient failure falls back to the last good list rather than failing
  // open with []; only a user with no cache at all gets the empty list (and
  // the server-side not_blocked() filter still backstops that case).
  if (error) return cache.userId === userId && cache.ids ? cache.ids : []

  const ids = (data ?? []).map(r => r.blocked_id)
  cache = { userId, ids }
  return ids
}

export async function blockUser(userId, blockedId) {
  if (!userId || !blockedId || userId === blockedId) return
  const { error } = await supabase
    .from('blocked_users')
    // ON CONFLICT DO NOTHING: blocked_users has no UPDATE policy, so a
    // merge-duplicates upsert would fail RLS (42501) on a repeat block.
    .upsert({ blocker_id: userId, blocked_id: blockedId }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true })
  if (error) throw error
  if (cache.userId === userId && cache.ids && !cache.ids.includes(blockedId)) {
    cache = { userId, ids: [...cache.ids, blockedId] }
  }
}

export async function unblockUser(userId, blockedId) {
  if (!userId || !blockedId) return
  const { error } = await supabase
    .from('blocked_users')
    .delete()
    .eq('blocker_id', userId)
    .eq('blocked_id', blockedId)
  if (error) throw error
  if (cache.userId === userId && cache.ids) {
    cache = { userId, ids: cache.ids.filter(id => id !== blockedId) }
  }
}

export async function isBlocked(userId, otherId) {
  const ids = await getBlockedIds(userId)
  return ids.includes(otherId)
}

/** Drop the in-memory cache (call on sign-out / account switch). */
export function clearBlockedCache() {
  cache = { userId: null, ids: null }
}
