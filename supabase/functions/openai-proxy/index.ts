import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const OPENAI_KEY   = Deno.env.get('OPENAI_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Profile pictures only ever live here; moderate_profile_picture refuses to
// hand any other URL to the model (it would fetch whatever it was given).
const AVATAR_PREFIX = `${SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public/avatars/`
// Routine task/step photos and saved-meal ingredient photos.
const PHOTO_BUCKET        = 'routine-photos'
// Must match the cap in the routine_photos limit trigger and
// MAX_ROUTINE_PHOTOS in lib/photoPaths.js.
const MAX_ROUTINE_PHOTOS  = 10
const MAX_PER_DAY          = 3
const MAX_MOD_PER_DAY      = 60
const MAX_EXTRACT_PER_WEEK = 10
// Length of the base64 string, so ~1.5MB of decoded image.
const MAX_IMAGE_B64        = 2_000_000
// The food estimator charges one unit per call (clarify, then estimate), so
// this is about 20 foods a day.
const MAX_FOOD_PER_DAY     = 40

// Every nutrient the Meals tab tracks, in the app's own key names and units.
// Must match MACRO_GROUPS in components/AddMealModal.js.
const FOOD_NUTRIENTS: Array<[string, string]> = [
  ['calories', 'kcal'],
  ['protein', 'g'], ['carbs', 'g'], ['fiber', 'g'], ['sugar', 'g'], ['addedSugar', 'g'],
  ['fat', 'g'], ['saturatedFat', 'g'], ['transFat', 'g'], ['polyunsaturatedFat', 'g'], ['monounsaturatedFat', 'g'],
  ['sodium', 'mg'], ['potassium', 'mg'], ['cholesterol', 'mg'], ['calcium', 'mg'], ['iron', 'mg'],
  ['magnesium', 'mg'], ['zinc', 'mg'], ['phosphorus', 'mg'], ['selenium', 'mcg'], ['copper', 'mg'],
  ['manganese', 'mg'], ['chromium', 'mcg'], ['iodine', 'mcg'],
  ['vitaminA', 'mcg'], ['vitaminC', 'mg'], ['vitaminD', 'mcg'], ['vitaminE', 'mg'], ['vitaminK', 'mcg'],
  ['vitaminB6', 'mg'], ['vitaminB12', 'mcg'], ['folate', 'mcg'], ['thiamin', 'mg'], ['riboflavin', 'mg'],
  ['niacin', 'mg'], ['pantothenicAcid', 'mg'], ['biotin', 'mcg'],
]
const FOOD_MODEL = 'gpt-5.6-luna'

// Cheap text-only helpers (one small call each) share the 'light' daily cap.
const MAX_LIGHT_PER_DAY = 40
// Must match MUSCLE_OPTIONS in lib/customExercises.js: these are the names the
// app's muscle map understands.
const EXERCISE_MUSCLES = [
  'Chest', 'Upper Back', 'Lats', 'Lower Back', 'Traps', 'Shoulders',
  'Biceps', 'Triceps', 'Forearms',
  'Abs', 'Obliques', 'Core',
  'Hip Flexors', 'Adductors', 'Glutes', 'Quads', 'Hamstrings', 'Calves', 'Neck',
]

// ── AI meal planner (the Plan tab on the Meals page) ─────────────────────────
// A generation and each revision cost one unit of this daily cap.
const MAX_MEALPLAN_PER_DAY = 6
const PLAN_MODEL = 'gpt-5.6-luna'
// What the planner estimates per meal: the macros plus the vitamins and
// minerals most likely to fall short on a restricted diet. A subset of
// FOOD_NUTRIENTS, same keys and units, so a planned meal logs like any other.
const PLAN_NUTRIENTS: Array<[string, string]> = [
  ['calories', 'kcal'], ['protein', 'g'], ['carbs', 'g'], ['fat', 'g'],
  ['fiber', 'g'], ['sugar', 'g'], ['saturatedFat', 'g'],
  ['sodium', 'mg'], ['potassium', 'mg'], ['calcium', 'mg'], ['iron', 'mg'], ['magnesium', 'mg'], ['zinc', 'mg'],
  ['vitaminA', 'mcg'], ['vitaminC', 'mg'], ['vitaminD', 'mcg'], ['vitaminB12', 'mcg'], ['folate', 'mcg'],
]
const PLAN_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const PLAN_DAY_ALIASES: Record<string, string> = {
  mon: 'Mon', monday: 'Mon', tue: 'Tue', tues: 'Tue', tuesday: 'Tue', wed: 'Wed', wednesday: 'Wed',
  thu: 'Thu', thur: 'Thu', thurs: 'Thu', thursday: 'Thu', fri: 'Fri', friday: 'Fri',
  sat: 'Sat', saturday: 'Sat', sun: 'Sun', sunday: 'Sun',
}
const PLAN_SECTION_ALIASES: Record<string, string> = {
  morning: 'morning', breakfast: 'morning', brunch: 'morning',
  lunch: 'lunch', dinner: 'dinner', supper: 'dinner',
  snacks: 'snacks', snack: 'snacks', dessert: 'snacks',
}

// Actions that consume the daily generative rate limit.
// extract_workout has its own weekly cap (ai_workout_limits) instead.
const GENERATIVE = new Set(['create_routine', 'advise_routine', 'analyze_looks'])

// Moderation actions capped separately (moderate_routine, moderate_profile_picture
// and moderate_image call paid models; moderate_texts is the free endpoint but is
// capped too as abuse protection) so a scripted caller can't hammer them outside
// the normal UI. upload_avatar shares the same counter but is handled on its own
// because it cannot fail open.
const PAID_MOD = new Set(['moderate_routine', 'moderate_profile_picture', 'moderate_texts', 'moderate_image'])

const PICTURE_MOD_PROMPT = 'You are a content moderator for a family-friendly productivity app.\nReview this profile picture.\n\nBLOCK (allowed: false) if the image contains:\n- Nudity or sexual content\n- Hate symbols (swastikas, Nazi imagery, KKK, extremist symbols)\n- Violence or gore\n- Slurs or harassment text\n\nALLOW everything else: selfies, logos, art, memes, animals, landscapes, etc.\n\nReply with ONLY valid JSON:\n{"allowed": true}\n{"allowed": false, "reason": "one sentence, addressed to the user"}'

// App style rule: AI-written text the user sees must not contain em dashes.
// The prompts ask for this too, but models slip, so outputs are scrubbed as
// well. Extraction actions (workout/schedule) are exempt: they transcribe
// what's in the screenshot verbatim.
const noEmDash = (s: string) => s.replace(/\s*—\s*/g, ', ').replace(/–/g, '-')
const noEmDashDeep = (v: unknown): unknown => {
  if (typeof v === 'string') return noEmDash(v)
  if (Array.isArray(v)) return v.map(noEmDashDeep)
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, noEmDashDeep(x)])
    )
  }
  return v
}

// What a request used up: whose limit, which one, and whether a model that
// costs money was called.
type Usage = { user: string | null; kind: string | null; paid: boolean }

Deno.serve(async (req) => {
  const usage: Usage = { user: null, kind: null, paid: false }
  const res = await handle(req, usage)
  // Refused before any paid model call (flagged input, a bad or oversized
  // image, the moderation check itself failing): nothing was spent and the
  // user got nothing, so the use is given back. The refund is charged to the
  // day's moderation counter instead, so refusals stay capped. Moderation
  // actions ('mod') keep theirs: that counter is the cap.
  if (usage.user && usage.kind && usage.kind !== 'mod' && !usage.paid && res.status >= 400) {
    try {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY)
      const { error } = await admin.rpc('refund_ai_limit', {
        p_user: usage.user,
        p_kind: usage.kind,
        p_mod_max: MAX_MOD_PER_DAY,
      })
      if (error) console.error('refund_ai_limit failed:', error)
    } catch (e) {
      console.error('refund_ai_limit failed:', e)
    }
  }
  return res
})

