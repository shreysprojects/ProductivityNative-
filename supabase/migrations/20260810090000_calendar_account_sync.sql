-- Put the last calendar state that only ever lived on the device onto the
-- account, so a reinstall (or a second device) keeps it.
--
-- 1. schedule_items.updated_at — lets the class list merge with the cloud copy
--    instead of the local copy silently winning forever.
-- 2. user_settings — a small per-user key/value store for calendar preferences
--    that have no table of their own: the time-log grid shape, and the markers
--    recording which classes/routines have already been written to the log.

ALTER TABLE public.schedule_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, key)
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_settings_own" ON public.user_settings;
CREATE POLICY "user_settings_own" ON public.user_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
