-- Security hardening (audit of 2026-09-23).
--
-- supabase/audit-fixes.sql was never applied to the live database, and a few
-- policies from before security-fixes.sql survived under names that file did
-- not drop. This migration brings the live database to the state the app
-- already expects (blocked_users, not_blocked, server-side counters) and
-- closes these holes:
--
--   1. CRITICAL  profiles: a leftover "Profiles are publicly readable" policy
--                (USING true, every role) let anyone holding the public anon
--                key read every profile column, age and friend_code included.
--   2. CRITICAL  public_profiles: authenticated kept INSERT/UPDATE/DELETE on
--                the view. The view runs as its owner, which bypasses RLS, so
--                any signed-in user could rewrite or delete ANY profile — for
--                example set someone's visibility to 'everyone' and then read
--                their meals, routines and workout history.
--   3. CRITICAL  friendships: a requester could INSERT a row that was already
--                'accepted', and an addressee accepting a request could also
--                rewrite requester_id. Either way: a friendship with anyone,
--                without their consent, and friend-level access to their data.
--   4. HIGH      blocked_users / not_blocked() did not exist, so blocking a
--                user failed; blocks now also cut off profile-data access.
--   5. HIGH      shared_routines had a second INSERT policy with no rate
--                limit, which bypassed the 5-per-day / 60-second limit.
--   6. HIGH      feed reads ignored is_hidden, report volume and blocks.
--   7. HIGH      report_count never moved (the trigger ran under RLS), and
--                community-post reports had no counter or server-set target.
--   8. HIGH      profile name/username/bio had no server-side moderation or
--                length caps; avatar_url accepted any URL (tracking pixel).
--   9. HIGH      avatars could be written straight to storage, skipping the
--                moderated upload_avatar path.
--  10. HIGH      a workout post's exercises[].gifUrl was rendered from any URL
--                (tracking pixel / unmoderated image in everyone's feed), and
--                post author_bio / sizes were unbounded client input.
--  11. MEDIUM    the avatars and routine-photos buckets could be LISTED by
--                anyone, enumerating every user's photos. Public URLs keep
--                working; only listing is now limited to your own folder.
--  12. MEDIUM    can_view_data() let the anon role read the data of users set
--                to 'everyone' (the setting means any signed-in user).
--  13. LOW       blocklist normalization, pinned search_path on helpers, one
--                friendship row per pair, friend_code no longer client-set.
--
-- Everything here is compatible with the app and the openai-proxy function as
-- they are today, so it can be applied on its own. The companion migration
-- 20260923090100_photo_upload_lockdown.sql is NOT: it needs the new app build
-- and the redeployed edge function first.


-- ============================================================================
-- Blocking (needed by the policies further down)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.blocked_users (
  blocker_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS blocked_users_blocked_idx ON public.blocked_users (blocked_id);

ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.blocked_users FROM anon;

DROP POLICY IF EXISTS "blocked_users_own_select" ON public.blocked_users;
CREATE POLICY "blocked_users_own_select" ON public.blocked_users
  FOR SELECT TO authenticated USING (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "blocked_users_own_insert" ON public.blocked_users;
CREATE POLICY "blocked_users_own_insert" ON public.blocked_users
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "blocked_users_own_delete" ON public.blocked_users;
CREATE POLICY "blocked_users_own_delete" ON public.blocked_users
  FOR DELETE TO authenticated USING (auth.uid() = blocker_id);

-- Definer so a policy can consult both directions of a block without either
-- user being able to read the other's block list. Blocks hide in BOTH
-- directions, so being blocked is not something you can detect.
CREATE OR REPLACE FUNCTION public.not_blocked(author UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.blocked_users b
    WHERE (b.blocker_id = auth.uid() AND b.blocked_id = author)
       OR (b.blocker_id = author      AND b.blocked_id = auth.uid())
  )
$$;

REVOKE ALL ON FUNCTION public.not_blocked(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.not_blocked(UUID) TO anon, authenticated, service_role;


-- ============================================================================
-- Visibility helpers: pinned search_path, blocks respected, signed-in only
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_friend(other_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE status = 'accepted'
    AND (
      (requester_id = auth.uid() AND addressee_id = other_user_id) OR
      (addressee_id = auth.uid() AND requester_id = other_user_id)
    )
  )
$$;

-- 'everyone' means any SIGNED-IN user (that is what the setting says); the
-- anon role used to qualify too. A block in either direction cuts access.
CREATE OR REPLACE FUNCTION public.can_view_data(owner_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    auth.uid() = owner_id
    OR (
      auth.uid() IS NOT NULL
      AND public.not_blocked(owner_id)
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = owner_id AND (
          p.visibility = 'everyone'
          OR (COALESCE(p.visibility, 'friends') = 'friends' AND public.is_friend(owner_id))
        )
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.recent_post_count(since TIMESTAMPTZ)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (
    (SELECT COUNT(*) FROM public.shared_routines WHERE user_id = auth.uid() AND created_at > since)
    + (SELECT COUNT(*) FROM public.community_posts WHERE user_id = auth.uid() AND created_at > since)
  )::INTEGER
$$;

ALTER FUNCTION public.make_friend_code()      SET search_path = public;
ALTER FUNCTION public.assign_friend_code_fn() SET search_path = public;


-- ============================================================================
-- #1 / #2  Profiles: own row only; everyone else reads public_profiles
-- ============================================================================

DROP POLICY IF EXISTS "Profiles are publicly readable"     ON public.profiles;
DROP POLICY IF EXISTS "profiles_auth_select"               ON public.profiles;
DROP POLICY IF EXISTS "own_profile"                        ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "profiles_own_select"                ON public.profiles;
DROP POLICY IF EXISTS "profiles_own_insert"                ON public.profiles;
DROP POLICY IF EXISTS "profiles_own_update"                ON public.profiles;

CREATE POLICY "profiles_own_select" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_own_insert" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_own_update" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Nothing signed-out ever needs the table; username checks go through the
-- username_available() definer function.
REVOKE ALL ON public.profiles FROM anon;

-- The safe projection other users read. SELECT only: the view runs as its
-- owner, so any write privilege on it is a write to every profile.
CREATE OR REPLACE VIEW public.public_profiles AS
  SELECT id, username, name, bio, avatar_url, visibility
  FROM public.profiles;

REVOKE ALL ON public.public_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_profiles TO authenticated;


-- ============================================================================
-- #8  Profile writes: moderation, length caps, avatar URL, server-owned fields
-- ============================================================================
-- Only fields that actually change are validated, so an existing profile is
-- never locked out of unrelated edits (toggling visibility, finishing setup).

CREATE OR REPLACE FUNCTION public.guard_profile_write()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  avatar_prefix CONSTANT TEXT := 'https://lkopadfjqjaqmivkyzgw.supabase.co/storage/v1/object/public/avatars/';
  is_insert BOOLEAN := TG_OP = 'INSERT';
BEGIN
  -- friend_code is assigned by the server (trg_assign_friend_code, which
  -- fires after this trigger) and never changes afterwards, so nobody can
  -- pick a vanity code or squat on one a friend is about to type.
  IF is_insert THEN
    NEW.friend_code := NULL;
  ELSE
    NEW.friend_code := OLD.friend_code;
    NEW.created_at  := OLD.created_at;
  END IF;

  -- Checked only when it is set or changed, so an edit that leaves the
  -- username alone (a new photo, the privacy setting) is never refused over
  -- it. The column is NOT NULL: a profile is created with its username.
  IF NEW.username IS NOT NULL THEN
    NEW.username := lower(trim(NEW.username));
  END IF;
  IF is_insert OR NEW.username IS DISTINCT FROM OLD.username THEN
    IF NEW.username IS NOT NULL AND NEW.username !~ '^[a-z0-9_]{3,20}$' THEN
      RAISE EXCEPTION 'invalid_username'
        USING HINT = 'Usernames are 3 to 20 lowercase letters, numbers or underscores';
    END IF;
    PERFORM public.assert_text_clean(coalesce(NEW.username, ''), 'Username');
  END IF;

  IF is_insert OR NEW.name IS DISTINCT FROM OLD.name THEN
    IF char_length(coalesce(NEW.name, '')) > 40 THEN
      RAISE EXCEPTION 'name_too_long' USING HINT = 'Name exceeds 40 characters';
    END IF;
    PERFORM public.assert_text_clean(coalesce(NEW.name, ''), 'Name');
  END IF;

  IF is_insert OR NEW.bio IS DISTINCT FROM OLD.bio THEN
    IF char_length(coalesce(NEW.bio, '')) > 200 THEN
      RAISE EXCEPTION 'bio_too_long' USING HINT = 'Bio exceeds 200 characters';
    END IF;
    PERFORM public.assert_text_clean(coalesce(NEW.bio, ''), 'Bio');
  END IF;

  -- The avatar is the user's OWN moderated upload (upload_avatar writes
  -- <uid>/avatar.jpg; the app appends ?t=<ms> to bust caches). Any other URL
  -- is fetched by every device that shows the profile or one of its posts,
  -- handing the URL's owner their IP address; another user's file would be
  -- impersonation.
  IF (is_insert OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url)
     AND coalesce(NEW.avatar_url, '') <> ''
     AND (
       split_part(NEW.avatar_url, '?', 1) <> avatar_prefix || NEW.id::TEXT || '/avatar.jpg'
       OR (position('?' IN NEW.avatar_url) > 0 AND NEW.avatar_url !~ '\?t=[0-9]{1,16}$')
     ) THEN
    RAISE EXCEPTION 'invalid_avatar_url' USING HINT = 'Avatar must be uploaded through the app';
  END IF;

  RETURN NEW;
END;
$$;

-- Named so it sorts (and so fires) before trg_assign_friend_code.
DROP TRIGGER IF EXISTS trg_0_profile_guard ON public.profiles;
CREATE TRIGGER trg_0_profile_guard
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_write();

-- Superseded by guard_profile_write if audit-fixes.sql was ever run by hand.
DROP TRIGGER IF EXISTS trg_profile_text_check       ON public.profiles;
DROP TRIGGER IF EXISTS trg_profile_avatar_url_check ON public.profiles;


-- ============================================================================
-- #3  Friendships: requests start pending, only the addressee accepts, and
--     nobody can rewrite who the friendship is between.
-- ============================================================================

DROP POLICY IF EXISTS "friendships_insert" ON public.friendships;
CREATE POLICY "friendships_insert" ON public.friendships
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = requester_id
    AND status = 'pending'
    AND public.not_blocked(addressee_id)
    AND (
      SELECT COUNT(*) FROM public.friendships f
      WHERE f.requester_id = auth.uid()
      AND f.created_at > NOW() - INTERVAL '1 hour'
    ) < 30
  );

DROP POLICY IF EXISTS "friendships_update" ON public.friendships;
DROP POLICY IF EXISTS "friendships_accept" ON public.friendships;
CREATE POLICY "friendships_accept" ON public.friendships
  FOR UPDATE TO authenticated
  USING      (auth.uid() = addressee_id AND status = 'pending')
  WITH CHECK (auth.uid() = addressee_id AND status = 'accepted');

-- Column privileges: a request names only the two people, and the only thing
-- that can ever change afterwards is its status.
REVOKE INSERT, UPDATE ON public.friendships FROM anon, authenticated;
GRANT INSERT (requester_id, addressee_id) ON public.friendships TO authenticated;
GRANT UPDATE (status) ON public.friendships TO authenticated;

-- Belt and braces in case a future grant widens the columns again.
CREATE OR REPLACE FUNCTION public.guard_friendship_update()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.id           IS DISTINCT FROM OLD.id
  OR NEW.requester_id IS DISTINCT FROM OLD.requester_id
  OR NEW.addressee_id IS DISTINCT FROM OLD.addressee_id
  OR NEW.created_at   IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'friendship_immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_friendship_guard ON public.friendships;
CREATE TRIGGER trg_friendship_guard
  BEFORE UPDATE ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.guard_friendship_update();

-- One row per pair: A->B and B->A used to be able to coexist.
CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_uniq
  ON public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));


-- ============================================================================
-- #13  Blocklist with normalization (keep in sync with lib/contentFilter.js)
-- ============================================================================
-- The word lists are unchanged; the text is normalized first so 'f u c k',
-- 'sh1t' and 'fuuuck' no longer walk straight through. Whole words are only
-- matched on the separator-intact view, so "grass" never trips "ass".

CREATE OR REPLACE FUNCTION public.assert_text_clean(txt TEXT, field_label TEXT DEFAULT 'content')
RETURNS VOID
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  bad_substrings TEXT[] := ARRAY[
    'fuck', 'shit', 'bitch', 'cunt', 'pussy', 'asshole', 'whore', 'faggot', 'nigger', 'nigga',
    'slut', 'skank', 'twat', 'wanker', 'piss', 'spaz', 'jerk off', 'jerkoff',
    'penis', 'vagina', 'masturbat', 'handjob', 'blowjob', 'cumshot', 'orgasm', 'erection',
    'ejaculat', 'dildo', 'vibrator', 'porn', 'intercourse', 'foreplay', 'threesome',
    'genitals', 'testicle', 'nude', 'naked', 'incest', 'pedophil', 'prostitut', 'bestiality',
    'boob', 'jackoff', 'sexual',
    'onlyfans', 'only fans', 'fansly', 'subscrib', 'subscription', 'camgirl', 'cam girl',
    'escort', 'hookup', 'sugar daddy', 'sugar baby', 'nsfw', 'xxx', 'fetish', 'bdsm',
    'milf', 'hentai', 'stripper', 'strip club', 'lewd', 'thot', 'sexting', 'horny',
    'creampie', 'deepthroat', 'gangbang', 'bukkake', 'gloryhole', 'rimjob', 'footjob',
    'titties', 'cumming', 'fap',
    'gook', 'kike', 'wetback', 'beaner', 'towelhead', 'redskin', 'golliwog', 'zipperhead', 'darkie',
    'tranny', 'shemale',
    'suicide', 'murder', 'terrorist', 'torture',
    'hitler', 'stalin', 'mussolini', 'genocide', 'holocaust', 'fascism', 'fascist', 'communism'
  ];
  bad_words TEXT[] := ARRAY[
    'ass', 'cock', 'sex', 'anal', 'rape', 'kill', 'bastard',
    'spic', 'chink', 'coon', 'cracker', 'paki', 'jap', 'dyke', 'honky',
    'retard', 'hooker',
    'nazi'
  ];
  low       TEXT;
  squashed  TEXT;
  collapsed TEXT;
  word      TEXT;
  needle    TEXT;
BEGIN
  low := lower(coalesce(txt, ''));
  IF low = '' THEN RETURN; END IF;

  -- Invisible characters pasted between letters to break up a word
  low := translate(low, chr(8203) || chr(8204) || chr(8205) || chr(8288) || chr(65279) || chr(173), '');

  -- Accented latin letters folded to their base letter
  low := translate(low,
    'àáâãäåāăą' || 'èéêëēĕėęě' || 'ìíîïĩīĭįı' || 'òóôõöøōŏő' || 'ùúûüũūŭůűų' ||
    'çćĉċč' || 'ñńņň' || 'ýÿŷ' || 'šśŝş' || 'žźż' || 'đď' || 'ł' || 'ŧ' || 'ß' || 'æ' || 'œ',
    'aaaaaaaaa' || 'eeeeeeeee' || 'iiiiiiiii' || 'ooooooooo' || 'uuuuuuuuuu' ||
    'ccccc'     || 'nnnn'      || 'yyy'       || 'ssss'      || 'zzz'        || 'dd' || 'l' || 't' || 's' || 'a' || 'o');

  -- Leet digits
  low := translate(low, '0134578', 'oieastb');

  -- Separators are only dropped when the text actually looks spaced out
  -- ("f u c k"); unconditionally, "finish it" would become "finishit".
  IF low ~ '([a-z0-9][^a-z0-9]+){2,}[a-z0-9]' THEN
    squashed := regexp_replace(low, '[^a-z0-9]', '', 'g');
  ELSE
    squashed := low;
  END IF;
  collapsed := regexp_replace(squashed, '(.)\1+', '\1', 'g');

  FOREACH word IN ARRAY bad_substrings LOOP
    needle := regexp_replace(word, '[^a-z0-9]', '', 'g');
    IF strpos(low, word) > 0 OR strpos(squashed, needle) > 0 THEN
      RAISE EXCEPTION 'inappropriate_content'
        USING HINT = field_label || ' contains blocked content';
    END IF;
    -- Only worth testing when the text itself had a repeated run; short
    -- collapsed needles ('xxx' -> 'x') would match almost anything.
    IF collapsed <> squashed THEN
      needle := regexp_replace(needle, '(.)\1+', '\1', 'g');
      IF char_length(needle) >= 4 AND strpos(collapsed, needle) > 0 THEN
        RAISE EXCEPTION 'inappropriate_content'
          USING HINT = field_label || ' contains blocked content';
      END IF;
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


-- ============================================================================
-- #5 / #10  Feed posts: one rate-limited insert path, bounded content, author
--           fields taken from the real profile, image URLs from our library
-- ============================================================================

-- The unconditional twin of shared_routines_insert. Permissive policies are
-- OR'ed together, so while it existed the rate limit never applied.
DROP POLICY IF EXISTS "Authenticated users can post routines" ON public.shared_routines;

DROP POLICY IF EXISTS "shared_routines_insert" ON public.shared_routines;
CREATE POLICY "shared_routines_insert" ON public.shared_routines
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.recent_post_count(NOW() - INTERVAL '24 hours') < 5
    AND public.recent_post_count(NOW() - INTERVAL '60 seconds') = 0
  );

DROP POLICY IF EXISTS "community_posts_insert" ON public.community_posts;
CREATE POLICY "community_posts_insert" ON public.community_posts
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.recent_post_count(NOW() - INTERVAL '24 hours') < 5
    AND public.recent_post_count(NOW() - INTERVAL '60 seconds') = 0
  );

