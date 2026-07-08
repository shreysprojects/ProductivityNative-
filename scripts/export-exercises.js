// Backup the public.exercises workout library to supabase/seed-exercises.sql.
// Reads through the public REST API (the exercises table has a public-read
// policy), so no database password is needed.
//
// Usage (from project root):
//   set -a; source .env; set +a
//   URL="$EXPO_PUBLIC_SUPABASE_URL" ANON="$EXPO_PUBLIC_SUPABASE_ANON_KEY" \
//     OUT="supabase/seed-exercises.sql" node scripts/export-exercises.js
//
// NOTE: this backs up the exercise ROWS (names, muscles, instructions, and the
// gif_url values). The GIF *files* themselves live in the `exercise-gifs`
// Storage bucket and are NOT included here — the gif_url values point at this
// project's storage. To migrate to a different project you'd also copy that
// bucket's contents.
const fs = require('fs')
const URL = process.env.URL, ANON = process.env.ANON, OUT = process.env.OUT

async function fetchAll() {
  const all = []
  const limit = 1000
  for (let offset = 0; ; ) {
    const res = await fetch(
      `${URL}/rest/v1/exercises?select=*&order=id&limit=${limit}&offset=${offset}`,
      { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
    const rows = await res.json()
    if (rows.length === 0) break
    all.push(...rows)
    offset += rows.length
    if (all.length > 100000) throw new Error('runaway pagination')
  }
  return all
}

;(async () => {
  const rows = await fetchAll()
  const json = JSON.stringify(rows)
  const sql = `-- ============================================================================
-- seed-exercises.sql  —  backup of the public.exercises workout library.
-- ${rows.length} exercises: names, muscles, gif_url, youtube_id, instructions.
-- Idempotent (ON CONFLICT DO NOTHING). Run AFTER schema.sql.
-- Regenerate with scripts/export-exercises.js whenever the library changes.
-- NOTE: the GIF files live in the exercise-gifs Storage bucket, not here.
-- ============================================================================

-- Columns the live table has beyond the original schema.sql (safe no-ops if present):
ALTER TABLE public.exercises ADD COLUMN IF NOT EXISTS youtube_id   TEXT;
ALTER TABLE public.exercises ADD COLUMN IF NOT EXISTS instructions TEXT[];

INSERT INTO public.exercises
SELECT * FROM jsonb_populate_recordset(
  null::public.exercises,
  $exercises_seed$${json}$exercises_seed$::jsonb
)
ON CONFLICT (id) DO NOTHING;
`
  fs.writeFileSync(OUT, sql)
  console.log(`wrote ${OUT} — ${rows.length} exercises, ${(sql.length / 1024 / 1024).toFixed(2)} MB`)
})().catch(e => { console.error('EXPORT FAILED:', e.message); process.exit(1) })
