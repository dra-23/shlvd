// Genre clean-up helpers: spotting duplicates and library subject tags, and
// suggesting where a book's genre should go.

const key = g => g.trim().toLowerCase()

/** [{ name, count }] for every genre in use, most common first */
export function genreCounts(books) {
  const counts = new Map()
  books.forEach(b => {
    const g = b.genre.trim()
    if (g) counts.set(g, (counts.get(g) || 0) + 1)
  })
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/**
 * Genres that differ only in capitalisation or spacing ("Crime thriller" vs
 * "Crime Thriller"). Each fix folds the variants into the most-used spelling.
 */
export function caseDuplicateFixes(books) {
  const groups = new Map()
  genreCounts(books).forEach(g => {
    const k = key(g.name)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(g)
  })
  return [...groups.values()]
    .filter(variants => variants.length > 1)
    .map(variants => {
      const [to, ...from] = variants // already sorted most-used first
      return { to: to.name, toCount: to.count, from }
    })
}

// Words that show up in real genre names. Anything without one of these is
// probably a library subject heading ("Amnesia", "California", "Brothers").
const GENRE_WORDS = [
  'thriller', 'mystery', 'mysteries', 'fantasy', 'romance', 'rom-com', 'romantic', 'horror',
  'fiction', 'science', 'sci-fi', 'historical', 'dystopian', 'biography', 'autobiography',
  'memoir', 'true crime', 'comedy', 'suspense', 'gothic', 'paranormal', 'contemporary',
  'young adult', 'ya', 'literary', 'nonfiction', 'non-fiction', 'poetry', 'classic',
  'adventure', 'western', 'crime', 'drama', 'self-help', 'cozy', 'supernatural',
]

/** True when a genre looks like a subject tag rather than a genre */
export function looksLikeSubjectTag(name) {
  const n = key(name)
  // Library headings often carry qualifiers: "Galway (Ireland : County)", "Fantasy fiction, American"
  if (/[(),:]/.test(n)) return true
  return !GENRE_WORDS.some(w => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(n))
}

/**
 * Suggested genres to move a genre's books into: what the same authors are
 * usually filed under, then the most common genres overall.
 */
export function suggestGenres(genre, books, limit = 3) {
  // Only suggest established genres, so one-off oddities ("Horror tales") don't spread
  const established = new Set(genreCounts(books)
    .filter(g => g.count >= 3 && g.name !== genre && !looksLikeSubjectTag(g.name))
    .map(g => g.name))
  const inGenre = books.filter(b => b.genre === genre)
  const authors = new Set(inGenre.map(b => b.author))
  const score = new Map()
  books.forEach(b => {
    if (authors.has(b.author) && established.has(b.genre)) score.set(b.genre, (score.get(b.genre) || 0) + 1)
  })
  const byAuthor = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g)
  return [...new Set([...byAuthor, ...established])].slice(0, limit)
}

/** Find an existing genre matching `name` regardless of case, e.g. for Search pre-fill */
export function matchGenre(name, genres) {
  if (!name) return ''
  const k = key(name)
  return genres.find(g => key(g) === k) || ''
}
