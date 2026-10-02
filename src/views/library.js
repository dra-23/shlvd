import { esc } from '../escape.js'
import { watchAllBooks } from '../db.js'
import { openBookDetail } from './book-detail.js'
import { navigateTo } from '../main.js'
import { avatarButtonHTML, wireTopBar } from './topbar.js'
import { openSheet } from './sheet.js'
import { bookCardHTML, coverImgHTML, groupSeries, SHELF_BADGE } from './shelves.js'
import { openManageGenres } from './manage-genres.js'

// Library tab ("Shlvd"): every book, with shelf chips, sort, filters and a
// grid/list toggle, plus a Series view. The last view is remembered per device.

const STATE_KEY = 'shlvd-library'
const NO_FILTERS = { genres: [], minRating: 0, years: [], series: 'any' }
const DEFAULT_STATE = {
  segment: 'books', shelf: 'all', sort: 'finished', layout: 'grid',
  filters: NO_FILTERS, seriesFilter: 'all',
}
const PAGE = 60 // books rendered per chunk as you scroll

const SHELVES = [['all', 'All'], ['reading', 'Reading'], ['want', 'TBR'], ['read', 'Read'], ['dnf', 'DNF']]

const monthLabel = d => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
const time = d => d?.getTime?.() ?? 0
// "The Unknown" sorts under U, "’Salem’s Lot" under S
const sortTitle = b => b.title.replace(/^[^\p{L}\p{N}]+/u, '').replace(/^(the|a|an)\s+/i, '')
const initial = s => /^[a-z]/i.test(s) ? s[0].toUpperCase() : '#'
// Number-aware, so "1st to Die" comes before "10th Anniversary"
const collate = (x, y) => x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' })
const yearOf = b => Number(String(b.dateReleased).match(/\d{4}/)?.[0]) || 0

const SORTS = {
  finished:  { label: 'Date finished', cmp: (a, b) => time(b.dateCompleted) - time(a.dateCompleted),
               group: b => b.dateCompleted ? monthLabel(b.dateCompleted) : 'Not finished' },
  added:     { label: 'Date added', cmp: (a, b) => time(b.addedAt) - time(a.addedAt),
               group: b => b.addedAt ? monthLabel(b.addedAt) : 'Unknown' },
  title:     { label: 'Title', cmp: (a, b) => collate(sortTitle(a), sortTitle(b)),
               group: b => initial(sortTitle(b)) },
  author:    { label: 'Author', cmp: (a, b) => collate(a.author, b.author) || collate(sortTitle(a), sortTitle(b)),
               group: b => initial(b.author) },
  rating:    { label: 'Rating', cmp: (a, b) => (b.rating || 0) - (a.rating || 0) || time(b.dateCompleted) - time(a.dateCompleted),
               group: b => b.rating ? `${b.rating} star${b.rating > 1 ? 's' : ''}` : 'Unrated' },
  published: { label: 'Published', cmp: (a, b) => yearOf(b) - yearOf(a),
               group: b => yearOf(b) ? String(yearOf(b)) : 'Unknown' },
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY) || '{}')
    return { ...DEFAULT_STATE, ...saved, filters: { ...NO_FILTERS, ...saved.filters } }
  } catch { return { ...DEFAULT_STATE } }
}
function saveState(state) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)) } catch {}
}

// Other tabs open the library pre-filtered ("See all 115" on Home, etc.)
let activeLibrary = null
let pendingPreset = null
export function openLibrary(preset = {}) {
  if (activeLibrary) return activeLibrary.applyPreset(preset)
  pendingPreset = preset
  navigateTo('library')
}

// ── View ──────────────────────────────────────────────────────────────────────

