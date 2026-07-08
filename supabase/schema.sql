-- ============================================================
-- Run this entire file in Supabase SQL Editor (one paste)
-- Dashboard → SQL Editor → New query → paste → Run
-- ============================================================

-- Profiles (one row per auth user, auto-created by trigger below)
CREATE TABLE IF NOT EXISTS public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT,
  has_setup  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Routine name lists
CREATE TABLE IF NOT EXISTS public.routine_names (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  names   TEXT[] NOT NULL DEFAULT '{}'
);

-- Routine task templates
CREATE TABLE IF NOT EXISTS public.routine_templates (
  user_id      UUID  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  routine_name TEXT  NOT NULL,
  tasks        JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY (user_id, routine_name)
);

-- Daily routine run state
CREATE TABLE IF NOT EXISTS public.routine_runs (
  user_id      UUID  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  routine_name TEXT  NOT NULL,
  date         DATE  NOT NULL,
  data         JSONB NOT NULL,
  PRIMARY KEY (user_id, routine_name, date)
);

-- Gym split configuration
CREATE TABLE IF NOT EXISTS public.gym_splits (
  user_id UUID  PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preset  TEXT  NOT NULL DEFAULT 'PPL',
  days    JSONB NOT NULL DEFAULT '[]'
);

-- Stretch routine exercises
CREATE TABLE IF NOT EXISTS public.stretch_routines (
  user_id   UUID  PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  exercises JSONB NOT NULL DEFAULT '[]'
);

-- Workout plans per muscle group
CREATE TABLE IF NOT EXISTS public.workout_plans (
  user_id      UUID  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  muscle_group TEXT  NOT NULL,
  exercises    JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY (user_id, muscle_group)
);

-- Workout logs per day
CREATE TABLE IF NOT EXISTS public.workout_logs (
  user_id UUID  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date    DATE  NOT NULL,
  data    JSONB,
  PRIMARY KEY (user_id, date)
);

-- Routine completion history
CREATE TABLE IF NOT EXISTS public.history (
  user_id      UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date         DATE    NOT NULL,
  routine_name TEXT    NOT NULL,
  completion   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date, routine_name)
);

-- Streak tracking
CREATE TABLE IF NOT EXISTS public.streaks (
  user_id   UUID    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current   INTEGER NOT NULL DEFAULT 0,
  longest   INTEGER NOT NULL DEFAULT 0,
  last_date DATE
);

-- Daily meals
CREATE TABLE IF NOT EXISTS public.meals (
  user_id UUID  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date    DATE  NOT NULL,
  meals   JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY (user_id, date)
);

-- Saved meal templates
CREATE TABLE IF NOT EXISTS public.saved_meals (
  user_id UUID  PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  meals   JSONB NOT NULL DEFAULT '[]'
);

-- Exercise library (seeded from WorkoutX via seed script)
CREATE TABLE IF NOT EXISTS public.exercises (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  body_part          TEXT,
  target             TEXT,
  secondary_muscles  TEXT[] NOT NULL DEFAULT '{}',
  equipment          TEXT,
  difficulty         TEXT,
  description        TEXT,
  gif_url            TEXT,
  youtube_id         TEXT,
  instructions       TEXT[]
);

-- ── Row Level Security ──────────────────────────────────────────────────────

ALTER TABLE public.profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routine_names     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routine_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routine_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gym_splits        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stretch_routines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_plans     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.history           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streaks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meals             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_meals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercises         ENABLE ROW LEVEL SECURITY;

-- User tables: each user can only read/write their own rows
CREATE POLICY "own_profile"          ON public.profiles         FOR ALL USING (auth.uid() = id);
CREATE POLICY "own_routine_names"    ON public.routine_names     FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_templates"        ON public.routine_templates FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_runs"             ON public.routine_runs      FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_gym_split"        ON public.gym_splits        FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_stretch"          ON public.stretch_routines  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_workout_plans"    ON public.workout_plans     FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_workout_logs"     ON public.workout_logs      FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_history"          ON public.history           FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_streaks"          ON public.streaks           FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_meals"            ON public.meals             FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_saved_meals"      ON public.saved_meals       FOR ALL USING (auth.uid() = user_id);

-- Exercises: publicly readable, only service role can write (seed script)
CREATE POLICY "exercises_public_read" ON public.exercises FOR SELECT USING (true);