CREATE OR REPLACE FUNCTION public.validate_shared_routine_content()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  task      JSONB;
  task_name TEXT;
  prof      RECORD;
BEGIN
  SELECT p.username, p.name, p.bio, p.avatar_url, g.age, g.sex
    INTO prof
    FROM public.profiles p
    LEFT JOIN public.user_goals g ON g.user_id = p.id
    WHERE p.id = NEW.user_id;

  -- Identity fields come from the poster's real profile. Hiding a field
  -- (sending ''/NULL) is honoured; anything shown is the genuine value.
  NEW.author_username   := coalesce(prof.username, 'user');
  NEW.author_name       := trim(coalesce(nullif(trim(prof.name), ''), prof.username, 'User'));
  NEW.author_avatar_url := CASE WHEN coalesce(NEW.author_avatar_url, '') = ''
                                THEN '' ELSE coalesce(prof.avatar_url, '') END;
  NEW.author_bio        := CASE WHEN coalesce(trim(NEW.author_bio), '') = ''
                                THEN '' ELSE coalesce(prof.bio, '') END;
  IF NEW.author_age    IS NOT NULL THEN NEW.author_age    := prof.age; END IF;
  IF NEW.author_gender IS NOT NULL THEN NEW.author_gender := prof.sex; END IF;

  NEW.routine_name := trim(NEW.routine_name);
  -- Server-owned. created_at in particular: the posting rate limit counts
  -- rows by it, so a backdated post would never count against the limit.
  NEW.report_count := 0;
  NEW.created_at   := NOW();

  IF char_length(NEW.routine_name) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'routine_name_length' USING HINT = 'Routine names are 1 to 80 characters';
  END IF;
  IF NEW.routine_name ~ '\S+@\S+\.\S+' OR
     NEW.routine_name ~ '(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}' THEN
    RAISE EXCEPTION 'contact_info' USING HINT = 'Routine name contains personal contact information';
  END IF;

  IF jsonb_typeof(NEW.tasks) <> 'array' THEN
    RAISE EXCEPTION 'invalid_content' USING HINT = 'Tasks must be a list';
  END IF;
  IF jsonb_array_length(NEW.tasks) > 60 OR octet_length(NEW.tasks::text) > 20000 THEN
    RAISE EXCEPTION 'content_too_large' USING HINT = 'This routine is too large to share';
  END IF;

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
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  gif_prefix CONSTANT TEXT := 'https://lkopadfjqjaqmivkyzgw.supabase.co/storage/v1/object/public/exercise-gifs/';
  ex      JSONB;
  sec     JSONB;
  itm     JSONB;
  cleaned JSONB;
  prof    RECORD;