export function renderLibrary(container) {
  let state = loadState()
  let books = []
  let query = ''

  container.innerHTML = `
    <div class="shelves-root">
      <div class="shelves-top">
        <button class="shelves-logo-btn" data-goto-home aria-label="Home"><img src="/icons/logo2-512.png" class="shelves-logo" alt="" /></button>
        <div class="search-bar shelves-search-bar">
          <span class="material-symbols-rounded">search</span>
          <input class="search-input" id="lib-search" type="search" enterkeyhint="search"
            placeholder="Search your library…" autocomplete="off" />
          <button class="icon-btn" id="lib-search-clear" style="display:none" aria-label="Clear search">
            <span class="material-symbols-rounded">close</span>
          </button>
          <button class="lib-filter-icon" id="lib-filters" aria-label="Sort and filter">
            <span class="material-symbols-rounded">tune</span>
            <span class="lib-filter-badge" id="lib-filter-badge" hidden></span>
          </button>
        </div>
        ${avatarButtonHTML()}
      </div>
      <div id="library-content" class="library-content">
        <div class="lib-controls" id="lib-controls"></div>
        <div id="lib-results"><div class="lib-loading">${'<div class="skeleton lib-skel"></div>'.repeat(6)}</div></div>
      </div>
    </div>
  `
  wireTopBar(container)
  const content  = container.querySelector('#library-content')
  const controls = container.querySelector('#lib-controls')
  const results  = container.querySelector('#lib-results')
  const search   = container.querySelector('#lib-search')
  const clearBtn = container.querySelector('#lib-search-clear')
  const filterBtn = container.querySelector('#lib-filters')
  const badge    = container.querySelector('#lib-filter-badge')

  const update = (changes = {}, { keepScroll = false } = {}) => {
    state = { ...state, ...changes }
    saveState(state)
    render(keepScroll)
  }

  // ── Rendering ─────────────────────────────────────────
  let feed = null // progressive renderer for the current book list
  let observer = null

  function render(keepScroll) {
    const prevCount = keepScroll && feed ? feed.rendered : 0
    controls.innerHTML = controlsHTML(state, books)
    // The chip row re-renders scrolled to the start — bring the selected chip into view
    const chipRow = controls.querySelector('.lib-chips')
    const selected = chipRow.querySelector('.selected')
    if (selected) {
      const overflow = selected.offsetLeft + selected.offsetWidth + 16 - chipRow.clientWidth
      if (overflow > 0) chipRow.scrollLeft = overflow
    }
    // Badge = active filters (books) or a non-default series filter
    const n = state.segment === 'series'
      ? (state.seriesFilter !== 'all' ? 1 : 0)
      : activeFilterCount(state.filters)
    badge.hidden = !n
    badge.textContent = n
    filterBtn.classList.toggle('active', !!n)
    if (!keepScroll) content.scrollTop = 0
    if (state.segment === 'series') renderSeries()
    else renderBooks(Math.max(PAGE, prevCount))
  }

  function renderBooks(initialCount) {
    const list = filterBooks(books, state, query).sort(SORTS[state.sort].cmp)
    const countEl = controls.querySelector('#lib-count')
    if (countEl) countEl.textContent = `${list.length} book${list.length === 1 ? '' : 's'}`

    if (!list.length) {
      results.innerHTML = `
        <div class="empty-state" style="padding-top:40px">
          <span class="material-symbols-rounded">search_off</span>
          <div class="empty-state-title">No books match</div>
          <div class="empty-state-body">Try a different search or clear some filters.</div>
        </div>`
      return
    }

    // Group consecutive books by the sort's group label
    const groups = []
    list.forEach(b => {
      const label = SORTS[state.sort].group(b)
      if (groups.at(-1)?.label !== label) groups.push({ label, books: [] })
      groups.at(-1).books.push(b)
    })

    results.innerHTML = ''
    feed = { groups, g: 0, i: 0, rendered: 0, target: null }
    appendBooks(initialCount)
  }

  // Append up to `count` more books, opening new group sections as needed
  function appendBooks(count) {
    const f = feed
    let added = 0
    while (added < count && f.g < f.groups.length) {
      const group = f.groups[f.g]
      if (f.i === 0) {
        results.insertAdjacentHTML('beforeend', `
          <div class="month-sticky-label lib-group-label">
            <span>${esc(group.label)}</span><span class="lib-group-count">${group.books.length}</span>
          </div>
          <div class="${state.layout === 'grid' ? 'book-grid lib-grid' : 'lib-list'}"></div>`)
        f.target = results.lastElementChild
      }
      const slice = group.books.slice(f.i, f.i + (count - added))
      f.target.insertAdjacentHTML('beforeend',
        slice.map(b => state.layout === 'grid' ? bookCardHTML(b) : listRowHTML(b, state.sort)).join(''))
      f.i += slice.length
      added += slice.length
      if (f.i >= group.books.length) { f.g++; f.i = 0 }
    }
    f.rendered += added

    // Sentinel near the end loads the next chunk
    results.querySelector('.lib-sentinel')?.remove()
    observer?.disconnect()
    if (f.g < f.groups.length) {
      results.insertAdjacentHTML('beforeend', '<div class="lib-sentinel"></div>')
      observer = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) appendBooks(PAGE)
      }, { root: content, rootMargin: '600px 0px' })
      observer.observe(results.querySelector('.lib-sentinel'))
    }
  }

  function renderSeries() {
    feed = null
    observer?.disconnect()
    const q = query.toLowerCase()
    const all = groupSeries(books).sort((a, b) => a.name.localeCompare(b.name))
    const list = all
      .filter(s => seriesMatches(s, state.seriesFilter))
      .filter(s => !q || s.name.toLowerCase().includes(q) || s.books.some(b => b.title.toLowerCase().includes(q)))
    const countEl = controls.querySelector('#lib-count')
    if (countEl) countEl.textContent = `${list.length} series`
    results.innerHTML = list.length
      ? `<div class="lib-series-list">${list.map(seriesCardHTML).join('')}</div>`
      : `<div class="empty-state" style="padding-top:40px">
           <span class="material-symbols-rounded">collections_bookmark</span>
           <div class="empty-state-title">${all.length ? 'No series match' : 'No series yet'}</div>
           <div class="empty-state-body">${all.length ? 'Try another filter.' : 'Add a series name when editing a book.'}</div>
         </div>`
  }

  // ── Events ────────────────────────────────────────────
  // The filter icon in the search bar and the sort label share one sheet
  const openSortFilter = () => openSortFilterSheet(books, state, changes => update(changes))
  filterBtn.addEventListener('click', openSortFilter)

  controls.addEventListener('click', e => {
    const t = e.target
    const shelf = t.closest('[data-shelf]')
    if (shelf) {
      return update(shelf.dataset.shelf === 'series'
        ? { segment: 'series' }
        : { segment: 'books', shelf: shelf.dataset.shelf })
    }
    const layout = t.closest('[data-layout]')
    if (layout) return update({ layout: layout.dataset.layout }, { keepScroll: true })
    if (t.closest('#lib-sort-open')) return openSortFilter()
  })

  results.addEventListener('click', e => {
    const expand = e.target.closest('.series-card-header')
    if (expand) {
      const card = expand.closest('.series-card')
      const open = card.classList.toggle('open')
      card.querySelector('.series-expand-btn .material-symbols-rounded').textContent = open ? 'expand_less' : 'expand_more'
      return
    }
    const el = e.target.closest('.book-card, .lib-row, .series-book-row')
    const book = el && books.find(b => b.id === el.dataset.bookId)
    if (book) openBookDetail(book, book.shelf, null)
  })

  let searchTimer = null
  search.addEventListener('input', () => {
    clearBtn.style.display = search.value ? 'flex' : 'none'
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => { query = search.value.trim(); render(false) }, 150)
  })
  clearBtn.addEventListener('click', () => {
    search.value = ''; query = ''; clearBtn.style.display = 'none'; render(false); search.focus()
  })

  // ── Presets from other tabs ───────────────────────────
  function applyPreset(p) {
    const changes = {}
    if (p.segment) changes.segment = p.segment
    if (p.shelf) Object.assign(changes, { segment: 'books', shelf: p.shelf, filters: NO_FILTERS })
    if (p.filters) Object.assign(changes, { segment: 'books', filters: { ...NO_FILTERS, ...p.filters } })
    if (p.sort) changes.sort = p.sort
    if (Object.keys(changes).length) update(changes)
    if (p.focusSearch) requestAnimationFrame(() => search.focus())
  }

  activeLibrary = { applyPreset }
  if (pendingPreset) { applyPreset(pendingPreset); pendingPreset = null }

  const unsub = watchAllBooks(b => {
    const first = !books.length
    books = b
    // A saved genre filter can outlive its genre (renamed or merged) — drop it
    const inUse = new Set(books.map(x => x.genre))
    const genres = state.filters.genres.filter(g => inUse.has(g))
    if (genres.length !== state.filters.genres.length) {
      state = { ...state, filters: { ...state.filters, genres } }
      saveState(state)
    }
    render(!first) // later snapshots (edits) keep your place in the list
  })

  return () => {
    unsub()
    observer?.disconnect()
    clearTimeout(searchTimer)
    activeLibrary = null
  }
}

