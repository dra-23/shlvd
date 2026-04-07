import { watchShelf, getBook } from '../db.js'
import { openBookDetail } from './book-detail.js'
import { navigateTo } from '../main.js'

const SHELVES = [
  { id: 'reading', label: 'Reading',      icon: 'chrome_reader_mode' },
  { id: 'want',    label: 'Want to Read', icon: 'bookmark'           },
  { id: 'read',    label: 'Read',         icon: 'done_all'           },
]

// Snackbar helper — exported for use by other views
let snackbarTimeout = null
export function showSnackbar(msg) {
  document.querySelector('.snackbar')?.remove()
  clearTimeout(snackbarTimeout)
  const el = document.createElement('div')
  el.className = 'snackbar'
  el.textContent = msg
  document.body.appendChild(el)
  snackbarTimeout = setTimeout(() => el.remove(), 3000)
}

// Per-shelf expand state
const expandedState = { read: false }
// Store latest read books for expand/collapse re-render
let latestReadBooks = []
// Pagination
const MONTHS_PER_PAGE = 3
let visibleMonths = MONTHS_PER_PAGE
// All shelf books for local search
const allShelfBooks = { reading: [], want: [], read: [] }
const SHELF_BADGE = { reading: 'Reading', want: 'Want to Read', read: 'Read' }

export function renderShelves(container) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;min-height:100%;">
      <div class="top-bar" id="shelves-top-bar">
        <span class="top-bar-title">shlvd</span>
        <button class="icon-btn" id="shelf-search-open">
          <span class="material-symbols-rounded">search</span>
        </button>
      </div>
      <div id="shelf-search-bar" style="display:none;">
        <div class="search-bar" style="margin:8px 16px;">
          <span class="material-symbols-rounded">search</span>
          <input class="search-input" id="shelf-search-input" type="search"
            placeholder="Search your library…" autocomplete="off" />
          <button class="icon-btn" id="shelf-search-close">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
      </div>
      <div id="shelf-search-results" style="display:none;flex:1;overflow-y:auto;"></div>
      <div id="shelves-content" style="flex:1;padding-bottom:16px;">
        ${SHELVES.map(s => `
          <div class="shelf-section" id="shelf-${s.id}">
            <div class="shelf-header">
              <span class="shelf-title">${s.label}</span>
              <span class="shelf-count" id="count-${s.id}"></span>
              ${s.id === 'read' ? `<button class="btn btn-text expand-read-btn" id="expand-read-btn" style="margin-left:auto;padding:0 8px;font-size:0.8125rem;">
                <span class="material-symbols-rounded" style="font-size:18px">expand_more</span>
                View all
              </button>` : ''}
            </div>
            <div id="shelf-body-${s.id}">
              <div class="shelf-scroll" id="scroll-${s.id}">
                ${skeletonCards(3)}
              </div>
            </div>
          </div>
          <div class="divider"></div>
        `).join('')}
      </div>
    </div>
  `

  // ── Shelf search ─────────────────────────────────────
  const openBtn    = container.querySelector('#shelf-search-open')
  const closeBtn   = container.querySelector('#shelf-search-close')
  const searchBar  = container.querySelector('#shelf-search-bar')
  const searchInput = container.querySelector('#shelf-search-input')
  const resultsEl  = container.querySelector('#shelf-search-results')
  const contentEl  = container.querySelector('#shelves-content')

  openBtn.addEventListener('click', () => {
    searchBar.style.display = 'block'
    resultsEl.style.display = 'block'
    contentEl.style.display = 'none'
    openBtn.style.display = 'none'
    setTimeout(() => searchInput.focus(), 50)
  })

  const closeSearch = () => {
    searchBar.style.display = 'none'
    resultsEl.style.display = 'none'
    contentEl.style.display = 'block'
    openBtn.style.display = 'flex'
    searchInput.value = ''
    resultsEl.innerHTML = ''
  }

  closeBtn.addEventListener('click', closeSearch)

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase()
    if (!q) { resultsEl.innerHTML = ''; return }
    const all = [...allShelfBooks.reading, ...allShelfBooks.want, ...allShelfBooks.read]
    const hits = all.filter(b =>
      b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)
    )
    if (!hits.length) {
      resultsEl.innerHTML = `<div class="empty-state"><span class="material-symbols-rounded">search_off</span><div class="empty-state-title">No matches</div></div>`
      return
    }
    resultsEl.innerHTML = hits.map(b => `
      <div class="search-result shelf-search-result" data-id="${b.id}" data-shelf="${b.shelf}">
        <div class="search-result-cover">
          ${b.thumbnail ? `<img src="${b.thumbnail}" alt="${b.title}" loading="lazy" />` : ''}
        </div>
        <div class="search-result-info">
          <div class="search-result-title">${b.title}</div>
          <div class="search-result-author">${b.author}</div>
        </div>
        <span class="search-result-badge">${SHELF_BADGE[b.shelf] || b.shelf}</span>
      </div>
    `).join('')

    resultsEl.querySelectorAll('.shelf-search-result').forEach((row, i) => {
      row.addEventListener('click', async () => {
        try {
          const bookData = await getBook(hits[i].id)
          openBookDetail({ ...hits[i], ...bookData }, hits[i].shelf, null)
        } catch {
          openBookDetail(hits[i], hits[i].shelf, null)
        }
      })
    })
  })

  // Expand/collapse button for Read
  container.querySelector('#expand-read-btn')?.addEventListener('click', () => {
    expandedState.read = !expandedState.read
    renderReadSection(container, latestReadBooks)
  })

  const unsubscribers = []
  SHELVES.forEach(shelf => {
    const unsub = watchShelf(shelf.id, books => {
      allShelfBooks[shelf.id] = books
      if (shelf.id === 'read') {
        latestReadBooks = books
        renderReadSection(container, books)
      } else {
        renderShelfBooks(container, shelf, books)
      }
    })
    unsubscribers.push(unsub)
  })

  return () => unsubscribers.forEach(u => u())
}

// ── Render a normal shelf ────────────────────────────────────────────────────

function renderShelfBooks(container, shelf, books) {
  const scrollEl = container.querySelector(`#scroll-${shelf.id}`)
  const countEl  = container.querySelector(`#count-${shelf.id}`)
  if (!scrollEl) return

  countEl.textContent = books.length ? `${books.length}` : ''

  if (!books.length) {
    scrollEl.innerHTML = `
      <div class="shelf-empty">
        No books here yet —
        <button class="btn btn-text" style="padding:0 4px;font-size:0.875rem;" data-goto="search">
          search to add one
        </button>
      </div>
    `
    scrollEl.querySelector('[data-goto]')?.addEventListener('click', () => navigateTo('search'))
    return
  }

  scrollEl.innerHTML = books.map(book => bookCardHTML(book, shelf.id)).join('')
  attachCardListeners(scrollEl, books, shelf.id)
}

