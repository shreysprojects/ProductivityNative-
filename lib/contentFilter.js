// Shared client-side content filter.
//
// Keep the two word lists in sync with public.assert_text_clean in
// supabase/migrations/20260923090000_security_hardening.sql (which applies
// the SAME normalization server-side).
// The DB trigger is the authoritative backstop; this copy exists so the user
// gets an instant, specific message before a write is attempted.
//
// Matching runs over several normalized views of the text so that simple
// obfuscation (diacritics, leet digits, spaced-out or repeated letters) does
// not slip through:
//   pass A  normalized, separators intact  -> substring + word-boundary checks
//   pass B  separators stripped            -> substring checks only
//   pass C  runs collapsed + de-separated  -> substring checks only
// Word-boundary entries are checked only in pass A, where boundaries still
// mean something (so "grass" never trips the standalone word "ass").

// Substring match: these never appear inside innocent words.
export const BLOCKED_SUBSTRINGS = [
  'fuck', 'shit', 'bitch', 'cunt', 'pussy', 'asshole', 'whore', 'faggot', 'nigger', 'nigga',
  'slut', 'skank', 'twat', 'wanker', 'piss', 'spaz', 'jerk off', 'jerkoff',
  'penis', 'vagina', 'masturbat', 'handjob', 'blowjob', 'cumshot', 'orgasm', 'erection',
  'ejaculat', 'dildo', 'vibrator', 'porn', 'intercourse', 'foreplay', 'threesome',
  'genitals', 'testicle', 'nude', 'naked', 'incest', 'pedophil', 'prostitut', 'bestiality',
  'boob', 'jackoff', 'sexual',
  // Adult content / solicitation
  'onlyfans', 'only fans', 'fansly', 'subscrib', 'subscription', 'camgirl', 'cam girl',
  'escort', 'hookup', 'sugar daddy', 'sugar baby', 'nsfw', 'xxx', 'fetish', 'bdsm',
  'milf', 'hentai', 'stripper', 'strip club', 'lewd', 'thot', 'sexting', 'horny',
  'creampie', 'deepthroat', 'gangbang', 'bukkake', 'gloryhole', 'rimjob', 'footjob',
  'titties', 'cumming', 'fap',
  'gook', 'kike', 'wetback', 'beaner', 'towelhead', 'redskin', 'golliwog', 'zipperhead', 'darkie',
  'tranny', 'shemale',
  'suicide', 'murder', 'terrorist', 'torture',
  'hitler', 'stalin', 'mussolini', 'genocide', 'holocaust', 'fascism', 'fascist', 'communism',
]

// Word-boundary match: a substring match would catch innocent words
// (e.g. "skill" contains "kill", "Ashkenazi" contains "nazi").
export const BLOCKED_WORDS = [
  'ass', 'cock', 'sex', 'anal', 'rape', 'kill', 'bastard',
  'spic', 'chink', 'coon', 'cracker', 'paki', 'jap', 'dyke', 'honky',
  'retard', 'hooker', 'nazi',
]

const ZERO_WIDTH_RE = /[​-‍⁠﻿]/g
const SEPARATOR_RE = /[\s._\-*+~|/\\'"`^()[\]{}<>,:;!?#]/g

const LEET = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
  '@': 'a', '$': 's', '€': 'e', '£': 'l', '!': 'i',
}

/**
 * Casefold, strip diacritics and zero-width characters, and fold common
 * leet-speak substitutions back to letters.
 */
export function normalizeForFilter(text) {
  let s = String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // combining marks left by NFKD
    .replace(ZERO_WIDTH_RE, '')
    .toLowerCase()
  s = s.replace(/[01345789@$€£!]/g, ch => LEET[ch] ?? ch)
  return s
}

const stripSeparators = s => s.replace(SEPARATOR_RE, '')
const collapseRuns = s => s.replace(/(.)\1+/g, '$1')

// Runs of single characters split by separators — the "f u c k" / "s-h-i-t"
// pattern. Only these runs are de-spaced; stripping every separator in the
// whole string would join innocent neighbours ("finish it" -> "finishit").
const SPACED_LETTERS_RE = /(?:[a-z0-9][^a-z0-9]+){2,}[a-z0-9]/g

const joinSpacedLetters = s =>
  s.replace(SPACED_LETTERS_RE, run => run.replace(/[^a-z0-9]/g, ''))

/**
 * Returns the offending word, or null when the text is clean.
 * Mirrors public.assert_text_clean.
 */
export function findBlockedWord(text) {
  const base = normalizeForFilter(text)
  if (!base) return null

  const deSpaced = joinSpacedLetters(base)
  const collapsed = collapseRuns(deSpaced)
  // Collapsing only tells us something when the text actually repeated a
  // character; otherwise it just shortens needles into innocent words
  // ("piss" -> "pis" would match "pistol squat").
  const runsCollapsed = collapsed !== deSpaced

  for (const w of BLOCKED_SUBSTRINGS) {
    if (base.includes(w)) return w
    if (deSpaced !== base && deSpaced.includes(w)) return w
    if (runsCollapsed) {
      const squashed = collapseRuns(w)
      if (squashed.length >= 4 && collapsed.includes(squashed)) return w
    }
  }

  // Word boundaries only make sense while separators are intact.
  for (const w of BLOCKED_WORDS) {
    if (new RegExp(`\\b${w}\\b`).test(base)) return w
    if (deSpaced !== base && new RegExp(`\\b${w}\\b`).test(deSpaced)) return w
  }
  return null
}

export function containsBlockedContent(text) {
  return findBlockedWord(text) !== null
}