// ── Filtering ─────────────────────────────────────────────────────────────────

function filterBooks(books, state, query, filters = state.filters) {
  const q = query.toLowerCase()
  return books.filter(b =>
    (state.shelf === 'all' || b.shelf === state.shelf) &&
    (!filters.genres.length || filters.genres.includes(b.genre)) &&
    (!filters.minRating || b.rating >= filters.minRating) &&
    (!filters.years.length || (b.dateCompleted && filters.years.includes(b.dateCompleted.getFullYear()))) &&
    (filters.series === 'any' || (filters.series === 'yes') === !!b.series) &&
    (!q || b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q) || b.series.toLowerCase().includes(q)))
}

const activeFilterCount = f =>
  f.genres.length + f.years.length + (f.minRating ? 1 : 0) + (f.series !== 'any' ? 1 : 0)

function seriesMatches(s, filter) {
  if (filter === 'progress') return s.read > 0 && s.read < s.total
  if (filter === 'unstarted') return s.read === 0
  if (filter === 'complete') return s.read === s.total
  return true
}

// ── Controls ──────────────────────────────────────────────────────────────────

const SERIES_FILTERS = [['all', 'All'], ['progress', 'In progress'], ['unstarted', 'Not started'], ['complete', 'Complete']]

// One chip row (shelves + Series) and a thin "count · sort" line
function controlsHTML(state, books) {
  const isSeries = state.segment === 'series'
  const counts = Object.fromEntries(SHELVES.map(([id]) =>
    [id, id === 'all' ? books.length : books.filter(b => b.shelf === id).length]))
  const seriesCount = groupSeries(books).length

  return `
    <div class="lib-chips">
      ${SHELVES.map(([id, label]) => `
        <button class="chip ${!isSeries && state.shelf === id ? 'selected' : ''}" data-shelf="${id}">
          ${label}${counts[id] ? ` <span class="lib-chip-count">${counts[id]}</span>` : ''}
        </button>`).join('')}
      <button class="chip ${isSeries ? 'selected' : ''}" data-shelf="series">
        Series${seriesCount ? ` <span class="lib-chip-count">${seriesCount}</span>` : ''}
      </button>
    </div>
    <div class="lib-meta">
      <span class="lib-count" id="lib-count"></span>
      ${isSeries
        ? (state.seriesFilter !== 'all' ? `<span class="lib-meta-dot">·</span>
            <button class="lib-sort-open" id="lib-sort-open">${SERIES_FILTERS.find(([id]) => id === state.seriesFilter)[1]}
              <span class="material-symbols-rounded">expand_more</span></button>` : '')
        : `<span class="lib-meta-dot">·</span>
          <button class="lib-sort-open" id="lib-sort-open">${SORTS[state.sort].label}
            <span class="material-symbols-rounded">expand_more</span></button>
          <div class="lib-layout" role="group" aria-label="Layout">
            <button data-layout="grid" class="${state.layout === 'grid' ? 'selected' : ''}" aria-label="Grid">
              <span class="material-symbols-rounded">grid_view</span>
            </button>
            <button data-layout="list" class="${state.layout === 'list' ? 'selected' : ''}" aria-label="List">
              <span class="material-symbols-rounded">view_list</span>
            </button>
          </div>`}
    </div>`
}

