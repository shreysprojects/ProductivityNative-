-- TimeLog-style features: 30-minute time logging, to-do buckets, and
-- AI-imported class metadata. Purely additive; touches no existing data.

-- One row per logged time slot. slot_start is minutes from midnight.
CREATE TABLE IF NOT EXISTS public.time_logs (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day        DATE NOT NULL,
  slot_start INT  NOT NULL,
  text       TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL DEFAULT 'log',
  updated_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, day, slot_start)
);

ALTER TABLE public.time_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "time_logs_own" ON public.time_logs;
CREATE POLICY "time_logs_own" ON public.time_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- To-do buckets ('today' | 'week' | 'anytime' | 'ambitious') and optional
-- deadline ('YYYY-MM-DD' = end of that day, or 'YYYY-MM-DD HH:MM').
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS bucket   TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS deadline TEXT;

-- Class metadata from the AI timetable import: {courseCode, courseName, type}.
ALTER TABLE public.schedule_items ADD COLUMN IF NOT EXISTS meta JSONB;