async function handle(req: Request, usage: Usage): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // Every model call goes through here. Anything but the free moderation
  // endpoint costs money, which makes the request's limit use stick.
  const callOpenAI = (url: string, body: unknown) => {
    if (!url.endsWith('/moderations')) usage.paid = true
    return requestOpenAI(url, body)
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const auth = req.headers.get('Authorization') ?? ''
    if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401)

    const admin = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: { user }, error: authErr } = await admin.auth.getUser(auth.slice(7))
    if (authErr || !user) return json({ error: 'unauthorized' }, 401)
    usage.user = user.id

    const body = await req.json()
    const { action } = body
    if (!action) return json({ error: 'missing_action' }, 400)

    // ── Server-side rate limit ───────────────────────────────────────────────
    // Increments and checks in one statement; null means the counter itself failed.
    const consumeLimit = async (kind: string, max: number) => {
      const { data, error } = await admin.rpc('consume_ai_limit', {
        p_user: user.id,
        p_kind: kind,
        p_max: max,
      })
      if (error) {
        console.error('consume_ai_limit failed:', error)
        return null
      }
      const rl = data as { allowed: boolean; count: number }
      // Remembered so a request refused before any paid call can give it
      // back. (count 0 is the owner's exemption: nothing was taken.)
      if (rl?.allowed && rl.count > 0) usage.kind = kind
      return rl
    }

    const checkImageSize = (b64: string) =>
      b64.length > MAX_IMAGE_B64
        ? json({ error: 'image_too_large', reason: 'That image is too large. Please try a smaller photo.' }, 413)
        : null

    // A counter that cannot be reached is NOT the same as a limit that has
    // been hit. Reporting the two the same way once had every AI feature
    // claiming a limit the user had never used.
    const limitUnavailable = () => json(
      {
        error: 'limit_unavailable',
        reason: 'We could not check your usage limit right now. Please try again in a moment.',
      },
      503,
    )

    if (GENERATIVE.has(action)) {
      const rl = await consumeLimit('generative', MAX_PER_DAY)
      if (!rl) return limitUnavailable()
      if (!rl.allowed) {
        return json(
          { error: 'daily_limit', reason: `Daily limit of ${MAX_PER_DAY} AI uses reached. Try again tomorrow.` },
          429,
        )
      }
    } else if (action === 'extract_workout' || action === 'extract_schedule') {
      // Weekly cap (Mon–Sun, UTC), separate from the daily generative limit.
      // Workout and timetable imports share the same counter.
      const rl = await consumeLimit('workout', MAX_EXTRACT_PER_WEEK)
      if (!rl) return limitUnavailable()
      if (!rl.allowed) {
        return json(
          { error: 'daily_limit', reason: `Weekly limit of ${MAX_EXTRACT_PER_WEEK} screenshot imports reached. It resets on Monday.` },
          429,
        )
      }
    } else if (action === 'food_clarify' || action === 'food_estimate' || action === 'food_scan') {
      const rl = await consumeLimit('food', MAX_FOOD_PER_DAY)
      if (!rl) return limitUnavailable()
      if (!rl.allowed) {
        return json(
          { error: 'daily_limit', reason: `Daily limit of ${MAX_FOOD_PER_DAY / 2} AI food estimates reached. Try again tomorrow.` },
          429,
        )
      }
    } else if (action === 'exercise_muscles' || action === 'meal_coach') {
      const rl = await consumeLimit('light', MAX_LIGHT_PER_DAY)
      if (!rl) return limitUnavailable()
      if (!rl.allowed) {
        return json(
          { error: 'daily_limit', reason: `Daily limit of ${MAX_LIGHT_PER_DAY} AI helper uses reached. Try again tomorrow.` },
          429,
        )
      }
    } else if (action === 'meal_plan_generate' || action === 'meal_plan_revise') {
      const rl = await consumeLimit('mealplan', MAX_MEALPLAN_PER_DAY)
      if (!rl) return limitUnavailable()
      if (!rl.allowed) {
        return json(
          { error: 'daily_limit', reason: `Daily limit of ${MAX_MEALPLAN_PER_DAY} meal plans reached. Try again tomorrow.` },
          429,
        )
      }
    } else if (action === 'upload_avatar' || action === 'upload_photo') {
      const rl = await consumeLimit('mod', MAX_MOD_PER_DAY)
      if (rl && !rl.allowed) {
        return json(
          {
            error: 'daily_limit',
            reason: action === 'upload_avatar'
              ? 'You have changed your photo too many times today. Please try again tomorrow.'
              : 'You have added too many photos today. Please try again tomorrow.',
          },
          429,
        )
      }
    } else if (PAID_MOD.has(action)) {
      const rl = await consumeLimit('mod', MAX_MOD_PER_DAY)
      // Fail open (allowed: true) past the cap: don't burn paid calls, and the
      // DB blocklist trigger + 5-posts/day insert policy still backstop content.
      if (rl && !rl.allowed) return json({ allowed: true })
    }

    // ── Dispatch ────────────────────────────────────────────────────────────

    if (action === 'moderate_image') {
      const base64 = String(body.base64 ?? '')
      const oversize = checkImageSize(base64)
      if (oversize) return oversize

      const res = await callOpenAI('https://api.openai.com/v1/moderations', {
        model: 'omni-moderation-latest',
        input: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } }],
      })
      return json({ flagged: res.results?.[0]?.flagged ?? false })
    }

    if (action === 'upload_avatar') {
      const base64 = typeof body.base64 === 'string' ? body.base64 : ''
      if (!base64) return json({ error: 'no_image' }, 400)
      const oversize = checkImageSize(base64)
      if (oversize) return oversize
      // Only real JPEG/PNG/WebP bytes are stored, under their true type; the
      // bucket is public, so anything else would be served to every viewer.
      const img = decodeImage(base64)
      if (!img) {
        return json({ error: 'invalid_image', reason: 'That photo could not be read. Please try another one.' }, 400)
      }

      const dataUrl = `data:${img.mime};base64,${base64}`
      let reason = 'That photo does not fit our community guidelines. Please pick another one.'
      let flagged = false
      try {
        const mod = await callOpenAI('https://api.openai.com/v1/moderations', {
          model: 'omni-moderation-latest',
          input: [{ type: 'image_url', image_url: { url: dataUrl } }],
        })
        flagged = mod.results?.[0]?.flagged === true

        if (!flagged) {
          const chat = await callOpenAI('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-5.6-luna',
            reasoning_effort: 'low',
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: PICTURE_MOD_PROMPT },
                { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
              ],
            }],
            // Reasoning tokens count against this budget — keep headroom
            // well above the tiny JSON reply or it comes back empty.
            max_completion_tokens: 4000,
            response_format: { type: 'json_object' },
          })
          const parsed = JSON.parse(chat.choices?.[0]?.message?.content ?? '{}')
          if (parsed.allowed === false) {
            flagged = true
            if (typeof parsed.reason === 'string' && parsed.reason.trim()) reason = noEmDash(parsed.reason.trim())
          }
        }
      } catch (e) {
        console.error('upload_avatar moderation failed:', e)
        return json(
          { error: 'moderation_unavailable', reason: 'We could not check that image right now. Please try again.' },
          503,
        )
      }
      if (flagged) return json({ error: 'flagged', reason }, 422)

      const path = `${user.id}/avatar.jpg`
      const { error: upErr } = await admin.storage.from('avatars').upload(path, img.bytes, {
        contentType: img.mime,
        upsert: true,
      })
      if (upErr) {
        console.error('upload_avatar storage error:', upErr)
        return json({ error: 'upload_failed', reason: 'We could not save that photo. Please try again.' }, 500)
      }

      const { data: pub } = admin.storage.from('avatars').getPublicUrl(path)
      return json({ url: pub.publicUrl })
    }

    // Routine task/step photos ('routine') and saved-meal ingredient photos
    // ('ingredient'). The bucket is public and clients cannot write to it, so
    // this is the only way in: moderation first (fails closed), then the
    // service-role upload, then — for routine photos — the ledger row whose
    // trigger enforces the per-account cap.
    if (action === 'upload_photo') {
      const kind = body.kind === 'ingredient' ? 'ingredient' : 'routine'
      const base64 = typeof body.base64 === 'string' ? body.base64 : ''
      if (!base64) return json({ error: 'no_image', reason: 'Pick a photo first.' }, 400)
      const oversize = checkImageSize(base64)
      if (oversize) return oversize
      const img = decodeImage(base64)
      if (!img) {
        return json({ error: 'invalid_image', reason: 'Could not read that picture. Please try another one.' }, 400)
      }

      try {
        const mod = await callOpenAI('https://api.openai.com/v1/moderations', {
          model: 'omni-moderation-latest',
          input: [{ type: 'image_url', image_url: { url: `data:${img.mime};base64,${base64}` } }],
        })
        if (mod.results?.[0]?.flagged === true) {
          return json(
            { error: 'flagged', reason: 'That photo may not be appropriate to share. Please choose a different one.' },
            422,
          )
        }
      } catch (e) {
        console.error('upload_photo moderation failed:', e)
        return json(
          { error: 'moderation_unavailable', reason: 'Could not check that photo right now. Check your connection and try again.' },
          503,
        )
      }

      // The uid prefix is what the storage policies (list/delete) check, and
      // the app reads it back out of the URL, so it stays the first segment.
      const file = `${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}.${img.ext}`
      const path = kind === 'ingredient' ? `${user.id}/ingredients/${file}` : `${user.id}/${file}`

      // Bytes first, ledger second: if the ledger insert is refused the object
      // is removed again, and a stray object left by a crash in between is
      // swept up by the app's slot reconciler.
      const { error: upErr } = await admin.storage.from(PHOTO_BUCKET).upload(path, img.bytes, {
        contentType: img.mime,
        upsert: false,
      })
      if (upErr) {
        console.error('upload_photo storage error:', upErr)
        return json({ error: 'upload_failed', reason: 'Could not upload that photo. Check your connection and try again.' }, 500)
      }

      if (kind === 'routine') {
        const { error: rowErr } = await admin.from('routine_photos').insert({ path, user_id: user.id })
        if (rowErr) {
          await admin.storage.from(PHOTO_BUCKET).remove([path])
          if (String(rowErr.message ?? '').includes('routine_photo_limit_reached')) {
            return json(
              {
                error: 'photo_limit',
                reason: `You've used all ${MAX_ROUTINE_PHOTOS} routine photos. Remove one from a task or step to free up a slot.`,
              },
              409,
            )
          }
          console.error('upload_photo ledger error:', rowErr)
          return json({ error: 'upload_failed', reason: 'Could not save that photo. Check your connection and try again.' }, 500)
        }
      }

      const { data: pub } = admin.storage.from(PHOTO_BUCKET).getPublicUrl(path)
      return json({ url: pub.publicUrl })
    }

    if (action === 'create_routine') {
      // Every string here goes straight into the prompt, so each is capped:
      // uncapped, one call could carry megabytes of text and cost as much as
      // hundreds of normal ones.
      const routineName = String(body.routineName ?? '').trim().slice(0, 60)
      const surveyQA = (Array.isArray(body.surveyQA) ? body.surveyQA : [])
        .slice(0, 20)
        .map((i: Record<string, unknown>) => ({
          q: String(i?.q ?? '').trim().slice(0, 200),
          answer: String(i?.answer ?? '').trim().slice(0, 500),
        }))

      // Moderate all user-supplied text before generating
      const userText = [routineName, ...surveyQA.flatMap(i => [i.q, i.answer])]
        .filter(Boolean).join('\n').slice(0, 4000)
      const mod = await callOpenAI('https://api.openai.com/v1/moderations', { input: userText })
      if (mod.results?.[0]?.flagged) {
        return json({ error: 'flagged', reason: 'Input contains inappropriate content.' }, 422)
      }

      const qs = surveyQA.map(i => `${i.q}: ${i.answer}`).join('\n')
      const fitnessClause = routineName === 'Fitness'
        ? ' This app already has a dedicated workout system — do NOT include specific exercises, lifts, sets, or reps. Only include surrounding habits: warm-up, mobility, hydration, supplements, nutrition, cooldown, shower.'
        : ''
      const prompt =
        `You are a personal productivity coach. Create an optimized ${routineName} routine.\n\n` +
        `User preferences:\n${qs}\n\n` +
        `Return a JSON object: {"tasks": [{"text": "concise task name", "emoji": "1 relevant emoji", "timeGoalSecs": integer_or_0}]}\n` +
        `Include 5–8 specific, actionable tasks realistic for the available time.${fitnessClause} Set timeGoalSecs to 0 for open-ended tasks. Never use em dashes in any text.`

      const chat = await callOpenAI('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-5.6-luna',
        reasoning_effort: 'low',
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 8000,
        response_format: { type: 'json_object' },
      })

      const parsed = JSON.parse(chat.choices?.[0]?.message?.content ?? '{}')
      const raw: Array<{ text?: string; emoji?: string; timeGoalSecs?: number }> =
        Array.isArray(parsed.tasks) ? parsed.tasks : Array.isArray(parsed) ? parsed : []

      // The model's reply is bounded like any other input: it becomes the
      // user's routine template.
      const tasks = raw
        .slice(0, 20)
        .map((t, i) => ({
          id: Date.now() + i,
          text: noEmDash(String(t?.text ?? '').trim()).slice(0, 80),
          emoji: String(t?.emoji ?? '').slice(0, 8),
          timeGoalSecs: Math.min(4 * 3600, Math.max(0, Math.round(Number(t?.timeGoalSecs) || 0))),
          subTasks: [],
        }))
        .filter(t => t.text)

      return json({ tasks })
    }

    if (action === 'advise_routine') {
      // Capped for the same reason as create_routine.
      const routineName = String(body.routineName ?? '').trim().slice(0, 60)
      const tasks = (Array.isArray(body.tasks) ? body.tasks : [])
        .slice(0, 60)
        .map((t: Record<string, unknown>) => ({ text: String(t?.text ?? '').trim().slice(0, 200) }))
        .filter((t: { text: string }) => t.text)

      const taskList = tasks.map((t, i) => `${i + 1}. ${t.text}`).join('\n')
      const fitnessClause = routineName === 'Fitness'
        ? ' Do NOT recommend specific exercises, lifts, sets, or reps. Focus only on surrounding habits (warm-up, mobility, hydration, supplements, nutrition, cooldown, shower, rest).'
        : ''
      const prompt =
        `You are a personal productivity coach. Analyze this ${routineName} routine and give concise advice:\n\n` +
        `${taskList}\n\n` +
        `In 2–3 short paragraphs: what is good, what to add, remove, or change, and any timing tips. Be specific and direct.${fitnessClause} Under 200 words. Never use em dashes.`

      const chat = await callOpenAI('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-5.6-luna',
        reasoning_effort: 'low',
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 8000,
      })

      const advice = noEmDash(chat.choices?.[0]?.message?.content?.trim() ?? '')
      return json({ advice })
    }

    if (action === 'moderate_profile_picture') {
      const avatarUrl = typeof body.avatarUrl === 'string' ? body.avatarUrl : ''
      if (!avatarUrl) return json({ allowed: true })
      // The model fetches whatever URL it is handed, so only our own avatars
      // bucket is accepted (the database refuses any other avatar_url too).
      if (!avatarUrl.startsWith(AVATAR_PREFIX)) {
        return json({ allowed: false, reason: 'Please upload your profile picture again in Settings before sharing.' })
      }
      try {
        const chat = await callOpenAI('https://api.openai.com/v1/chat/completions', {
          model: 'gpt-5.6-luna',
          reasoning_effort: 'low',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: PICTURE_MOD_PROMPT },
              { type: 'image_url', image_url: { url: avatarUrl, detail: 'low' } },
            ],
          }],
          max_completion_tokens: 4000,
          response_format: { type: 'json_object' },
        })
        const parsed = JSON.parse(chat.choices?.[0]?.message?.content ?? '{}')
        return json({ allowed: parsed.allowed !== false, reason: typeof parsed.reason === 'string' ? noEmDash(parsed.reason) : null })
      } catch { return json({ allowed: true }) }
    }

    if (action === 'moderate_texts') {
      const texts: string[] = body.texts ?? []
      const bio: string = body.bio ?? ''
      const combined = [...texts.filter(Boolean), bio.trim()].filter(Boolean).join('\n').slice(0, 3000)
      if (!combined) return json({ allowed: true })
      try {
        const mod = await callOpenAI('https://api.openai.com/v1/moderations', { input: combined })
        if (mod.results?.[0]?.flagged) {
          return json({ allowed: false, reason: 'Your content violates our community guidelines. Please edit before sharing.' })
        }
      } catch {}
      return json({ allowed: true })
    }

    if (action === 'moderate_routine') {
      const routineName: string = body.routineName ?? ''
      const tasks: Array<{ name?: string }> = body.tasks ?? []
      const bio: string = body.bio ?? ''
      const taskNames = tasks.map(t => t.name).filter(Boolean)
      const allText = [routineName, bio.trim(), ...taskNames].filter(Boolean).join('\n').slice(0, 3000)

      // Pass 1: OpenAI moderation API (fast)
      try {
        const mod = await callOpenAI('https://api.openai.com/v1/moderations', { input: allText })
        if (mod.results?.[0]?.flagged) {
          return json({ allowed: false, reason: 'Your routine or bio contains content that violates our community guidelines.' })
        }
      } catch {}

      // Pass 2: GPT-4o-mini for context-aware check
      const taskList = taskNames.join(', ') || '(none)'
      const prompt = [
        'You are a strict content moderator for a family-friendly productivity app.',
        `Routine: "${routineName}"  Tasks: ${taskList}  Bio: "${bio.trim() || '(none)'}"`,
        'BLOCK if ANY contain: sexual content, violence, hate speech, contact info, spam.',
        'ALLOW genuine daily habits, fitness plans, or productivity schedules.',
        'Reply ONLY with valid JSON: {"allowed": true} or {"allowed": false, "reason": "one sentence"}',
      ].join('\n')
      try {
        const chat = await callOpenAI('https://api.openai.com/v1/chat/completions', {
          model: 'gpt-5.6-luna',
          reasoning_effort: 'low',
          messages: [{ role: 'user', content: prompt }],
          max_completion_tokens: 4000,
          response_format: { type: 'json_object' },
        })
        const parsed = JSON.parse(chat.choices?.[0]?.message?.content ?? '{}')
        return json({ allowed: parsed.allowed !== false, reason: typeof parsed.reason === 'string' ? noEmDash(parsed.reason) : null })
      } catch { return json({ allowed: true }) }
    }

    if (action === 'extract_workout') {
      const images: string[] = (Array.isArray(body.images) ? body.images : [])
        .filter((b: unknown) => typeof b === 'string' && b.length > 0)
        .slice(0, 4)
      if (!images.length) return json({ error: 'no_images' }, 400)
      for (const b64 of images) {
        const oversize = checkImageSize(b64)
        if (oversize) return oversize
      }

      const chat = await callOpenAI('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-5.6-luna',
        reasoning_effort: 'low',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'The attached screenshots show a workout plan from a fitness app. Extract every exercise in the EXACT order shown — the screenshots are provided in order, so exercises from earlier screenshots come first.\n\nReturn ONLY valid JSON:\n{"exercises":[{"name":"exercise name","sets":3,"reps":10}]}\n\nRules:\n- Use standard full exercise names, expanding abbreviations (RDL → Romanian Deadlift, OHP → Overhead Press, DB → Dumbbell, BB → Barbell).\n- Keep the equipment in the name when shown (e.g. "Dumbbell Bench Press").\n- If sets or reps are not visible for an exercise, use sets 3 and reps 10. For rep ranges like 8-12 use the lower bound.\n- Skip duplicates if the same exercise appears in overlapping screenshots.\n- If the images do not show a workout, return {"exercises":[]}.' },
            ...images.map(b64 => ({
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' },
            })),
          ],
        }],
        max_completion_tokens: 16000,
        response_format: { type: 'json_object' },
      })

      const choice = chat.choices?.[0]
      if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) {
        return json({ error: 'inappropriate' })
      }
      const parsed = JSON.parse(choice?.message?.content ?? '{}')
      const raw: Array<{ name?: string; sets?: number; reps?: number }> =
        Array.isArray(parsed.exercises) ? parsed.exercises : []
      const exercises = raw
        .map(e => ({
          name: String(e.name ?? '').trim().slice(0, 80),
          sets: Math.min(Math.max(1, Math.round(Number(e.sets) || 3)), 10),
          reps: Math.min(Math.max(1, Math.round(Number(e.reps) || 10)), 100),
        }))
        .filter(e => e.name)
      return json({ exercises })
    }

    if (action === 'extract_schedule') {
      const images: string[] = (Array.isArray(body.images) ? body.images : [])
        .filter((b: unknown) => typeof b === 'string' && b.length > 0)
        .slice(0, 3)
      if (!images.length) return json({ error: 'no_images' }, 400)
      for (const b64 of images) {
        const oversize = checkImageSize(b64)
        if (oversize) return oversize
      }

      // Grid reading needs deep reasoning more than a big model: gpt-4o-mini,
      // gpt-4.1 and even gpt-5 at medium effort misplaced classes by day, and
      // gpt-5.6 + HIGH effort fixed it. Keep effort high if the model changes,
      // and keep the audit field — it forces a per-column transcription before
      // any merging. (Terra also verified working here; Luna is the cheap tier.)
      const chat = await callOpenAI('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-5.6-luna',
        reasoning_effort: 'high',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'The attached screenshots show a student\'s class schedule / timetable. Extract every recurring class meeting with the CORRECT day of the week and times.\n\nMost timetables are a grid: day columns across the top, a time axis down the side. The #1 mistake is assigning a class block to the wrong day column. Avoid it by working column by column:\n1. Locate each day header and its horizontal span.\n2. For each column, read every class block inside that column top to bottom, taking start/end from the time axis rows the block spans.\n3. Assign a block ONLY to the day whose column it sits in. Never assume patterns like MWF or TuTh — trust only the columns. A course CAN meet at different times on different days.\nIf the schedule is a list rather than a grid, read each day/date heading and the classes under it; convert specific dates to their weekday.\n\nReturn ONLY valid JSON:\n{"audit":[{"day":"Mon","blocks":["CS 135 LEC 14:30-15:20 MC 2054"]}],"classes":[{"courseCode":"CS 135","courseName":"Designing Functional Programs","type":"Lecture","days":["Mon","Wed","Fri"],"startTime":"14:30","endTime":"15:20","location":"MC 2054"}]}\n\naudit: FIRST transcribe every day that has classes — one entry per day, one string per block with course, type, time range and room. This is your worksheet; complete it before deciding anything else.\nclasses: THEN merge the audit into recurring patterns. Every audit block must appear in exactly one classes entry, and every day listed for a class must have a matching audit block.\n\nRules:\n- days: every weekday on which that exact course, type, start/end time and location meets. Three-letter values from Mon,Tue,Wed,Thu,Fri,Sat,Sun.\n- If a course has different times, types, or rooms on different days, return separate objects with the correct days for each pattern.\n- courseCode: the short code as shown (e.g. "CS 135", "MATH 137"). If none is visible, use a short form of the name.\n- courseName: the full course title. If not visible, repeat the course code.\n- type: exactly one of "Lecture", "Tutorial", "Lab", "Seminar", "Other". Actively look for the type marker on EVERY block — it is often abbreviated or buried in the section code: LEC/Lec 001 = Lecture, TUT/T01/CONF/DIS/REC = Tutorial, LAB/PRA = Lab, SEM = Seminar. If a block has no visible marker, infer it from context: a course\'s main classroom meeting is a "Lecture", a smaller discussion/problem session is a "Tutorial", a hands-on computer/science session is a "Lab". Use "Other" ONLY when you genuinely cannot tell.\n- startTime/endTime: 24-hour "HH:MM" with leading zeros. Convert AM/PM times ("2:30 PM" → "14:30").\n- location: the room/building as shown, or null if not visible.\n- If the images do not show a class schedule, return {"audit":[],"classes":[]}.' },
            ...images.map(b64 => ({
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' },
            })),
          ],
        }],
        // Reasoning tokens count against this budget; too tight and the reply
        // comes back empty. High effort thinks longer, so leave real headroom.
        max_completion_tokens: 24000,
        response_format: { type: 'json_object' },
      })

      const choice = chat.choices?.[0]
      if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) {
        return json({ error: 'inappropriate' })
      }
      const parsed = JSON.parse(choice?.message?.content ?? '{}')
      const raw: Array<Record<string, unknown>> = Array.isArray(parsed.classes) ? parsed.classes : []
      const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      const DAY_ALIASES: Record<string, string> = {
        sun: 'Sun', sunday: 'Sun', mon: 'Mon', monday: 'Mon',
        tue: 'Tue', tues: 'Tue', tuesday: 'Tue', wed: 'Wed', wednesday: 'Wed',
        thu: 'Thu', thur: 'Thu', thurs: 'Thu', thursday: 'Thu',
        fri: 'Fri', friday: 'Fri', sat: 'Sat', saturday: 'Sat',
      }
      // Models often return the marker as printed on the timetable ("LEC",
      // "Tut 002", "Conf") — an exact-match check silently turned every one
      // of those into 'Other'. Normalize by prefix instead.
      const TYPE_PREFIXES: Array<[string, string]> = [
        ['lec', 'Lecture'],
        ['tut', 'Tutorial'], ['conf', 'Tutorial'], ['dis', 'Tutorial'], ['rec', 'Tutorial'],
        ['lab', 'Lab'], ['pra', 'Lab'],
        ['sem', 'Seminar'],
      ]
      const classType = (t: unknown): string => {
        const s = String(t ?? '').trim().toLowerCase()
        const hit = TYPE_PREFIXES.find(([prefix]) => s.startsWith(prefix))
        return hit ? hit[1] : 'Other'
      }
      // Zero-pad "9:05" → "09:05"; unpadded hours made the start<end string
      // comparison drop every morning class that ran past 10:00.
      const normTime = (t: unknown): string | null => {
        const m = /^(\d{1,2}):([0-5]\d)$/.exec(String(t ?? '').trim())
        if (!m || Number(m[1]) > 23) return null
        return `${m[1].padStart(2, '0')}:${m[2]}`
      }
      const classes = raw
        .flatMap(c => {
          const suppliedDays = Array.isArray(c.days) ? c.days : [c.day]
          const days = [...new Set(suppliedDays
            .map(day => DAY_ALIASES[String(day ?? '').trim().toLowerCase()])
            .filter(day => DAYS.includes(day)))]
          return days.map(day => ({
            courseCode: String(c.courseCode ?? '').trim().slice(0, 20),
            courseName: String(c.courseName ?? '').trim().slice(0, 80),
            type: classType(c.type),
            day,
            startTime: normTime(c.startTime),
            endTime: normTime(c.endTime),
            location: c.location ? String(c.location).trim().slice(0, 60) : null,
          }))
        })
        .filter(c =>
          (c.courseCode || c.courseName) && DAYS.includes(c.day) &&
          c.startTime && c.endTime && c.startTime < c.endTime
        )
      return json({ classes })
    }

    if (action === 'analyze_looks') {
      const base64: string = body.base64 ?? ''
      const oversize = checkImageSize(base64)
      if (oversize) return oversize

      // Same pre-check as upload_avatar: run the selfie through the
      // moderation endpoint before it ever reaches the analysis model. The
      // prompt below asks the model to refuse inappropriate images too, but a
      // prompt is self-policing, not a gate — and like upload_avatar this
      // fails closed: if the check itself cannot run, the photo goes nowhere.
      try {
        const mod = await callOpenAI('https://api.openai.com/v1/moderations', {
          model: 'omni-moderation-latest',
          input: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } }],
        })
        if (mod.results?.[0]?.flagged === true) {
          return json(
            { error: 'flagged', reason: 'That photo does not fit our community guidelines. Please pick another one.' },
            422,
          )
        }
      } catch (e) {
        console.error('analyze_looks moderation failed:', e)
        return json(
          { error: 'moderation_unavailable', reason: 'We could not check that image right now. Please try again.' },
          503,
        )
      }

      const chat = await callOpenAI('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-5.6-luna',
        reasoning_effort: 'low',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this facial photo and provide a personalized foundational skincare and hair care routine.\nReturn ONLY a valid JSON object.\n\nIf the image contains inappropriate, explicit, or offensive content, return exactly: {"error":"inappropriate"}\nOnly return {"error":"quality"} if the image is so dark, blurry, or obscured that NO facial features are visible at all.\n\nOtherwise return:\n{"skinNote":"Optional short compliment if skin looks notably clear/healthy — omit entirely if not applicable","categories":[{"name":"Category name","steps":[{"name":"Step name","product":"Specific accessible drugstore product","explanation":"1-sentence reason based on what you observe"}]}]}\n\nInclude 2-4 skin categories AND one "Hair Care" category (2-4 steps each). For Hair Care: identify hair type, washing frequency, and product recommendations. For skin: reference observable features (oiliness, dryness, texture). Use affordable drugstore products. No medical diagnoses or attractiveness judgments. Never use em dashes in any text.' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
          ],
        }],
        max_completion_tokens: 16000,
        response_format: { type: 'json_object' },
      })

      const choice = chat.choices?.[0]
      if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) {
        return json({ error: 'inappropriate' })
      }
      const parsed = JSON.parse(choice?.message?.content ?? '{}') as Record<string, unknown>
      if (parsed.error === 'inappropriate' || parsed.error === 'quality') return json({ error: parsed.error })
      // The app saves this and renders it on every Morning screen open, so
      // only the documented shape goes back, every field a bounded string.
      const str = (v: unknown, max: number) => noEmDash(String(v ?? '').trim()).slice(0, max)
      const categories = (Array.isArray(parsed.categories) ? parsed.categories : [])
        .slice(0, 6)
        .map((c: Record<string, unknown>) => ({
          name: str(c?.name, 60),
          steps: (Array.isArray(c?.steps) ? c.steps : [])
            .slice(0, 6)
            .map((st: Record<string, unknown>) => ({
              name: str(st?.name, 80),
              product: str(st?.product, 120),
              explanation: str(st?.explanation, 300),
            }))
            .filter((st: { name: string }) => st.name),
        }))
        .filter((c: { name: string; steps: unknown[] }) => c.name && c.steps.length)
      const skinNote = str(parsed.skinNote, 200)
      return json({ ...(skinNote ? { skinNote } : {}), categories })
    }

    // ── Food estimator ("Ask AI" under the food search) ──────────────────────

    if (action === 'food_clarify') {
      const query = String(body.query ?? '').trim().slice(0, 200)
      if (!query) return json({ error: 'missing_query' }, 400)
      const details = foodDetails(body)

      const mod = await callOpenAI('https://api.openai.com/v1/moderations', {
        input: [query, ...details.map(d => d.a)].join('\n').slice(0, 3000),
      })
      if (mod.results?.[0]?.flagged) {
        return json({ error: 'flagged', reason: 'That text could not be processed.' }, 422)
      }

      const prompt = details.length
        ? `A user of a nutrition-tracking app described a meal they ate:\n${foodDetailBlock(query, details)}\n\n` +
          'Before its nutrition is estimated, ask ONLY the questions whose answers would materially change the numbers. ' +
          'The usual gaps: an ingredient listed without an amount, how much of the whole dish they ate (if it was a recipe, its total yield and the share eaten), ' +
          'how it was cooked, and any oil, sauce, sugar or toppings not mentioned. Skip anything the description already answers. ' +
          'Ask at most 3 questions. If the amounts and the share eaten are already pinned down, ask nothing.\n\n' +
          'Return ONLY valid JSON: {"questions":[{"id":"q1","text":"short question","hint":"example answer"}]}\n' +
          'Keep each question under 14 words and each hint under 8. Never use em dashes.'
        : `A user of a nutrition-tracking app wants to log this food: "${query}"\n\n` +
          'Before its nutrition is estimated, ask ONLY the questions whose answers would materially change the numbers. ' +
          'The usual gaps: the specific type or variety, the amount eaten (cups, grams, pieces, or a plate or bowl description), ' +
          'how it was prepared or cooked, and any oil, sauce, sugar or toppings added. Skip anything the description already answers. ' +
          'Ask at most 3 questions. If the description already pins down both the type and the amount, ask nothing.\n\n' +
          'Return ONLY valid JSON: {"questions":[{"id":"q1","text":"short question","hint":"example answer"}]}\n' +
          'Keep each question under 12 words and each hint under 8. Never use em dashes.'

      const chat = await callOpenAI('https://api.openai.com/v1/chat/completions', {
        model: FOOD_MODEL,
        reasoning_effort: 'low',
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 3000,
        response_format: { type: 'json_object' },
      })
      const parsed = JSON.parse(chat.choices?.[0]?.message?.content ?? '{}')
      const raw: Array<{ text?: string; hint?: string }> = Array.isArray(parsed.questions) ? parsed.questions : []
      const questions = raw
        .map((q, i) => ({
          id: `q${i + 1}`,
          text: noEmDash(String(q.text ?? '').trim()).slice(0, 120),
          hint: noEmDash(String(q.hint ?? '').trim()).slice(0, 60),
        }))
        .filter(q => q.text)
        .slice(0, 3)
      return json({ questions })
    }

    // ── Scan a meal photo: name it and what is on the plate, or ask what the
    //    photo cannot show. The client then runs food_estimate with the same
    //    photo attached, so a scan costs two food units like a described meal.
    if (action === 'food_scan') {
      const base64 = typeof body.base64 === 'string' ? body.base64 : ''
      if (!base64) return json({ error: 'missing_photo', reason: 'Take a photo of the meal first.' }, 400)
      const oversize = checkImageSize(base64)
      if (oversize) return oversize
      const note = String(body.note ?? '').trim().slice(0, 300)

      try {
        const mod = await callOpenAI('https://api.openai.com/v1/moderations', {
          model: 'omni-moderation-latest',
          input: [
            ...(note ? [{ type: 'text', text: note }] : []),
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
          ],
        })
        if (mod.results?.[0]?.flagged === true) {
          return json({ error: 'flagged', reason: 'That photo could not be processed.' }, 422)
        }
      } catch (e) {
        console.error('food_scan moderation failed:', e)
        return json(
          { error: 'moderation_unavailable', reason: 'We could not check that photo right now. Please try again.' },
          503,
        )
      }

      const prompt =
        'A user of a nutrition-tracking app photographed a meal they are about to log. Identify it from the photo' +
        (note ? ` (they added: "${note}")` : '') + '.\n\n' +
        'Return ONLY valid JSON:\n' +
        '{"name":"short meal name","contents":"one line listing what you can see on the plate, with rough amounts","portion":"the portion visible, e.g. 1 plate (about 350 g)","confidence":"low|medium|high","questions":[{"id":"q1","text":"short question","hint":"example answer"}]}\n\n' +
        'Rules:\n' +
        '- If the photo is not of food or drink, set name to an empty string and say why in contents.\n' +
        '- Ask ONLY the questions whose answers would materially change the nutrition and that the photo cannot answer: a hidden ingredient or sauce, how it was cooked, whether the whole plate is being eaten, a drink or dressing out of frame. Skip anything the photo already shows. At most 3 questions; ask nothing when the photo is clear enough.\n' +
        '- Keep each question under 12 words and each hint under 8. Never use em dashes.'

      const chat = await callOpenAI('https://api.openai.com/v1/chat/completions', {
        model: FOOD_MODEL,
        reasoning_effort: 'low',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
          ],
        }],
        max_completion_tokens: 3000,
        response_format: { type: 'json_object' },
      })
      const choice = chat.choices?.[0]
      if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) {
        return json({ error: 'inappropriate' })
      }
      const parsed = JSON.parse(choice?.message?.content ?? '{}') as Record<string, unknown>
      const str = (v: unknown, max: number) => noEmDash(String(v ?? '').trim()).slice(0, max)
      const rawQ = (Array.isArray(parsed.questions) ? parsed.questions : []) as Array<Record<string, unknown>>
      const questions = rawQ
        .map((q, i) => ({ id: `q${i + 1}`, text: str(q?.text, 120), hint: str(q?.hint, 60) }))
        .filter(q => q.text)
        .slice(0, 3)
      const name = str(parsed.name, 80)
      if (!name) {
        return json({ error: 'not_food', reason: str(parsed.contents, 200) || 'That does not look like a meal. Try another photo.' }, 422)
      }
      const confidenceRaw = str(parsed.confidence, 10).toLowerCase()
      return json({
        name,
        contents: str(parsed.contents, 300) || null,
        portion: str(parsed.portion, 80) || null,
        confidence: ['low', 'medium', 'high'].includes(confidenceRaw) ? confidenceRaw : 'medium',
        questions,
      })
    }

    if (action === 'food_estimate') {
      const query = String(body.query ?? '').trim().slice(0, 200)
      if (!query) return json({ error: 'missing_query' }, 400)
      const details = foodDetails(body)
      const answers: Array<{ q: string; a: string }> = (Array.isArray(body.answers) ? body.answers : [])
        .map((x: Record<string, unknown>) => ({
          q: String(x?.q ?? '').trim().slice(0, 160),
          a: String(x?.a ?? '').trim().slice(0, 300),
        }))
        .filter((x: { q: string; a: string }) => x.q && x.a)
        .slice(0, 5)
      const base64 = typeof body.base64 === 'string' ? body.base64 : ''
      if (base64) {
        const oversize = checkImageSize(base64)
        if (oversize) return oversize
      }

      // Text and (if present) the photo go through moderation first. Like the
      // other photo features this fails closed: no verdict, no estimate.
      const text = [query, ...details.map(d => d.a), ...answers.map(x => x.a)].join('\n').slice(0, 3000)
      try {
        const mod = await callOpenAI('https://api.openai.com/v1/moderations', {
          model: 'omni-moderation-latest',
          input: [
            { type: 'text', text },
            ...(base64 ? [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } }] : []),
          ],
        })
        if (mod.results?.[0]?.flagged === true) {
          return json({ error: 'flagged', reason: 'That text or photo could not be processed.' }, 422)
        }
      } catch (e) {
        console.error('food_estimate moderation failed:', e)
        return json(
          { error: 'moderation_unavailable', reason: 'We could not check that request right now. Please try again.' },
          503,
        )
      }

      const nutrientList = FOOD_NUTRIENTS.map(([k, u]) => `${k} (${u})`).join(', ')
      const macroTemplate = FOOD_NUTRIENTS.map(([k]) => `"${k}":0`).join(',')
      const qa = answers.map(x => `Q: ${x.q}\nA: ${x.a}`).join('\n')
      const prompt =
        'You estimate nutrition for a food-logging app, with the care of a registered dietitian using standard food-composition data (USDA-style values).\n\n' +
        (details.length
          ? `Meal as described by the user:\n${foodDetailBlock(query, details)}\n`
          : `Food as described by the user: "${query}"\n`) +
        (qa ? `Clarifying answers:\n${qa}\n` : '') +
        (base64 ? 'A photo of the food is attached: use it to judge the type, the portion size and the preparation, and prefer what you can see over assumptions.\n' : '') +
        '\nEstimate the nutrition for the WHOLE portion the user ate (not per 100 g). ' +
        (details.length
          ? 'Work from the ingredient amounts; if they gave a recipe yield and the share they ate, scale to that share. Keep the meal name they gave. '
          : '') +
        'State the exact portion you assumed.\n\n' +
        'Return ONLY valid JSON:\n' +
        `{"name":"short food name","portion":"the amount you estimated for, e.g. 1 cup (170 g), cooked","contents":"one line on what is in it and how it was prepared","confidence":"low|medium|high","notes":"one short sentence on the biggest uncertainty, or an empty string","macros":{${macroTemplate}}}\n\n` +
        'Rules:\n' +
        `- macros must contain EVERY key above as a plain number, in these units: ${nutrientList}.\n` +
        '- Use 0 only when a nutrient is genuinely negligible; otherwise give your best estimate, including trace vitamins and minerals.\n' +
        '- No ranges and no text in numeric fields. Never use em dashes.'

      const chat = await callOpenAI('https://api.openai.com/v1/chat/completions', {
        model: FOOD_MODEL,
        reasoning_effort: 'low',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...(base64 ? [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } }] : []),
          ],
        }],
        max_completion_tokens: 10000,
        response_format: { type: 'json_object' },
      })

      const choice = chat.choices?.[0]
      if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) {
        return json({ error: 'inappropriate' })
      }
      const parsed = JSON.parse(choice?.message?.content ?? '{}') as Record<string, unknown>
      const rawMacros = (parsed.macros ?? {}) as Record<string, unknown>
      const macros: Record<string, number> = {}
      for (const [k] of FOOD_NUTRIENTS) {
        const n = Number(rawMacros[k])
        const safe = Number.isFinite(n) && n > 0 ? n : 0
        macros[k] = k === 'calories' ? Math.round(safe) : Math.round(safe * 10) / 10
      }
      const str = (v: unknown, max: number) => noEmDash(String(v ?? '').trim()).slice(0, max)
      const confidenceRaw = str(parsed.confidence, 10).toLowerCase()
      const estimate = {
        name: str(parsed.name, 80) || query,
        portion: str(parsed.portion, 80) || null,
        contents: str(parsed.contents, 200) || null,
        confidence: ['low', 'medium', 'high'].includes(confidenceRaw) ? confidenceRaw : 'medium',
        notes: str(parsed.notes, 200) || null,
        macros,
      }

      // Record it so the food can be added to a real food list later without
      // paying for another estimate. Clients cannot read this table; a failed
      // insert is logged, not surfaced, because the user still needs their meal.
      let estimateId: string | null = null
      const { data: row, error: insErr } = await admin
        .from('ai_food_estimates')
        .insert({
          user_id: user.id,
          query,
          // The described ingredients and servings ride along in answers so
          // the record needs no new columns.
          answers: [...details, ...answers],
          had_photo: !!base64,
          name: estimate.name,
          portion: estimate.portion,
          contents: estimate.contents,
          confidence: estimate.confidence,
          notes: estimate.notes,
          macros,
          model: FOOD_MODEL,
          raw: parsed,
        })
        .select('id')
        .single()
      if (insErr) console.error('ai_food_estimates insert failed:', insErr)
      else estimateId = row?.id ?? null

      return json({ estimateId, ...estimate })
    }

    // ── Which muscles does a custom exercise train? ─────────────────────────

    if (action === 'exercise_muscles') {
      const name = String(body.name ?? '').trim().slice(0, 120)
      const description = String(body.description ?? '').trim().slice(0, 600)
      if (!name) return json({ error: 'missing_name' }, 400)

      const mod = await callOpenAI('https://api.openai.com/v1/moderations', {
        input: [name, description].filter(Boolean).join('\n'),
      })
      if (mod.results?.[0]?.flagged) {
        return json({ error: 'flagged', reason: 'That text could not be processed.' }, 422)
      }

      const prompt =
        'An exercise in a workout app:\n' +
        `Name: "${name}"\n` +
        (description ? `Description: "${description}"\n` : '') +
        '\nWhich muscles does it train? Choose ONLY from this list, using these exact spellings: ' +
        `${EXERCISE_MUSCLES.join(', ')}.\n\n` +
        'Return ONLY valid JSON: {"primary":["..."],"secondary":["..."],"note":"one short sentence on what the movement is, or an empty string"}\n' +
        'primary: the 1 to 3 muscles doing most of the work. secondary: up to 4 that assist or stabilise. ' +
        'If you cannot identify a real exercise from the name and description, return {"primary":[],"secondary":[],"note":"..."} and say briefly why. Never use em dashes.'

      const chat = await callOpenAI('https://api.openai.com/v1/chat/completions', {
        model: FOOD_MODEL,
        reasoning_effort: 'low',
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 3000,
        response_format: { type: 'json_object' },
      })
      const parsed = JSON.parse(chat.choices?.[0]?.message?.content ?? '{}') as Record<string, unknown>
      // Canonicalise to the app's spellings; anything else is dropped.
      const canon = (v: unknown): string[] => {
        const seen = new Set<string>()
        const out: string[] = []
        for (const x of Array.isArray(v) ? v : []) {
          const hit = EXERCISE_MUSCLES.find(mu => mu.toLowerCase() === String(x ?? '').trim().toLowerCase())
          if (hit && !seen.has(hit)) { seen.add(hit); out.push(hit) }
        }
        return out
      }
      const primary = canon(parsed.primary).slice(0, 3)
      const secondary = canon(parsed.secondary).filter(mu => !primary.includes(mu)).slice(0, 4)
      const note = noEmDash(String(parsed.note ?? '').trim()).slice(0, 200)
      // Only a recognised exercise gets a demo video, and the video comes from
      // a real YouTube search, never from the model.
      const video = primary.length > 0 ? await findYouTubeDemo(name) : null
      return json({ primary, secondary, note, video })
    }

    // ── AI meal planner ─────────────────────────────────────────────────────
    // generate: goals + survey answers in, a week of meals out.
    // revise: the same plus the current week and what to change.

    if (action === 'meal_plan_generate' || action === 'meal_plan_revise') {
      const answers = planAnswers(body.answers)
      const request = action === 'meal_plan_revise' ? String(body.request ?? '').trim().slice(0, 600) : ''
      if (action === 'meal_plan_revise' && !request) {
        return json({ error: 'missing_request', reason: 'Say what you would like changed first.' }, 400)
      }

      // Everything the user typed goes through moderation first. Fails closed.
      const userText = [...answers.map(x => x.a), request].filter(Boolean).join('\n').slice(0, 4000)
      if (userText) {
        try {
          const mod = await callOpenAI('https://api.openai.com/v1/moderations', { input: userText })
          if (mod.results?.[0]?.flagged) {
            return json({ error: 'flagged', reason: 'That text could not be processed.' }, 422)
          }
        } catch (e) {
          console.error('meal plan moderation failed:', e)
          return json(
            { error: 'moderation_unavailable', reason: 'We could not check that request right now. Please try again.' },
            503,
          )
        }
      }

      const prompt = action === 'meal_plan_generate'
        ? mealPlanPrompt(body, answers)
        : mealPlanRevisePrompt(body, answers, request)

      // A whole week takes the model a minute or more. The reply is streamed
      // with a keep-alive byte every few seconds so the app's idle timeout
      // (60 s on iOS) cannot fire while it thinks; see streamJson.
      return streamJson(async () => {
        // Balancing seven days of macros needs more thought than a food
        // estimate, and the reply is 20 to 30 meals of JSON, so both effort
        // and the token budget are higher than the other text actions.
        const chat = await callOpenAI('https://api.openai.com/v1/chat/completions', {
          model: PLAN_MODEL,
          reasoning_effort: 'medium',
          messages: [{ role: 'user', content: prompt }],
          max_completion_tokens: 40000,
          response_format: { type: 'json_object' },
        })
        const choice = chat.choices?.[0]
        if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) {
          return { error: 'inappropriate' }
        }
        let parsed: Record<string, unknown> = {}
        try { parsed = JSON.parse(choice?.message?.content ?? '{}') } catch { parsed = {} }
        const plan = normalizeMealPlan(parsed)
        if (!plan.meals.length || !plan.days.some(d => d.mealIds.length)) {
          console.error('meal plan came back empty; finish_reason:', choice?.finish_reason)
          return { error: 'empty_plan', reason: 'The planner came back empty. Please try again.' }
        }
        return plan
      })
    }

    // ── Meal coach: a chat about the user's plan and what they eat ──────────

    if (action === 'meal_coach') {
      const messages = coachMessages(body.messages)
      if (!messages.length || messages[messages.length - 1].role !== 'user') {
        return json({ error: 'missing_query', reason: 'Type a question first.' }, 400)
      }

      // Everything the user typed in this conversation goes through
      // moderation first. Fails closed.
      const userText = messages.filter(m => m.role === 'user').map(m => m.content).join('\n').slice(0, 4000)
      try {
        const mod = await callOpenAI('https://api.openai.com/v1/moderations', { input: userText })
        if (mod.results?.[0]?.flagged) {
          return json({ error: 'flagged', reason: 'That message could not be processed.' }, 422)
        }
      } catch (e) {
        console.error('meal_coach moderation failed:', e)
        return json(
          { error: 'moderation_unavailable', reason: 'We could not check that message right now. Please try again.' },
          503,
        )
      }

      // The live numbers go in right before the latest question, not only at
      // the top: models lean on the most recent context, and an earlier turn
      // in the conversation may quote totals that have since changed.
      const history = messages.slice(0, -1)
      const latest = messages[messages.length - 1]
      const chat = await callOpenAI('https://api.openai.com/v1/chat/completions', {
        model: PLAN_MODEL,
        reasoning_effort: 'low',
        messages: [
          { role: 'system', content: mealCoachRules() },
          ...history,
          { role: 'system', content: mealCoachData(body) },
          latest,
        ],
        max_completion_tokens: 4000,
      })
      const choice = chat.choices?.[0]
      if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) {
        return json({ error: 'inappropriate' })
      }
      const reply = noEmDash(String(choice?.message?.content ?? '').trim()).slice(0, 4000)
      if (!reply) return json({ error: 'empty_reply', reason: 'The coach had nothing to say. Please try again.' }, 502)
      return json({ reply })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (e) {
    console.error('openai-proxy error:', e)
    return json({ error: 'internal_error' }, 500)
  }
}

