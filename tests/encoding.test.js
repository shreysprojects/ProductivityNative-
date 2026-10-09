// Every source file must be plain UTF-8, encoded once.
//
// Run with:  node tests/encoding.test.js
//
// On 2026-09-23 lib/storage.js went through a Windows PowerShell rewrite that
// read it as Windows-1252 and saved it back as UTF-8, so every non-ASCII
// character came out mangled (the apostrophe in "can’t" turned into three
// odd characters, and so did the ✨ emoji), and it shipped: some of those
// strings are what the app shows. This finds
// the pattern that misreading leaves: a UTF-8 lead byte and its continuation
// bytes, each turned into its own Windows-1252 character.

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const DIRS = ['app', 'components', 'lib', 'supabase', 'tests']
const EXT = /\.(js|ts|sql|json)$/

// Windows-1252 characters back to their byte values. 0x80-0x9F differ from
// Latin-1; the five bytes 1252 leaves undefined come through as C1 controls.
const CP1252_80_9F = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
]
const byteOf = new Map()
for (let b = 0x80; b < 0x100; b++) {
  byteOf.set(String.fromCodePoint(b <= 0x9f ? CP1252_80_9F[b - 0x80] : b), b)
}
const utf8 = new TextDecoder('utf-8', { fatal: true })

// The mangled characters in one line, or [] when it is clean.
function mangled(line) {
  const chars = Array.from(line)
  const found = []
  for (let i = 0; i < chars.length; i++) {
    const lead = byteOf.get(chars[i])
    if (lead === undefined || lead < 0xc2 || lead > 0xf4) continue
    const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : 2
    const bytes = [lead]
    for (let k = 1; k < need; k++) {
      const b = byteOf.get(chars[i + k])
      if (b === undefined || b > 0xbf) break
      bytes.push(b)
    }
    if (bytes.length !== need) continue
    try {
      found.push(`"${chars.slice(i, i + need).join('')}" (should be "${utf8.decode(Uint8Array.from(bytes))}")`)
      i += need - 1
    } catch {}
  }
  return found
}

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* files(full)
    else if (EXT.test(entry.name)) yield full
  }
}

let total = 0
const fails = []
for (const dir of DIRS) {
  const base = path.join(ROOT, dir)
  if (!fs.existsSync(base)) continue
  for (const file of files(base)) {
    total++
    const buf = fs.readFileSync(file)
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) fails.push(`${rel}: starts with a byte-order mark`)
    buf.toString('utf8').split('\n').forEach((line, i) => {
      const bad = mangled(line)
      if (bad.length) fails.push(`${rel}:${i + 1}: ${bad.slice(0, 3).join(', ')}`)
    })
  }
}

if (fails.length) {
  console.error(`✗ encoding: ${fails.length} problem(s) in ${total} files`)
  fails.slice(0, 40).forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`✓ encoding: ${total} files are clean UTF-8`)
