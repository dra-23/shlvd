import { updateBook } from './db.js'

// Finds covers for books whose cover image fails to load, or that have no
// cover at all, and saves what it finds to the library so it's fixed for good.

const BASE = 'https://www.googleapis.com/books/v1/volumes'
const MISS_KEY = 'shlvd-cover-misses'
const MISS_DAYS = 7

// Simple throttle queue — one request every 800ms to avoid rate limits
const queue = []
let processing = false
const attempted = new Set() // don't retry the same book twice per session

// Books we searched for recently without finding a cover — skip for a week
function recentMisses() {
  try {
    const all = JSON.parse(localStorage.getItem(MISS_KEY) || '{}')
    const cutoff = Date.now() - MISS_DAYS * 86400000
    return Object.fromEntries(Object.entries(all).filter(([, at]) => at > cutoff))
  } catch { return {} }
}
function recordMiss(bookId) {
  try {
    const all = recentMisses()
    all[bookId] = Date.now()
    localStorage.setItem(MISS_KEY, JSON.stringify(all))
  } catch {}
}

function enqueue({ bookId, title, author, img = null }) {
  if (!bookId || attempted.has(bookId) || recentMisses()[bookId]) return
  attempted.add(bookId)
  queue.push({ bookId, title, author, img })
  processQueue()
}

export function initCoverFix() {
  // 1. Cover images that fail to load
  document.addEventListener('error', e => {
    if (e.target.tagName !== 'IMG') return
    const img = e.target
    if (!img.dataset.bookId) return
    img.style.display = 'none' // show the placeholder while we look
    enqueue({ bookId: img.dataset.bookId, title: img.dataset.title || '', author: img.dataset.author || '', img })
  }, true) // capture phase so it fires before bubbling

  // 2. Library books shown with no cover at all (placeholders marked
  //    data-missing-cover). Once a cover is saved, the library listener
  //    re-renders the book with it.
  const scan = root => root.querySelectorAll?.('[data-missing-cover]').forEach(el =>
    enqueue({ bookId: el.dataset.bookId, title: el.dataset.title || '', author: el.dataset.author || '' }))
  new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => {
    if (n.nodeType !== 1) return
    if (n.matches?.('[data-missing-cover]')) scan(n.parentNode)
    else scan(n)
  }))).observe(document.body, { childList: true, subtree: true })
}

/** Data attributes that mark a cover placeholder for a library book as fixable */
export function missingCoverAttrs(book) {
  const attr = v => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `data-missing-cover data-book-id="${attr(book.id)}" data-title="${attr(book.title)}" data-author="${attr(book.author)}"`
}

async function processQueue() {
  if (processing || !queue.length) return
  processing = true
  await fixCover(queue.shift())
  processing = false
  if (queue.length) setTimeout(processQueue, 800)
}

async function fixCover({ bookId, title, author, img }) {
  try {
    let key = ''
    try {
      const { BOOKS_API_KEY } = await import('./config.js')
      if (BOOKS_API_KEY) key = `&key=${BOOKS_API_KEY}`
    } catch {}

    // Drop subtitles and "(Series, #2)" suffixes, which make title search miss
    const cleanTitle = title.replace(/\s*[:(\[].*$/, '').trim()
    const firstAuthor = author.split(/\s*(?:,|&|\band\b)\s*/i)[0] || ''
    const queries = [
      [cleanTitle && `intitle:${cleanTitle}`, firstAuthor && `inauthor:${firstAuthor}`].filter(Boolean).join(' '),
      `${cleanTitle} ${firstAuthor}`.trim(), // Google's fielded search is unreliable; plain search as fallback
    ]

    let url = ''
    for (const q of queries) {
      const res = await fetch(`${BASE}?q=${encodeURIComponent(q)}&maxResults=5&printType=books${key}`)
      if (!res.ok) return // rate limited etc. — try again another session
      const data = await res.json()
      const hit = (data.items || []).find(i => i.volumeInfo?.imageLinks)
      const thumb = hit?.volumeInfo.imageLinks.thumbnail || hit?.volumeInfo.imageLinks.smallThumbnail
      if (thumb) { url = thumb.replace('http://', 'https://'); break }
    }
    if (!url) { recordMiss(bookId); return }

    // Update DOM
    if (img?.isConnected) {
      img.src = url
      img.style.display = ''
    }

    // Persist to Firestore
    await updateBook(bookId, { thumbnail: url })

  } catch (err) {
    console.warn('Cover fix failed:', title, err.message)
  }
}