-- Shared community routines (public feed)
CREATE TABLE IF NOT EXISTS public.shared_routines (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name        TEXT        NOT NULL,
  author_bio         TEXT        NOT NULL DEFAULT '',
  author_avatar_url  TEXT        NOT NULL DEFAULT '',
  routine_name       TEXT        NOT NULL,
  tasks              JSONB       NOT NULL DEFAULT '[]',
  report_count       INTEGER     NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Structural guards (fast, index-friendly)
  CONSTRAINT sr_routine_name_length CHECK (char_length(trim(routine_name)) BETWEEN 1 AND 80),
  CONSTRAINT sr_author_name_length  CHECK (char_length(trim(author_name))  BETWEEN 1 AND 40),
  CONSTRAINT sr_routine_no_contact  CHECK (
    trim(routine_name) !~ '\S+@\S+\.\S+' AND
    trim(routine_name) !~ '(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}'
  ),
  CONSTRAINT sr_routine_no_spam     CHECK (trim(routine_name) !~ '(.)\1{9,}')
);

ALTER TABLE public.shared_routines ENABLE ROW LEVEL SECURITY;

-- Anyone (including anonymous) can read the community feed
CREATE POLICY "shared_routines_public_read"
  ON public.shared_routines FOR SELECT USING (true);

-- Authenticated users can post; user_id must match their own auth id
CREATE POLICY "shared_routines_insert"
  ON public.shared_routines FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can only remove their own posts
CREATE POLICY "shared_routines_own_delete"
  ON public.shared_routines FOR DELETE
  USING (auth.uid() = user_id);

-- ── Shared routine server-side content validation ──────────────────────────

-- Central blocklist checker — shared by every content trigger so the word
-- list lives in ONE place. Raises 'inappropriate_content' on a hit.
-- Keep this list in sync with BLOCKED_SUBSTRINGS / BLOCKED_WORDS in app/(tabs)/explore.js.
CREATE OR REPLACE FUNCTION public.assert_text_clean(txt TEXT, field_label TEXT DEFAULT 'content')
RETURNS VOID LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  -- Substring match: safe because these never appear inside innocent words
  bad_substrings TEXT[] := ARRAY[
    'fuck', 'shit', 'bitch', 'cunt', 'pussy', 'asshole', 'whore', 'faggot', 'nigger', 'nigga',
    'slut', 'skank', 'twat', 'wanker', 'piss', 'spaz', 'jerk off', 'jerkoff',
    'penis', 'vagina', 'masturbat', 'handjob', 'blowjob', 'cumshot', 'orgasm', 'erection',
    'ejaculat', 'dildo', 'vibrator', 'porn', 'intercourse', 'foreplay', 'threesome',
    'genitals', 'testicle', 'nude', 'naked', 'incest', 'pedophil', 'prostitut', 'bestiality',
    'boob', 'jackoff', 'sexual',
    -- Adult content / solicitation
    'onlyfans', 'only fans', 'fansly', 'subscrib', 'subscription', 'camgirl', 'cam girl',
    'escort', 'hookup', 'sugar daddy', 'sugar baby', 'nsfw', 'xxx', 'fetish', 'bdsm',
    'milf', 'hentai', 'stripper', 'strip club', 'lewd', 'thot', 'sexting', 'horny',
    'creampie', 'deepthroat', 'gangbang', 'bukkake', 'gloryhole', 'rimjob', 'footjob',
    'titties', 'cumming', 'fap',
    'gook', 'kike', 'wetback', 'beaner', 'towelhead', 'redskin', 'golliwog', 'zipperhead', 'darkie',
    'tranny', 'shemale',
    'suicide', 'murder', 'terrorist', 'torture',
    -- Historical figures / extremism
    'hitler', 'stalin', 'mussolini', 'genocide', 'holocaust', 'fascism', 'fascist', 'communism'
  ];
  -- Word-boundary match: substring match risks catching innocent words (e.g. "skill" has "kill")
  bad_words TEXT[] := ARRAY[
    'ass', 'cock', 'sex', 'anal', 'rape', 'kill', 'bastard',
    'spic', 'chink', 'coon', 'cracker', 'paki', 'jap', 'dyke', 'honky',
    'retard', 'hooker',
    'nazi'   -- Ashkenazi needs word boundary
  ];
  low  TEXT := lower(coalesce(txt, ''));
  word TEXT;
