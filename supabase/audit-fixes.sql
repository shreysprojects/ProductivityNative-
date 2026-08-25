-- ============================================================================
-- audit-fixes.sql  —  paste the WHOLE file into Supabase SQL Editor and Run.
-- Run AFTER schema.sql, rls-supplement.sql, security-fixes.sql and
-- ai-workout-limits.sql. Idempotent: safe to run more than once.
-- Pair this with the client + edge-function changes.
--
-- Fixes:
--   #1  HIGH      AI rate limits were read-check-write (TOCTOU) -> atomic RPC
--   #2  HIGH      no way to block a user -> blocked_users + not_blocked()
--   #3  HIGH      reported/hidden content stayed in the feed forever
--   #4  HIGH      report_count never incremented (trigger blocked by RLS)
--   #5  MEDIUM    no admin review surface for community posts
--   #6  MEDIUM    reported_user_id was client-supplied (blame anyone)
--   #7  HIGH      blocklist bypassable with 'f u c k', 'sh1t', 'fuuuck'
--   #8  HIGH      profile name/username/bio had no server-side moderation
--   #9  HIGH      avatar_url accepted any URL (tracking pixel / IP logging)
--   #10 HIGH      clients could write unmoderated files to the avatars bucket
--   #11 LOW       helper functions ran without a pinned search_path
--   #12 LOW       friendships allowed a duplicate reciprocal pair
-- ============================================================================