// ── Meal coach helpers ────────────────────────────────────────────────────────

type CoachMessage = { role: 'user' | 'assistant'; content: string }

// The last few turns of the conversation, each trimmed; roles other than the
// two chat roles are dropped so the client cannot inject a system message.
function coachMessages(raw: unknown): CoachMessage[] {
  return (Array.isArray(raw) ? raw : [])
    .map((m: Record<string, unknown>) => ({
      role: m?.role === 'assistant' ? 'assistant' : m?.role === 'user' ? 'user' : null,
      content: String(m?.content ?? '').trim().slice(0, 1500),
    }))
    .filter((m): m is CoachMessage => !!m.role && !!m.content)
    .slice(-12)
}

const macroNum = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

// Every tracked nutrient summed over a list of meals.
function sumNutrients(meals: Array<Record<string, unknown>>): Record<string, number> {
  const t: Record<string, number> = {}
  for (const m of meals) {
    const macros = (m?.macros && typeof m.macros === 'object' ? m.macros : {}) as Record<string, unknown>
    for (const [k] of FOOD_NUTRIENTS) {
      const n = macroNum(macros[k])
      if (n) t[k] = (t[k] ?? 0) + n
    }
  }
  return t
}

const fmtNutrient = (k: string, v: number) => (k === 'calories' ? String(Math.round(v)) : String(Math.round(v * 10) / 10))

