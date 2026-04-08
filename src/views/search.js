import { searchBooks } from '../books-api.js'
import { getBook } from '../db.js'
import { openBookDetail } from './book-detail.js'

const SHELF_BADGE = { want: 'Want', reading: 'Reading', read: 'Read' }

export function renderSearch(container) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;min-height:100%;">
      <div class="top-bar" style="display:flex; align-items:center; gap:12px;">
        <img src="/icons/logo2-512.png" alt="Logo" style="width:32px; height:32px; border-radius:8px; margin-left:16px;">
        <span class="top-bar-title">Search</span>
      </div>

      <div class="search-bar">
        <span class="material-symbols-rounded">search</span>
        <input
          class="search-input"
          id="search-input"
          type="search"
          placeholder="Title, author, ISBN…"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          enterkeyhint="search"
        />
        <button class="icon-btn" id="clear-btn" style="display:none">
          <span class="material-symbols-rounded">close</span>
        </button>
      </div>

      <div id="search-results" style="flex:1;overflow-y:auto;"></div>
    </div>
  `

  const input   = container.querySelector('#search-input')
  const clearBtn = container.querySelector('#clear-btn')
  const results = container.querySelector('#search-results')

  let debounceTimer = null

  input.addEventListener('input', () => {
    const q = input.value.trim()
    clearBtn.style.display = q ? 'flex' : 'none'

    clearTimeout(debounceTimer)
    if (!q) {
      results.innerHTML = emptyPrompt()
      return
    }
    if (q.length < 3) return  // wait for at least 3 characters

    results.innerHTML = loadingHTML()
    debounceTimer = setTimeout(() => doSearch(q, results), 900)
  })

  clearBtn.addEventListener('click', () => {
    input.value = ''
    clearBtn.style.display = 'none'
    results.innerHTML = emptyPrompt()
    input.focus()
  })

  results.innerHTML = emptyPrompt()

  // Focus input after mount
  setTimeout(() => input.focus(), 150)
}

async function doSearch(query, resultsEl) {
  let books
  try {
    books = await searchBooks(query)
  } catch (err) {
    console.error('Books API error:', err)
    resultsEl.innerHTML = err.status === 429 ? rateLimitHTML() : errorHTML()
    return
  }

  if (!books.length) {
    resultsEl.innerHTML = noResultsHTML(query)
    return
  }

  // Check which books are already on a shelf (non-fatal if Firestore fails)
  const withShelf = await Promise.all(
    books.map(async b => {
      try {
        const saved = await getBook(b.googleBooksId)
        return { ...b, existingShelf: saved?.shelf || null }
      } catch {
        return { ...b, existingShelf: null }
      }
    })
  )

  resultsEl.innerHTML = withShelf.map(b => resultRowHTML(b)).join('')

  resultsEl.querySelectorAll('.search-result').forEach((row, i) => {
    row.addEventListener('click', () => {
      openBookDetail(
        withShelf[i],
        withShelf[i].existingShelf,
        () => {
          resultsEl.innerHTML = loadingHTML()
          setTimeout(() => doSearch(query, resultsEl), 300)
        }
      )
    })
  })
}

function resultRowHTML(book) {
  const coverHTML = book.thumbnail
    ? `<img src="${book.thumbnail}" alt="${book.title}" loading="lazy" />`
    : ''

  const badge = book.existingShelf
    ? `<span class="search-result-badge">${SHELF_BADGE[book.existingShelf]}</span>`
    : `<span class="material-symbols-rounded" style="color:var(--md-on-surface-variant);font-size:20px">add</span>`

  return `
    <div class="search-result">
      <div class="search-result-cover">${coverHTML}</div>
      <div class="search-result-info">
        <div class="search-result-title">${book.title}</div>
        <div class="search-result-author">${book.author}</div>
        ${book.publishedDate ? `<div class="body-small mt-4" style="color:var(--md-on-surface-variant)">${book.publishedDate.substring(0,4)}</div>` : ''}
      </div>
      ${badge}
    </div>
  `
}

function emptyPrompt() {
  return `
    <div class="empty-state" style="padding-top:48px;">
      <span class="material-symbols-rounded">search</span>
      <div class="empty-state-title">Find your next read</div>
      <div class="empty-state-body">Search by title, author, or ISBN to add books to your shelves.</div>
    </div>
  `
}

function loadingHTML() {
  return Array.from({ length: 5 }, () => `
    <div class="search-result">
      <div class="search-result-cover skeleton"></div>
      <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
        <div class="skeleton" style="height:14px;border-radius:6px;width:80%"></div>
        <div class="skeleton" style="height:12px;border-radius:6px;width:50%"></div>
      </div>
    </div>
  `).join('')
}

function noResultsHTML(query) {
  return `
    <div class="empty-state">
      <span class="material-symbols-rounded">sentiment_dissatisfied</span>
      <div class="empty-state-title">No results for "${query}"</div>
      <div class="empty-state-body">Try a different title or author name.</div>
    </div>
  `
}

function errorHTML() {
  return `
    <div class="empty-state">
      <span class="material-symbols-rounded">wifi_off</span>
      <div class="empty-state-title">Couldn't reach Books API</div>
      <div class="empty-state-body">Check your connection and try again.</div>
    </div>
  `
}

function rateLimitHTML() {
  return `
    <div class="empty-state">
      <span class="material-symbols-rounded">hourglass_empty</span>
      <div class="empty-state-title">Too many searches</div>
      <div class="empty-state-body">Google Books API rate limit hit. Wait a few seconds and try again.</div>
    </div>
  `
}

export function destroySearch() {}
