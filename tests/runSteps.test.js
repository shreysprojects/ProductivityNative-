// Tests for lib/runSteps.js — the step-picture reveal rule and the run-step
// shape that carries pictures into a run.
//
// Run with:  node tests/runSteps.test.js
//
// There is no test runner in this project and lib/ is ESM that Metro compiles,
// so this loads the module by stripping its `export` keywords and evaluating
// it. That works only because runSteps.js has no imports — if you ever add one,
// this loader has to change with it.

const fs = require('fs')
const path = require('path')

function loadPure(fileName, exportNames) {
  const file = path.join(__dirname, '..', 'lib', fileName)
  const src = fs.readFileSync(file, 'utf8')
  if (/^\s*import\s/m.test(src)) {
    throw new Error(`lib/${fileName} grew an import — it must stay pure, or this loader must be replaced.`)
  }
  const body = src.replace(/^export /gm, '')
  // eslint-disable-next-line no-new-func
  return new Function(`${body}\nreturn { ${exportNames.join(', ')} }`)()
}

function loadRunSteps() {
  return loadPure('runSteps.js', [
    'taskGoalSecs', 'blankRunStep', 'stepImageUnlocked', 'subStepImageUnlocked',
    'parseStartTimeInput', 'runWithAdjustedStart',
  ])
}

function loadPhotoPaths() {
  return loadPure('photoPaths.js', [
    'MAX_ROUTINE_PHOTOS', 'ROUTINE_PHOTO_BUCKET', 'isRemotePhoto',
    'storagePathFromUrl', 'routinePhotoPath', 'countRemotePhotos',
    'collectPhotoUris', 'base64ToBytes',
  ])
}

// ── Tiny assertion harness ─────────────────────────────────────────────────
let passed = 0
const failures = []

