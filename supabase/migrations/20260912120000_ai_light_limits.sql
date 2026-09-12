-- A daily counter for cheap, text-only AI helpers (first use: suggesting the
-- muscles a custom exercise trains). Same shape as ai_rate_limits; the proxy
-- passes its own cap. Owner exemption still short-circuits everything.

CREATE TABLE IF NOT EXISTS public.ai_light_limits (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date    DATE NOT NULL,
  count   INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
ALTER TABLE public.ai_light_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_light_limits_own_read" ON public.ai_light_limits;
CREATE POLICY "ai_light_limits_own_read" ON public.ai_light_limits
  FOR SELECT USING (auth.uid() = user_id);

-- Same body as 20260912090000, plus the 'light' kind.
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

  ELSIF p_kind = 'light' THEN
    INSERT INTO public.ai_light_limits (user_id, date, count)
    VALUES (p_user, current_date, 1)
    ON CONFLICT (user_id, date) DO UPDATE SET count = ai_light_limits.count + 1
    RETURNING ai_light_limits.count INTO v_count;

  ELSE
    RAISE EXCEPTION 'unknown_limit_kind'
      USING HINT = 'p_kind must be generative, mod, workout, food or light';
  END IF;

  RETURN jsonb_build_object('allowed', v_count <= p_max, 'count', v_count);
END;
$$;
