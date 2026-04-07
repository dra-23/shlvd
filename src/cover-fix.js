import { updateBook } from './db.js'

const BASE = 'https://www.googleapis.com/books/v1/volumes'

// Simple throttle queue — one request every 800ms to avoid rate limits
const queue = []
let processing = false
const attempted = new Set() // don't retry the same book twice

export function initCoverFix() {
  document.addEventListener('error', e => {
    if (e.target.tagName !== 'IMG') return
    const img = e.target
    const bookId = img.dataset.bookId
    if (!bookId || attempted.has(bookId)) return
    attempted.add(bookId)

    // Swap to placeholder immediately while we fetch
    img.style.display = 'none'

    queue.push({
      bookId,
      title:  img.dataset.title  || '',
      author: img.dataset.author || '',
      img,
    })
    processQueue()
  }, true) // capture phase so it fires before bubbling
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

    const q = [
      title  ? `intitle:${encodeURIComponent(title)}`  : '',
      author ? `inauthor:${encodeURIComponent(author)}` : '',
    ].filter(Boolean).join('+')

    const res = await fetch(`${BASE}?q=${q}&maxResults=1&printType=books${key}`)
    if (!res.ok) return

    const data = await res.json()
    const info = data.items?.[0]?.volumeInfo
    if (!info) return

    const thumb = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail
    if (!thumb) return

    const url = thumb.replace('http://', 'https://')

    // Update DOM
    if (img.isConnected) {
      img.src = url
      img.style.display = ''
    }

    // Persist to Firestore
    await updateBook(bookId, { thumbnail: url })

  } catch (err) {
    console.warn('Cover fix failed:', title, err.message)
  }
}