BEGIN
  SELECT p.username, p.name, p.bio, p.avatar_url, g.age, g.sex
    INTO prof
    FROM public.profiles p
    LEFT JOIN public.user_goals g ON g.user_id = p.id
    WHERE p.id = NEW.user_id;

  NEW.author_username   := coalesce(prof.username, 'user');
  NEW.author_name       := trim(coalesce(nullif(trim(prof.name), ''), prof.username, 'User'));
  NEW.author_avatar_url := CASE WHEN coalesce(NEW.author_avatar_url, '') = ''
                                THEN '' ELSE coalesce(prof.avatar_url, '') END;
  NEW.author_bio        := CASE WHEN coalesce(trim(NEW.author_bio), '') = ''
                                THEN '' ELSE coalesce(prof.bio, '') END;
  IF NEW.author_age    IS NOT NULL THEN NEW.author_age    := prof.age; END IF;
  IF NEW.author_gender IS NOT NULL THEN NEW.author_gender := prof.sex; END IF;

  NEW.report_count := 0;
  NEW.created_at   := NOW();

  IF jsonb_typeof(NEW.content) <> 'object' THEN
    RAISE EXCEPTION 'invalid_content' USING HINT = 'Post content must be an object';
  END IF;
  IF octet_length(NEW.content::text) > 20000 THEN
    RAISE EXCEPTION 'content_too_large' USING HINT = 'This post is too large to share';
  END IF;

  PERFORM public.assert_text_clean(NEW.author_name, 'Name');
  PERFORM public.assert_text_clean(coalesce(NEW.author_bio, ''), 'Bio');

  IF NEW.post_type = 'deep_work' THEN
    PERFORM public.assert_text_clean(coalesce(NEW.content->>'taskDesc', ''), 'Session name');
    PERFORM public.assert_text_clean(coalesce(NEW.content->>'notes', ''),    'Session notes');

  ELSIF NEW.post_type = 'workout' THEN
    PERFORM public.assert_text_clean(coalesce(NEW.content->>'muscleGroup', ''), 'Workout name');
    IF jsonb_typeof(coalesce(NEW.content->'exercises', '[]'::jsonb)) <> 'array' THEN
      RAISE EXCEPTION 'invalid_content' USING HINT = 'Exercises must be a list';
    END IF;
    -- Every device in the feed loads each exercise picture, so only pictures
    -- from the app's own exercise library are kept; anything else is dropped.
    cleaned := '[]'::jsonb;
    FOR ex IN SELECT * FROM jsonb_array_elements(coalesce(NEW.content->'exercises', '[]'::jsonb)) LOOP
      PERFORM public.assert_text_clean(coalesce(ex->>'name', ''), 'Exercise name');
      IF jsonb_typeof(ex) = 'object'
         AND coalesce(ex->>'gifUrl', '') <> ''
         AND (left(ex->>'gifUrl', char_length(gif_prefix)) <> gif_prefix
              OR position('..' IN ex->>'gifUrl') > 0) THEN
        ex := jsonb_set(ex, '{gifUrl}', 'null'::jsonb);
      END IF;
      cleaned := cleaned || jsonb_build_array(ex);
    END LOOP;
    NEW.content := jsonb_set(NEW.content, '{exercises}', cleaned);

  ELSIF NEW.post_type = 'meal_day' THEN
    IF jsonb_typeof(coalesce(NEW.content->'sections', '[]'::jsonb)) <> 'array' THEN
      RAISE EXCEPTION 'invalid_content' USING HINT = 'Meal sections must be a list';
    END IF;
    FOR sec IN SELECT * FROM jsonb_array_elements(coalesce(NEW.content->'sections', '[]'::jsonb)) LOOP
      IF jsonb_typeof(coalesce(sec->'items', '[]'::jsonb)) <> 'array' THEN
        RAISE EXCEPTION 'invalid_content' USING HINT = 'Meal items must be a list';
      END IF;
      FOR itm IN SELECT * FROM jsonb_array_elements(coalesce(sec->'items', '[]'::jsonb)) LOOP
        PERFORM public.assert_text_clean(coalesce(itm->>'name', ''), 'Meal name');
      END LOOP;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;