function check(name, fn) {
  try {
    fn()
    passed++
  } catch (err) {
    failures.push(`${name}: ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${msg} — expected ${e}, got ${a}`)
}

// ── The suite, as a function so the mutation guard can re-run it ───────────
// Returns the list of failure messages, empty when everything passed. The
// count of checks it ran is attached as `.total`.
function runSuite({
  taskGoalSecs, blankRunStep, stepImageUnlocked, subStepImageUnlocked,
  parseStartTimeInput, runWithAdjustedStart,
}) {
  const fails = []
  let total = 0
  const t = (name, fn) => {
    total++
    try { fn() } catch (err) { fails.push(`${name}: ${err.message}`) }
  }

  const done = { completedAt: 1738000000000 }
  const notDone = { completedAt: null }

  // — the reveal rule —
  t('first step is unlocked with nothing done', () => {
    assert(stepImageUnlocked([notDone, notDone, notDone], 0), 'index 0 should never be locked')
  })
  t('a step stays locked while the one before it is unchecked', () => {
    assert(!stepImageUnlocked([notDone, notDone], 1), 'step 1 should be locked')
  })
  t('a step unlocks once the step before it is checked', () => {
    assert(stepImageUnlocked([done, notDone], 1), 'step 1 should be unlocked')
  })
  t('the last step needs every earlier step, not just the previous one', () => {
    assert(!stepImageUnlocked([notDone, done, done], 3), 'a gap earlier in the list must keep it locked')
    assert(stepImageUnlocked([done, done, done], 3), 'all earlier done should unlock it')
  })
  t('unchecking a step re-locks everything after it', () => {
    assert(!stepImageUnlocked([done, notDone, done], 2), 'step 2 re-locks when step 1 is unchecked')
  })
  t('missing run steps count as not done', () => {
    assert(!stepImageUnlocked([undefined, undefined], 1), 'an absent run step must not unlock the next picture')
    assert(stepImageUnlocked(undefined, 0), 'no run at all still shows the first picture')
  })

  // — the same rule for the steps inside a task, which use `done` —
  t('the first step in a task is unlocked', () => {
    assert(subStepImageUnlocked([{ done: false }, { done: false }], 0), 'step 0 should never be locked')
  })
  t('a step stays locked while an earlier step is unchecked', () => {
    assert(!subStepImageUnlocked([{ done: false }, { done: false }], 1), 'step 1 should be locked')
    assert(!subStepImageUnlocked([{ done: false }, { done: true }], 2), 'a gap earlier must keep it locked')
  })
  t('a step unlocks once every step above it is checked', () => {
    assert(subStepImageUnlocked([{ done: true }], 1), 'step 1 unlocks')
    assert(subStepImageUnlocked([{ done: true }, { done: true }], 2), 'step 2 unlocks')
  })
  t('sub-steps do not read completedAt', () => {
    // A task records completedAt; a step records done. Reading the wrong one
    // silently unlocks (or hides) every step photo.
    assert(!subStepImageUnlocked([{ completedAt: 123 }], 1), 'completedAt must not unlock a step photo')
  })

  // — the run-step shape —
  t('blankRunStep carries each step picture into the run', () => {
    const step = blankRunStep({
      id: 1, text: 'A',
      subTasks: [{ id: 2, text: 'sub', image: 'file://sub.jpg' }],
    })
    eq(step.subTasks[0].image, 'file://sub.jpg', 'step picture should survive into the run')
    eq(step.subTasks[0].done, false, 'step should start unchecked')
  })

  t('blankRunStep carries the task picture into the run', () => {
    const step = blankRunStep({ id: 7, text: 'Stretch', image: 'file://step.jpg', subTasks: [] })
    eq(step.image, 'file://step.jpg', 'picture should survive into the run step')
  })
  t('a task with no picture gets an explicit null', () => {
    const step = blankRunStep({ id: 7, text: 'Stretch', subTasks: [] })
    eq(step.image, null, 'missing picture should normalise to null')
  })
  t('blankRunStep starts with no progress and unchecked sub-steps', () => {
    const step = blankRunStep({ id: 1, text: 'A', subTasks: [{ id: 2, text: 'sub' }] })
    eq(step.completedAt, null, 'completedAt')
    eq(step.elapsedMs, 0, 'elapsedMs')
    eq(step.subTasks, [{ id: 2, text: 'sub', done: false }], 'subTasks')
  })
  t('blankRunStep survives Array.map passing an index', () => {
    const steps = [{ id: 1, text: 'A', image: 'file://a.jpg' }].map(blankRunStep)
    eq(steps[0].image, 'file://a.jpg', 'mapped step keeps its picture')
  })

  // — legacy time goals —
  t('taskGoalSecs reads seconds, then legacy minutes', () => {
    eq(taskGoalSecs({ timeGoalSecs: 90 }), 90, 'seconds')
    eq(taskGoalSecs({ timeGoalMins: 2 }), 120, 'legacy minutes')
    eq(taskGoalSecs({}), 0, 'neither')
  })

  // — "I started at a different time": parsing the typed clock time —
  // All in local time; mk(day, h, m) is a moment on that August 2026 day.
  const mk = (day, h, m) => new Date(2026, 7, day, h, m, 0, 0).getTime()

  t('a bare time means its most recent occurrence', () => {
    eq(parseStartTimeInput('6:45', mk(25, 7, 30)), mk(25, 6, 45), 'this morning, not yesterday evening')
    eq(parseStartTimeInput('7', mk(25, 7, 30)), mk(25, 7, 0), 'bare hour, half an hour ago')
  })
  t('an am/pm suffix is honored, wrapping to yesterday when needed', () => {
    eq(parseStartTimeInput('6:45 pm', mk(25, 7, 30)), mk(24, 18, 45), 'pm at 7:30am is yesterday evening')
    eq(parseStartTimeInput('6:45am', mk(25, 7, 30)), mk(25, 6, 45), 'no space before the suffix')
    eq(parseStartTimeInput('6:45 p.m.', mk(25, 7, 30)), mk(24, 18, 45), 'dotted suffix')
  })
  t('24-hour times are unambiguous', () => {
    eq(parseStartTimeInput('18:45', mk(25, 19, 0)), mk(25, 18, 45), 'today')
    eq(parseStartTimeInput('18:45', mk(25, 7, 30)), mk(24, 18, 45), 'yesterday when not yet reached')
    eq(parseStartTimeInput('0:30', mk(25, 1, 0)), mk(25, 0, 30), '0:xx is midnight, not noon')
  })
  t('a night routine crossing midnight resolves to yesterday', () => {
    eq(parseStartTimeInput('11:50 pm', mk(25, 0, 10)), mk(24, 23, 50), '20 minutes ago, across midnight')
  })
  t('12 o\'clock edge cases', () => {
    eq(parseStartTimeInput('12:15 am', mk(25, 1, 0)), mk(25, 0, 15), '12:15am is just after midnight')
    eq(parseStartTimeInput('12', mk(25, 13, 0)), mk(25, 12, 0), 'bare 12 after noon is noon')
  })
  t('the parsed start is never in the future', () => {
    for (const [text, now] of [['6:45', mk(25, 7, 30)], ['11:50 pm', mk(25, 0, 10)], ['9', mk(25, 8, 0)]]) {
      const ts = parseStartTimeInput(text, now)
      assert(ts != null && ts <= now, `"${text}" resolved into the future`)
    }
  })
  t('non-times are rejected', () => {
    for (const bad of ['', 'abc', '25:00', '7:75', '13 pm', '6:4', null, undefined]) {
      eq(parseStartTimeInput(bad, mk(25, 12, 0)), null, `"${bad}" should be null`)
    }
  })

  // — applying the adjusted start to a run —
  const baseRun = () => ({
    startedAt: mk(25, 7, 0),
    currentStep: 0,
    steps: [
      { id: 1, startedAt: mk(25, 7, 0), completedAt: null, elapsedMs: 0 },
      { id: 2, startedAt: null, completedAt: null, elapsedMs: 0 },
    ],
    finished: false,
  })

  t('adjusting the first task moves the routine start with it', () => {
    const u = runWithAdjustedStart(baseRun(), mk(25, 6, 30), mk(25, 7, 10))
    eq(u.steps[0].startedAt, mk(25, 6, 30), 'task start')
    eq(u.startedAt, mk(25, 6, 30), 'routine start follows the first task')
  })
  t('adjusting the first task later also moves the routine start later', () => {
    const u = runWithAdjustedStart(baseRun(), mk(25, 7, 5), mk(25, 7, 10))
    eq(u.startedAt, mk(25, 7, 5), 'routine start follows even forward')
  })
  t('adjusting a later task can only pull the routine start earlier', () => {
    const run = { ...baseRun(), currentStep: 1 }
    run.steps[1].startedAt = mk(25, 7, 20)
    const pulled = runWithAdjustedStart(run, mk(25, 6, 30), mk(25, 7, 30))
    eq(pulled.steps[1].startedAt, mk(25, 6, 30), 'task start')
    eq(pulled.startedAt, mk(25, 6, 30), 'routine start pulled back to cover the task')
    const kept = runWithAdjustedStart(run, mk(25, 7, 15), mk(25, 7, 30))
    eq(kept.startedAt, mk(25, 7, 0), 'a later task start leaves the routine start alone')
  })
  t('a start in the future is clamped to now', () => {
    const u = runWithAdjustedStart(baseRun(), mk(25, 9, 0), mk(25, 7, 10))
    eq(u.steps[0].startedAt, mk(25, 7, 10), 'clamped to now')
  })
  t('only the current task is touched', () => {
    const run = { ...baseRun(), currentStep: 1 }
    run.steps[0].completedAt = mk(25, 7, 10)
    const u = runWithAdjustedStart(run, mk(25, 6, 30), mk(25, 7, 30))
    eq(u.steps[0].startedAt, mk(25, 7, 0), 'earlier task start untouched')
    eq(u.steps[0].completedAt, mk(25, 7, 10), 'earlier task completion untouched')
  })

  fails.total = total
  return fails
}

// ── Photo storage helpers ─────────────────────────────────────────────────
function runPhotoSuite(mod) {
  const {
    MAX_ROUTINE_PHOTOS, isRemotePhoto, storagePathFromUrl,
    routinePhotoPath, countRemotePhotos, collectPhotoUris, base64ToBytes,
  } = mod
  const fails = []
  let total = 0
  const t = (name, fn) => {
    total++
    try { fn() } catch (err) { fails.push(`${name}: ${err.message}`) }
  }

  const BASE = 'https://abc.supabase.co/storage/v1/object/public/routine-photos'

  t('the cap matches the one the database enforces', () => {
    // supabase/migrations/20260821090000_routine_photos.sql raises at 10.
    eq(MAX_ROUTINE_PHOTOS, 10, 'MAX_ROUTINE_PHOTOS')
  })
  t('uploaded photos are recognised as remote, local files are not', () => {
    assert(isRemotePhoto(`${BASE}/u/1.jpg`), 'https should be remote')
    assert(!isRemotePhoto('file:///data/app/routinestepimgs/1.jpg'), 'file:// is local')
    assert(!isRemotePhoto(null) && !isRemotePhoto(undefined), 'nullish is not remote')
  })
  t('the storage path is recovered from a public URL', () => {
    eq(storagePathFromUrl(`${BASE}/uid-1/1700_ab12.jpg`), 'uid-1/1700_ab12.jpg', 'path')
  })
  t('a cache-busting query string is not part of the path', () => {
    eq(storagePathFromUrl(`${BASE}/uid-1/a.jpg?t=123`), 'uid-1/a.jpg', 'path')
  })
  t('percent-encoding in the URL is undone', () => {
    eq(storagePathFromUrl(`${BASE}/uid%201/a.jpg`), 'uid 1/a.jpg', 'decoded path')
  })
  t('local files and other buckets yield no storage path', () => {
    // Returning a path for these would delete the wrong object, or try to.
    eq(storagePathFromUrl('file:///x/y.jpg'), null, 'local file')
    eq(storagePathFromUrl('https://abc.supabase.co/storage/v1/object/public/avatars/u/a.jpg'), null, 'other bucket')
    eq(storagePathFromUrl(null), null, 'nullish')
  })
  t('the upload path starts with the user id', () => {
    // The storage policies check (storage.foldername(name))[1] = auth.uid(),
    // so anything else makes every upload fail as unauthorised.
    const p = routinePhotoPath('user-9', 1700, 'ab12')
    eq(p.split('/')[0], 'user-9', 'first segment')
    assert(p.endsWith('.jpg'), 'should be a .jpg')
  })
  t('slot counting includes step photos, not just task photos', () => {
    const tasks = [
      { image: `${BASE}/u/1.jpg`, subTasks: [{ image: `${BASE}/u/2.jpg` }, { image: null }] },
      { image: null, subTasks: [{ image: `${BASE}/u/3.jpg` }] },
    ]
    eq(countRemotePhotos(tasks), 3, 'remote count')
  })
  t('local photos do not use an upload slot', () => {
    const tasks = [{ image: 'file:///x/a.jpg', subTasks: [{ image: 'file:///x/b.jpg' }] }]
    eq(countRemotePhotos(tasks), 0, 'local photos are not uploads')
  })
  t('slot counting survives missing subTasks', () => {
    eq(countRemotePhotos([{ image: `${BASE}/u/1.jpg` }]), 1, 'no subTasks key')
    eq(countRemotePhotos(undefined), 0, 'no tasks at all')
  })
  t('collectPhotoUris gathers both levels', () => {
    const tasks = [{ image: 'a', subTasks: [{ image: 'b' }, {}] }, { subTasks: [{ image: 'c' }] }]
    eq(collectPhotoUris(tasks), ['a', 'b', 'c'], 'uris')
  })

  // base64ToBytes is checked against Node's own decoder, which is the thing it
  // has to agree with — a decoder that is merely self-consistent would upload
  // corrupt JPEGs that only fail once they reach a device.
  t('base64 decoding matches Node for every payload length', () => {
    for (let len = 0; len < 40; len++) {
      const buf = Buffer.alloc(len)
      for (let i = 0; i < len; i++) buf[i] = (i * 37 + len * 11) % 256
      const b64 = buf.toString('base64')
      const got = Buffer.from(base64ToBytes(b64))
      if (!got.equals(buf)) {
        throw new Error(`length ${len}: expected ${buf.toString('hex')}, got ${got.toString('hex')}`)
      }
    }
  })
  t('base64 decoding handles real JPEG header bytes', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00])
    const got = Buffer.from(base64ToBytes(jpeg.toString('base64')))
    assert(got.equals(jpeg), 'JPEG magic bytes must survive the round trip')
  })
  t('base64 decoding ignores whitespace and newlines', () => {
    const buf = Buffer.from('hello world, routine photo')
    const wrapped = buf.toString('base64').replace(/(.{4})/g, '$1\n')
    assert(Buffer.from(base64ToBytes(wrapped)).equals(buf), 'wrapped base64 should decode')
  })

  fails.total = total
  return fails
}