// One food, with every nutrient it was logged with, on its own line. The
// coach answers a question about a single food from this, so nothing is
// folded into a day total. Keys that are present but zero are listed at the
// end so "0 mg" and "not tracked" stay distinguishable.
function mealLine(m: Record<string, unknown>, withSection = true): string {
  const s = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
  const macros = (m?.macros && typeof m.macros === 'object' ? m.macros : {}) as Record<string, unknown>
  const tracked = FOOD_NUTRIENTS.filter(([k]) => macros[k] !== undefined && macros[k] !== null && macros[k] !== '' && Number.isFinite(Number(macros[k])))
  const nonzero = tracked.filter(([k]) => macroNum(macros[k]) !== 0)
  const zero = tracked.filter(([k]) => macroNum(macros[k]) === 0).map(([k]) => k)
  const values = nonzero.map(([k, u]) => `${k} ${fmtNutrient(k, macroNum(macros[k]))} ${u}`).join(', ') || 'nothing tracked'
  const section = withSection ? s(m.section, 10) : ''
  const contents = s(m.contents, 140)
  const flag = m.source === 'ai' ? ' (AI estimate)' : ''
  return `- ${section ? section + ': ' : ''}${s(m.name, 60)}${flag}${contents ? ` [${contents}]` : ''} | ${values}${zero.length ? `; zero: ${zero.join(', ')}` : ''}`
}

