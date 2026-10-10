// "For you" recommendations built from reading history.
// Network results are cached for a day per query; which books show is
// worked out fresh from the library each time, so anything you add or
// dismiss disappears immediately.
import { searchByAuthor, searchGoogle, titleKey, isJunkTitle } from './books-api.js'
import { splitAuthors } from './authors.js'
import { groupSeries } from './views/shelves.js'

const DAY = 86400000
const CACHE_PREFIX = 'shlvd-recs:'
const DISMISSED_KEY = 'shlvd-recs-dismissed'

// ── Small helpers ─────────────────────────────────────────────────────────────

async function cached(key, ttl, fn) {
  try {
    const hit = JSON.parse(localStorage.getItem(CACHE_PREFIX + key) || 'null')
    if (hit && Date.now() - hit.at < ttl) return hit.value
  } catch {}
  const value = await fn()
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), value })) } catch {}
  return value
}

export function getDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')) } catch { return new Set() }
}
export function dismiss(title) {
  const d = getDismissed()
  d.add(titleKey(title))
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...d])) } catch {}
}

const year = () => new Date().getFullYear()
const pubYear = b => Number(String(b.publishedDate || '').slice(0, 4)) || 0

/** Authors ranked by how much you like them: books read, weighted by rating */
export function authorAffinity(books) {
  const stats = new Map()
  books.filter(b => b.shelf === 'read').forEach(b => {
    splitAuthors(b.author).forEach(a => {
      const s = stats.get(a) || { author: a, count: 0, ratingSum: 0, rated: 0 }
      s.count++
      if (b.rating) { s.ratingSum += b.rating; s.rated++ }
      stats.set(a, s)
    })
  })
  return [...stats.values()]
    .map(s => ({ ...s, avg: s.rated ? +(s.ratingSum / s.rated).toFixed(1) : null }))
    .map(s => ({ ...s, score: s.count * ((s.avg ?? 3.5) / 5) }))
    .sort((a, b) => b.score - a.score)
}

export function topGenres(books, n = 3) {
  const counts = new Map()
  books.filter(b => b.shelf === 'read' && b.genre).forEach(b => counts.set(b.genre, (counts.get(b.genre) || 0) + 1))
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([g]) => g)
}

// Anything already on a shelf, or dismissed, never shows as a recommendation
function filterNew(list, books) {
  const owned = new Set(books.map(b => titleKey(b.title)))
  const dismissed = getDismissed()
  const seen = new Set()
  return list.filter(b => {
    const k = titleKey(b.title)
    if (!k || owned.has(k) || dismissed.has(k) || seen.has(k) || isJunkTitle(b.title) || !b.thumbnail) return false
    seen.add(k)
    return true
  })
}

// ── 1. Continue your series ───────────────────────────────────────────────────

/** Next unread book of each series you've started (all from your own shelves) */
export function continueSeries(books) {
  return groupSeries(books)
    .filter(s => s.read > 0 && s.next)
    .sort((a, b) => (b.lastRead?.getTime() ?? 0) - (a.lastRead?.getTime() ?? 0))
    .map(s => ({ book: s.next, reason: `Next in ${s.name} · ${s.read} of ${s.total} read` }))
}

/** Later books in series you've finished in your library, from Google Books */
export async function moreInFinishedSeries(books) {
  const finished = groupSeries(books)
    .filter(s => s.read === s.total && s.total > 0)
    .sort((a, b) => (b.lastRead?.getTime() ?? 0) - (a.lastRead?.getTime() ?? 0))
    .slice(0, 3)
  const out = []
  for (const s of finished) {
    const author = splitAuthors(s.books[0].author)[0]
    if (!author) continue
    const results = await cached(`series:${s.name}`, DAY, () => searchGoogle(`${s.name} ${author}`).catch(() => []))
    const seriesWord = s.name.toLowerCase()
    filterNew(results, books)
      .filter(b => b.author.toLowerCase().includes(author.toLowerCase()))
      .filter(b => `${b.title} ${b.description}`.toLowerCase().includes(seriesWord))
      .slice(0, 2)
      .forEach(b => out.push({ book: b, reason: `More in ${s.name}` }))
  }
  return out
}

// ── 2. New from authors you love ──────────────────────────────────────────────

