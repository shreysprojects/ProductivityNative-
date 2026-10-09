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
//
// Replay is paced per op, not per queue. Each failure bumps the op's attempt
// counter and pushes its next try out exponentially; a flush skips ops still
// waiting out their backoff so one sick op cannot stop the healthy ops behind
// it from draining. An op that fails MAX_ATTEMPTS times — or fails once with
// an error the server will deterministically repeat (constraint violation,
// RLS denial, unknown column) — moves to the dead-letter store under
// DEAD_LETTER_KEY. Its payload is kept there, never dropped, but it stops
// counting as pending: cloudSync gates its refresh on the pending count, and
// one poisoned op must not freeze cross-device sync forever.

const QUEUE_KEY = '@sync_queue_v1'
const DEAD_LETTER_KEY = '@sync_dead_letter_v1'
const MAX_OPS = 500
const MAX_ATTEMPTS = 8

// 30s doubling per failure, capped at an hour: quick enough to ride out a
// blip, slow enough not to hammer a struggling endpoint from every flush.
const BACKOFF_BASE_MS = 30 * 1000
const BACKOFF_CAP_MS = 60 * 60 * 1000
const backoffMs = attempts =>
  Math.min(BACKOFF_BASE_MS * 2 ** (Math.max(attempts, 1) - 1), BACKOFF_CAP_MS)

// Identity columns per table: two queued writes to the same record collapse
// into one, newest wins. A table that is absent is never collapsed.
const IDENTITY = {
  tasks:                 ['user_id', 'id'],
  day_todos:             ['user_id', 'date'],
  day_rules:             ['user_id'],
  weekly_routines:       ['user_id'],
  time_logs:             ['user_id', 'day', 'slot_start'],
  user_settings:         ['user_id', 'key'],
  journal_entries:       ['user_id', 'date'],
  schedule_items:        ['user_id', 'id'],
  calendar_events:       ['user_id', 'id'],
  user_goals:            ['user_id'],
  streaks:               ['user_id'],
  routine_runs:          ['user_id', 'routine_name', 'date'],
  history:               ['user_id', 'date', 'routine_name'],
  meals:                 ['user_id', 'date'],
  saved_meals:           ['user_id'],
  gym_splits:            ['user_id'],
  workout_plans:         ['user_id', 'muscle_group'],
  workout_logs:          ['user_id', 'date'],
  routine_names:         ['user_id'],
  routine_templates:     ['user_id', 'routine_name'],
  routine_photos:        ['path'], // the ledger's PK is the storage path itself
  productivity_sessions: ['id'],
  profiles:              ['id'],
}

// supabase-js surfaces server rejections as { message, details, hint, code },
// where code is a Postgres SQLSTATE or a PGRST-prefixed PostgREST code;
// network failures throw plain fetch errors with no code at all. Only codes
// that are deterministic for a fixed payload are called permanent here.
// Anything ambiguous — including FK violations, whose parent row may still be
// en route in this same queue — keeps retrying and falls to the attempt cap.
const PERMANENT_CODES = new Set([
  '23502',    // not-null violation
  '23505',    // a unique violation the upsert could not resolve
  '23514',    // check constraint violation
  '23P01',    // exclusion constraint violation
  '42501',    // insufficient_privilege — RLS said no and will keep saying no
  '42703',    // undefined column
  '42P01',    // undefined table
  '42883',    // undefined function
  'PGRST204', // column missing from PostgREST's schema cache
  'PGRST205', // table missing from PostgREST's schema cache
])

function isPermanent(err) {
  const code = err?.code
  if (typeof code !== 'string') return false
  // Class 22 is the data exceptions: bad type, bad format, value out of
  // range. Replaying the same payload can only hit the same wall.
  return PERMANENT_CODES.has(code) || code.startsWith('22')
}

let chain = Promise.resolve()
let flushPromise = null
let counter = 0
let deadLetterCount = null // unknown until the store is first read
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

// Persisting is no longer best-effort: a swallowed setItem failure used to
// report an op as safely queued when it only lived in memory. The failure now
// propagates so each caller can be honest about durability. The old silent
// slice(-MAX_OPS) cap is gone too — enqueue() refuses newcomers at capacity
// instead of quietly discarding the oldest promised write.
async function writeQueue(ops) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(ops))
  notify(ops.length, await currentDeadLetterCount())
  return ops.length
}