// The headline five, the way the app shows a day.
function dayTotals(meals: Array<Record<string, unknown>>): string {
  const t = sumNutrients(meals)
  return `${Math.round(t.calories ?? 0)} kcal, ${Math.round(t.protein ?? 0)} g protein, ${Math.round(t.carbs ?? 0)} g carbs, ${Math.round(t.fat ?? 0)} g fat, ${Math.round(t.fiber ?? 0)} g fiber`
}

// Everything else that was tracked (sugars, fats by type, sodium, minerals,
// vitamins), in the app's units, skipping what is zero.
function nutrientLine(t: Record<string, number>): string {
  const skip = new Set(['calories', 'protein', 'carbs', 'fat', 'fiber'])
  return FOOD_NUTRIENTS
    .filter(([k]) => !skip.has(k) && (t[k] ?? 0) > 0)
    .map(([k, u]) => `${k} ${fmtNutrient(k, t[k])} ${u}`)
    .join(', ') || 'none tracked'
}

// The daily values the app's micronutrient bars grade against (FDA, 2,000
// kcal reference). Must match MICRO_DV in app/(tabs)/meals.js.
const DAILY_VALUES =
  'Daily values the app grades against (limits, stay under): saturatedFat 20 g, transFat 2 g, cholesterol 300 mg, sodium 2300 mg, addedSugar 50 g. ' +
  'Targets: fiber 28 g, potassium 4700 mg, calcium 1300 mg, iron 18 mg, magnesium 420 mg, zinc 11 mg, phosphorus 1250 mg, selenium 55 mcg, copper 0.9 mg, manganese 2.3 mg, chromium 35 mcg, iodine 150 mcg, ' +
  'vitaminA 900 mcg, vitaminC 90 mg, vitaminD 20 mcg, vitaminE 15 mg, vitaminK 120 mcg, vitaminB6 1.7 mg, vitaminB12 2.4 mcg, folate 400 mcg, thiamin 1.2 mg, riboflavin 1.3 mg, niacin 16 mg, pantothenicAcid 5 mg, biotin 30 mcg. ' +
  'A nutrient missing from a day\'s line was not tracked for those foods (many entries only carry the main macros), so say "not tracked" rather than "zero".'

