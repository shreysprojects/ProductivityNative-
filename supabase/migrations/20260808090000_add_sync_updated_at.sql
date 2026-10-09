-- Timestamps for cross-device conflict resolution on whole-blob stores.
-- Purely additive; touches no existing data.

ALTER TABLE public.day_rules       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE public.weekly_routines ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
