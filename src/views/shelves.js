import { watchShelf, getBook } from '../db.js'
import { openBookDetail } from './book-detail.js'
import { navigateTo } from '../main.js'

const TABS = [
  { id: 'want',    label: 'Queued',  icon: 'bookmark'           },
  { id: 'reading', label: 'Reading', icon: 'chrome_reader_mode' },
  { id: 'read',    label: 'Read',    icon: 'done_all'           },
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

// Module-level state
let activeTab = 'reading'
const allShelfBooks = { reading: [], want: [], read: [] }
const SHELF_BADGE   = { reading: 'Reading', want: 'Queued', read: 'Read' }

// Read-tab pagination
const MONTHS_PER_PAGE = 6
let visibleMonths = MONTHS_PER_PAGE

export function renderShelves(container) {
  container.innerHTML = `
    <div class="shelves-root">
      <div class="shelves-top">
        <div class="shelves-title-row">
          <span class="top-bar-title">shlvd</span>
        </div>
        <div class="search-bar shelves-search-bar">
          <span class="material-symbols-rounded">search</span>
          <input class="search-input" id="shelf-search-input" type="search"
            placeholder="Search your library…" autocomplete="off" />
          <button class="icon-btn shelf-search-clear" id="shelf-search-clear" style="display:none;">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
      </div>
      <div id="shelf-search-results" style="display:none;flex:1;overflow-y:auto;"></div>

      <!-- Tab bar -->
      <div class="shelf-tab-bar" id="shelf-tab-bar">
        ${TABS.map(t => `
          <button class="shelf-tab ${t.id === activeTab ? 'active' : ''}" data-tab="${t.id}">
            ${t.label}
          </button>
        `).join('')}
      </div>
      <div class="shelf-tab-indicator-track">
        <div class="shelf-tab-indicator" id="shelf-tab-indicator"></div>
      </div>

      <!-- Tab panels -->
      <div id="shelves-content">
        ${TABS.map(t => `
          <div class="shelf-panel ${t.id === activeTab ? 'active' : ''}" id="panel-${t.id}">
            <div class="book-grid panel-grid" id="grid-${t.id}">
              ${skeletonCards(6)}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `

  // ── Tab switching ─────────────────────────────────────
  const tabBar   = container.querySelector('#shelf-tab-bar')
  const indicator = container.querySelector('#shelf-tab-indicator')

  function setActiveTab(id) {
    activeTab = id
    tabBar.querySelectorAll('.shelf-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === id)
    })
    container.querySelectorAll('.shelf-panel').forEach(p => {
      p.classList.toggle('active', p.id === `panel-${id}`)
    })
    positionIndicator()
  }

  function positionIndicator() {
    const activeBtn = tabBar.querySelector('.shelf-tab.active')
    if (!activeBtn || !indicator) return
    indicator.style.left = `${activeBtn.offsetLeft + activeBtn.offsetWidth / 2}px`
  }

  tabBar.querySelectorAll('.shelf-tab').forEach(btn => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab))
  })

  // Position indicator after layout
  requestAnimationFrame(positionIndicator)

  // ── Swipe between tabs ────────────────────────────────
  const swipeEl = container.querySelector('#shelves-content')
  let touchStartX = 0
  let touchStartY = 0

  swipeEl.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX
    touchStartY = e.touches[0].clientY
  }, { passive: true })

  swipeEl.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX
    const dy = e.changedTouches[0].clientY - touchStartY
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    const tabIds = TABS.map(t => t.id)
    const cur = tabIds.indexOf(activeTab)
    if (dx < 0 && cur < tabIds.length - 1) setActiveTab(tabIds[cur + 1])
    if (dx > 0 && cur > 0) setActiveTab(tabIds[cur - 1])
  }, { passive: true })

  // ── Shelf search ──────────────────────────────────────
  const searchInput = container.querySelector('#shelf-search-input')
  const clearBtn    = container.querySelector('#shelf-search-clear')
  const resultsEl   = container.querySelector('#shelf-search-results')
  const contentEl   = container.querySelector('#shelves-content')
  const tabBarEl    = container.querySelector('#shelf-tab-bar')
  const indicatorEl = container.querySelector('.shelf-tab-indicator-track')

  clearBtn.addEventListener('click', () => {
    searchInput.value = ''
    clearBtn.style.display = 'none'
    resultsEl.style.display = 'none'
    resultsEl.innerHTML = ''
    contentEl.style.display = 'block'
    tabBarEl.style.display = 'flex'
    indicatorEl.style.display = 'block'
    searchInput.focus()
  })

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase()
    clearBtn.style.display = q ? 'flex' : 'none'
    if (!q) {
      resultsEl.style.display = 'none'
      resultsEl.innerHTML = ''
      contentEl.style.display = 'block'
      tabBarEl.style.display = 'flex'
      indicatorEl.style.display = 'block'
      return
    }
    resultsEl.style.display = 'block'
    contentEl.style.display = 'none'
    tabBarEl.style.display = 'none'
    indicatorEl.style.display = 'none'
    const all = [...allShelfBooks.reading, ...allShelfBooks.want, ...allShelfBooks.read]
    const hits = all.filter(b =>
      b.title.toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q)
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

  // ── Watch shelves ─────────────────────────────────────
  const unsubscribers = []
  TABS.forEach(tab => {
    const unsub = watchShelf(tab.id, books => {
      allShelfBooks[tab.id] = books
      if (tab.id === 'read') {
        renderReadGrid(container, books)
      } else {
        renderGrid(container, tab.id, books)
      }
    })
    unsubscribers.push(unsub)
  })

  return () => unsubscribers.forEach(u => u())
}

// ── Render a standard shelf grid ─────────────────────────────────────────────

function renderGrid(container, shelfId, books) {
  const gridEl = container.querySelector(`#grid-${shelfId}`)
  if (!gridEl) return

  if (!books.length) {
    gridEl.innerHTML = `
      <div class="shelf-empty" style="width:100%;padding:32px 0;">
        No books here yet —
        <button class="btn btn-text" style="padding:0 4px;font-size:0.875rem;" data-goto="search">
          search to add one
        </button>
      </div>
    `
    gridEl.querySelector('[data-goto]')?.addEventListener('click', () => navigateTo('search'))
    return
  }

  gridEl.innerHTML = books.map(book => bookCardHTML(book, shelfId)).join('')
  attachCardListeners(gridEl, books, shelfId)
}

// ── Render the Read shelf (month-grouped, paginated) ──────────────────────────

function renderReadGrid(container, books) {
  const panelEl = container.querySelector('#panel-read')
  if (!panelEl) return

  if (!books.length) {
    panelEl.innerHTML = `
      <div class="shelf-empty" style="width:100%;padding:32px 16px;">
        No books here yet —
        <button class="btn btn-text" style="padding:0 4px;font-size:0.875rem;" data-goto="search">
          search to add one
        </button>
      </div>
    `
    panelEl.querySelector('[data-goto]')?.addEventListener('click', () => navigateTo('search'))
    return
  }

  visibleMonths = MONTHS_PER_PAGE
  renderReadMonths(panelEl, books)
}

function renderReadMonths(panelEl, books) {
  const groups  = groupByMonth(books)
  const visible = groups.slice(0, visibleMonths)
  const hasMore = groups.length > visibleMonths

  panelEl.innerHTML = `
    <div style="padding:0 16px 24px;">
      ${visible.map(({ label, books: gb }) => `
        <div class="month-group">
          <div class="month-group-title">${label}</div>
          <div class="book-grid">
            ${gb.map(b => bookCardHTML(b, 'read')).join('')}
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
  panelEl.querySelectorAll('.book-card').forEach((card, i) => {
    card.addEventListener('click', async () => {
      try {
        const bookData = await getBook(allVisible[i].id)
        openBookDetail({ ...allVisible[i], ...bookData }, 'read', null)
      } catch {
        openBookDetail(allVisible[i], 'read', null)
      }
    })
  })

  panelEl.querySelector('.load-more-btn')?.addEventListener('click', () => {
    visibleMonths += MONTHS_PER_PAGE
    renderReadMonths(panelEl, books)
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function attachCardListeners(gridEl, books, shelfId) {
  gridEl.querySelectorAll('.book-card').forEach((card, i) => {
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
  `).join('')
}

export function destroyShelves() {}