async function readDeadLetter() {
  try {
    const raw = await AsyncStorage.getItem(DEAD_LETTER_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    const list = Array.isArray(parsed) ? parsed : []
    deadLetterCount = list.length
    return list
  } catch {
    deadLetterCount = deadLetterCount ?? 0
    return []
  }
}

async function currentDeadLetterCount() {
  if (deadLetterCount === null) await readDeadLetter()
  return deadLetterCount ?? 0
}

function notify(pending, deadLettered, atCapacity = false) {
  for (const cb of listeners) {
    try { cb(pending, { pending, deadLettered, atCapacity }) } catch {}
  }
}

/**
 * Subscribe to sync-state changes. The callback receives the pending-write
 * count (as it always has) plus a details object:
 *   { pending, deadLettered, atCapacity }
 * deadLettered counts ops given up on and parked under DEAD_LETTER_KEY;
 * atCapacity flags a refused enqueue — the queue was full and the last write
 * was NOT durably queued. Returns an unsubscribe function.
 */
export function onSyncStateChange(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

// Dead-lettered ops are deliberately not counted: they will never drain on
// their own, and cloudSync refuses to refresh while anything is pending.
export async function pendingCount() {
  return (await readQueue()).length
}

function opKey({ table, action, payload, match }) {
  const source = match ?? payload ?? {}
  const cols = IDENTITY[table]
  if (cols) return `${table}|${action}|${cols.map(c => String(source[c] ?? '')).join('|')}`
  return `${table}|${action}|${JSON.stringify(source)}`
}

// A record's identity regardless of action, so a fresh upsert can also purge
// a stale queued delete of the same record (and vice versa). Null for tables
// outside IDENTITY, whose ops have no reliable record-level key.
function recordKey({ table, payload, match }) {
  const cols = IDENTITY[table]
  if (!cols) return null
  const source = match ?? payload ?? {}
  return `${table}|${cols.map(c => String(source[c] ?? '')).join('|')}`
}

async function runOp({ table, action, payload, match }) {
  let q = supabase.from(table)
  if (action === 'delete') {
    q = q.delete()
    for (const [col, val] of Object.entries(match ?? {})) q = q.eq(col, val)
  } else if (action === 'update') {
    // A partial change to an existing row. (An upsert of a partial row fails
    // on any NOT NULL column it leaves out, even when the row exists.)
    q = q.update(payload)
    for (const [col, val] of Object.entries(match ?? {})) q = q.eq(col, val)
  } else {
    // Older app versions queued epoch-ms numbers; Postgres timestamptz
    // rejects them, which left those ops failing forever. Normalize here so
    // queued legacy writes finally go through on replay.
    if (payload && typeof payload.updated_at === 'number') {
      payload = { ...payload, updated_at: new Date(payload.updated_at).toISOString() }
    }
    // Same for created_at: to-dos queued it as epoch ms, which Postgres
    // refused (22008), so not one to-do had ever reached the account.
    if (payload && typeof payload.created_at === 'number') {
      payload = { ...payload, created_at: new Date(payload.created_at).toISOString() }
    }
    q = q.upsert(payload)
  }
  const { error } = await q
  if (error) throw error
}

// Resolves true when the op is durably on disk, false when it is not (queue
// at capacity, or AsyncStorage refused the persist). Replacing a queued op
// for the same record is allowed even at capacity — the queue does not grow.
function enqueue(op) {
  return serialize(async () => {
    const ops = await readQueue()
    const key = opKey(op)
    // Partial updates to the same record carry different columns, so the
    // newer one is laid over the queued one instead of replacing it.
    if (op.action === 'update') {
      const prev = ops.find(o => opKey(o) === key)
      if (prev) op = { ...op, payload: { ...(prev.payload ?? {}), ...(op.payload ?? {}) } }
    }
    const next = ops.filter(o => opKey(o) !== key)
    if (next.length >= MAX_OPS) {
      // Refuse the newcomer rather than silently evict the oldest op, which
      // would drop a write the caller was already told is safely queued.
      notify(ops.length, await currentDeadLetterCount(), true)
      return false
    }
    next.push({ ...op, id: nextId(), ts: Date.now(), attempts: 0, nextAttemptAt: 0 })
    try {
      await writeQueue(next)
      return true
    } catch {
      return false
    }
  })
}

// A direct write that reached the server supersedes anything still queued for
// the same record — an older queued payload replayed afterwards would roll
// the record back, and an older queued delete would kill it. Runs through
// serialize() like every other queue mutation. Best-effort on persist: if the
// trimmed queue cannot be written the stale op merely survives, which is no
// worse than before the purge existed.
function purgeSuperseded(op) {
  const rec = recordKey(op)
  const key = opKey(op)
  return serialize(async () => {
    const ops = await readQueue()
    const next = ops.filter(o => (rec ? recordKey(o) !== rec : opKey(o) !== key))
    if (next.length === ops.length) return
    try { await writeQueue(next) } catch {}
  })
}

/**
 * Attempt a Supabase write; queue it for retry if it fails.
 * @returns {Promise<boolean|null>}
 *   true  — the write reached the server.
 *   false — the write failed but is durably queued and will be replayed.
 *   null  — the write failed AND could not be queued (queue at capacity, or
 *           storage refused the persist); the caller holds the only copy.
 * Both failure values are falsy, so existing truthiness checks keep meaning
 * "reached the server".
 */
export async function trySync(table, action, payload, match = null) {
  try {
    await runOp({ table, action, payload, match })
    await purgeSuperseded({ table, action, payload, match })
    return true
  } catch {
    const queued = await enqueue({ table, action, payload, match })
    return queued ? false : null
  }
}

/**
 * The newest queued — not yet landed — upsert payload for one record, or null
 * when the record has nothing queued or its newest queued op is a delete.
 *
 * Whole-row stores (the routine list, saved meals, a template, the streak)
 * are rebuilt from a read of the server copy. While an upsert for the record
 * is still queued, that server copy is OLDER than what the user last saved,
 * and the next write built from it both loses the queued change and — once it
 * lands — purges the queued op for good. Readers of those stores use this
 * payload in place of the server row when there is one.
 * @param {string} table
 * @param {object} match  the record's identity columns (see IDENTITY)
 */
export async function pendingUpsert(table, match) {
  const want = recordKey({ table, match })
  if (!want) return null
  const ops = await readQueue()
  // Ops are appended as they are queued, so the last one for the record is
  // the newest intent: a later delete means there is nothing to prefer.
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i]
    if (op.table !== table || recordKey(op) !== want) continue
    return op.action === 'upsert' ? (op.payload ?? null) : null
  }
  return null
}

