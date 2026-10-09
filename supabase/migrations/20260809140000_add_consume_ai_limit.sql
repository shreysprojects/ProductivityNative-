-- The openai-proxy edge function calls consume_ai_limit() before every AI
-- action. The function was written in supabase/audit-fixes.sql but never made
-- it into the live database, so every call errored — and because the proxy
-- treats a failed counter as "limit reached", every AI feature reported a
-- limit the user had not actually hit.
--
-- Idempotent: creates the backing tables only if missing, replaces the
-- function outright.

CREATE TABLE IF NOT EXISTS public.ai_rate_limits (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date    DATE NOT NULL,
  count   INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
ALTER TABLE public.ai_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ai_mod_limits (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date    DATE NOT NULL,
  count   INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
ALTER TABLE public.ai_mod_limits ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ai_workout_limits (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  count      INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, week_start)
);
ALTER TABLE public.ai_workout_limits ENABLE ROW LEVEL SECURITY;

-- Increment and check in one statement so concurrent calls can't both pass.
CREATE OR REPLACE FUNCTION public.consume_ai_limit(p_user UUID, p_kind TEXT, p_max INT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INT;
BEGIN
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

  ELSE
    RAISE EXCEPTION 'unknown_limit_kind'
      USING HINT = 'p_kind must be generative, mod or workout';
  END IF;

  RETURN jsonb_build_object('allowed', v_count <= p_max, 'count', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_limit(UUID, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_limit(UUID, TEXT, INT) TO service_role;

-- Read-your-own-usage policies (no client writes; the proxy uses service role).
DROP POLICY IF EXISTS "ai_rate_limits_own_read" ON public.ai_rate_limits;
CREATE POLICY "ai_rate_limits_own_read" ON public.ai_rate_limits
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "ai_mod_limits_own_read" ON public.ai_mod_limits;
CREATE POLICY "ai_mod_limits_own_read" ON public.ai_mod_limits
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "ai_workout_limits_own_read" ON public.ai_workout_limits;
CREATE POLICY "ai_workout_limits_own_read" ON public.ai_workout_limits
  FOR SELECT USING (auth.uid() = user_id);
