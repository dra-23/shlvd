import { watchShelf, getBook } from '../db.js'
import { openBookDetail } from './book-detail.js'
import { navigateTo } from '../main.js'

const SHELVES = [
  { id: 'reading', label: 'Reading' },
  { id: 'want',    label: 'TBR'     },
  { id: 'read',    label: 'Read'    },
  { id: 'dnf',     label: 'DNF'     },
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

const allShelfBooks  = { reading: [], want: [], read: [], dnf: [] }
const SHELF_BADGE    = { reading: 'Reading', want: 'TBR', read: 'Read', dnf: 'DNF' }
let expandedRead     = false
let latestReadBooks  = []
const MONTHS_PER_PAGE = 6
let visibleMonths     = MONTHS_PER_PAGE
const expandedSeries  = new Set()

export function renderShelves(container) {
  container.innerHTML = `
    <div class="shelves-root">

      <div class="shelves-top">
        <img src="/icons/logo2-512.png" class="shelves-logo" alt="shlvd" />
        <div class="search-bar shelves-search-bar">
          <span class="material-symbols-rounded">search</span>
          <input class="search-input" id="shelf-search-input" type="text"
            placeholder="Search your library…" autocomplete="off" />
          <button class="icon-btn" id="shelf-search-clear" style="display:none;">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
      </div>

      <div id="shelf-search-results" style="display:none;flex:1;overflow-y:auto;"></div>

      <div id="shelves-content" style="flex:1;overflow-y:auto;padding:12px 0 24px;">

        <!-- Reading -->
        <div class="shelf-section">
          <div class="shelf-header">
            <span class="shelf-title">Reading</span>
            <span class="shelf-count" id="count-reading"></span>
          </div>
          <div class="shelf-scroll" id="scroll-reading">${skeletonCards(3)}</div>
        </div>

        <!-- TBR -->
        <div class="shelf-section">
          <div class="shelf-header">
            <span class="shelf-title">TBR</span>
            <span class="shelf-count" id="count-want"></span>
          </div>
          <div class="shelf-scroll" id="scroll-want">${skeletonCards(3)}</div>
        </div>

        <!-- Read -->
        <div class="shelf-section" id="shelf-read-section">
          <div class="shelf-header">
            <span class="shelf-title">Read</span>
            <span class="shelf-count" id="count-read"></span>
            <button class="btn btn-text expand-read-btn" id="expand-read-btn">
              <span class="material-symbols-rounded" style="font-size:18px">expand_more</span>
              View all
            </button>
          </div>
          <div id="shelf-body-read">
            <div class="shelf-scroll" id="scroll-read">${skeletonCards(3)}</div>
          </div>
        </div>

        <!-- Expanded read months render here, outside the card -->
        <div id="shelf-read-expanded"></div>

        <!-- DNF -->
        <div class="shelf-section">
          <div class="shelf-header">
            <span class="shelf-title">DNF</span>
            <span class="shelf-count" id="count-dnf"></span>
          </div>
          <div class="shelf-scroll" id="scroll-dnf">${skeletonCards(3)}</div>
        </div>

        <!-- Series -->
        <div class="shelf-section" id="shelf-series-section">
          <div class="shelf-header">
            <span class="shelf-title">Series</span>
            <span class="shelf-count" id="count-series"></span>
          </div>
          <div id="series-list"></div>
        </div>

      </div>
    </div>
  `

  // ── Search ────────────────────────────────────────────
  const searchInput = container.querySelector('#shelf-search-input')
  const clearBtn    = container.querySelector('#shelf-search-clear')
  const resultsEl   = container.querySelector('#shelf-search-results')
  const contentEl   = container.querySelector('#shelves-content')

  const hideResults = () => {
    resultsEl.style.display = 'none'
    resultsEl.innerHTML = ''
    contentEl.style.display = 'block'
    clearBtn.style.display = 'none'
    searchInput.value = ''
  }

  clearBtn.addEventListener('click', () => { hideResults(); searchInput.focus() })

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase()
    clearBtn.style.display = q ? 'flex' : 'none'
    if (!q) { hideResults(); return }

    resultsEl.style.display = 'block'
    contentEl.style.display = 'none'

    const all = [...allShelfBooks.reading, ...allShelfBooks.want, ...allShelfBooks.read, ...allShelfBooks.dnf]
    const hits = all.filter(b =>
      b.title.toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q)
    )

    if (!hits.length) {
      resultsEl.innerHTML = `<div class="empty-state">
        <span class="material-symbols-rounded">search_off</span>
        <div class="empty-state-title">No matches</div>
      </div>`
      return
    }

    resultsEl.innerHTML = hits.map(b => `
      <div class="search-result shelf-search-result" data-id="${b.id}">
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

  // ── Read expand/collapse ──────────────────────────────
  container.querySelector('#expand-read-btn').addEventListener('click', () => {
    expandedRead = !expandedRead
    renderReadSection(container, latestReadBooks)
  })

  // ── Watch shelves ─────────────────────────────────────
  const unsubscribers = SHELVES.map(shelf =>
    watchShelf(shelf.id, books => {
      allShelfBooks[shelf.id] = books
      if (shelf.id === 'read') {
        latestReadBooks = books
        renderReadSection(container, books)
      } else {
        renderShelfScroll(container, shelf.id, books)
      }
      renderSeriesSection(container)
    })
  )

  return () => unsubscribers.forEach(u => u())
}

// ── Horizontal scroll shelf (Reading / TBR / DNF) ────────────────────────────

function renderShelfScroll(container, shelfId, books) {
  const scrollEl = container.querySelector(`#scroll-${shelfId}`)
  const countEl  = container.querySelector(`#count-${shelfId}`)
  if (!scrollEl) return

  countEl.textContent = books.length || ''

  if (!books.length) {
    scrollEl.innerHTML = `
      <div class="shelf-empty">
        No books here yet —
        <button class="btn btn-text" style="padding:0 4px;font-size:0.875rem;" data-goto="search">
          search to add one
        </button>
      </div>`
    scrollEl.querySelector('[data-goto]')?.addEventListener('click', () => navigateTo('search'))
    return
  }

  scrollEl.innerHTML = books.map(b => bookCardHTML(b, shelfId)).join('')
  attachCardListeners(scrollEl, books, shelfId)
}

// ── Read shelf — collapsed (scroll) or expanded (month grid) ─────────────────

function renderReadSection(container, books) {
  const countEl    = container.querySelector('#count-read')
  const expandBtn  = container.querySelector('#expand-read-btn')
  const bodyEl     = container.querySelector('#shelf-body-read')
  const expandedEl = container.querySelector('#shelf-read-expanded')
  if (!bodyEl || !expandedEl) return

  // Sort by most recently completed first; books without a date go to the end
  const sorted = [...books].sort((a, b) => {
    const da = a.dateCompleted ? new Date(a.dateCompleted).getTime() : 0
    const db = b.dateCompleted ? new Date(b.dateCompleted).getTime() : 0
    return db - da
  })

  if (countEl) countEl.textContent = sorted.length || ''
  if (expandBtn) {
    expandBtn.innerHTML = expandedRead
      ? `<span class="material-symbols-rounded" style="font-size:18px">expand_less</span> Collapse`
      : `<span class="material-symbols-rounded" style="font-size:18px">expand_more</span> View all`
  }

  if (!sorted.length) {
    bodyEl.innerHTML = `<div class="shelf-scroll"><div class="shelf-empty">
      No books here yet —
      <button class="btn btn-text" style="padding:0 4px;font-size:0.875rem;" data-goto="search">search to add one</button>
    </div></div>`
    bodyEl.querySelector('[data-goto]')?.addEventListener('click', () => navigateTo('search'))
    expandedEl.innerHTML = ''
    return
  }

  if (!expandedRead) {
    bodyEl.style.display = 'block'
    bodyEl.innerHTML = `<div class="shelf-scroll" id="scroll-read">
      ${sorted.map(b => bookCardHTML(b, 'read')).join('')}
    </div>`
    attachCardListeners(bodyEl.querySelector('#scroll-read'), sorted, 'read')
    expandedEl.innerHTML = ''
  } else {
    bodyEl.style.display = 'none'
    visibleMonths = MONTHS_PER_PAGE
    renderReadMonths(expandedEl, sorted)
  }
}

// Month groups render OUTSIDE the shelf card so sticky headers work cleanly
function renderReadMonths(expandedEl, books) {
  const groups  = groupByMonth(books)
  const visible = groups.slice(0, visibleMonths)
  const hasMore = groups.length > visibleMonths

  expandedEl.innerHTML = `
    ${visible.map(({ label, books: gb }) => `
      <div class="month-sticky-label">${label}</div>
      <div class="shelf-section" style="margin-top:0;">
        <div class="book-grid" style="padding:12px 8px 4px;">
          ${gb.map(b => bookCardHTML(b, 'read')).join('')}
        </div>
      </div>
    `).join('')}
    ${hasMore ? `
      <button class="btn btn-tonal load-more-btn"
        style="width:calc(100% - 32px);margin:8px 16px 4px;height:48px;">
        <span class="material-symbols-rounded">expand_more</span>
        Load older months (${groups.length - visibleMonths} more)
      </button>` : ''}
  `

  const allVisible = visible.flatMap(g => g.books)
  expandedEl.querySelectorAll('.book-card').forEach((card, i) => {
    card.addEventListener('click', async () => {
      try {
        const bookData = await getBook(allVisible[i].id)
        openBookDetail({ ...allVisible[i], ...bookData }, 'read', null)
      } catch {
        openBookDetail(allVisible[i], 'read', null)
      }
    })
  })

  expandedEl.querySelector('.load-more-btn')?.addEventListener('click', () => {
    visibleMonths += MONTHS_PER_PAGE
    renderReadMonths(expandedEl, books)
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupByMonth(books) {
  const map = new Map()
  books.forEach(book => {
    const d = book.dateCompleted
    const key = d ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'Unknown'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(book)
  })
  return Array.from(map.entries()).map(([label, books]) => ({ label, books }))
}

function attachCardListeners(el, books, shelfId) {
  el.querySelectorAll('.book-card').forEach((card, i) => {
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
    ? `<img src="${book.thumbnail}" alt="${book.title}" loading="lazy"
           data-book-id="${book.id}"
           data-title="${book.title.replace(/"/g, '&quot;')}"
           data-author="${(book.author || '').replace(/"/g, '&quot;')}" />`
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
    ? `<div class="botm-badge"><span class="material-symbols-rounded">workspace_premium</span></div>`
    : ''

  const botyBadge = book.isBOTY
    ? `<div class="boty-badge"><span class="material-symbols-rounded">emoji_events</span></div>`
    : ''

  return `
    <div class="book-card">
      <div class="book-cover">${coverHTML}${botmBadge}${botyBadge}</div>
      <div class="book-card-info">
        <div class="book-card-title">${book.title}</div>
        <div class="book-card-author">${book.author}</div>
        ${book.rating > 0 ? `<div class="book-card-rating">${'★'.repeat(book.rating)}${'☆'.repeat(5 - book.rating)}</div>` : ''}
        ${progressHTML}
      </div>
    </div>`
}

// ── Series section ────────────────────────────────────────────────────────────

function renderSeriesSection(container) {
  const listEl  = container.querySelector('#series-list')
  const countEl = container.querySelector('#count-series')
  if (!listEl) return

  const allBooks = [
    ...allShelfBooks.reading,
    ...allShelfBooks.want,
    ...allShelfBooks.read,
    ...allShelfBooks.dnf,
  ].filter(b => b.series)

  // Group by series name
  const map = new Map()
  allBooks.forEach(b => {
    if (!map.has(b.series)) map.set(b.series, [])
    map.get(b.series).push(b)
  })

  if (countEl) countEl.textContent = map.size || ''

  if (!map.size) {
    listEl.innerHTML = `<div class="shelf-empty" style="padding:12px 16px;">
      No series yet — add a series name when editing a book.
    </div>`
    return
  }

  // Sort series alphabetically
  const series = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))

  listEl.innerHTML = series.map(([name, books]) => seriesCardHTML(name, books)).join('')

  // Wire expand buttons
  listEl.querySelectorAll('.series-expand-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      const name    = btn.dataset.series
      const card    = btn.closest('.series-card')
      const bookList = card.querySelector('.series-book-list')
      const icon    = btn.querySelector('.material-symbols-rounded')
      if (expandedSeries.has(name)) {
        expandedSeries.delete(name)
        bookList.style.display = 'none'
        icon.textContent = 'expand_more'
      } else {
        expandedSeries.add(name)
        bookList.style.display = 'block'
        icon.textContent = 'expand_less'
      }
    })
  })

  // Wire book taps in expanded list
  listEl.querySelectorAll('.series-book-row').forEach(row => {
    row.addEventListener('click', async () => {
      const id = row.dataset.id
      const book = allBooks.find(b => b.id === id)
      if (!book) return
      try {
        const full = await getBook(id)
        openBookDetail({ ...book, ...full }, book.shelf, () => renderSeriesSection(container))
      } catch {
        openBookDetail(book, book.shelf, () => renderSeriesSection(container))
      }
    })
  })
}

function seriesCardHTML(name, books) {
  // Sort books by series number (numeric)
  const sorted = [...books].sort((a, b) => {
    const na = parseFloat(a.seriesNumber) || 0
    const nb = parseFloat(b.seriesNumber) || 0
    return na - nb
  })

  const readCount = sorted.filter(b => b.shelf === 'read').length
  const total     = sorted.length
  const pct       = total ? Math.round((readCount / total) * 100) : 0

  const nextBook = sorted.find(b => b.shelf !== 'read')
  const nextLabel = nextBook
    ? `${nextBook.seriesNumber ? `#${nextBook.seriesNumber} · ` : ''}${nextBook.title}`
    : 'All read!'

  const isExpanded = expandedSeries.has(name)

  const bookRows = sorted.map(b => {
    const badge = SHELF_BADGE[b.shelf] || b.shelf
    const badgeClass = b.shelf === 'read' ? 'series-badge-read' : 'series-badge-other'
    return `
      <div class="series-book-row" data-id="${b.id}">
        <div class="series-book-cover">
          ${b.thumbnail ? `<img src="${b.thumbnail}" alt="${b.title}" loading="lazy" />` : ''}
        </div>
        <div class="series-book-info">
          ${b.seriesNumber ? `<span class="series-book-num">#${b.seriesNumber}</span>` : ''}
          <span class="series-book-title">${b.title}</span>
        </div>
        <span class="series-book-badge ${badgeClass}">${badge}</span>
      </div>`
  }).join('')

  return `
    <div class="series-card">
      <div class="series-card-header">
        <div class="series-card-info">
          <div class="series-card-name">${name}</div>
          <div class="series-card-count">${readCount} of ${total} read</div>
        </div>
        <button class="icon-btn series-expand-btn" data-series="${name}">
          <span class="material-symbols-rounded">${isExpanded ? 'expand_less' : 'expand_more'}</span>
        </button>
      </div>
      <div class="series-progress-bar">
        <div class="series-progress-fill" style="width:${pct}%"></div>
      </div>
      ${nextBook ? `
      <div class="series-next">
        <span class="material-symbols-rounded">auto_stories</span>
        ${nextLabel}
      </div>` : `
      <div class="series-next series-next-done">
        <span class="material-symbols-rounded">check_circle</span>
        All books read!
      </div>`}
      <div class="series-book-list" style="display:${isExpanded ? 'block' : 'none'}">
        ${bookRows}
      </div>
    </div>`
}

function skeletonCards(n) {
  return Array.from({ length: n }, () => `
    <div class="book-card">
      <div class="book-cover skeleton"></div>
      <div style="padding:8px 4px;display:flex;flex-direction:column;gap:6px;">
        <div class="skeleton" style="height:12px;border-radius:6px;width:90%"></div>
        <div class="skeleton" style="height:10px;border-radius:6px;width:60%"></div>
      </div>
    </div>`).join('')
}

export function destroyShelves() {}