/**
 * The newest queued op for one record as { action, payload }, or null.
 * @param {string} table
 * @param {object} match  the record's identity columns (see IDENTITY)
 */
export async function pendingOp(table, match) {
  const want = recordKey({ table, match })
  if (!want) return null
  const ops = await readQueue()
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i]
    if (op.table === table && recordKey(op) === want) return { action: op.action, payload: op.payload ?? null }
  }
  return null
}

/**
 * Every queued — not yet landed — upsert payload for `table`, oldest first.
 * For sweeps that must treat unsynced records as existing (a photo only a
 * template saved offline refers to is still in use).
 * @returns {Promise<object[]>}
 */
export async function pendingUpserts(table) {
  const ops = await readQueue()
  return ops.filter(op => op.table === table && op.action === 'upsert' && op.payload).map(op => op.payload)
}

/**
 * Record ids that have a queued — not dead-lettered — delete for `table`, so
 * merge-on-read code can avoid resurrecting records deleted while offline.
 * The id is the op's identity columns minus user_id, in IDENTITY order,
 * joined with '|' when composite (tasks → the task id, journal_entries → the
 * date, time_logs → "day|slot_start"). Singleton-per-user tables, whose
 * identity is user_id alone, never contribute.
 * @returns {Promise<Set<string>>}
 */
export async function pendingDeleteIds(table) {
  const ops = await readQueue()
  const out = new Set()
  for (const op of ops) {
    if (op.table !== table || op.action !== 'delete') continue
    const source = op.match ?? op.payload ?? {}
    const cols = (IDENTITY[table] ?? Object.keys(source)).filter(c => c !== 'user_id')
    const id = cols.map(c => String(source[c] ?? '')).join('|')
    if (id) out.add(id)
  }
  return out
}