// ── Render the Read shelf (normal or expanded) ───────────────────────────────

function renderReadSection(container, books) {
  const countEl  = container.querySelector('#count-read')
  const expandBtn = container.querySelector('#expand-read-btn')
  const bodyEl   = container.querySelector('#shelf-body-read')
  if (!bodyEl) return

  if (countEl) countEl.textContent = books.length ? `${books.length}` : ''

  if (expandBtn) {
    expandBtn.innerHTML = expandedState.read
      ? `<span class="material-symbols-rounded" style="font-size:18px">expand_less</span> Collapse`
      : `<span class="material-symbols-rounded" style="font-size:18px">expand_more</span> View all`
  }

  if (!books.length) {
    bodyEl.innerHTML = `
      <div class="shelf-scroll">
        <div class="shelf-empty">
          No books here yet —
          <button class="btn btn-text" style="padding:0 4px;font-size:0.875rem;" data-goto="search">
            search to add one
          </button>
        </div>
      </div>
    `
    bodyEl.querySelector('[data-goto]')?.addEventListener('click', () => navigateTo('search'))
    return
  }

  if (!expandedState.read) {
    // Normal: horizontal scroll of recent books
    bodyEl.innerHTML = `
      <div class="shelf-scroll" id="scroll-read">
        ${books.map(book => bookCardHTML(book, 'read')).join('')}
      </div>
    `
    attachCardListeners(bodyEl.querySelector('#scroll-read'), books, 'read')
  } else {
    // Expanded: grouped by Month/Year grid — paginated by month
    visibleMonths = MONTHS_PER_PAGE
    renderExpandedRead(bodyEl, books)
  }
}

