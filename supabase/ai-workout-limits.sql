-- ============================================================
-- Weekly rate-limit table for the workout screenshot import
-- (extract_workout action in the openai-proxy edge function):
-- 10 imports per week (Mon–Sun), separate from the 3/day
-- generative AI limit.
-- Safe to run multiple times.
-- Dashboard → SQL Editor → New query → paste → Run
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_workout_limits (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  count      INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, week_start)
);

ALTER TABLE public.ai_workout_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_workout_limits_own_read" ON public.ai_workout_limits;
CREATE POLICY "ai_workout_limits_own_read" ON public.ai_workout_limits
  FOR SELECT USING (auth.uid() = user_id);
-- No client writes; the openai-proxy edge function uses the service-role key.