// ── Run against the real module ───────────────────────────────────────────
const real = loadRunSteps()
const realFailures = runSuite(real)
realFailures.forEach(f => failures.push(f))
passed += realFailures.total - realFailures.length

const realPhotos = loadPhotoPaths()
const photoFailures = runPhotoSuite(realPhotos)
photoFailures.forEach(f => failures.push(f))
passed += photoFailures.total - photoFailures.length

// ── Mutation guard ────────────────────────────────────────────────────────
// A test suite that cannot fail is worth nothing. Re-run the same assertions
// against deliberately broken versions of each rule and confirm they are
// caught — this is what proves the suite still detects the original bugs.
const mutants = [
  {
    name: 'blankRunStep drops the picture (the original bug)',
    mod: { ...real, blankRunStep: t => ({ ...real.blankRunStep(t), image: undefined }) },
  },
  {
    name: 'stepImageUnlocked always returns true (no gating)',
    mod: { ...real, stepImageUnlocked: () => true },
  },
  {
    name: 'stepImageUnlocked checks only the immediately previous step',
    mod: { ...real, stepImageUnlocked: (steps, i) => i === 0 || !!steps?.[i - 1]?.completedAt },
  },
  {
    name: 'taskGoalSecs ignores legacy minutes',
    mod: { ...real, taskGoalSecs: t => t?.timeGoalSecs ?? 0 },
  },
  {
    name: 'subStepImageUnlocked always returns true (no step gating)',
    mod: { ...real, subStepImageUnlocked: () => true },
  },
  {
    name: 'subStepImageUnlocked reads completedAt instead of done',
    mod: {
      ...real,
      subStepImageUnlocked: (subs, i) => {
        for (let k = 0; k < i; k++) if (!subs?.[k]?.completedAt) return false
        return true
      },
    },
  },
  {
    name: 'blankRunStep drops step pictures while keeping the task picture',
    mod: {
      ...real,
      blankRunStep: task => {
        const s = real.blankRunStep(task)
        return { ...s, subTasks: s.subTasks.map(({ image, ...rest }) => rest) }
      },
    },
  },
  {
    name: 'parseStartTimeInput reads pm as am',
    mod: {
      ...real,
      parseStartTimeInput: (text, now) =>
        real.parseStartTimeInput(String(text ?? '').replace(/p/gi, 'a'), now),
    },
  },
  {
    name: 'parseStartTimeInput anchors to the wrong day (can return the future)',
    mod: {
      ...real,
      parseStartTimeInput: (text, now) =>
        real.parseStartTimeInput(text, now + 24 * 60 * 60 * 1000),
    },
  },
  {
    name: 'runWithAdjustedStart never moves the routine start',
    mod: {
      ...real,
      runWithAdjustedStart: (run, t, now) =>
        ({ ...real.runWithAdjustedStart(run, t, now), startedAt: run.startedAt }),
    },
  },
  {
    name: 'runWithAdjustedStart accepts a start in the future',
    mod: {
      ...real,
      runWithAdjustedStart: (run, t, now) =>
        real.runWithAdjustedStart(run, t, Math.max(now, t)),
    },
  },
  {
    name: 'runWithAdjustedStart rewrites every task start, not just the current one',
    mod: {
      ...real,
      runWithAdjustedStart: (run, t, now) => {
        const u = real.runWithAdjustedStart(run, t, now)
        const cur = u.steps[run.currentStep].startedAt
        return { ...u, steps: u.steps.map(s => ({ ...s, startedAt: cur })) }
      },
    },
  },
]