BEGIN
  IF low = '' THEN RETURN; END IF;
  FOREACH word IN ARRAY bad_substrings LOOP
    IF strpos(low, word) > 0 THEN
      RAISE EXCEPTION 'inappropriate_content'
        USING HINT = field_label || ' contains blocked content';
    END IF;
  END LOOP;
  FOREACH word IN ARRAY bad_words LOOP
    IF low ~ ('\m' || word || '\M') THEN
      RAISE EXCEPTION 'inappropriate_content'
        USING HINT = field_label || ' contains blocked content';
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_shared_routine_content()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  task      JSONB;
  task_name TEXT;
BEGIN
  -- Normalize whitespace on store
  NEW.routine_name := trim(NEW.routine_name);
  NEW.author_name  := trim(NEW.author_name);

  PERFORM public.assert_text_clean(NEW.routine_name, 'Routine name');
  PERFORM public.assert_text_clean(NEW.author_name,  'Name');
  PERFORM public.assert_text_clean(coalesce(NEW.author_bio, ''), 'Bio');

  -- Validate each task name
  FOR task IN SELECT * FROM jsonb_array_elements(NEW.tasks) LOOP
    task_name := trim(coalesce(task->>'name', task->>'text', task->>'title', ''));
    CONTINUE WHEN task_name = '';

    IF char_length(task_name) > 80 THEN
      RAISE EXCEPTION 'task_name_too_long'
        USING HINT = 'Task name exceeds 80 characters';
    END IF;

    IF task_name ~ '\S+@\S+\.\S+' OR
       task_name ~ '(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}' THEN
      RAISE EXCEPTION 'contact_info'
        USING HINT = 'Task contains personal contact information';
    END IF;

    IF task_name ~ '(.)\1{9,}' THEN
      RAISE EXCEPTION 'spam_content'
        USING HINT = 'Task name contains repeated characters';
    END IF;

    PERFORM public.assert_text_clean(task_name, 'Task name');
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shared_routine_content_check ON public.shared_routines;
CREATE TRIGGER shared_routine_content_check
  BEFORE INSERT ON public.shared_routines
  FOR EACH ROW EXECUTE FUNCTION public.validate_shared_routine_content();

-- ── Migration: age fields (run once if upgrading) ──────────────────────────
-- Run these two lines in Supabase SQL Editor if you applied the schema before
-- age was added. Safe to run multiple times (IF NOT EXISTS).

ALTER TABLE public.profiles         ADD COLUMN IF NOT EXISTS age INTEGER;
ALTER TABLE public.profiles         ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.shared_routines  ADD COLUMN IF NOT EXISTS author_age INTEGER;
ALTER TABLE public.shared_routines  ADD COLUMN IF NOT EXISTS author_gender TEXT;

-- ── Auto-create profile on sign-up ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── User reports (community flagging) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.reports (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_routine_id UUID        NOT NULL REFERENCES public.shared_routines(id) ON DELETE CASCADE,
  reported_user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reporter_id, shared_routine_id)
);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Authenticated users can submit reports; reporter_id must match + max 5 per hour
CREATE POLICY "reports_insert"
  ON public.reports FOR INSERT
  WITH CHECK (
    auth.uid() = reporter_id
    AND (
      SELECT COUNT(*) FROM public.reports
      WHERE reporter_id = auth.uid()
      AND created_at > NOW() - INTERVAL '1 hour'
    ) < 5
  );

-- Users can see their own reports (lets the app check for duplicates)
CREATE POLICY "reports_own_read"
  ON public.reports FOR SELECT
  USING (auth.uid() = reporter_id);

-- Trigger: keep shared_routines.report_count in sync
CREATE OR REPLACE FUNCTION public.sync_report_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.shared_routines SET report_count = report_count + 1 WHERE id = NEW.shared_routine_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.shared_routines SET report_count = GREATEST(report_count - 1, 0) WHERE id = OLD.shared_routine_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_report_change ON public.reports;
CREATE TRIGGER on_report_change
  AFTER INSERT OR DELETE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.sync_report_count();

-- ── Community posts (deep work, workout, meal day) ───────────────────────────

CREATE TABLE IF NOT EXISTS public.community_posts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_type         TEXT        NOT NULL CHECK (post_type IN ('deep_work', 'workout', 'meal_day')),
  author_name       TEXT        NOT NULL,
  author_bio        TEXT        NOT NULL DEFAULT '',
  author_avatar_url TEXT        NOT NULL DEFAULT '',
  author_age        INTEGER,
  author_gender     TEXT,
  content           JSONB       NOT NULL DEFAULT '{}',
  report_count      INTEGER     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "community_posts_public_read"
  ON public.community_posts FOR SELECT USING (true);

