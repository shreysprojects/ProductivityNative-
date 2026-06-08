-- ============================================================================
-- security-fixes.sql  —  paste the WHOLE file into Supabase SQL Editor and Run.
-- Idempotent: safe to run more than once.
-- Pair this with the client + edge-function changes (see the chat steps).
--
-- Fixes:
--   #1 CRITICAL  friendship self-accept -> any user could read your private data
--   #2 HIGH      profiles table over-exposed (friend_code, age leaked to all)
--   #3 HIGH      community/feed author identity was client-spoofable
--   #4 HIGH      reported_posts_admin view leaked reporter identities
--   #5 MEDIUM    avatars storage scoped to the owner's own folder
--   #6 MEDIUM    cost-DoS: cap paid gpt-4o-mini moderation calls (table only)
--   #7 MEDIUM    server-side 13+ age floor
--   #8 MEDIUM    delete_own_account RPC (was missing) — deletes ONLY the caller
-- ============================================================================


-- ============================================================================
-- #1 CRITICAL — Friendships: only the ADDRESSEE may accept, pending -> accepted.
-- Previously either party (incl. the requester) could flip status to 'accepted'
-- and self-grant friend-level access to a victim's data.
-- ============================================================================

DROP POLICY IF EXISTS "friendships_update" ON public.friendships;
DROP POLICY IF EXISTS "friendships_accept" ON public.friendships;
CREATE POLICY "friendships_accept" ON public.friendships
  FOR UPDATE
  USING      (auth.uid() = addressee_id AND status = 'pending')
  WITH CHECK (auth.uid() = addressee_id AND status = 'accepted');

-- (Optional, low) light spam cap on outgoing requests: max 30 / hour.
DROP POLICY IF EXISTS "friendships_insert" ON public.friendships;
CREATE POLICY "friendships_insert" ON public.friendships
  FOR INSERT
  WITH CHECK (
    auth.uid() = requester_id
    AND (
      SELECT COUNT(*) FROM public.friendships
      WHERE requester_id = auth.uid()
      AND created_at > NOW() - INTERVAL '1 hour'
    ) < 30
  );


-- ============================================================================
-- #2 HIGH — Lock down the profiles table.
-- Before: any signed-in user could SELECT * from every profile, leaking
-- friend_code (defeats its purpose) and age (incl. minors) to everyone.
-- After: the base table is self-only; everyone else reads a SAFE view that
-- exposes only id/username/name/bio/avatar_url/visibility. friend_code & age
-- are reachable only through narrow, purpose-built RPCs.
--
-- ⚠ Requires the client edits (public_profiles / RPCs). Run the SQL and ship
-- the client together.
-- ============================================================================

-- Remove the blanket "any authenticated user can read every row" policy.
-- (own_profile FOR ALL stays, so you keep full read/write on your OWN row.)
DROP POLICY IF EXISTS "profiles_auth_select" ON public.profiles;

-- Safe, public-facing projection. A normal (non-invoker) view is owned by the
-- creating role and bypasses RLS — intended here so it can show these few
-- columns for ANY user, while friend_code/age never appear in it.
CREATE OR REPLACE VIEW public.public_profiles AS
  SELECT id, username, name, bio, avatar_url, visibility
  FROM public.profiles;

REVOKE ALL ON public.public_profiles FROM anon;
GRANT  SELECT ON public.public_profiles TO authenticated;

