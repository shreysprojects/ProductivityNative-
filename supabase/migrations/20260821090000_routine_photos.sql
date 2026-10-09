-- Routine photos in cloud storage.
--
-- Task and step photos used to live only on the device that picked them: the
-- task JSON held a file:// path out of the app's document directory. That path
-- is meaningless on a second device, and on iOS the container directory is
-- re-created on app updates, so photos went missing on their own. These are
-- now uploaded, and the task JSON holds the public URL instead.
--
-- The account is capped at 10 photos. That cap is enforced by the trigger
-- below, not by the app, so it holds regardless of what any client does.
-- MAX_ROUTINE_PHOTOS in lib/photoPaths.js must match the 10 used here.

-- ── Bucket ─────────────────────────────────────────────────────────────────
-- Public-read, like avatars. Object names carry a random component and the
-- URL is only ever stored in the owner's own rows, but a determined guesser
-- with the URL could read one — the trade is that a stored URL keeps working
-- forever, which a signed URL would not.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'routine-photos', 'routine-photos', true,
  5242880,                                   -- 5 MB; the app uploads ~200 KB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── Ledger ─────────────────────────────────────────────────────────────────
-- Storage has no way to express "at most N objects per user", so every upload
-- also writes a row here and the cap is enforced on this table.
CREATE TABLE IF NOT EXISTS public.routine_photos (
  path       TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS routine_photos_user_idx
  ON public.routine_photos(user_id);

ALTER TABLE public.routine_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS routine_photos_own ON public.routine_photos;
CREATE POLICY routine_photos_own ON public.routine_photos
  FOR ALL TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── The cap ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_routine_photo_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  photo_count INTEGER;
BEGIN
  SELECT count(*) INTO photo_count
  FROM public.routine_photos
  WHERE user_id = NEW.user_id;

  IF photo_count >= 10 THEN
    -- The app matches on this exact string to show a friendly message.
    RAISE EXCEPTION 'routine_photo_limit_reached';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS routine_photos_limit ON public.routine_photos;
CREATE TRIGGER routine_photos_limit
  BEFORE INSERT ON public.routine_photos
  FOR EACH ROW EXECUTE FUNCTION public.enforce_routine_photo_limit();

-- ── Storage policies ───────────────────────────────────────────────────────
-- Anyone may read (the bucket is public); only the owner may write into their
-- own uid-prefixed folder.
DROP POLICY IF EXISTS routine_photos_public_read ON storage.objects;
CREATE POLICY routine_photos_public_read ON storage.objects
  FOR SELECT USING (bucket_id = 'routine-photos');

DROP POLICY IF EXISTS routine_photos_insert_own ON storage.objects;
CREATE POLICY routine_photos_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'routine-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS routine_photos_update_own ON storage.objects;
CREATE POLICY routine_photos_update_own ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'routine-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS routine_photos_delete_own ON storage.objects;
CREATE POLICY routine_photos_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'routine-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