-- (shared_routine_content_check / community_post_content_check already point
--  at these two functions; replacing the bodies is enough.)


-- ============================================================================
-- #6  Feed reads honour hiding, report volume and blocks. The author always
--     keeps seeing their own post.
-- ============================================================================

ALTER TABLE public.shared_routines ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;

DROP POLICY IF EXISTS "Anyone can read shared routines" ON public.shared_routines;
DROP POLICY IF EXISTS "shared_routines_public_read"     ON public.shared_routines;
CREATE POLICY "shared_routines_public_read" ON public.shared_routines
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR (NOT is_hidden AND report_count < 5 AND public.not_blocked(user_id))
  );

DROP POLICY IF EXISTS "community_posts_public_read" ON public.community_posts;
CREATE POLICY "community_posts_public_read" ON public.community_posts
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR (NOT is_hidden AND report_count < 5 AND public.not_blocked(user_id))
  );

-- No client UPDATE on posts: is_hidden and report_count are server-owned.
REVOKE UPDATE ON public.shared_routines FROM anon, authenticated;
REVOKE UPDATE ON public.community_posts FROM anon, authenticated;


-- ============================================================================
-- #7  Reports: counters that move, a counter for community posts, and the
--     reported user taken from the post rather than from the client
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_report_count()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

CREATE OR REPLACE FUNCTION public.sync_cp_report_count()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.community_posts SET report_count = report_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.community_posts SET report_count = GREATEST(report_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_cp_report_change ON public.community_post_reports;
CREATE TRIGGER on_cp_report_change
  AFTER INSERT OR DELETE ON public.community_post_reports
  FOR EACH ROW EXECUTE FUNCTION public.sync_cp_report_count();

CREATE OR REPLACE FUNCTION public.set_report_target()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_author UUID;
BEGIN
  SELECT user_id INTO v_author FROM public.shared_routines WHERE id = NEW.shared_routine_id;
  IF v_author IS NULL THEN
    RAISE EXCEPTION 'post_not_found' USING HINT = 'The reported routine no longer exists';
  END IF;
  NEW.reported_user_id := v_author;
  -- The 5-per-hour report limit counts rows by created_at.
  NEW.created_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reports_set_target ON public.reports;
CREATE TRIGGER trg_reports_set_target
  BEFORE INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.set_report_target();

CREATE OR REPLACE FUNCTION public.set_cp_report_target()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_author UUID;
BEGIN
  SELECT user_id INTO v_author FROM public.community_posts WHERE id = NEW.post_id;
  IF v_author IS NULL THEN
    RAISE EXCEPTION 'post_not_found' USING HINT = 'The reported post no longer exists';
  END IF;
  NEW.reported_user_id := v_author;
  NEW.created_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cp_reports_set_target ON public.community_post_reports;
CREATE TRIGGER trg_cp_reports_set_target
  BEFORE INSERT ON public.community_post_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_cp_report_target();

-- Rebuild both counters from the report tables.
UPDATE public.shared_routines sr
   SET report_count = c.n
  FROM (SELECT shared_routine_id, COUNT(*)::INT AS n FROM public.reports GROUP BY shared_routine_id) c
 WHERE c.shared_routine_id = sr.id AND sr.report_count <> c.n;

UPDATE public.community_posts cp
   SET report_count = c.n
  FROM (SELECT post_id, COUNT(*)::INT AS n FROM public.community_post_reports GROUP BY post_id) c
 WHERE c.post_id = cp.id AND cp.report_count <> c.n;

-- Moderator review surface for community posts (service role / SQL editor
-- only: it aggregates reporter ids).
CREATE OR REPLACE VIEW public.reported_community_posts_admin AS
SELECT
  cp.id,
  cp.report_count,
  cp.is_hidden,
  cp.post_type,
  cp.author_name,
  cp.author_username,
  cp.author_bio,
  cp.author_avatar_url,
  cp.content,
  cp.created_at                  AS posted_at,
  MAX(r.created_at)              AS last_reported_at,
  ARRAY_AGG(r.reporter_id::TEXT) AS reporter_ids
FROM public.community_posts cp
JOIN public.community_post_reports r ON r.post_id = cp.id
GROUP BY cp.id
ORDER BY cp.report_count DESC, last_reported_at DESC;

ALTER VIEW public.reported_community_posts_admin SET (security_invoker = on);
REVOKE ALL ON public.reported_community_posts_admin FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.reported_posts_admin FROM PUBLIC, anon, authenticated;


-- ============================================================================
-- #9 / #11  Storage: avatars are written only by the moderated upload_avatar
--           path; neither bucket can be listed outside your own folder.
-- ============================================================================
-- Public buckets serve /object/public/ URLs without consulting RLS, so every
-- avatar and photo keeps displaying. The SELECT policies only govern listing
-- and the API's own reads (remove() needs one on your own files).

DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "avatars_insert_own"                ON storage.objects;
DROP POLICY IF EXISTS "avatars_update_own"                ON storage.objects;
DROP POLICY IF EXISTS "Avatars are publicly accessible"   ON storage.objects;
DROP POLICY IF EXISTS "avatars_public_read"               ON storage.objects;

DROP POLICY IF EXISTS "avatars_own_select" ON storage.objects;
CREATE POLICY "avatars_own_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::TEXT);

DROP POLICY IF EXISTS "avatars_delete_own" ON storage.objects;
CREATE POLICY "avatars_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::TEXT);

UPDATE storage.buckets
   SET file_size_limit    = 5242880,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE id = 'avatars';

DROP POLICY IF EXISTS routine_photos_public_read ON storage.objects;
DROP POLICY IF EXISTS routine_photos_own_select  ON storage.objects;
CREATE POLICY routine_photos_own_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'routine-photos' AND (storage.foldername(name))[1] = auth.uid()::TEXT);