CREATE POLICY "community_posts_insert"
  ON public.community_posts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "community_posts_own_delete"
  ON public.community_posts FOR DELETE
  USING (auth.uid() = user_id);

-- Reports for community posts (separate from shared_routines reports)
CREATE TABLE IF NOT EXISTS public.community_post_reports (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id          UUID        NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  reported_user_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reporter_id, post_id)
);

ALTER TABLE public.community_post_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cp_reports_insert"
  ON public.community_post_reports FOR INSERT
  WITH CHECK (
    auth.uid() = reporter_id
    AND (
      SELECT COUNT(*) FROM public.community_post_reports
      WHERE reporter_id = auth.uid()
      AND created_at > NOW() - INTERVAL '1 hour'
    ) < 5
  );

CREATE POLICY "cp_reports_own_read"
  ON public.community_post_reports FOR SELECT
  USING (auth.uid() = reporter_id);

-- Admin review view: one row per reported post with full content + reporter count
-- Query this in the Supabase SQL Editor to review flagged content
CREATE OR REPLACE VIEW public.reported_posts_admin AS
SELECT
  sr.id,
  sr.report_count,
  sr.routine_name,
  sr.author_name,
  sr.author_bio,
  sr.author_avatar_url,
  sr.tasks,
  sr.created_at                         AS posted_at,
  MAX(r.created_at)                     AS last_reported_at,
  ARRAY_AGG(r.reporter_id::TEXT)        AS reporter_ids
FROM public.shared_routines sr
JOIN public.reports r ON r.shared_routine_id = sr.id
GROUP BY sr.id
ORDER BY sr.report_count DESC, last_reported_at DESC;

-- ── Session notes migration ───────────────────────────────────────────────────
-- Run this if your productivity_sessions table already exists:
-- ALTER TABLE public.productivity_sessions ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';

-- ── Friends & Social ──────────────────────────────────────────────────────────
-- Run this entire block in Supabase SQL Editor to enable the friends feature.

-- Friendships (must come before is_friend function and policies that reference it)
CREATE TABLE IF NOT EXISTS public.friendships (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status       TEXT        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'accepted')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "friendships_own_select"
  ON public.friendships FOR SELECT
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

CREATE POLICY "friendships_insert"
  ON public.friendships FOR INSERT
  WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "friendships_update"
  ON public.friendships FOR UPDATE
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

CREATE POLICY "friendships_delete"
  ON public.friendships FOR DELETE
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- Helper: returns true if the calling user has an accepted friendship with other_user_id
CREATE OR REPLACE FUNCTION public.is_friend(other_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE status = 'accepted'
    AND (
      (requester_id = auth.uid() AND addressee_id = other_user_id) OR
      (addressee_id = auth.uid() AND requester_id = other_user_id)
    )
  )
$$;

-- Friend code on profiles (unique 6-char code, e.g. "AB1234")
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS friend_code TEXT UNIQUE;

-- Generate a random 6-char uppercase alphanumeric code (no 0/O/1/I to avoid confusion)
CREATE OR REPLACE FUNCTION public.make_friend_code() RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code  TEXT := '';
  i     INTEGER;
BEGIN
  FOR i IN 1..6 LOOP
    code := code || substr(chars, floor(random() * length(chars))::int + 1, 1);
  END LOOP;
  RETURN code;
END;
$$;

-- Auto-assign a unique friend code on INSERT if not provided
CREATE OR REPLACE FUNCTION public.assign_friend_code_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  new_code TEXT;
  attempts INTEGER := 0;
BEGIN
  IF NEW.friend_code IS NULL THEN
    LOOP
      new_code := public.make_friend_code();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE friend_code = new_code);
      attempts := attempts + 1;
      IF attempts > 50 THEN RAISE EXCEPTION 'Could not generate unique friend code'; END IF;
    END LOOP;
    NEW.friend_code := new_code;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_friend_code ON public.profiles;
CREATE TRIGGER trg_assign_friend_code
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.assign_friend_code_fn();

-- Backfill friend codes for existing profiles that don't have one
DO $$
DECLARE
  rec   RECORD;
  code  TEXT;
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  tries INTEGER;
BEGIN
  FOR rec IN SELECT id FROM public.profiles WHERE friend_code IS NULL LOOP
    tries := 0;
    LOOP
      code := '';
      FOR i IN 1..6 LOOP
        code := code || substr(chars, floor(random() * length(chars))::int + 1, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE friend_code = code);
      tries := tries + 1;
      IF tries > 50 THEN RAISE EXCEPTION 'backfill failed for %', rec.id; END IF;
    END LOOP;
    UPDATE public.profiles SET friend_code = code WHERE id = rec.id;
  END LOOP;