async function flushOnce() {
  const ops = await readQueue()
  if (!ops.length) return 0

  const now = Date.now()
  const done = new Set()
  const retry = new Map() // id → patched attempt fields
  const dead = new Map()  // id → why the op is being given up on

  for (const op of ops) {
    // Still waiting out its backoff: skip it rather than block the ops
    // behind it. It stays queued — and pending, since its write has not
    // landed and refreshing over it would lose the edit.
    if ((op.nextAttemptAt ?? 0) > now) continue
    try {
      await runOp(op)
      done.add(op.id)
    } catch (err) {
      const attempts = (op.attempts ?? 0) + 1 // ops persisted by old versions carry no counter
      const lastError = String(err?.message ?? err)
      if (isPermanent(err) || attempts >= MAX_ATTEMPTS) {
        dead.set(op.id, {
          attempts,
          lastError,
          errorCode: typeof err?.code === 'string' ? err.code : null,
          reason: isPermanent(err) ? 'permanent' : 'max_attempts',
        })
      } else {
        retry.set(op.id, {
          attempts,
          nextAttemptAt: Date.now() + backoffMs(attempts),
          lastError,
        })
      }
    }
  }

  if (done.size || retry.size || dead.size) {
    // Matching by id keeps this safe against ops enqueued — or superseded and
    // re-enqueued under a fresh id — while the network calls were in flight.
    // Writing a snapshot back would erase them.
    await serialize(async () => {
      const current = await readQueue()

      // Bury the given-up ops first; an op only leaves the live queue once
      // the dead-letter store has durably accepted it, so a payload is never
      // in zero places.
      const corpses = current.filter(o => dead.has(o.id))
      let buried = false
      if (corpses.length) {
        try {
          const incoming = new Set(corpses.map(o => o.id))
          const list = (await readDeadLetter())
            .filter(d => !incoming.has(d.id)) // retrying a half-failed move must not duplicate
            .concat(corpses.map(o => ({ ...o, ...dead.get(o.id), deadLetteredAt: Date.now() })))
            .slice(-MAX_OPS) // even the graveyard is capped; beyond it the oldest corpses go
          await AsyncStorage.setItem(DEAD_LETTER_KEY, JSON.stringify(list))
          deadLetterCount = list.length
          buried = true
        } catch {
          // The store refused the corpses. Leave them in the live queue with
          // maxed counters and a long backoff, and retry the move next flush.
          for (const [id, info] of dead) {
            retry.set(id, {
              attempts: info.attempts,
              nextAttemptAt: Date.now() + BACKOFF_CAP_MS,
              lastError: info.lastError,
            })
          }
        }
      }

      const next = current
        .filter(o => !done.has(o.id) && !(buried && dead.has(o.id)))
        .map(o => (retry.has(o.id) ? { ...o, ...retry.get(o.id) } : o))
      try {
        await writeQueue(next)
      } catch {
        // The trimmed queue didn't persist. Harmless: completed upserts and
        // deletes are idempotent on replay, and a re-buried op is deduped by
        // id above. flushQueue must not reject — sign-out awaits it.
      }
    })
  }
  return (await readQueue()).length
}

/**
 * Replay queued writes. Concurrent callers share the in-flight run and all
 * await the same completion.
 * @returns {Promise<number>} operations still pending afterwards (ops waiting
 * out a backoff count as pending; dead-lettered ops do not).
 */
export function flushQueue() {
  if (!flushPromise) {
    flushPromise = flushOnce().finally(() => { flushPromise = null })
  }
  return flushPromise
}

/** Drop everything pending (used on sign-out so writes never cross accounts).
 * The dead-letter store goes too — its payloads belong to the old account. */
export function clearQueue() {
  return serialize(async () => {
    try { await AsyncStorage.removeItem(QUEUE_KEY) } catch {}
    try { await AsyncStorage.removeItem(DEAD_LETTER_KEY) } catch {}
    deadLetterCount = 0
    notify(0, 0)
  })
}
