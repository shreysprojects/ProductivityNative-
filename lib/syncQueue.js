import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

// Durable retry queue for Supabase writes.
//
// The app is local-first: AsyncStorage is written synchronously and the cloud
// write follows. A swallowed cloud failure used to mean the write never
// reached Supabase and was lost on reinstall, since Supabase is the only copy
// a fresh install reads. Every cloud write now goes through trySync(), which
// persists the operation on failure and replays it on the next foreground.
//
// Because a queued write is replayed LATER, only writes that are still correct
// out of order belong here. Anything derived from a read that might have
// failed must not be queued — the caller has to refuse instead, or the replay
// will overwrite good server data with a guess.

const QUEUE_KEY = '@sync_queue_v1'
const MAX_OPS = 500

// Identity columns per table: two queued writes to the same record collapse
// into one, newest wins. A table that is absent is never collapsed.
const IDENTITY = {
  tasks:                 ['user_id', 'id'],
  day_todos:             ['user_id', 'date'],
  day_rules:             ['user_id'],
  weekly_routines:       ['user_id'],
  journal_entries:       ['user_id', 'date'],
  schedule_items:        ['user_id', 'id'],
  calendar_events:       ['user_id', 'id'],
  user_goals:            ['user_id'],
  streaks:               ['user_id'],
  routine_runs:          ['user_id', 'routine_name', 'date'],
  history:               ['user_id', 'date', 'routine_name'],
  meals:                 ['user_id', 'date'],
  saved_meals:           ['user_id'],
  workout_plans:         ['user_id', 'muscle_group'],
  workout_logs:          ['user_id', 'date'],
  routine_names:         ['user_id'],
  routine_templates:     ['user_id', 'routine_name'],
  productivity_sessions: ['id'],
  profiles:              ['id'],
}

let chain = Promise.resolve()
let flushPromise = null
let counter = 0
const listeners = new Set()

const nextId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`

// Every mutation of the stored queue runs here, so concurrent failures can't
// read the same base array and overwrite each other.
function serialize(fn) {
  const run = chain.then(fn, fn)
  chain = run.then(() => {}, () => {})
  return run
}

async function readQueue() {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeQueue(ops) {
  const capped = ops.slice(-MAX_OPS)
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(capped))
  } catch {}
  notify(capped.length)
  return capped.length
}

function notify(count) {
  for (const cb of listeners) {
    try { cb(count) } catch {}
  }
}

/** Subscribe to pending-write count changes. Returns an unsubscribe function. */
export function onSyncStateChange(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export async function pendingCount() {
  return (await readQueue()).length
}

function opKey({ table, action, payload, match }) {
  const source = match ?? payload ?? {}
  const cols = IDENTITY[table]
  if (cols) return `${table}|${action}|${cols.map(c => String(source[c] ?? '')).join('|')}`
  return `${table}|${action}|${JSON.stringify(source)}`
}

async function runOp({ table, action, payload, match }) {
  let q = supabase.from(table)
  if (action === 'delete') {
    q = q.delete()
    for (const [col, val] of Object.entries(match ?? {})) q = q.eq(col, val)
  } else {
    // Older app versions queued epoch-ms numbers; Postgres timestamptz
    // rejects them, which left those ops failing forever. Normalize here so
    // queued legacy writes finally go through on replay.
    if (payload && typeof payload.updated_at === 'number') {
      payload = { ...payload, updated_at: new Date(payload.updated_at).toISOString() }
    }
    q = q.upsert(payload)
  }
  const { error } = await q
  if (error) throw error
}

function enqueue(op) {
  return serialize(async () => {
    const ops = await readQueue()
    const key = opKey(op)
    const next = ops.filter(o => opKey(o) !== key)
    next.push({ ...op, id: nextId(), ts: Date.now() })
    await writeQueue(next)
  })
}

/**
 * Attempt a Supabase write; queue it for retry if it fails.
 * @returns {Promise<boolean>} true when the write reached the server.
 */
export async function trySync(table, action, payload, match = null) {
  try {
    await runOp({ table, action, payload, match })
    return true
  } catch {
    await enqueue({ table, action, payload, match })
    return false
  }
}

async function flushOnce() {
  const ops = await readQueue()
  if (!ops.length) return 0

  const done = new Set()
  for (const op of ops) {
    try {
      await runOp(op)
      done.add(op.id)
    } catch {
      // Leave it queued for the next attempt.
    }
  }

  if (done.size) {
    // Remove only what succeeded. Writing a snapshot back would erase
    // anything enqueued while this flush was in flight.
    await serialize(async () => {
      const current = await readQueue()
      await writeQueue(current.filter(o => !done.has(o.id)))
    })
  }
  return (await readQueue()).length
}

/**
 * Replay queued writes. Concurrent callers share the in-flight run and all
 * await the same completion.
 * @returns {Promise<number>} operations still pending afterwards.
 */
export function flushQueue() {
  if (!flushPromise) {
    flushPromise = flushOnce().finally(() => { flushPromise = null })
  }
  return flushPromise
}

/** Drop everything pending (used on sign-out so writes never cross accounts). */
export function clearQueue() {
  return serialize(async () => {
    try { await AsyncStorage.removeItem(QUEUE_KEY) } catch {}
    notify(0)
  })
}
