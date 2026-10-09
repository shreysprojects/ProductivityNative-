-- ============================================================
-- RLS Supplement — run in Supabase SQL Editor after schema.sql
-- Adds missing tables (user_goals, tasks, journal_entries, etc.)
-- and the ai_rate_limits table for server-side AI rate limiting.
-- Safe to run multiple times (all statements use IF NOT EXISTS /
-- OR REPLACE / IF EXISTS guards).
-- Dashboard → SQL Editor → New query → paste → Run
-- ============================================================

-- ── Missing profile columns ────────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username   TEXT UNIQUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio        TEXT    NOT NULL DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT    NOT NULL DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- ── user_goals ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_goals (
  user_id          UUID    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  weight_kg        NUMERIC,
  height_cm        NUMERIC,
  age              INTEGER,
  sex              TEXT,
  fitness_goal     TEXT    NOT NULL DEFAULT 'none',
  activity_level   TEXT,
  workout_days     INTEGER,
  gym_split        JSONB,
  calories         INTEGER,
  protein          INTEGER,
  carbs            INTEGER,
  fat              INTEGER,
  is_custom        BOOLEAN NOT NULL DEFAULT FALSE,
  target_weight    NUMERIC,
  onboarding_done  BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE public.user_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_goals_own" ON public.user_goals;
CREATE POLICY "user_goals_own" ON public.user_goals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── tasks ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasks (
  id          TEXT    NOT NULL,
  user_id     UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  description TEXT,
  due_date    DATE,
  priority    TEXT,
  done        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, user_id)
);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tasks_own" ON public.tasks;
CREATE POLICY "tasks_own" ON public.tasks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── journal_entries ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.journal_entries (
  user_id    UUID  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date       DATE  NOT NULL,
  mood       TEXT,
  text       TEXT  NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, date)
);

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "journal_entries_own" ON public.journal_entries;
CREATE POLICY "journal_entries_own" ON public.journal_entries
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── schedule_items ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.schedule_items (
  id             TEXT        NOT NULL,
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title          TEXT        NOT NULL,
  location       TEXT,
  days           INTEGER[]   NOT NULL DEFAULT '{}',
  start_time     TEXT,
  end_time       TEXT,
  color          TEXT,
  semester_start DATE,
  semester_end   DATE,
  PRIMARY KEY (id, user_id)
);

ALTER TABLE public.schedule_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "schedule_items_own" ON public.schedule_items;
CREATE POLICY "schedule_items_own" ON public.schedule_items
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── calendar_events ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id          TEXT        NOT NULL,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  date        DATE        NOT NULL,
  time        TEXT,
  type        TEXT,
  notify_mins INTEGER     NOT NULL DEFAULT 10,
  notif_id    TEXT,
  PRIMARY KEY (id, user_id)
);

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "calendar_events_own" ON public.calendar_events;
CREATE POLICY "calendar_events_own" ON public.calendar_events
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── day_todos ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.day_todos (
  user_id UUID  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date    DATE  NOT NULL,
  todos   JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY (user_id, date)
);

ALTER TABLE public.day_todos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "day_todos_own" ON public.day_todos;
CREATE POLICY "day_todos_own" ON public.day_todos
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── weekly_routines ────────────────────────────────────────────────────────
-- Weekly routines (with their lists): full array as JSONB per user.
CREATE TABLE IF NOT EXISTS public.weekly_routines (
  user_id  UUID  PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  routines JSONB NOT NULL DEFAULT '[]'
);

ALTER TABLE public.weekly_routines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "weekly_routines_own" ON public.weekly_routines;
CREATE POLICY "weekly_routines_own" ON public.weekly_routines
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── day_rules ──────────────────────────────────────────────────────────────
-- Dashboard "Rules for today": [{id, text}] per user, persists until edited.
CREATE TABLE IF NOT EXISTS public.day_rules (
  user_id UUID  PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  rules   JSONB NOT NULL DEFAULT '[]'
);

ALTER TABLE public.day_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "day_rules_own" ON public.day_rules;
CREATE POLICY "day_rules_own" ON public.day_rules
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── productivity_sessions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.productivity_sessions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_desc  TEXT        NOT NULL DEFAULT '',
  duration   INTEGER     NOT NULL DEFAULT 0,
  notes      TEXT        NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.productivity_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "productivity_sessions_own" ON public.productivity_sessions;
CREATE POLICY "productivity_sessions_own" ON public.productivity_sessions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Visibility-aware read policy (matches pattern from schema.sql)
DO $$ BEGIN
  CREATE POLICY "productivity_sessions_view"
    ON public.productivity_sessions FOR SELECT
    USING (public.can_view_data(user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── ai_rate_limits ─────────────────────────────────────────────────────────
-- Written only by the openai-proxy edge function (service role).
-- Clients can read their own row to show remaining uses, but cannot write.
CREATE TABLE IF NOT EXISTS public.ai_rate_limits (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date    DATE NOT NULL,
  count   INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

ALTER TABLE public.ai_rate_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_rate_limits_own_read" ON public.ai_rate_limits;
CREATE POLICY "ai_rate_limits_own_read" ON public.ai_rate_limits
  FOR SELECT USING (auth.uid() = user_id);
-- No INSERT/UPDATE/DELETE from client — edge function uses service role key