-- Friend-code lookup: returns at most one {id, username}; caller must already
-- know the exact code, so the full code space is never enumerable.
CREATE OR REPLACE FUNCTION public.lookup_friend_code(code TEXT)
RETURNS TABLE (id UUID, username TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.username
  FROM public.profiles p
  WHERE p.friend_code = upper(trim(code))
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.lookup_friend_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_friend_code(TEXT) TO authenticated;

-- Username availability: yes/no only, never exposes the row. anon needs this
-- during sign-up (before a session exists), so it is granted to anon too.
CREATE OR REPLACE FUNCTION public.username_available(u TEXT, exclude_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE username = lower(trim(u))
    AND (exclude_id IS NULL OR id <> exclude_id)
  )
$$;
REVOKE ALL ON FUNCTION public.username_available(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.username_available(TEXT, UUID) TO anon, authenticated;


-- ============================================================================
-- #3 HIGH — Bind author identity server-side. The client used to send
-- author_username / author_name / author_avatar_url / author_age / author_gender
-- and they were trusted, allowing impersonation, fake ages, and arbitrary
-- avatar URLs (IP-logging / tracking pixels for everyone who viewed the feed).
-- The triggers below OVERWRITE those fields from the poster's real profile.
-- The user's choice to HIDE avatar/age/gender (send NULL/'') is preserved, but
-- any value that IS shown is forced to the genuine one.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.validate_shared_routine_content()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  task      JSONB;
  task_name TEXT;
  prof      RECORD;
BEGIN
  SELECT p.username, p.name, p.avatar_url, g.age, g.sex
    INTO prof
    FROM public.profiles p
    LEFT JOIN public.user_goals g ON g.user_id = p.id
    WHERE p.id = NEW.user_id;

  NEW.author_username   := coalesce(prof.username, 'user');
  NEW.author_name       := coalesce(nullif(trim(prof.name), ''), prof.username, 'User');
  NEW.author_avatar_url := CASE WHEN coalesce(NEW.author_avatar_url, '') = ''
                                THEN '' ELSE coalesce(prof.avatar_url, '') END;
  IF NEW.author_age    IS NOT NULL THEN NEW.author_age    := prof.age; END IF;
  IF NEW.author_gender IS NOT NULL THEN NEW.author_gender := prof.sex; END IF;

  NEW.routine_name := trim(NEW.routine_name);
  NEW.author_name  := trim(NEW.author_name);

  PERFORM public.assert_text_clean(NEW.routine_name, 'Routine name');
  PERFORM public.assert_text_clean(NEW.author_name,  'Name');
  PERFORM public.assert_text_clean(coalesce(NEW.author_bio, ''), 'Bio');

  FOR task IN SELECT * FROM jsonb_array_elements(NEW.tasks) LOOP
    task_name := trim(coalesce(task->>'name', task->>'text', task->>'title', ''));
    CONTINUE WHEN task_name = '';
    IF char_length(task_name) > 80 THEN
      RAISE EXCEPTION 'task_name_too_long' USING HINT = 'Task name exceeds 80 characters';
    END IF;
    IF task_name ~ '\S+@\S+\.\S+' OR
       task_name ~ '(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}' THEN
      RAISE EXCEPTION 'contact_info' USING HINT = 'Task contains personal contact information';
    END IF;
    IF task_name ~ '(.)\1{9,}' THEN
      RAISE EXCEPTION 'spam_content' USING HINT = 'Task name contains repeated characters';
    END IF;
    PERFORM public.assert_text_clean(task_name, 'Task name');
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_community_post_content()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ex   JSONB;
  sec  JSONB;
  itm  JSONB;
  prof RECORD;
BEGIN
  SELECT p.username, p.name, p.avatar_url, g.age, g.sex
    INTO prof
    FROM public.profiles p
    LEFT JOIN public.user_goals g ON g.user_id = p.id
    WHERE p.id = NEW.user_id;

  NEW.author_username   := coalesce(prof.username, 'user');
  NEW.author_name       := coalesce(nullif(trim(prof.name), ''), prof.username, 'User');
  NEW.author_avatar_url := CASE WHEN coalesce(NEW.author_avatar_url, '') = ''
                                THEN '' ELSE coalesce(prof.avatar_url, '') END;
  IF NEW.author_age    IS NOT NULL THEN NEW.author_age    := prof.age; END IF;
  IF NEW.author_gender IS NOT NULL THEN NEW.author_gender := prof.sex; END IF;

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
-- (Triggers already point at these functions; CREATE OR REPLACE is enough.)


-- ============================================================================
-- #4 HIGH — reported_posts_admin must NOT be reachable by app users.
-- It is a definer view that aggregates reporter_ids; exposed through PostgREST
-- it would out the people who filed reports. Restrict to service role / SQL
-- editor only, and make it respect RLS as a backstop.
-- ============================================================================

DO $$ BEGIN
  ALTER VIEW public.reported_posts_admin SET (security_invoker = on);
  REVOKE ALL ON public.reported_posts_admin FROM anon, authenticated;
EXCEPTION WHEN undefined_table THEN NULL; END $$;


-- ============================================================================
-- #5 MEDIUM — Storage: avatars are publicly readable, but a user may only
-- write/replace/delete files inside their OWN  <uid>/...  folder.
-- Path used by the app is  <uid>/avatar.jpg .
-- (If the 'avatars' bucket doesn't exist yet, create it in Storage and mark it
--  Public, then run this.)
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_insert_own" ON storage.objects;
CREATE POLICY "avatars_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatars_update_own" ON storage.objects;
CREATE POLICY "avatars_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatars_delete_own" ON storage.objects;
CREATE POLICY "avatars_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);


-- ============================================================================
-- #6 MEDIUM — Backing table for capping paid gpt-4o-mini moderation calls.
-- The edge-function change uses this; written only by the service role.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_mod_limits (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date    DATE NOT NULL,
  count   INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
ALTER TABLE public.ai_mod_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_mod_limits_own_read" ON public.ai_mod_limits;
CREATE POLICY "ai_mod_limits_own_read" ON public.ai_mod_limits
  FOR SELECT USING (auth.uid() = user_id);
-- No client writes; the openai-proxy edge function uses the service-role key.


-- ============================================================================
-- #7 MEDIUM — Server-side 13+ floor (client check alone is bypassable).
-- If this fails, you have an existing row with age < 13 to clean up first.
-- ============================================================================

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_age_min CHECK (age IS NULL OR age >= 13);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.user_goals
    ADD CONSTRAINT user_goals_age_min CHECK (age IS NULL OR age >= 13);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ============================================================================
-- #8 MEDIUM — Account self-deletion. Deletes ONLY the caller; cascades to all
-- public tables via the existing ON DELETE CASCADE foreign keys.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.delete_own_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;

-- ============================================================================
-- Done.
-- ============================================================================