// ── Rows / cards ──────────────────────────────────────────────────────────────

function listRowHTML(book, sort) {
  const meta = sort === 'added' && book.addedAt
    ? `Added ${book.addedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : book.dateCompleted
      ? `Finished ${book.dateCompleted.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
      : SHELF_BADGE[book.shelf]
  return `
    <div class="lib-row" data-book-id="${esc(book.id)}" role="button" tabindex="0">
      <div class="lib-row-cover">${coverImgHTML(book)}</div>
      <div class="lib-row-info">
        <span class="lib-row-title">${esc(book.title)}</span>
        <span class="lib-row-author">${esc(book.author)}</span>
        <span class="lib-row-meta">
          ${book.rating ? `<span class="lib-row-stars">${'★'.repeat(book.rating)}</span>` : ''}${esc(meta)}
        </span>
      </div>
      ${book.isBOTM ? `<span class="material-symbols-rounded lib-row-botm">workspace_premium</span>` : ''}
    </div>`
}

function seriesCardHTML(s) {
  const pct = s.total ? Math.round(s.read / s.total * 100) : 0
  return `
    <div class="series-card">
      <div class="series-card-header" role="button" tabindex="0">
        <div class="series-card-info">
          <div class="series-card-name">${esc(s.name)}</div>
          <div class="series-card-count">${s.read} of ${s.total} read</div>
        </div>
        <span class="icon-btn series-expand-btn" aria-hidden="true">
          <span class="material-symbols-rounded">expand_more</span>
        </span>
      </div>
      <div class="series-progress-bar"><div class="series-progress-fill" style="width:${pct}%"></div></div>
      ${s.next ? `
        <div class="series-next"><span class="material-symbols-rounded">auto_stories</span>
          ${s.next.seriesNumber ? `#${esc(s.next.seriesNumber)} · ` : ''}${esc(s.next.title)}</div>`
      : s.read === s.total ? `
        <div class="series-next series-next-done"><span class="material-symbols-rounded">check_circle</span>All books read!</div>` : ''}
      <div class="series-book-list">
        ${s.books.map(b => `
          <div class="series-book-row" data-book-id="${esc(b.id)}" role="button" tabindex="0">
            <div class="series-book-cover">${b.thumbnail ? `<img src="${esc(b.thumbnail)}" alt="" loading="lazy" />` : ''}</div>
            <div class="series-book-info">
              ${b.seriesNumber ? `<span class="series-book-num">#${esc(b.seriesNumber)}</span>` : ''}
              <span class="series-book-title">${esc(b.title)}</span>
            </div>
            <span class="series-book-badge ${b.shelf === 'read' ? 'series-badge-read' : 'series-badge-other'}">${SHELF_BADGE[b.shelf]}</span>
          </div>`).join('')}
      </div>
    </div>`
}

// ── Sort & filter sheet ───────────────────────────────────────────────────────

// Changes apply together when you tap the footer button. For the Series view
// the sheet only offers the series status filter.
function openSortFilterSheet(books, state, onApply) {
  if (state.segment === 'series') return openSeriesFilterSheet(books, state, onApply)

  let sort = state.sort
  let f = structuredClone(state.filters)
  const inShelf = books.filter(b => state.shelf === 'all' || b.shelf === state.shelf)

  const genreCounts = new Map()
  inShelf.forEach(b => { if (b.genre) genreCounts.set(b.genre, (genreCounts.get(b.genre) || 0) + 1) })
  const genres = [...genreCounts.entries()].sort((a, b) => b[1] - a[1])
  const years = [...new Set(inShelf.filter(b => b.dateCompleted).map(b => b.dateCompleted.getFullYear()))].sort((a, b) => b - a)
  const TOP_GENRES = 12

  const { sheet, close } = openSheet(`
    <div class="filter-sheet">
      <div class="filter-sheet-head">
        <h2>Sort and filter</h2>
        <button class="btn btn-text" id="filter-clear">Clear filters</button>
      </div>

      <div class="filter-group">
        <div class="bd-label">Sort by</div>
        <div class="chips" data-group="sort">
          ${Object.entries(SORTS).map(([id, s]) => `<button class="chip" data-value="${id}">${s.label}</button>`).join('')}
        </div>
      </div>

      <div class="filter-group">
        <div class="bd-label">Rating</div>
        <div class="chips" data-group="rating">
          ${[[0, 'Any'], [3, '3+ stars'], [4, '4+ stars'], [5, '5 stars']].map(([v, l]) =>
            `<button class="chip" data-value="${v}">${l}</button>`).join('')}
        </div>
      </div>

      ${years.length ? `
      <div class="filter-group">
        <div class="bd-label">Year read</div>
        <div class="chips" data-group="years">
          ${years.map(y => `<button class="chip" data-value="${y}">${y}</button>`).join('')}
        </div>
      </div>` : ''}

      <div class="filter-group">
        <div class="bd-label">Series</div>
        <div class="chips" data-group="series">
          ${[['any', 'Any'], ['yes', 'In a series'], ['no', 'Standalone']].map(([v, l]) =>
            `<button class="chip" data-value="${v}">${l}</button>`).join('')}
        </div>
      </div>

      ${genres.length ? `
      <div class="filter-group">
        <div class="filter-group-head">
          <div class="bd-label">Genre</div>
          <button class="btn btn-text filter-manage" id="filter-manage-genres">Manage genres</button>
        </div>
        <div class="chips filter-genres" data-group="genres">
          ${genres.map(([g, n], i) => `<button class="chip ${i >= TOP_GENRES ? 'filter-extra' : ''}" data-value="${esc(g)}">
            ${esc(g)} <span class="lib-chip-count">${n}</span></button>`).join('')}
        </div>
        ${genres.length > TOP_GENRES ? `<button class="btn btn-text filter-more" id="filter-more">Show all ${genres.length} genres</button>` : ''}
      </div>` : ''}
    </div>
    <div class="bd-footer">
      <button class="btn btn-filled" id="filter-apply"></button>
    </div>
  `, { className: 'filter-sheet-wrap' })

  const sync = () => {
    sheet.querySelectorAll('[data-group]').forEach(group => {
      const key = group.dataset.group
      group.querySelectorAll('.chip').forEach(chip => {
        const v = chip.dataset.value
        const on = key === 'sort' ? v === sort
          : key === 'rating' ? Number(v) === f.minRating
          : key === 'series' ? v === f.series
          : key === 'years' ? f.years.includes(Number(v))
          : f.genres.includes(v)
        chip.classList.toggle('selected', on)
      })
    })
    sheet.querySelector('#filter-clear').disabled = !activeFilterCount(f)
    const n = filterBooks(books, state, '', f).length
    sheet.querySelector('#filter-apply').textContent = `Show ${n} book${n === 1 ? '' : 's'}`
  }
  sync()

  sheet.addEventListener('click', e => {
    const chip = e.target.closest('[data-group] .chip')
    if (chip) {
      const key = chip.closest('[data-group]').dataset.group
      const v = chip.dataset.value
      if (key === 'sort') sort = v
      if (key === 'rating') f.minRating = Number(v)
      if (key === 'series') f.series = v
      if (key === 'years') {
        const y = Number(v)
        f.years = f.years.includes(y) ? f.years.filter(x => x !== y) : [...f.years, y]
      }
      if (key === 'genres') f.genres = f.genres.includes(v) ? f.genres.filter(x => x !== v) : [...f.genres, v]
      return sync()
    }
    if (e.target.closest('#filter-more')) {
      sheet.querySelector('.filter-genres').classList.add('show-all')
      e.target.closest('#filter-more').remove()
      return
    }
    if (e.target.closest('#filter-clear')) { f = structuredClone(NO_FILTERS); return sync() }
    if (e.target.closest('#filter-manage-genres')) {
      close()
      // Let this sheet's history entry unwind before opening the next one
      return setTimeout(openManageGenres, 350)
    }
    if (e.target.closest('#filter-apply')) { onApply({ sort, filters: f }); close() }
  })
}

function openSeriesFilterSheet(books, state, onApply) {
  const all = groupSeries(books)
  const { sheet, close } = openSheet(`
    <div class="filter-sheet">
      <div class="filter-sheet-head"><h2>Filter series</h2></div>
      <div class="filter-group">
        <div class="bd-label">Show</div>
        <div class="chips">
          ${SERIES_FILTERS.map(([id, label]) => {
            const n = all.filter(s => seriesMatches(s, id)).length
            return `<button class="chip ${state.seriesFilter === id ? 'selected' : ''}" data-series-filter="${id}">
              ${label} <span class="lib-chip-count">${n}</span></button>`
          }).join('')}
        </div>
      </div>
    </div>
    <div style="height:16px"></div>
  `, { className: 'filter-sheet-wrap' })

  // A single choice — apply straight away
  sheet.addEventListener('click', e => {
    const chip = e.target.closest('[data-series-filter]')
    if (!chip) return
    onApply({ seriesFilter: chip.dataset.seriesFilter })
    close()
  })
}