// Who the coach is and how it answers. The data it answers from is a
// separate system message (mealCoachData) placed just before the latest
// question.
function mealCoachRules(): string {
  return [
    'You are the meal coach inside a nutrition-tracking app. The user asks about their weekly meal plan and what they eat: whether it is good, whether they are hitting their targets, how healthy it is, what to add or change, or ideas they are considering.',
    'Answer like a knowledgeable, friendly registered dietitian who has their numbers in front of them. Be specific to THEIR data: name the meals, cite the numbers, say what is on track and what falls short (calories, protein, fiber, and the vitamins and minerals likely to be low for their eating pattern). Give concrete, realistic suggestions.',
    'The data arrives in a system message right before their latest question and is current as of that question. It overrides any figure quoted earlier in the conversation, including your own earlier replies: if the numbers moved, use the new ones and say so.',
    'Every food in the data has its own line with everything tracked for it: calories, macros, sugars, fats by type, sodium, minerals and vitamins in the app\'s units (logged today, logged earlier this week, and every planned meal). Each day also has totals, and the daily values the app grades against are listed. For a question about one food, find that food\'s line and quote the number from it; never estimate a value its line already gives. A nutrient absent from a food\'s line was not tracked for that entry: say so, and if you add a typical figure from general knowledge, label it clearly as a general estimate rather than their data. Use the nutrient lines for any question about micronutrients, vitamins, minerals, sodium or sugar, and compare against the daily values.',
    'Two different things are in the data: what they have LOGGED (actually eaten) and what they have PLANNED for the week. When they ask about what they ate, use the logged totals and quote the exact "Today so far" line. When they ask about the plan, or when nothing is logged today and the foods they mention are in the plan, they mean the plan: use the planned day they mean (today\'s weekday is marked; otherwise the day they name) and quote its exact "planned day total" line. Never add the per-meal numbers up yourself; the totals are given. Say which one you are talking about ("in your plan for Monday" or "logged today") whenever it could be unclear.',
    'Keep replies short: under 150 words unless they ask for detail. Plain text, short paragraphs or a few short bullet lines, no headings. Never use em dashes.',
    'This is general nutrition guidance, not medical advice. For a health condition, medication, pregnancy, an eating disorder, or before starting a supplement, tell them to speak to a doctor or registered dietitian. Never diagnose. If asked about something unrelated to food, nutrition, cooking or their plan, steer back briefly.',
  ].join('\n')
}