const photoMutants = [
  {
    name: 'base64 decoder drops the tail bytes of unpadded input',
    mod: { ...realPhotos, base64ToBytes: b64 => realPhotos.base64ToBytes(b64).subarray(0, -1) },
  },
  {
    name: 'storagePathFromUrl keeps the query string',
    mod: {
      ...realPhotos,
      storagePathFromUrl: url => {
        const p = realPhotos.storagePathFromUrl(url)
        return p ? `${p}?t=1` : p
      },
    },
  },
  {
    name: 'storagePathFromUrl treats a local file as a storage object',
    mod: { ...realPhotos, storagePathFromUrl: url => (url ? String(url) : null) },
  },
  {
    name: 'the upload path omits the user id prefix',
    mod: { ...realPhotos, routinePhotoPath: (uid, seed, rand) => `${seed}_${rand}.jpg` },
  },
  {
    name: 'slot counting ignores step photos',
    mod: {
      ...realPhotos,
      countRemotePhotos: tasks =>
        (tasks ?? []).filter(t => realPhotos.isRemotePhoto(t?.image)).length,
    },
  },
  {
    name: 'the client cap drifts from the database cap',
    mod: { ...realPhotos, MAX_ROUTINE_PHOTOS: 20 },
  },
]

check('mutation guard: every broken variant is caught', () => {
  const survivors = [
    ...mutants.filter(m => runSuite(m.mod).length === 0),
    ...photoMutants.filter(m => runPhotoSuite(m.mod).length === 0),
  ].map(m => m.name)
  assert(
    survivors.length === 0,
    `these regressions would slip through undetected:\n    - ${survivors.join('\n    - ')}`
  )
})

// ── Report ────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} failing\n`)
  failures.forEach(f => console.error(`  ✗ ${f}`))
  console.error('')
  process.exit(1)
}
console.log(`\n✓ runSteps: ${passed} checks passed (including the mutation guard)\n`)
