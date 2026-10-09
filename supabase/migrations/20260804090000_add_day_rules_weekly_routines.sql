-- Cloud backup tables for "Rules for today" and weekly routines.
-- Purely additive: creates tables only if missing, touches no existing data.

CREATE TABLE IF NOT EXISTS public.day_rules (
  user_id UUID  PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  rules   JSONB NOT NULL DEFAULT '[]'
);

ALTER TABLE public.day_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "day_rules_own" ON public.day_rules;
CREATE POLICY "day_rules_own" ON public.day_rules
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.weekly_routines (
  user_id  UUID  PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  routines JSONB NOT NULL DEFAULT '[]'
);

ALTER TABLE public.weekly_routines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "weekly_routines_own" ON public.weekly_routines;
CREATE POLICY "weekly_routines_own" ON public.weekly_routines
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