// What the coach knows, most relevant first: today's log with its totals,
// targets and stats, the last seven days, then the weekly plan (meals per
// day with day totals). Each block is capped so a big plan cannot blow up
// the prompt, and the plan comes last so it is what gets cut if anything is.
function mealCoachData(body: Record<string, unknown>): string {
  const s = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
  const parts: string[] = ['CURRENT DATA (as of the latest message; overrides anything earlier in the conversation)']

  const today = (body.today && typeof body.today === 'object' ? body.today : null) as Record<string, unknown> | null
  const todayMeals = (Array.isArray(today?.meals) ? today!.meals : []).slice(0, 30) as Array<Record<string, unknown>>
  if (today?.unavailable === true || body.today === null) {
    // The app could not read the day's log. That is not the same as an
    // empty day, and answering as if nothing was eaten would be wrong.
    parts.push('', 'LOGGED TODAY: could not be read just now. Do not assume nothing was eaten; if the answer depends on it, say you cannot see today\'s log right now.')
  } else if (todayMeals.length) {
    parts.push('', `LOGGED TODAY (${s(today?.date, 10)}), actually eaten, one line per food with everything tracked for it:`,
      ...todayMeals.map(m => mealLine(m)),
      `Today so far: ${dayTotals(todayMeals)}`,
      `Today's other nutrients: ${nutrientLine(sumNutrients(todayMeals))}`)
  } else {
    parts.push('', 'LOGGED TODAY: nothing yet.')
  }

  parts.push('', planUserBlock(body, []), DAILY_VALUES)

  const week = (Array.isArray(body.week) ? body.week : []).slice(0, 7) as Array<Record<string, unknown>>
  if (week.length) {
    parts.push('', 'LOGGED TOTALS, last 7 days (today included):',
      ...week.map(d => {
        const totals: Record<string, number> = {}
        for (const [k] of FOOD_NUTRIENTS) { const n = macroNum(d[k]); if (n) totals[k] = n }
        return `${s(d.date, 10)}: ${Math.round(totals.calories ?? 0)} kcal, ${Math.round(totals.protein ?? 0)} g protein, ${Math.round(totals.carbs ?? 0)} g carbs, ${Math.round(totals.fat ?? 0)} g fat, ${Math.round(totals.fiber ?? 0)} g fiber${macroNum(d.meals) ? ` (${Math.round(macroNum(d.meals))} meals)` : ''}; nutrients: ${nutrientLine(totals)}`
      }))
  }

  // Which plan day is today, so "today" questions about the plan land on
  // the right day. Dates are the app's local YYYY-MM-DD.
  const todayIso = s(today?.date, 10)
  const todayDow = /^\d{4}-\d{2}-\d{2}$/.test(todayIso)
    ? PLAN_DAYS[(new Date(`${todayIso}T12:00:00Z`).getUTCDay() + 6) % 7]
    : ''

  const plan = (body.plan && typeof body.plan === 'object' ? body.plan : null) as Record<string, unknown> | null
  if (plan) {
    const mealsById = new Map<string, Record<string, unknown>>()
    // A hand-built day can hold far more meals than the planner makes, so
    // the caps here are generous: every meal must count, or the totals lie.
    const planMeals = (Array.isArray(plan.meals) ? plan.meals : []).slice(0, 120) as Array<Record<string, unknown>>
    for (const m of planMeals) {
      const id = s(m?.id, 12)
      if (id) mealsById.set(id, m)
    }
    const dayLines: string[] = []
    for (const d of (Array.isArray(plan.days) ? plan.days : []).slice(0, 7)) {
      const day = s((d as Record<string, unknown>)?.day, 3)
      const ids = (Array.isArray((d as Record<string, unknown>)?.mealIds) ? (d as Record<string, unknown>).mealIds as unknown[] : []).slice(0, 25)
      const meals = ids.map(id => mealsById.get(String(id))).filter(Boolean) as Array<Record<string, unknown>>
      if (!day) continue
      const names = meals.map(m => `${s(m.name, 60)} (${Math.round(macroNum((m.macros as Record<string, unknown>)?.calories))} kcal)`).join('; ')
      dayLines.push(`${day}${day === todayDow ? ' (today)' : ''}: ${names || 'nothing planned'}${meals.length ? ` | planned day total ${dayTotals(meals)} | nutrients: ${nutrientLine(sumNutrients(meals))}` : ''}`)
    }
    if (dayLines.length) parts.push('', 'WEEKLY PLAN (what they intend to eat; repeats every week; NOT what was logged):', ...dayLines)
    const notes = plan.nutritionNotes
    if (Array.isArray(notes) && notes.length) {
      parts.push('Notes the planner gave with it:', ...notes.slice(0, 6).map(n => `- ${s(n, 300)}`))
    }
    // Every distinct planned meal once, with everything tracked for it, so a
    // question about one planned food is answered from that food's own line.
    if (planMeals.length) {
      parts.push('', 'PLANNED MEALS, full nutrition per meal (the plan days above refer to these by name):',
        ...planMeals.slice(0, 80).map(m => mealLine(m)))
    }
  } else {
    parts.push('', 'WEEKLY PLAN: none yet.')
  }

  // Foods logged on earlier days this week, one line each. Last, and the
  // biggest block, so it is what gets cut if the prompt has to be trimmed.
  const recent = (Array.isArray(body.recent) ? body.recent : []).slice(-6) as Array<Record<string, unknown>>
  const recentLines: string[] = []
  for (const d of recent) {
    const date = s(d?.date, 10)
    const meals = (Array.isArray(d?.meals) ? d.meals : []).slice(0, 20) as Array<Record<string, unknown>>
    if (!date || date === todayIso || !meals.length) continue
    recentLines.push(`${date}:`, ...meals.map(m => mealLine(m)))
  }
  if (recentLines.length) parts.push('', 'LOGGED EARLIER THIS WEEK, actually eaten, one line per food:', ...recentLines)

  return parts.join('\n').slice(0, 64000)
}

// ── Food estimator helpers ────────────────────────────────────────────────────

// The "Describe to AI" meal logger sends the meal's ingredients, how much was
// eaten and any notes alongside the name. Each becomes a labelled line for
// the prompts (and a { q, a } pair for the record). A plain search query has
// none of these and reads exactly as before.
function foodDetails(body: Record<string, unknown>): Array<{ q: string; a: string }> {
  const fields: Array<[string, string, number]> = [
    ['ingredients', 'Ingredients', 1200],
    ['servings', 'Amount eaten', 120],
    ['notes', 'Notes', 400],
  ]
  const out: Array<{ q: string; a: string }> = []
  for (const [key, label, max] of fields) {
    const v = String(body[key] ?? '').trim().slice(0, max)
    if (v) out.push({ q: label, a: v })
  }
  return out
}

function foodDetailBlock(query: string, details: Array<{ q: string; a: string }>): string {
  return [`Meal: ${query}`, ...details.map(d => `${d.q}: ${d.a}`)].join('\n')
}

// ── Meal planner helpers ──────────────────────────────────────────────────────

