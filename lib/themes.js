const PALETTE = [
  { emoji: '⭐', color: '#2b7fff', bg: '#eef5ff', border: '#bdd4ff' },
  { emoji: '🔮', color: '#2b7fff', bg: '#eef5ff', border: '#bdd4ff' },
  { emoji: '🌌', color: '#2b7fff', bg: '#eef5ff', border: '#bdd4ff' },
  { emoji: '💫', color: '#2b7fff', bg: '#eef5ff', border: '#bdd4ff' },
  { emoji: '✨', color: '#2b7fff', bg: '#eef5ff', border: '#bdd4ff' },
  { emoji: '🎆', color: '#2b7fff', bg: '#eef5ff', border: '#bdd4ff' },
]

function fallback(name) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0
  return PALETTE[Math.abs(h) % PALETTE.length]
}

export function routineTheme(name) {
  const map = {
    Morning: { emoji: '☀️', color: '#2b7fff', bg: '#eef5ff', border: '#bdd4ff' },
    Fitness: { emoji: '💪', color: '#2b7fff', bg: '#eef5ff', border: '#bdd4ff' },
    Night:   { emoji: '🌙', color: '#2b7fff', bg: '#eef5ff', border: '#bdd4ff' },
    Looks:   { emoji: '✨', color: '#2b7fff', bg: '#eef5ff', border: '#bdd4ff' },
  }
  return map[name] ?? fallback(name)
}