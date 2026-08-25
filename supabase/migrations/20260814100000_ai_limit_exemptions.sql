-- Permanent AI limit exemption for the app owner (username theflungdung).
-- consume_ai_limit short-circuits for exempted users, so every limit kind it
-- guards — generative daily, mod daily, workout weekly — and any future kind
-- routed through it is bypassed in one place. The edge function needs no
-- changes and still fails closed for everyone else.

CREATE TABLE IF NOT EXISTS public.ai_limit_exemptions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);
-- RLS on with no policies on purpose: only the SECURITY DEFINER function
-- (and service role) read this; clients can neither see nor grant exemptions.
ALTER TABLE public.ai_limit_exemptions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_user UUID;
BEGIN
  SELECT id INTO v_user FROM public.profiles WHERE username = 'theflungdung';
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'no profile with username theflungdung; exemption not added';
  END IF;
  INSERT INTO public.ai_limit_exemptions (user_id) VALUES (v_user)
  ON CONFLICT DO NOTHING;
END $$;

-- Same body as 20260809140000, plus the exemption check up top.
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

  ELSE
    RAISE EXCEPTION 'unknown_limit_kind'
      USING HINT = 'p_kind must be generative, mod or workout';
  END IF;

  RETURN jsonb_build_object('allowed', v_count <= p_max, 'count', v_count);
END;
$$;
