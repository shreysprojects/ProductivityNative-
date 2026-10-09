-- Close the race in the routine-photo cap.
--
-- The trigger from 20260821090000_routine_photos.sql counts the user's rows
-- and then lets the insert through. Count and insert are two steps, so two
-- inserts running concurrently can both read 9, both pass, and the account
-- lands on 11 photos: a classic check-then-act race. A scripted client firing
-- parallel uploads can push well past the cap this way.
--
-- Fix: serialize inserts per user with a transaction-scoped advisory lock
-- taken before the count. The second concurrent insert blocks on the lock
-- until the first commits, then counts 10 and is rejected. The lock releases
-- itself at commit or rollback, keys on the user id (namespaced with the
-- table name so it cannot collide with any other advisory-lock user), and
-- only ever serializes one user's own uploads, so there is no cross-user
-- contention. Cap and error message are unchanged; the existing
-- routine_photos_limit trigger already points at this function, so replacing
-- the function body is the whole fix.

CREATE OR REPLACE FUNCTION public.enforce_routine_photo_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  photo_count INTEGER;
BEGIN
  -- Held until this transaction ends, so the count below cannot go stale
  -- between the check and the insert.
  PERFORM pg_advisory_xact_lock(hashtext('routine_photos:' || NEW.user_id::text));

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
