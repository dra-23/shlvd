import { BOOKS_API_KEY } from './config.js'

const GOOGLE_BASE = 'https://www.googleapis.com/books/v1/volumes'
const OL_SEARCH   = 'https://openlibrary.org/search.json'

// ── Normalizers ──────────────────────────────────────────────────────────────

function normalizeGoogleBook(item) {
  const info = item.volumeInfo || {}
  const thumb =
    info.imageLinks?.thumbnail ||
    info.imageLinks?.smallThumbnail ||
    ''
  return {
    googleBooksId: item.id,
    source: 'google',
    title: info.title || 'Untitled',
    author: (info.authors || []).join(', ') || 'Unknown author',
    thumbnail: thumb.replace('http://', 'https://'),
    pageCount: info.pageCount || 0,
    description: info.description || '',
    publishedDate: info.publishedDate || '',
    categories: info.categories || [],
  }
}

function normalizeOLBook(doc) {
  const coverId = doc.cover_i
  return {
    googleBooksId: `ol_${(doc.key || '').replace('/works/', '')}`,
    source: 'openlibrary',
    title: doc.title || 'Untitled',
    author: (doc.author_name || []).join(', ') || 'Unknown author',
    thumbnail: coverId
      ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`
      : '',
    pageCount: doc.number_of_pages_median || 0,
    description: '',
    publishedDate: doc.first_publish_year?.toString() || '',
    categories: (doc.subject || []).slice(0, 3),
  }
}

// ── Deduplication fingerprint ─────────────────────────────────────────────────

function fingerprint(book) {
  const t = (book.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20)
  const a = (book.author || '').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 12)
  return `${t}|${a}`
}

// ── Individual API fetchers ───────────────────────────────────────────────────

async function searchGoogle(query) {
  const key = BOOKS_API_KEY ? `&key=${BOOKS_API_KEY}` : ''
  const url = `${GOOGLE_BASE}?q=${encodeURIComponent(query)}&maxResults=20&printType=books${key}`
  const res = await fetch(url)
  if (!res.ok) {
    const err = new Error('Books API error')
    err.status = res.status
    throw err
  }
  const data = await res.json()
  return (data.items || []).map(normalizeGoogleBook)
}

async function searchOpenLibrary(query) {
  const url = `${OL_SEARCH}?q=${encodeURIComponent(query)}&limit=15&fields=key,title,author_name,cover_i,number_of_pages_median,first_publish_year,subject`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Open Library error')
  const data = await res.json()
  return (data.docs || []).map(normalizeOLBook)
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Search both Google Books and Open Library in parallel.
 * Google Books results come first; Open Library fills in unique titles.
 * Throws only if both sources fail.
 */
export const searchBooks = async (query) => {
  if (!query.trim()) return []

  const [googleResult, olResult] = await Promise.allSettled([
    searchGoogle(query),
    searchOpenLibrary(query),
  ])

  if (googleResult.status === 'rejected' && olResult.status === 'rejected') {
    throw googleResult.reason
  }

  const google = googleResult.status === 'fulfilled' ? googleResult.value : []
  const ol     = olResult.status  === 'fulfilled' ? olResult.value  : []

  // Deduplicate: Google Books takes priority
  const seen = new Set(google.map(fingerprint))
  const uniqueOL = ol.filter(b => {
    const fp = fingerprint(b)
    if (seen.has(fp)) return false
    seen.add(fp)
    return true
  })

  return [...google, ...uniqueOL]
}

/**
 * Fetch a single book by Google Books volume ID.
 */
export const getBookById = async (volumeId) => {
  const res = await fetch(`${GOOGLE_BASE}/${volumeId}`)
  if (!res.ok) throw new Error('Books API error')
  const data = await res.json()
  return normalizeGoogleBook(data)
}