END;
$$;

-- Allow any authenticated user to read profiles
-- (username/bio/avatar already exposed publicly via community posts)
DO $$ BEGIN
  CREATE POLICY "profiles_auth_select"
    ON public.profiles FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Allow friends (and self) to read each other's streaks
DO $$ BEGIN
  CREATE POLICY "streaks_friends_select"
    ON public.streaks FOR SELECT
    USING (auth.uid() = user_id OR public.is_friend(user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Allow friends (and self) to read each other's routine name lists
DO $$ BEGIN
  CREATE POLICY "routine_names_friends_select"
    ON public.routine_names FOR SELECT
    USING (auth.uid() = user_id OR public.is_friend(user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Allow friends (and self) to read each other's routine task templates
DO $$ BEGIN
  CREATE POLICY "routine_templates_friends_select"
    ON public.routine_templates FOR SELECT
    USING (auth.uid() = user_id OR public.is_friend(user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Allow friends (and self) to read each other's history (for calendar view)
DO $$ BEGIN
  CREATE POLICY "history_friends_select"
    ON public.history FOR SELECT
    USING (auth.uid() = user_id OR public.is_friend(user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Allow friends (and self) to read each other's workout logs
DO $$ BEGIN
  CREATE POLICY "workout_logs_friends_select"
    ON public.workout_logs FOR SELECT
    USING (auth.uid() = user_id OR public.is_friend(user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Allow friends (and self) to read each other's routine run step details
DO $$ BEGIN
  CREATE POLICY "routine_runs_friends_select"
    ON public.routine_runs FOR SELECT
    USING (auth.uid() = user_id OR public.is_friend(user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Allow friends (and self) to read each other's meals (nutrition)
DO $$ BEGIN
  CREATE POLICY "meals_friends_select"
    ON public.meals FOR SELECT
    USING (auth.uid() = user_id OR public.is_friend(user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Allow friends (and self) to read each other's deep-work sessions
-- (table may not exist on older schemas — undefined_table is swallowed)
DO $$ BEGIN
  CREATE POLICY "productivity_sessions_friends_select"
    ON public.productivity_sessions FOR SELECT
    USING (auth.uid() = user_id OR public.is_friend(user_id));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

-- ── Profile visibility ("Show full data to") ──────────────────────────────────
-- Run this whole block in Supabase SQL Editor. Controls who can read a user's
-- full data (calendar logs, routines, workouts) when they view the profile.
--   'everyone' = any signed-in user, 'friends' = accepted friends only (default),
--   'none'     = nobody but the user themselves.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'friends';

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_visibility_check CHECK (visibility IN ('everyone','friends','none'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Master gate: can the calling user view owner_id's full data?
CREATE OR REPLACE FUNCTION public.can_view_data(owner_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    auth.uid() = owner_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = owner_id AND (
        p.visibility = 'everyone'
        OR (COALESCE(p.visibility, 'friends') = 'friends' AND public.is_friend(owner_id))
      )
    );
$$;

-- Replace the friends-only SELECT policies with visibility-aware ones.
-- (Self-write access stays via the existing own_* FOR ALL policies.)
DROP POLICY IF EXISTS "streaks_friends_select"           ON public.streaks;
DROP POLICY IF EXISTS "routine_names_friends_select"     ON public.routine_names;
DROP POLICY IF EXISTS "routine_templates_friends_select" ON public.routine_templates;
DROP POLICY IF EXISTS "history_friends_select"           ON public.history;
DROP POLICY IF EXISTS "workout_logs_friends_select"      ON public.workout_logs;
DROP POLICY IF EXISTS "routine_runs_friends_select"      ON public.routine_runs;
DROP POLICY IF EXISTS "meals_friends_select"             ON public.meals;

CREATE POLICY "streaks_view"           ON public.streaks           FOR SELECT USING (public.can_view_data(user_id));
CREATE POLICY "routine_names_view"     ON public.routine_names     FOR SELECT USING (public.can_view_data(user_id));
CREATE POLICY "routine_templates_view" ON public.routine_templates FOR SELECT USING (public.can_view_data(user_id));
CREATE POLICY "history_view"           ON public.history           FOR SELECT USING (public.can_view_data(user_id));
CREATE POLICY "workout_logs_view"      ON public.workout_logs      FOR SELECT USING (public.can_view_data(user_id));
CREATE POLICY "routine_runs_view"      ON public.routine_runs      FOR SELECT USING (public.can_view_data(user_id));
CREATE POLICY "meals_view"             ON public.meals             FOR SELECT USING (public.can_view_data(user_id));

-- Saved workout plans become viewable (for the "saved workouts" list + copy)
DO $$ BEGIN
  CREATE POLICY "workout_plans_view"
    ON public.workout_plans FOR SELECT
    USING (public.can_view_data(user_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Deep-work sessions (table may not exist on older schemas)
DO $$ BEGIN
  DROP POLICY IF EXISTS "productivity_sessions_friends_select" ON public.productivity_sessions;
  CREATE POLICY "productivity_sessions_view"
    ON public.productivity_sessions FOR SELECT
    USING (public.can_view_data(user_id));
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ── Author username on community content ──────────────────────────────────────
-- Posts now show the author's display name (author_name) with their @username
-- (author_username) underneath. Run once.

ALTER TABLE public.shared_routines ADD COLUMN IF NOT EXISTS author_username TEXT;
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS author_username TEXT;

-- ── Community post server-side content validation ─────────────────────────────
-- Same blocklist (public.assert_text_clean) as shared_routines. Moderates the
-- author name, bio, and every text field inside the post content (deep work
-- session name/notes, workout name + exercise names, meal names).

CREATE OR REPLACE FUNCTION public.validate_community_post_content()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  ex  JSONB;
  sec JSONB;
  itm JSONB;
BEGIN
  NEW.author_name := trim(NEW.author_name);
  PERFORM public.assert_text_clean(NEW.author_name, 'Name');
  PERFORM public.assert_text_clean(coalesce(NEW.author_bio, ''), 'Bio');

  IF NEW.post_type = 'deep_work' THEN
    PERFORM public.assert_text_clean(coalesce(NEW.content->>'taskDesc', ''), 'Session name');
    PERFORM public.assert_text_clean(coalesce(NEW.content->>'notes', ''),    'Session notes');

  ELSIF NEW.post_type = 'workout' THEN
    PERFORM public.assert_text_clean(coalesce(NEW.content->>'muscleGroup', ''), 'Workout name');
    FOR ex IN SELECT * FROM jsonb_array_elements(coalesce(NEW.content->'exercises', '[]'::jsonb)) LOOP
      PERFORM public.assert_text_clean(coalesce(ex->>'name', ''), 'Exercise name');
    END LOOP;

  ELSIF NEW.post_type = 'meal_day' THEN
    FOR sec IN SELECT * FROM jsonb_array_elements(coalesce(NEW.content->'sections', '[]'::jsonb)) LOOP
      FOR itm IN SELECT * FROM jsonb_array_elements(coalesce(sec->'items', '[]'::jsonb)) LOOP
        PERFORM public.assert_text_clean(coalesce(itm->>'name', ''), 'Meal name');
      END LOOP;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS community_post_content_check ON public.community_posts;
CREATE TRIGGER community_post_content_check
  BEFORE INSERT ON public.community_posts
  FOR EACH ROW EXECUTE FUNCTION public.validate_community_post_content();

-- ── Explore posting rate limit (server-side) ──────────────────────────────────
-- Max 5 posts per rolling 24h and a 60s cooldown, counted across BOTH the
-- shared_routines and community_posts tables (i.e. the whole explore feed).
-- This is the hard backstop; the app also limits client-side. Note: only rows
-- that pass moderation actually insert, so only real posts count here.

CREATE OR REPLACE FUNCTION public.recent_post_count(since TIMESTAMPTZ)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT (
    (SELECT COUNT(*) FROM public.shared_routines WHERE user_id = auth.uid() AND created_at > since)
    + (SELECT COUNT(*) FROM public.community_posts WHERE user_id = auth.uid() AND created_at > since)
  )::INTEGER
$$;

DROP POLICY IF EXISTS "shared_routines_insert" ON public.shared_routines;
CREATE POLICY "shared_routines_insert"
  ON public.shared_routines FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.recent_post_count(NOW() - INTERVAL '24 hours') < 5
    AND public.recent_post_count(NOW() - INTERVAL '60 seconds') = 0
  );

DROP POLICY IF EXISTS "community_posts_insert" ON public.community_posts;
CREATE POLICY "community_posts_insert"
  ON public.community_posts FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.recent_post_count(NOW() - INTERVAL '24 hours') < 5
    AND public.recent_post_count(NOW() - INTERVAL '60 seconds') = 0
  );
