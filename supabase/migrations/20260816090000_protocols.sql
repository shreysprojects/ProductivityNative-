-- Protocols: emergency checklists (urge-surfing, low-motivation playbooks)
-- with an optional days-since counter, plus the journal entries written after
-- completing one. Whole objects ride in a jsonb column so the client shape
-- can evolve without further migrations; updated_at drives last-write-wins.

CREATE TABLE IF NOT EXISTS public.protocols (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, id)
);

ALTER TABLE public.protocols ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "protocols_own" ON public.protocols;
CREATE POLICY "protocols_own" ON public.protocols
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.protocol_journals (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  day        DATE NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS protocol_journals_user_day
  ON public.protocol_journals (user_id, day);

ALTER TABLE public.protocol_journals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "protocol_journals_own" ON public.protocol_journals;
CREATE POLICY "protocol_journals_own" ON public.protocol_journals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
