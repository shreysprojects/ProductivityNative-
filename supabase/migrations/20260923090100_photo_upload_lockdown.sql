-- Routine and ingredient photos go through the moderated upload path.
--
-- The routine-photos bucket is public, and the only thing that checked a
-- picture before it landed there was the app itself: any signed-in user
-- could call the storage API directly and put anything, any number of times,
-- into their folder of a public bucket. The ledger did not help either,
-- because the storage insert never looked at it.
--
-- Uploads now go through the openai-proxy 'upload_photo' action, which checks
-- the picture with the moderation model (fails closed), stores it with the
-- service role, and writes the ledger row whose trigger enforces the
-- 10-photo cap. Clients keep what they genuinely need: listing and deleting
-- their own files, and reading and deleting their own ledger rows.
--
-- DEPLOY ORDER: this needs the redeployed openai-proxy function AND the app
-- update that calls upload_photo. Apply it after both, or photo uploads from
-- the old app build stop working.

DROP POLICY IF EXISTS routine_photos_insert_own ON storage.objects;
DROP POLICY IF EXISTS routine_photos_update_own ON storage.objects;

-- routine_photos_own_select and routine_photos_delete_own (storage) stay:
-- the app lists its own folder to reconcile slots and removes its own files.
DROP POLICY IF EXISTS routine_photos_delete_own ON storage.objects;
CREATE POLICY routine_photos_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'routine-photos' AND (storage.foldername(name))[1] = auth.uid()::TEXT);

-- The ledger: rows are added only by the proxy (service role).
DROP POLICY IF EXISTS routine_photos_own        ON public.routine_photos;
DROP POLICY IF EXISTS routine_photos_own_select ON public.routine_photos;
DROP POLICY IF EXISTS routine_photos_own_delete ON public.routine_photos;

CREATE POLICY routine_photos_own_select ON public.routine_photos
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY routine_photos_own_delete ON public.routine_photos
  FOR DELETE TO authenticated USING (user_id = auth.uid());

REVOKE INSERT, UPDATE ON public.routine_photos FROM anon, authenticated;
