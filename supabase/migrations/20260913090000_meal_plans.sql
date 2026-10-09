-- Meal planning (the Plan tab on the Meals page).
--
-- One row per user per week. `days` maps weekday keys (Mon..Sun) to the
-- planned meals for that day, in the same shape as a logged meal
-- ({ id, section, name, contents, macros, ... }) plus prep details. `notes`
-- holds what the AI planner said about the week: summary, nutrition check,
-- meal-prep steps and the grocery list. Null for weeks the user built by hand.

CREATE TABLE IF NOT EXISTS public.meal_plans (
  user_id    UUID  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start DATE  NOT NULL,                 -- the Monday of the week
  days       JSONB NOT NULL DEFAULT '{}',
  notes      JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_start)
);

ALTER TABLE public.meal_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "meal_plans_own" ON public.meal_plans;
CREATE POLICY "meal_plans_own" ON public.meal_plans
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Daily counter for the AI meal planner. A generation and each revision cost
-- one unit; the proxy passes the cap. Same shape as the other limit tables.
CREATE TABLE IF NOT EXISTS public.ai_mealplan_limits (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date    DATE NOT NULL,
  count   INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
ALTER TABLE public.ai_mealplan_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_mealplan_limits_own_read" ON public.ai_mealplan_limits;
CREATE POLICY "ai_mealplan_limits_own_read" ON public.ai_mealplan_limits
  FOR SELECT USING (auth.uid() = user_id);
-- No client writes; the openai-proxy edge function uses the service-role key.

-- Same body as 20260912120000, plus the 'mealplan' kind.
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

  ELSIF p_kind = 'mealplan' THEN
    INSERT INTO public.ai_mealplan_limits (user_id, date, count)
    VALUES (p_user, current_date, 1)
    ON CONFLICT (user_id, date) DO UPDATE SET count = ai_mealplan_limits.count + 1
    RETURNING ai_mealplan_limits.count INTO v_count;

  ELSE
    RAISE EXCEPTION 'unknown_limit_kind'
      USING HINT = 'p_kind must be generative, mod, workout, food, light or mealplan';
  END IF;

  RETURN jsonb_build_object('allowed', v_count <= p_max, 'count', v_count);
END;
$$;
