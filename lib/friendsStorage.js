import { supabase } from './supabase'

export async function getMyFriendCode(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('friend_code')
    .eq('id', userId)
    .single()
  return data?.friend_code ?? null
}

async function findExistingFriendship(userId1, userId2) {
  const [a, b] = await Promise.all([
    supabase.from('friendships').select('id, status, requester_id, addressee_id')
      .eq('requester_id', userId1).eq('addressee_id', userId2).maybeSingle(),
    supabase.from('friendships').select('id, status, requester_id, addressee_id')
      .eq('requester_id', userId2).eq('addressee_id', userId1).maybeSingle(),
  ])
  return a.data ?? b.data ?? null
}

export async function getFriends(userId) {
  const { data } = await supabase
    .from('friendships')
    .select('id, requester_id, addressee_id, created_at')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .eq('status', 'accepted')
  if (!data?.length) return []
  const friendIds = data.map(f => f.requester_id === userId ? f.addressee_id : f.requester_id)
  const { data: profiles } = await supabase
    .from('public_profiles')
    .select('id, username, bio, avatar_url')
    .in('id', friendIds)
  return data.map(f => {
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
  const { data: profiles } = await supabase
    .from('public_profiles')
    .select('id, username, bio, avatar_url')
    .in('id', data.map(f => f.requester_id))
  return data.map(f => {
    const p = (profiles ?? []).find(pr => pr.id === f.requester_id) ?? {}
    return { friendshipId: f.id, userId: f.requester_id, username: p.username ?? null, bio: p.bio ?? '', avatarUrl: p.avatar_url ?? '', createdAt: f.created_at }
  })
}

export async function addFriendByCode(currentUserId, code) {
  // Lookup via SECURITY DEFINER RPC so friend codes aren't enumerable from the
  // profiles table. Returns at most one {id, username}.
  const { data: rows } = await supabase
    .rpc('lookup_friend_code', { code: code.trim().toUpperCase() })
  const prof = Array.isArray(rows) ? rows[0] : rows
  if (!prof) return { error: 'not_found' }
  if (prof.id === currentUserId) return { error: 'self' }
  const existing = await findExistingFriendship(currentUserId, prof.id)
  if (existing) {
    if (existing.status === 'accepted') return { error: 'already_friends' }
    if (existing.requester_id === currentUserId) return { error: 'pending_sent' }
    // They already sent us a request — auto-accept
    await supabase.from('friendships').update({ status: 'accepted' }).eq('id', existing.id)
    return { ok: true, accepted: true, username: prof.username }
  }
  const { error } = await supabase.from('friendships').insert({ requester_id: currentUserId, addressee_id: prof.id })
  if (error) return { error: 'db_error' }
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