// A 200 whose body arrives as: a space every few seconds while `work` runs,
// then the JSON. Leading whitespace is valid JSON, so the client parses it as
// usual, and the trickle keeps idle timeouts from closing the connection on a
// long generation. Because the status is committed up front, failures inside
// `work` are reported in the body ({ error, reason }), which the app's proxy
// helper already treats the same as a non-2xx reply.
function streamJson(work: () => Promise<unknown>): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const tick = setInterval(() => {
        try { controller.enqueue(enc.encode(' ')) } catch {}
      }, 8000)
      let body: unknown
      try {
        body = await work()
      } catch (e) {
        console.error('openai-proxy stream error:', e)
        body = { error: 'internal_error' }
      }
      clearInterval(tick)
      try {
        controller.enqueue(enc.encode(JSON.stringify(body)))
        controller.close()
      } catch {}
    },
  })
  return new Response(stream, { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

type PlanAnswer = { q: string; a: string }

function planAnswers(raw: unknown): PlanAnswer[] {
  return (Array.isArray(raw) ? raw : [])
    .map((x: Record<string, unknown>) => ({
      q: String(x?.q ?? '').trim().slice(0, 160),
      a: String(x?.a ?? '').trim().slice(0, 400),
    }))
    .filter((x: PlanAnswer) => x.q && x.a)
    .slice(0, 16)
}

// Who the plan is for: the targets and body stats the app computed at
// onboarding, the week, and the survey answers.
function planUserBlock(body: Record<string, unknown>, answers: PlanAnswer[]): string {
  const g = (body.goals ?? {}) as Record<string, unknown>
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : null }
  const str = (v: unknown, max = 40) => String(v ?? '').trim().slice(0, max)
  const lines: string[] = []
  const cal = num(g.calories)
  if (cal) {
    lines.push(`Daily targets: ${cal} kcal, ${num(g.protein) ?? '?'} g protein, ${num(g.carbs) ?? '?'} g carbs, ${num(g.fat) ?? '?'} g fat.`)
  } else {
    lines.push('Daily targets: none set. Use a sensible maintenance estimate from the stats below (or about 2000 kcal with 100 g protein if there are none) and say in the summary what you assumed.')
  }
  const stats: string[] = []
  if (str(g.sex)) stats.push(`sex ${str(g.sex)}`)
  if (num(g.age)) stats.push(`age ${num(g.age)}`)
  if (num(g.weightKg)) stats.push(`weight ${num(g.weightKg)} kg`)
  if (num(g.heightCm)) stats.push(`height ${num(g.heightCm)} cm`)
  if (str(g.activityLevel)) stats.push(`activity ${str(g.activityLevel)}`)
  if (str(g.fitnessGoal) && str(g.fitnessGoal) !== 'none') stats.push(`goal: ${str(g.fitnessGoal)} weight`)
  if (num(g.targetWeightKg)) stats.push(`target weight ${num(g.targetWeightKg)} kg`)
  if (stats.length) lines.push(`About them: ${stats.join(', ')}.`)
  const weekStart = String(body.weekStart ?? '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) lines.push(`The week starts Monday ${weekStart}.`)
  if (answers.length) lines.push('Their answers:\n' + answers.map(x => `- ${x.q} ${x.a}`).join('\n'))
  return lines.join('\n')
}

function planOutputSpec(): string {
  const nutrientList = PLAN_NUTRIENTS.map(([k, u]) => `${k} (${u})`).join(', ')
  const macroTemplate = PLAN_NUTRIENTS.map(([k]) => `"${k}":0`).join(',')
  return (
    'Return ONLY valid JSON in exactly this shape:\n' +
    '{"summary":"2 or 3 sentences on the approach and how it fits their targets",' +
    '"meals":[{"id":"m1","section":"morning","name":"short meal name","contents":"what is in it with amounts, e.g. 1 cup cooked rice (200 g), 150 g paneer, 1 cup mixed vegetables, 1 tsp oil","prepMinutes":10,"prepNote":"how and when to prep it, or an empty string",' +
    `"macros":{${macroTemplate}}}],` +
    '"days":[{"day":"Mon","mealIds":["m1","m2","m3","m4"]}],' +
    '"prepPlan":["concrete batch-cooking steps with the day and quantities"],' +
    '"nutritionNotes":["one finding per string"],' +
    '"grocery":[{"item":"Greek yogurt","amount":"1 kg tub"}]}\n\n' +
    'Rules:\n' +
    '- section is one of morning, lunch, dinner, snacks. Every day gets a morning, a lunch and a dinner; add snacks only if their meals-per-day answer includes them.\n' +
    '- days must list all seven days Mon, Tue, Wed, Thu, Fri, Sat, Sun in order, each with 3 to 5 mealIds that exist in meals.\n' +
    '- Describe each distinct meal ONCE in meals and reuse its id on other days. Repeat meals freely when their time or prep answers call for it; give more variety when they asked for it.\n' +
    `- macros are for the WHOLE portion described in contents, estimated like a registered dietitian using standard food-composition data, with EVERY key above as a plain number in these units: ${nutrientList}. Use 0 only when genuinely negligible.\n` +
    '- Each day\'s total calories must land within 5% of the daily target and protein within 10%; carbs and fat close to target. Add up each day before answering.\n' +
    '- Respect every dietary restriction, allergy and dislike absolutely.\n' +
    '- prepPlan: 3 to 8 steps that fit their prep style and kitchen, naming the day, what to cook, how much, and how long it keeps.\n' +
    '- nutritionNotes: 3 to 6 short findings. Cover fiber, and the vitamins and minerals most likely to fall short for this eating pattern (for vegetarian or vegan: vitamin B12, iron, vitamin D, calcium, zinc, iodine and omega-3; for everyone: vitamin D, potassium, and sodium if it runs high). Say what in the plan covers each, and where intake may still be low say a supplement could be worth considering and to speak to a doctor or registered dietitian before starting one. Never diagnose or claim to treat a condition.\n' +
    '- grocery: one consolidated list for the whole week with realistic amounts, 15 to 50 items.\n' +
    '- Plain, friendly wording. Never use em dashes anywhere.'
  )
}

function mealPlanPrompt(body: Record<string, unknown>, answers: PlanAnswer[]): string {
  return (
    'You plan a week of meals for a user of a nutrition-tracking app, with the care of a registered dietitian. ' +
    'Build a practical, affordable 7-day plan they will actually follow, matched to their targets, restrictions, time and kitchen.\n\n' +
    planUserBlock(body, answers) + '\n\n' + planOutputSpec()
  )
}

function mealPlanRevisePrompt(body: Record<string, unknown>, answers: PlanAnswer[], request: string): string {
  const current = JSON.stringify(compactPlanInput(body.plan)).slice(0, 60000)
  return (
    'You plan a week of meals for a user of a nutrition-tracking app, with the care of a registered dietitian. ' +
    'They have a plan and want changes. Apply the request below, keep everything they did not ask to change exactly as it is (same meals, same ids), and re-check every day\'s totals afterwards.\n\n' +
    planUserBlock(body, answers) + '\n\n' +
    `Their request: "${request}"\n\n` +
    `Current plan:\n${current}\n\n` +
    'Return the COMPLETE updated plan (all seven days), not just the changed parts.\n' +
    planOutputSpec()
  )
}

// The client's copy of the current week, trimmed to what the prompt needs.
function compactPlanInput(raw: unknown): Record<string, unknown> {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const s = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
  // Generous caps: a hand-built day can hold many more meals than the planner
  // makes, and a revision must see all of them or it silently drops some.
  const meals = (Array.isArray(p.meals) ? p.meals : []).slice(0, 120).map((m: Record<string, unknown>) => {
    const rawMacros = (m?.macros && typeof m.macros === 'object' ? m.macros : {}) as Record<string, unknown>
    const macros: Record<string, number> = {}
    for (const [k] of PLAN_NUTRIENTS) {
      const n = Number(rawMacros[k])
      if (Number.isFinite(n) && n > 0) macros[k] = n
    }
    return {
      id: s(m?.id, 12), section: s(m?.section, 12), name: s(m?.name, 80), contents: s(m?.contents, 240),
      prepMinutes: Number(m?.prepMinutes) || 0, prepNote: s(m?.prepNote, 160), macros,
    }
  })
  const days = (Array.isArray(p.days) ? p.days : []).slice(0, 7).map((d: Record<string, unknown>) => ({
    day: s(d?.day, 3),
    mealIds: (Array.isArray(d?.mealIds) ? d.mealIds : []).slice(0, 25).map((x: unknown) => s(x, 12)),
  }))
  const list = (v: unknown, max: number, len: number) =>
    (Array.isArray(v) ? v : []).slice(0, max).map((x: unknown) => s(x, len)).filter(Boolean)
  return {
    meals, days,
    summary: s(p.summary, 600),
    prepPlan: list(p.prepPlan, 10, 300),
    nutritionNotes: list(p.nutritionNotes, 8, 400),
    grocery: (Array.isArray(p.grocery) ? p.grocery : []).slice(0, 80)
      .map((g: Record<string, unknown>) => ({ item: s(g?.item, 60), amount: s(g?.amount, 40) }))
      .filter((g: { item: string }) => g.item),
  }
}

// The model's reply, reduced to the shape the app stores. Unknown ids,
// sections and days are dropped rather than trusted; every macro key is
// present as a number.
function normalizeMealPlan(parsed: Record<string, unknown>) {
  const str = (v: unknown, max: number) => noEmDash(String(v ?? '').trim()).slice(0, max)
  const meals = (Array.isArray(parsed.meals) ? parsed.meals : []).slice(0, 120)
    .map((m: Record<string, unknown>) => {
      const section = PLAN_SECTION_ALIASES[str(m?.section, 20).toLowerCase()] ?? ''
      const rawMacros = (m?.macros && typeof m.macros === 'object' ? m.macros : {}) as Record<string, unknown>
      const macros: Record<string, number> = {}
      for (const [k] of PLAN_NUTRIENTS) {
        const n = Number(rawMacros[k])
        const safe = Number.isFinite(n) && n > 0 ? n : 0
        macros[k] = k === 'calories' ? Math.round(safe) : Math.round(safe * 10) / 10
      }
      return {
        id: str(m?.id, 12),
        section,
        name: str(m?.name, 80),
        contents: str(m?.contents, 240),
        prepMinutes: Math.min(240, Math.max(0, Math.round(Number(m?.prepMinutes) || 0))),
        prepNote: str(m?.prepNote, 160),
        macros,
      }
    })
    .filter((m: { id: string; name: string; section: string }) => m.id && m.name && m.section)
  const ids = new Set(meals.map((m: { id: string }) => m.id))
  const byDay = new Map<string, string[]>()
  for (const d of Array.isArray(parsed.days) ? parsed.days : []) {
    const key = PLAN_DAY_ALIASES[str((d as Record<string, unknown>)?.day, 12).toLowerCase()]
    if (!key || byDay.has(key)) continue
    const rawIds = (d as Record<string, unknown>)?.mealIds
    const mealIds = (Array.isArray(rawIds) ? rawIds : [])
      .map((x: unknown) => String(x ?? '').trim())
      .filter((x: string) => ids.has(x))
      .slice(0, 25)
    byDay.set(key, mealIds)
  }
  const days = PLAN_DAYS.map(day => ({ day, mealIds: byDay.get(day) ?? [] }))
  const list = (v: unknown, max: number, len: number) =>
    (Array.isArray(v) ? v : []).map((x: unknown) => str(x, len)).filter(Boolean).slice(0, max)
  const grocery = (Array.isArray(parsed.grocery) ? parsed.grocery : [])
    .map((g: Record<string, unknown>) => ({ item: str(g?.item, 60), amount: str(g?.amount, 40) }))
    .filter((g: { item: string }) => g.item)
    .slice(0, 80)
  return {
    summary: str(parsed.summary, 600),
    meals,
    days,
    prepPlan: list(parsed.prepPlan, 10, 300),
    nutritionNotes: list(parsed.nutritionNotes, 8, 400),
    grocery,
  }
}

// First video result for "<exercise> exercise how to" on YouTube, read from the
// search page's embedded data. No API key needed; best effort, null on any
// failure (YouTube changing its markup just means no video, never an error).
async function findYouTubeDemo(name: string): Promise<{ id: string; title: string } | null> {
  try {
    const q = encodeURIComponent(`${name} exercise how to`)
    // sp=EgIQAQ%3D%3D restricts results to videos.
    const res = await fetch(`https://www.youtube.com/results?search_query=${q}&sp=EgIQAQ%253D%253D&hl=en`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
    if (!res.ok) return null
    const html = await res.text()
    const m = /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/.exec(html)
    if (!m) return null
    const id = m[1]
    // The title sits a little after the id inside the same renderer.
    const after = html.slice(m.index, m.index + 6000)
    const t = /"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/.exec(after)
    let title = ''
    if (t) { try { title = JSON.parse(`"${t[1]}"`) } catch { title = t[1] } }
    return { id, title: String(title).slice(0, 120) }
  } catch (e) {
    console.error('findYouTubeDemo failed:', e)
    return null
  }
}

// Called only through handle()'s callOpenAI, which notes paid calls.
async function requestOpenAI(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>
    const msg = (err.error as Record<string, unknown> | undefined)?.message ?? `OpenAI HTTP ${res.status}`
    throw new Error(String(msg))
  }
  return res.json()
}

// Decodes an uploaded picture and identifies it by its magic bytes, so what
// lands in a public bucket is a real JPEG, PNG or WebP stored under its true
// content type. Null for anything else (or for base64 that does not decode).
function decodeImage(b64: string): { bytes: Uint8Array; mime: string; ext: string } | null {
  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  } catch {
    return null
  }
  const at = (i: number) => bytes[i]
  if (bytes.length > 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    return { bytes, mime: 'image/jpeg', ext: 'jpg' }
  }
  if (bytes.length > 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) {
    return { bytes, mime: 'image/png', ext: 'png' }
  }
  if (
    bytes.length > 12 &&
    String.fromCharCode(at(0), at(1), at(2), at(3)) === 'RIFF' &&
    String.fromCharCode(at(8), at(9), at(10), at(11)) === 'WEBP'
  ) {
    return { bytes, mime: 'image/webp', ext: 'webp' }
  }
  return null
}