function renderExpandedRead(bodyEl, books) {
  const groups = groupByMonth(books)
  const visible = groups.slice(0, visibleMonths)
  const hasMore = groups.length > visibleMonths

  bodyEl.innerHTML = `
    <div class="read-expanded">
      ${visible.map(({ label, books: groupBooks }) => `
        <div class="month-group">
          <div class="month-group-title">${label}</div>
          <div class="book-grid">
            ${groupBooks.map(b => bookCardHTML(b, 'read')).join('')}
          </div>
        </div>
      `).join('')}
      ${hasMore ? `
        <button class="btn btn-tonal load-more-btn" style="width:100%;height:48px;margin-top:8px;">
          <span class="material-symbols-rounded">expand_more</span>
          Load older months (${groups.length - visibleMonths} more)
        </button>
      ` : ''}
    </div>
  `

  const allVisible = visible.flatMap(g => g.books)
  bodyEl.querySelectorAll('.book-card').forEach((card, i) => {
    card.addEventListener('click', async () => {
      try {
        const bookData = await getBook(allVisible[i].id)
        openBookDetail({ ...allVisible[i], ...bookData }, 'read', null)
      } catch {
        openBookDetail(allVisible[i], 'read', null)
      }
    })
  })

  bodyEl.querySelector('.load-more-btn')?.addEventListener('click', () => {
    visibleMonths += MONTHS_PER_PAGE
    renderExpandedRead(bodyEl, books)
  })
}

function groupByMonth(books) {
  const map = new Map()
  books.forEach(book => {
    const d = book.dateCompleted
    const key = d
      ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : 'Unknown'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(book)
  })
  return Array.from(map.entries()).map(([label, books]) => ({ label, books }))
}

// Returns books in the same order they appear in the grouped view
function groupedToFlat(books) {
  return groupByMonth(books).flatMap(g => g.books)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function attachCardListeners(container, books, shelfId) {
  container.querySelectorAll('.book-card').forEach((card, i) => {
    card.addEventListener('click', async () => {
      try {
        const bookData = await getBook(books[i].id)
        openBookDetail({ ...books[i], ...bookData }, shelfId, null)
      } catch {
        openBookDetail(books[i], shelfId, null)
      }
    })
  })
}

function bookCardHTML(book, shelf) {
  const coverHTML = book.thumbnail
    ? `<img src="${book.thumbnail}" alt="${book.title}" loading="lazy" />`
    : `<div class="book-cover-placeholder">
         <span class="material-symbols-rounded">menu_book</span>
         <div class="placeholder-title">${book.title}</div>
       </div>`

  const progressHTML = shelf === 'reading' && book.pageCount > 0
    ? `<div class="book-progress">
         <div class="book-progress-fill" style="width:${Math.round((book.progress / book.pageCount) * 100)}%"></div>
       </div>`
    : ''

  const botmBadge = book.isBOTM
    ? `<div class="botm-badge"><span class="material-symbols-rounded">auto_awesome</span></div>`
    : ''

  return `
    <div class="book-card">
      <div class="book-cover">
        ${coverHTML}
        ${botmBadge}
      </div>
      <div class="book-card-info">
        <div class="book-card-title">${book.title}</div>
        <div class="book-card-author">${book.author}</div>
        ${progressHTML}
      </div>
    </div>
  `
}

function skeletonCards(n) {
  return Array.from({ length: n }, () => `
    <div class="book-card">
      <div class="book-cover skeleton"></div>
      <div style="padding:8px 4px;display:flex;flex-direction:column;gap:6px;">
        <div class="skeleton" style="height:12px;border-radius:6px;width:90%"></div>
        <div class="skeleton" style="height:10px;border-radius:6px;width:60%"></div>
      </div>
    </div>
  `).join('')}

export function destroyShelves() {}
