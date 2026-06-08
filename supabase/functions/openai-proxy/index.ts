import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const OPENAI_KEY   = Deno.env.get('OPENAI_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MAX_PER_DAY     = 3
const MAX_MOD_PER_DAY = 60

// Actions that consume the daily generative rate limit
const GENERATIVE = new Set(['create_routine', 'advise_routine', 'analyze_looks'])

// Moderation actions capped separately (moderate_routine & moderate_profile_picture
// call paid gpt-4o-mini; moderate_texts is the free endpoint but is capped too as
// abuse protection) so a scripted caller can't hammer them outside the normal UI.
const PAID_MOD = new Set(['moderate_routine', 'moderate_profile_picture', 'moderate_texts'])

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
    const today = new Date().toISOString().slice(0, 10)

    if (GENERATIVE.has(action)) {
      const { data: rl } = await admin
        .from('ai_rate_limits')
        .select('count')
        .eq('user_id', user.id)
        .eq('date', today)
        .maybeSingle()

      const current = (rl as { count: number } | null)?.count ?? 0
      if (current >= MAX_PER_DAY) {
        return json(
          { error: 'daily_limit', reason: `Daily limit of ${MAX_PER_DAY} AI uses reached. Try again tomorrow.` },
          429,
        )
      }
      await admin
        .from('ai_rate_limits')
        .upsert({ user_id: user.id, date: today, count: current + 1 })
    } else if (PAID_MOD.has(action)) {
      const { data: rl } = await admin
        .from('ai_mod_limits')
        .select('count')
        .eq('user_id', user.id)
        .eq('date', today)
        .maybeSingle()

      const current = (rl as { count: number } | null)?.count ?? 0
      // Fail open (allowed: true) past the cap: don't burn paid calls, and the
      // DB blocklist trigger + 5-posts/day insert policy still backstop content.
      if (current >= MAX_MOD_PER_DAY) return json({ allowed: true })
      await admin
        .from('ai_mod_limits')
        .upsert({ user_id: user.id, date: today, count: current + 1 })
    }

    // ── Dispatch ────────────────────────────────────────────────────────────

    if (action === 'moderate_text') {
      const text = String(body.text ?? '').slice(0, 2000)
      const res = await callOpenAI('https://api.openai.com/v1/moderations', { input: text })
      return json({ flagged: res.results?.[0]?.flagged ?? false })
    }

    if (action === 'moderate_image') {
      const res = await callOpenAI('https://api.openai.com/v1/moderations', {
        model: 'omni-moderation-latest',
        input: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${body.base64}` } }],
      })
      return json({ flagged: res.results?.[0]?.flagged ?? false })
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
              { type: 'text', text: 'You are a content moderator for a family-friendly productivity app.\nReview this profile picture.\n\nBLOCK (allowed: false) if the image contains:\n- Nudity or sexual content\n- Hate symbols (swastikas, Nazi imagery, KKK, extremist symbols)\n- Violence or gore\n- Slurs or harassment text\n\nALLOW everything else: selfies, logos, art, memes, animals, landscapes, etc.\n\nReply with ONLY valid JSON:\n{"allowed": true}\n{"allowed": false, "reason": "one sentence, addressed to the user"}' },
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

    if (action === 'analyze_looks') {
      const base64: string = body.base64 ?? ''
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
