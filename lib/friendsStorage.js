import { supabase } from './supabase'
import { getBlockedIds } from './blockedStorage'

export async function getMyFriendCode(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('friend_code')
    .eq('id', userId)
    .single()
  return data?.friend_code ?? null
}

// A failed lookup throws rather than reading as "no friendship": carrying on
// from it would send a second request, or call an existing one new.
async function findExistingFriendship(userId1, userId2) {
  const [a, b] = await Promise.all([
    supabase.from('friendships').select('id, status, requester_id, addressee_id')
      .eq('requester_id', userId1).eq('addressee_id', userId2).maybeSingle(),
    supabase.from('friendships').select('id, status, requester_id, addressee_id')
      .eq('requester_id', userId2).eq('addressee_id', userId1).maybeSingle(),
  ])
  if (a.error || b.error) throw a.error ?? b.error
  return a.data ?? b.data ?? null
}

// Only the addressee can accept, and only the status can change (see the
// friendships policies). An accept that fails must not be reported as done.
async function acceptExisting(friendshipId) {
  const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId)
  return !error
}

export async function getFriends(userId) {
  const { data } = await supabase
    .from('friendships')
    .select('id, requester_id, addressee_id, created_at')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .eq('status', 'accepted')
  if (!data?.length) return []
  // Someone you blocked is never listed, even while an older friendship row
  // is still around.
  const blocked = new Set(await getBlockedIds(userId))
  const rows = data.filter(f => !blocked.has(f.requester_id === userId ? f.addressee_id : f.requester_id))
  if (!rows.length) return []
  const friendIds = rows.map(f => f.requester_id === userId ? f.addressee_id : f.requester_id)
  const { data: profiles } = await supabase
    .from('public_profiles')
    .select('id, username, bio, avatar_url')
    .in('id', friendIds)
  return rows.map(f => {
    const fid = f.requester_id === userId ? f.addressee_id : f.requester_id
    const p = (profiles ?? []).find(pr => pr.id === fid) ?? {}
    return { friendshipId: f.id, userId: fid, username: p.username ?? null, bio: p.bio ?? '', avatarUrl: p.avatar_url ?? '', createdAt: f.created_at }
  })
}

export async function getPendingRequests(userId) {
  const { data } = await supabase
    .from('friendships')
    .select('id, requester_id, created_at')
    .eq('addressee_id', userId)
    .eq('status', 'pending')
  if (!data?.length) return []
  const blocked = new Set(await getBlockedIds(userId))
  const rows = data.filter(f => !blocked.has(f.requester_id))
  if (!rows.length) return []
  const { data: profiles } = await supabase
    .from('public_profiles')
    .select('id, username, bio, avatar_url')
    .in('id', rows.map(f => f.requester_id))
  return rows.map(f => {
    const p = (profiles ?? []).find(pr => pr.id === f.requester_id) ?? {}
    return { friendshipId: f.id, userId: f.requester_id, username: p.username ?? null, bio: p.bio ?? '', avatarUrl: p.avatar_url ?? '', createdAt: f.created_at }
  })
}

export async function addFriendByCode(currentUserId, code) {
  // Lookup via SECURITY DEFINER RPC so friend codes aren't enumerable from the
  // profiles table. Returns at most one {id, username}. A lookup that failed
  // (offline, server error) is not "no such code" and is reported apart.
  const { data: rows, error: lookupError } = await supabase
    .rpc('lookup_friend_code', { code: code.trim().toUpperCase() })
  if (lookupError) return { error: 'lookup_failed' }
  const prof = Array.isArray(rows) ? rows[0] : rows
  if (!prof) return { error: 'not_found' }
  if (prof.id === currentUserId) return { error: 'self' }
  let existing
  try {
    existing = await findExistingFriendship(currentUserId, prof.id)
  } catch {
    return { error: 'lookup_failed' }
  }
  if (existing) {
    if (existing.status === 'accepted') return { error: 'already_friends' }
    if (existing.requester_id === currentUserId) return { error: 'pending_sent' }
    // They already sent us a request — auto-accept
    if (!(await acceptExisting(existing.id))) return { error: 'accept_failed' }
    return { ok: true, accepted: true, username: prof.username }
  }
  // Only the two ids: requests always start pending, and the column grants
  // refuse an insert that names a status at all.
  const { error } = await supabase.from('friendships').insert({ requester_id: currentUserId, addressee_id: prof.id })
  if (error) {
    // A unique index covers the unordered pair, so if they added us at the same
    // moment their row wins and ours comes back as a unique violation.
    if (error.code === '23505') {
      let raced
      try {
        raced = await findExistingFriendship(currentUserId, prof.id)
      } catch {
        return { error: 'lookup_failed' }
      }
      if (raced && raced.status !== 'accepted' && raced.requester_id !== currentUserId) {
        if (!(await acceptExisting(raced.id))) return { error: 'accept_failed' }
        return { ok: true, accepted: true, username: prof.username }
      }
      if (raced && raced.status !== 'accepted') return { error: 'pending_sent' }
      return { error: 'already_friends' }
    }
    return { error: 'db_error' }
  }
  return { ok: true, accepted: false, username: prof.username }
}

export async function acceptFriendRequest(friendshipId) {
  const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId)
  if (error) throw error
}

export async function declineFriendRequest(friendshipId) {
  const { error } = await supabase.from('friendships').delete().eq('id', friendshipId)
  if (error) throw error
}

export async function removeFriend(friendshipId) {
  const { error } = await supabase.from('friendships').delete().eq('id', friendshipId)
  if (error) throw error
}
