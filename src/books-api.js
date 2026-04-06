const BASE = 'https://www.googleapis.com/books/v1/volumes'

/**
 * Search Google Books API.
 * Returns an array of normalized book objects.
 */
export const searchBooks = async (query) => {
  if (!query.trim()) return []
  const url = `${BASE}?q=${encodeURIComponent(query)}&maxResults=20&printType=books`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Books API error')
  const data = await res.json()
  if (!data.items) return []
  return data.items.map(normalizeBook)
}

/**
 * Fetch a single book by Google Books volume ID.
 */
export const getBookById = async (volumeId) => {
  const res = await fetch(`${BASE}/${volumeId}`)
  if (!res.ok) throw new Error('Books API error')
  const data = await res.json()
  return normalizeBook(data)
}

function normalizeBook(item) {
  const info = item.volumeInfo || {}
  const thumb =
    info.imageLinks?.thumbnail ||
    info.imageLinks?.smallThumbnail ||
    ''
  return {
    googleBooksId: item.id,
    title: info.title || 'Untitled',
    author: (info.authors || []).join(', ') || 'Unknown author',
    thumbnail: thumb.replace('http://', 'https://'),
    pageCount: info.pageCount || 0,
    description: info.description || '',
    publishedDate: info.publishedDate || '',
    categories: info.categories || [],
  }
}
