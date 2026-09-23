-- The meal plan is one recurring week per user, like the class schedule, not
-- a plan per calendar week. meal_plans loses its week_start key: one row per
-- user, and the app reads it every week until it is changed.
--
-- Rows that already exist (one per week, from the first version of the Plan
-- tab) collapse to the most recently updated week per user.

DELETE FROM public.meal_plans a
  USING public.meal_plans b
  WHERE a.user_id = b.user_id
    AND (a.updated_at < b.updated_at
         OR (a.updated_at = b.updated_at AND a.week_start < b.week_start));

ALTER TABLE public.meal_plans DROP CONSTRAINT IF EXISTS meal_plans_pkey;
ALTER TABLE public.meal_plans DROP COLUMN IF EXISTS week_start;
ALTER TABLE public.meal_plans ADD PRIMARY KEY (user_id);
