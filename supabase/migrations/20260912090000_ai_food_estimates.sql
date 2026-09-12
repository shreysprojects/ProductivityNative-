-- "Ask AI" under the food search.
--
-- When the food databases do not have what the user ate, the openai-proxy
-- estimates the nutrition from the user's description, their answers to a few
-- clarifying questions and an optional photo. Every estimate the proxy makes
-- is recorded here so estimated foods can later be curated into a real food
-- list without paying for the same estimate twice.
--
-- RLS is on with NO client policies on purpose: the app never reads or writes
-- this table, only the proxy does (service role). Query it from the dashboard.

CREATE TABLE IF NOT EXISTS public.ai_food_estimates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  query       TEXT NOT NULL,                  -- what the user typed
  answers     JSONB NOT NULL DEFAULT '[]',    -- [{q, a}] the clarifying answers
  had_photo   BOOLEAN NOT NULL DEFAULT false,
  name        TEXT NOT NULL,                  -- the food name the model settled on
  portion     TEXT,                           -- e.g. "1 cup (170 g), cooked"
  contents    TEXT,                           -- what is in it / how it was prepared
  confidence  TEXT,                           -- low | medium | high
  notes       TEXT,
  macros      JSONB NOT NULL,                 -- every tracked nutrient, app key names
  model       TEXT,
  raw         JSONB                           -- the model's full reply, for reference
);

CREATE INDEX IF NOT EXISTS ai_food_estimates_user_created_idx
  ON public.ai_food_estimates(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_food_estimates_query_idx
  ON public.ai_food_estimates(lower(query));

ALTER TABLE public.ai_food_estimates ENABLE ROW LEVEL SECURITY;

-- Daily counter for the estimator, same shape as ai_rate_limits. The proxy
-- charges one unit per call (clarify + estimate), so the cap it passes is
-- twice the number of foods a day.
CREATE TABLE IF NOT EXISTS public.ai_food_limits (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date    DATE NOT NULL,
  count   INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
ALTER TABLE public.ai_food_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_food_limits_own_read" ON public.ai_food_limits;
CREATE POLICY "ai_food_limits_own_read" ON public.ai_food_limits
  FOR SELECT USING (auth.uid() = user_id);

-- Same body as 20260814100000 (exemption check first), plus the 'food' kind.
CREATE OR REPLACE FUNCTION public.consume_ai_limit(p_user UUID, p_kind TEXT, p_max INT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INT;
BEGIN
  IF EXISTS (SELECT 1 FROM public.ai_limit_exemptions e WHERE e.user_id = p_user) THEN
    RETURN jsonb_build_object('allowed', true, 'count', 0);
  END IF;

  IF p_kind = 'generative' THEN
    INSERT INTO public.ai_rate_limits (user_id, date, count)
    VALUES (p_user, current_date, 1)
    ON CONFLICT (user_id, date) DO UPDATE SET count = ai_rate_limits.count + 1
    RETURNING ai_rate_limits.count INTO v_count;

  ELSIF p_kind = 'mod' THEN
    INSERT INTO public.ai_mod_limits (user_id, date, count)
    VALUES (p_user, current_date, 1)
    ON CONFLICT (user_id, date) DO UPDATE SET count = ai_mod_limits.count + 1
    RETURNING ai_mod_limits.count INTO v_count;

  ELSIF p_kind = 'workout' THEN
    -- Weekly window starts Monday, matching ai_workout_limits.week_start.
    INSERT INTO public.ai_workout_limits (user_id, week_start, count)
    VALUES (p_user, date_trunc('week', current_date)::DATE, 1)
    ON CONFLICT (user_id, week_start) DO UPDATE SET count = ai_workout_limits.count + 1
    RETURNING ai_workout_limits.count INTO v_count;

  ELSIF p_kind = 'food' THEN
    INSERT INTO public.ai_food_limits (user_id, date, count)
    VALUES (p_user, current_date, 1)
    ON CONFLICT (user_id, date) DO UPDATE SET count = ai_food_limits.count + 1
    RETURNING ai_food_limits.count INTO v_count;

  ELSE
    RAISE EXCEPTION 'unknown_limit_kind'
      USING HINT = 'p_kind must be generative, mod, workout or food';
  END IF;

  RETURN jsonb_build_object('allowed', v_count <= p_max, 'count', v_count);
END;
$$;