-- ============================================================================
-- #1 HIGH — Atomic AI usage counter.
-- The edge function used to SELECT the count, compare, then UPSERT, so parallel
-- requests all read the same value and sailed past the cap. This does the
-- increment and the check in one statement: concurrent callers serialize on the
-- conflicting row, so every caller gets a distinct count back.
-- Only the service role (openai-proxy) may call it.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.consume_ai_limit(p_user UUID, p_kind TEXT, p_max INT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INT;
BEGIN
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

REVOKE ALL ON FUNCTION public.consume_ai_limit(UUID, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_limit(UUID, TEXT, INT) TO service_role;


-- ============================================================================
-- #2 HIGH — Blocking. A block hides content in BOTH directions: the blocker
-- stops seeing the blocked user, and the blocked user stops seeing them (so
-- blocking is not a signal you can detect by watching the feed).
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

DROP POLICY IF EXISTS "blocked_users_own_select" ON public.blocked_users;
CREATE POLICY "blocked_users_own_select" ON public.blocked_users
  FOR SELECT USING (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "blocked_users_own_insert" ON public.blocked_users;
CREATE POLICY "blocked_users_own_insert" ON public.blocked_users
  FOR INSERT WITH CHECK (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "blocked_users_own_delete" ON public.blocked_users;
CREATE POLICY "blocked_users_own_delete" ON public.blocked_users
  FOR DELETE USING (auth.uid() = blocker_id);

-- Definer so a feed policy can consult the rows on BOTH sides of the block
-- without either user being able to read the other's block list.
CREATE OR REPLACE FUNCTION public.not_blocked(author UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.blocked_users b
    WHERE (b.blocker_id = auth.uid() AND b.blocked_id = author)
       OR (b.blocker_id = author      AND b.blocked_id = auth.uid())
  )
$$;

GRANT EXECUTE ON FUNCTION public.not_blocked(UUID) TO anon, authenticated;


-- ============================================================================
-- #3 HIGH — Feed reads honour hiding, report volume and blocks.
-- A post disappears from everyone else's feed once it has 5 reports or a
-- moderator sets is_hidden. The author always keeps seeing their own row, so
-- the app never shows a post silently vanishing mid-session.
-- (Neither table has an UPDATE policy, so is_hidden is service-role only.)
-- ============================================================================

ALTER TABLE public.shared_routines ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;

DROP POLICY IF EXISTS "shared_routines_public_read" ON public.shared_routines;
CREATE POLICY "shared_routines_public_read"
  ON public.shared_routines FOR SELECT
  USING (
    auth.uid() = user_id
    OR (NOT is_hidden AND report_count < 5 AND public.not_blocked(user_id))
  );

DROP POLICY IF EXISTS "community_posts_public_read" ON public.community_posts;
CREATE POLICY "community_posts_public_read"
  ON public.community_posts FOR SELECT
  USING (
    auth.uid() = user_id
    OR (NOT is_hidden AND report_count < 5 AND public.not_blocked(user_id))
  );


-- ============================================================================
-- #4 HIGH — Report counters actually count.
-- sync_report_count() ran as the reporting user, whose UPDATE on someone
-- else's shared_routines row was silently dropped by RLS (there is no UPDATE
-- policy), so report_count sat at 0 forever and nothing was ever auto-hidden.
-- Community posts had no counter trigger at all.
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

-- Rebuild both counters from the report tables so existing reports are reflected.
UPDATE public.shared_routines sr
   SET report_count = c.n
  FROM (SELECT shared_routine_id, COUNT(*)::INT AS n FROM public.reports GROUP BY shared_routine_id) c
 WHERE c.shared_routine_id = sr.id AND sr.report_count <> c.n;

UPDATE public.community_posts cp
   SET report_count = c.n
  FROM (SELECT post_id, COUNT(*)::INT AS n FROM public.community_post_reports GROUP BY post_id) c
 WHERE c.post_id = cp.id AND cp.report_count <> c.n;


-- ============================================================================
-- #5 MEDIUM — Admin review surface for community posts, mirroring
-- reported_posts_admin. Aggregates reporter ids, so it must never be reachable
-- through PostgREST: service role / SQL editor only.
-- ============================================================================

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
REVOKE ALL ON public.reported_community_posts_admin FROM anon, authenticated;


-- ============================================================================
-- #6 MEDIUM — reported_user_id is set by the server.
-- It arrived from the client, so a report could be filed against any user id
-- regardless of who actually wrote the post. These triggers read the real
-- author off the referenced row (definer: the reporter cannot see hidden rows).
-- ============================================================================

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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cp_reports_set_target ON public.community_post_reports;
CREATE TRIGGER trg_cp_reports_set_target
  BEFORE INSERT ON public.community_post_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_cp_report_target();


-- ============================================================================
-- #7 HIGH — Blocklist normalization. The word lists are unchanged; what changes
-- is that the text is normalized before matching, so 'f u c k', 'sh1t' and
-- 'fuuuck' no longer walk straight through.
-- Three views of the text are tested:
--   (a) normalized  — substring list AND whole-word list
--   (b) (a) with separators removed, but only when the text is actually
--       spaced out letter-by-letter — substring list only
--   (c) (b) with repeated letters collapsed — substring list only, needles
--       collapsed the same way, and only when the text really had a run
-- Whole words are matched on view (a) alone so "grass" never trips "ass".
-- Keep the lists in sync with lib/contentFilter.js.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.assert_text_clean(txt TEXT, field_label TEXT DEFAULT 'content')
RETURNS VOID
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
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

  -- Accented latin letters folded to their base letter (no unaccent extension)
  low := translate(low,
    'àáâãäåāăą' || 'èéêëēĕėęě' || 'ìíîïĩīĭįı' || 'òóôõöøōŏő' || 'ùúûüũūŭůűų' ||
    'çćĉċč' || 'ñńņň' || 'ýÿŷ' || 'šśŝş' || 'žźż' || 'đď' || 'ł' || 'ŧ' || 'ß' || 'æ' || 'œ',
    'aaaaaaaaa' || 'eeeeeeeee' || 'iiiiiiiii' || 'ooooooooo' || 'uuuuuuuuuu' ||
    'ccccc'     || 'nnnn'      || 'yyy'       || 'ssss'      || 'zzz'        || 'dd' || 'l' || 't' || 's' || 'a' || 'o');

  -- Leet digits
  low := translate(low, '0134578', 'oieastb');

  -- Separators are only dropped when the text actually looks spaced-out
  -- ("f u c k"). Removing them unconditionally would join innocent
  -- neighbours — "finish it" becomes "finishit", which contains "shit".
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
-- #8 HIGH — Moderate profile text. name / username / bio are shown to every
-- user through public_profiles and on every post, but were writable with no
-- server-side filtering at all. Same blocklist as the feed, plus length caps.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.validate_profile_text()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF char_length(coalesce(NEW.name, '')) > 40 THEN
    RAISE EXCEPTION 'name_too_long' USING HINT = 'Name exceeds 40 characters';
  END IF;
  IF char_length(coalesce(NEW.username, '')) > 30 THEN
    RAISE EXCEPTION 'username_too_long' USING HINT = 'Username exceeds 30 characters';
  END IF;
  IF char_length(coalesce(NEW.bio, '')) > 200 THEN
    RAISE EXCEPTION 'bio_too_long' USING HINT = 'Bio exceeds 200 characters';
  END IF;

  PERFORM public.assert_text_clean(coalesce(NEW.name, ''),     'Name');
  PERFORM public.assert_text_clean(coalesce(NEW.username, ''), 'Username');
  PERFORM public.assert_text_clean(coalesce(NEW.bio, ''),      'Bio');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_text_check ON public.profiles;
CREATE TRIGGER trg_profile_text_check
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.validate_profile_text();


-- ============================================================================
-- #9 HIGH — avatar_url must point at our own storage bucket. Any other URL is
-- fetched by every device that renders the profile or a post, which hands the
-- URL's owner the IP and rough location of everyone who scrolled past.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.validate_profile_avatar_url()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  prefix TEXT := 'https://lkopadfjqjaqmivkyzgw.supabase.co/storage/v1/object/public/avatars/';
BEGIN
  IF coalesce(NEW.avatar_url, '') <> ''
     AND left(NEW.avatar_url, char_length(prefix)) <> prefix THEN
    RAISE EXCEPTION 'invalid_avatar_url'
      USING HINT = 'Avatar must be uploaded through the app';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_avatar_url_check ON public.profiles;
CREATE TRIGGER trg_profile_avatar_url_check
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.validate_profile_avatar_url();


-- ============================================================================
-- #10 HIGH — Avatar uploads go through the openai-proxy 'upload_avatar' action,
-- which moderates the image and then writes with the service role. Direct
-- client writes are removed so an unmoderated image can never reach the bucket.
-- Reads stay public; delete-own stays so account deletion can clean up.
-- ============================================================================

DROP POLICY IF EXISTS "avatars_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "avatars_update_own" ON storage.objects;
DROP POLICY IF EXISTS "avatars_delete_own" ON storage.objects;

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "avatars_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::TEXT);


-- ============================================================================
-- #11 LOW — Pin search_path on the remaining definer helpers. Same bodies as
-- schema.sql, so a rogue schema earlier in search_path cannot shadow the
-- tables they read.
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

CREATE OR REPLACE FUNCTION public.can_view_data(owner_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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

CREATE OR REPLACE FUNCTION public.recent_post_count(since TIMESTAMPTZ)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (
    (SELECT COUNT(*) FROM public.shared_routines WHERE user_id = auth.uid() AND created_at > since)
    + (SELECT COUNT(*) FROM public.community_posts WHERE user_id = auth.uid() AND created_at > since)
  )::INTEGER
$$;


-- ============================================================================
-- #12 LOW — One friendship row per pair. UNIQUE (requester_id, addressee_id)
-- let A→B and B→A both exist, which showed up as two requests between the same
-- two people. If this errors, delete the duplicate reciprocal rows first.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_uniq
  ON public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));


-- ============================================================================
-- Done.
-- ============================================================================
