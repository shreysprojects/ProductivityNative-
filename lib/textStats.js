// Word count + estimated reading time for journal entries.
const WORDS_PER_MINUTE = 200

export function wordCount(text) {
  const t = (text || '').trim()
  return t ? t.split(/\s+/).length : 0
}

export function readingStats(text) {
  const words = wordCount(text)
  if (words === 0) return '0 words'
  const mins = Math.ceil(words / WORDS_PER_MINUTE)
  return `${words} word${words === 1 ? '' : 's'} · ${mins} min read`
}