export async function newFromFavouriteAuthors(books, howMany = 6) {
  const favourites = authorAffinity(books).filter(a => a.count >= 2).slice(0, howMany)
  const out = []
  for (const fav of favourites) {
    const list = await cached(`author:${fav.author}`, DAY, () => searchByAuthor(fav.author).catch(() => []))
    filterNew(list, books)
      .filter(b => pubYear(b) >= year() - 2)
      .slice(0, 2)
      .forEach(b => out.push({
        book: b,
        reason: `You've read ${fav.count} by ${fav.author}`,
        author: fav.author,
      }))
  }
  return out
}

// ── 3. Pick your next read from your TBR ──────────────────────────────────────

export function tbrPicks(books, howMany = 10) {
  const affinity = new Map(authorAffinity(books).map(a => [a.author, a]))
  const genres = topGenres(books, 5)
  return books
    .filter(b => b.shelf === 'want')
    .map(b => {
      const fav = splitAuthors(b.author).map(a => affinity.get(a)).filter(Boolean).sort((x, y) => y.score - x.score)[0]
      const genreRank = genres.indexOf(b.genre)
      const score = (fav?.score || 0) + (genreRank >= 0 ? (5 - genreRank) * 0.6 : 0)
      const reason = fav
        ? `You've read ${fav.count} by ${fav.author}${fav.avg ? ` · ${fav.avg}★ avg` : ''}`
        : genreRank >= 0 ? `You read lots of ${b.genre}` : 'On your TBR'
      return { book: b, reason, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, howMany)
}

// ── 4. Popular in genres you read (Open Library, authors you haven't read) ───

const slug = g => g.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

async function openLibrarySubject(genre) {
  for (const s of [slug(genre), `${slug(genre)}s`]) {
    const res = await fetch(`https://openlibrary.org/subjects/${s}.json?limit=60`)
    if (!res.ok) continue
    const data = await res.json()
    if ((data.works || []).length >= 10) return data.works
  }
  return []
}

export async function popularInGenres(books, howMany = 3) {
  const readAuthors = new Set(books.flatMap(b => splitAuthors(b.author).map(a => a.toLowerCase())))
  const out = []
  for (const genre of topGenres(books, howMany)) {
    const works = await cached(`genre:${genre}`, DAY, () => openLibrarySubject(genre).catch(() => []))
    const recent = works
      .filter(w => (w.first_publish_year || 0) >= year() - 8 && w.cover_id)
      .filter(w => /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}\p{S}]+$/u.test(w.title) && !/light novel|manga|vol\.?\s*\d/i.test(w.title))
      .filter(w => !(w.authors || []).some(a => readAuthors.has(a.name.toLowerCase())))
      .map(w => ({
        googleBooksId: `ol_${(w.key || '').replace('/works/', '')}`,
        source: 'openlibrary',
        title: w.title,
        author: (w.authors || []).map(a => a.name).join(', '),
        thumbnail: `https://covers.openlibrary.org/b/id/${w.cover_id}-M.jpg`,
        pageCount: 0,
        description: '',
        publishedDate: String(w.first_publish_year || ''),
        categories: [genre],
      }))
    filterNew(recent, books).slice(0, 5).forEach(b => out.push({ book: b, reason: `Popular in ${genre}` }))
  }
  return out
}

// ── 5. Similar authors (Gemini, verified against Google Books) ───────────────

export async function similarAuthors(books) {
  const affinity = authorAffinity(books)
  if (affinity.length < 3) return []
  const favourites = affinity.slice(0, 15).map(a => ({ author: a.author, count: a.count, avg: a.avg }))
  const readAuthors = affinity.map(a => a.author)

  const suggestions = await cached('ai:similar-authors', DAY, async () => {
    const { suggestSimilarAuthors } = await import('./ai.js')
    const raw = await suggestSimilarAuthors({ favourites, genres: topGenres(books, 5), alreadyRead: readAuthors.slice(0, 120) })
    // Keep only authors and books that really exist: each title must turn up
    // in Google Books under that author
    const verified = []
    for (const s of raw.slice(0, 6)) {
      const found = []
      for (const title of s.books.slice(0, 2)) {
        const hits = await searchGoogle(`${title} ${s.author}`).catch(() => [])
        const match = hits.find(h => titleKey(h.title) === titleKey(title) &&
          h.author.toLowerCase().includes(s.author.split(' ').at(-1).toLowerCase()))
        if (match) found.push(match)
      }
      if (found.length) verified.push({ author: s.author, because: s.because, books: found })
    }
    return verified
  })

  const read = new Set(readAuthors.map(a => a.toLowerCase()))
  return suggestions
    .filter(s => !read.has(s.author.toLowerCase()))
    .map(s => ({ ...s, books: filterNew(s.books, books) }))
    .filter(s => s.books.length)
}
