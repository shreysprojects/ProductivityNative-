import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const OPENAI_KEY   = Deno.env.get('OPENAI_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MAX_PER_DAY          = 3
const MAX_MOD_PER_DAY      = 60
const MAX_EXTRACT_PER_WEEK = 10
// Length of the base64 string, so ~1.5MB of decoded image.
const MAX_IMAGE_B64        = 2_000_000

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

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
      return data as { allowed: boolean; count: number }
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
    } else if (action === 'upload_avatar') {
      const rl = await consumeLimit('mod', MAX_MOD_PER_DAY)
      if (rl && !rl.allowed) {
        return json(
          { error: 'daily_limit', reason: 'You have changed your photo too many times today. Please try again tomorrow.' },
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
      const base64 = String(body.base64 ?? '')
      if (!base64) return json({ error: 'no_image' }, 400)
      const oversize = checkImageSize(base64)
      if (oversize) return oversize

      const dataUrl = `data:image/jpeg;base64,${base64}`
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
            model: 'gpt-4o-mini',
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: PICTURE_MOD_PROMPT },
                { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
              ],
            }],
            max_tokens: 80,
            response_format: { type: 'json_object' },
          })
          const parsed = JSON.parse(chat.choices?.[0]?.message?.content ?? '{}')
          if (parsed.allowed === false) {
            flagged = true
            if (typeof parsed.reason === 'string' && parsed.reason.trim()) reason = parsed.reason.trim()
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

      let bytes: Uint8Array | null = null
      try {
        bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
      } catch {}
      if (!bytes) {
        return json({ error: 'invalid_image', reason: 'That photo could not be read. Please try another one.' }, 400)
      }

      const path = `${user.id}/avatar.jpg`
      const { error: upErr } = await admin.storage.from('avatars').upload(path, bytes, {
        contentType: 'image/jpeg',
        upsert: true,
      })
      if (upErr) {
        console.error('upload_avatar storage error:', upErr)
        return json({ error: 'upload_failed', reason: 'We could not save that photo. Please try again.' }, 500)
      }

      const { data: pub } = admin.storage.from('avatars').getPublicUrl(path)
      return json({ url: pub.publicUrl })
    }

    if (action === 'create_routine') {
      const surveyQA: Array<{ q: string; answer: string }> = body.surveyQA ?? []
      const routineName: string = body.routineName ?? ''

      // Moderate all user-supplied text before generating
      const userText = surveyQA.map(i => i.answer).filter(Boolean).join(' ').slice(0, 2000)
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
        `Include 5–8 specific, actionable tasks realistic for the available time.${fitnessClause} Set timeGoalSecs to 0 for open-ended tasks.`

      const chat = await callOpenAI('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
        response_format: { type: 'json_object' },
      })

      const parsed = JSON.parse(chat.choices?.[0]?.message?.content ?? '{}')
      const raw: Array<{ text?: string; emoji?: string; timeGoalSecs?: number }> =
        Array.isArray(parsed.tasks) ? parsed.tasks : Array.isArray(parsed) ? parsed : []

      const tasks = raw
        .map((t, i) => ({
          id: Date.now() + i,
          text: String(t.text ?? '').trim(),
          emoji: String(t.emoji ?? ''),
          timeGoalSecs: Math.max(0, Math.round(Number(t.timeGoalSecs) || 0)),
          subTasks: [],
        }))
        .filter(t => t.text)

      return json({ tasks })
    }

    if (action === 'advise_routine') {
      const tasks: Array<{ text: string }> = body.tasks ?? []
      const routineName: string = body.routineName ?? ''

      const taskList = tasks.map((t, i) => `${i + 1}. ${t.text}`).join('\n')
      const fitnessClause = routineName === 'Fitness'
        ? ' Do NOT recommend specific exercises, lifts, sets, or reps. Focus only on surrounding habits (warm-up, mobility, hydration, supplements, nutrition, cooldown, shower, rest).'
        : ''
      const prompt =
        `You are a personal productivity coach. Analyze this ${routineName} routine and give concise advice:\n\n` +
        `${taskList}\n\n` +
        `In 2–3 short paragraphs: what is good, what to add, remove, or change, and any timing tips. Be specific and direct.${fitnessClause} Under 200 words.`

      const chat = await callOpenAI('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400,
      })

      const advice = chat.choices?.[0]?.message?.content?.trim() ?? ''
      return json({ advice })
    }

    if (action === 'moderate_profile_picture') {
      const avatarUrl: string = body.avatarUrl ?? ''
      if (!avatarUrl) return json({ allowed: true })
      try {
        const chat = await callOpenAI('https://api.openai.com/v1/chat/completions', {
          model: 'gpt-4o-mini',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: PICTURE_MOD_PROMPT },
              { type: 'image_url', image_url: { url: avatarUrl, detail: 'low' } },
            ],
          }],
          max_tokens: 80,
          response_format: { type: 'json_object' },
        })
        const parsed = JSON.parse(chat.choices?.[0]?.message?.content ?? '{}')
        return json({ allowed: parsed.allowed !== false, reason: parsed.reason ?? null })
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
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 80,
          response_format: { type: 'json_object' },
        })
        const parsed = JSON.parse(chat.choices?.[0]?.message?.content ?? '{}')
        return json({ allowed: parsed.allowed !== false, reason: parsed.reason ?? null })
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
        model: 'gpt-4o-mini',
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
        max_tokens: 1200,
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

      const chat = await callOpenAI('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'The attached screenshots show a student\'s class schedule / timetable. Read the ENTIRE timetable, checking every visible day/column in every screenshot. Extract every distinct recurring class meeting pattern.\n\nReturn ONLY valid JSON:\n{"classes":[{"courseCode":"CS 135","courseName":"Designing Functional Programs","type":"Lecture","days":["Mon","Wed","Fri"],"startTime":"14:30","endTime":"15:20","location":"MC 2054"}]}\n\nRules:\n- days: include EVERY weekday on which that exact course, type, time, and location meets. Never keep only the first day. Use three-letter values from Mon,Tue,Wed,Thu,Fri,Sat,Sun.\n- If a course has different times, types, or rooms on different days, return separate objects with the correct days for each pattern.\n- Inspect all seven day columns and all supplied screenshots before answering. Do not omit later days or repeated meetings.\n- courseCode: the short code as shown (e.g. "CS 135", "MATH 137"). If none is visible, use a short form of the name.\n- courseName: the full course title. If not visible, repeat the course code.\n- type: one of "Lecture", "Tutorial", "Lab", "Seminar", "Other" — infer from markers like LEC/TUT/LAB/SEM.\n- startTime/endTime: 24-hour "HH:MM".\n- location: the room/building as shown, or null if not visible.\n- If the images do not show a class schedule, return {"classes":[]}.' },
            ...images.map(b64 => ({
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' },
            })),
          ],
        }],
        max_tokens: 3000,
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
      const TYPES = ['Lecture', 'Tutorial', 'Lab', 'Seminar', 'Other']
      const timeOk = (t: unknown) => typeof t === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(t)
      const classes = raw
        .flatMap(c => {
          const suppliedDays = Array.isArray(c.days) ? c.days : [c.day]
          const days = [...new Set(suppliedDays
            .map(day => DAY_ALIASES[String(day ?? '').trim().toLowerCase()])
            .filter(day => DAYS.includes(day)))]
          return days.map(day => ({
            courseCode: String(c.courseCode ?? '').trim().slice(0, 20),
            courseName: String(c.courseName ?? '').trim().slice(0, 80),
            type: TYPES.includes(String(c.type)) ? String(c.type) : 'Other',
            day,
            startTime: c.startTime,
            endTime: c.endTime,
            location: c.location ? String(c.location).trim().slice(0, 60) : null,
          }))
        })
        .filter(c =>
          (c.courseCode || c.courseName) && DAYS.includes(c.day) &&
          timeOk(c.startTime) && timeOk(c.endTime) && String(c.startTime) < String(c.endTime)
        )
      return json({ classes })
    }

    if (action === 'analyze_looks') {
      const base64: string = body.base64 ?? ''
      const oversize = checkImageSize(base64)
      if (oversize) return oversize

      const chat = await callOpenAI('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this facial photo and provide a personalized foundational skincare and hair care routine.\nReturn ONLY a valid JSON object.\n\nIf the image contains inappropriate, explicit, or offensive content, return exactly: {"error":"inappropriate"}\nOnly return {"error":"quality"} if the image is so dark, blurry, or obscured that NO facial features are visible at all.\n\nOtherwise return:\n{"skinNote":"Optional short compliment if skin looks notably clear/healthy — omit entirely if not applicable","categories":[{"name":"Category name","steps":[{"name":"Step name","product":"Specific accessible drugstore product","explanation":"1-sentence reason based on what you observe"}]}]}\n\nInclude 2-4 skin categories AND one "Hair Care" category (2-4 steps each). For Hair Care: identify hair type, washing frequency, and product recommendations. For skin: reference observable features (oiliness, dryness, texture). Use affordable drugstore products. No medical diagnoses or attractiveness judgments.' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
          ],
        }],
        max_tokens: 1200,
        response_format: { type: 'json_object' },
      })

      const choice = chat.choices?.[0]
      if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) {
        return json({ error: 'inappropriate' })
      }
      const parsed = JSON.parse(choice?.message?.content ?? '{}')
      return json(parsed)
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (e) {
    console.error('openai-proxy error:', e)
    return json({ error: 'internal_error' }, 500)
  }
})

async function callOpenAI(url: string, body: unknown): Promise<Record<string, unknown>> {
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
