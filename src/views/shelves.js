import { esc } from '../escape.js'
import { watchAllBooks, watchReadingGoals, updateBook } from '../db.js'
import { openBookDetail } from './book-detail.js'
import { navigateTo } from '../main.js'
import { avatarButtonHTML, wireTopBar } from './topbar.js'
import { openSheet } from './sheet.js'
import { openLibrary } from './library.js'

// Home tab: what you're reading now and what's next. The full collection
// lives in the library tab (library.js).

export const SHELF_BADGE = { reading: 'Reading', want: 'TBR', read: 'Read', dnf: 'DNF' }
const ROW_LIMIT = 10

// Snackbar helper — exported for use by other views
// Optional action: { label, onClick } adds a button (e.g. Undo) and keeps it up longer
let snackbarTimeout = null
export function showSnackbar(msg, action) {
  document.querySelector('.snackbar')?.remove()
  clearTimeout(snackbarTimeout)
  const el = document.createElement('div')
  el.className = 'snackbar'
  const text = document.createElement('span')
  text.textContent = msg
  el.appendChild(text)
  if (action) {
    const btn = document.createElement('button')
    btn.className = 'snackbar-action'
    btn.textContent = action.label
    btn.addEventListener('click', () => {
      clearTimeout(snackbarTimeout)
      el.remove()
      action.onClick()
    })
    el.appendChild(btn)
  }
  document.body.appendChild(el)
  snackbarTimeout = setTimeout(() => el.remove(), action ? 6000 : 3000)
}

// ── Home ──────────────────────────────────────────────────────────────────────

export function renderShelves(container) {
  container.innerHTML = `
    <div class="shelves-root">
      <div class="shelves-top">
        <button class="shelves-logo-btn" data-goto-home aria-label="Home"><img src="/icons/logo2-512.png" class="shelves-logo" alt="" /></button>
        <button class="search-bar shelves-search-bar home-search-btn" id="home-search">
          <span class="material-symbols-rounded">search</span>
          <span class="home-search-placeholder">Search your library…</span>
        </button>
        ${avatarButtonHTML()}
      </div>

      <div id="shelves-content" class="home-content">
        <div id="home-goal"></div>
        <section class="home-section" id="home-reading">${skeletonReading()}</section>
        <section class="home-section" id="home-next"></section>
        <section class="home-section" id="home-recent"></section>
        <section class="home-section" id="home-series"></section>
      </div>
    </div>
  `
  wireTopBar(container)
  container.querySelector('#home-search').addEventListener('click', () => openLibrary({ focusSearch: true }))

  let books = null, goals = {}
  const render = () => {
    if (!books) return
    renderGoal(container, books, goals)
    renderReading(container, books)
    renderRow(container, '#home-next', 'TBR',
      books.filter(b => b.shelf === 'want').sort(byDesc(b => b.addedAt)),
      { shelf: 'want', sort: 'added' }, 'Nothing on your TBR yet.')
    renderRow(container, '#home-recent', 'Recently finished',
      books.filter(b => b.shelf === 'read').sort(byDesc(b => b.dateCompleted)),
      { shelf: 'read', sort: 'finished' }, 'Finished books show up here.')
    renderSeriesInProgress(container, books)
  }

  // One delegated handler for every book on the page
  container.querySelector('#shelves-content').addEventListener('click', e => {
    const update = e.target.closest('[data-update-progress]')
    if (update) return openProgressSheet(books.find(b => b.id === update.dataset.updateProgress))
    const seeAll = e.target.closest('[data-see-all]')
    if (seeAll) return openLibrary(JSON.parse(seeAll.dataset.seeAll))
    const el = e.target.closest('.book-card, .home-reading-card, .home-series-row')
    const book = el && books.find(b => b.id === el.dataset.bookId)
    if (book) openBookDetail(book, book.shelf, null)
  })

  const unsubBooks = watchAllBooks(b => { books = b; render() })
  const unsubGoals = watchReadingGoals(g => { goals = g; render() })
  return () => { unsubBooks(); unsubGoals() }
}

export function destroyShelves() {}

const byDesc = key => (a, b) => (key(b)?.getTime?.() ?? 0) - (key(a)?.getTime?.() ?? 0)

// ── Sections ──────────────────────────────────────────────────────────────────

function renderGoal(container, books, goals) {
  const el = container.querySelector('#home-goal')
  const year = new Date().getFullYear()
  const goal = Number(goals[year]) || 0
  if (!goal) { el.innerHTML = ''; return }
  const read = books.filter(b => b.shelf === 'read' && b.dateCompleted?.getFullYear() === year).length
  const start = new Date(year, 0, 1)
  const daysInYear = (new Date(year + 1, 0, 1) - start) / 86400000
  const diff = read - Math.floor(goal * (Math.floor((Date.now() - start) / 86400000) + 1) / daysInYear)
  const status = read >= goal ? 'Goal reached!'
    : diff > 0 ? `${diff} ahead of schedule`
    : diff < 0 ? `${-diff} behind schedule` : 'Right on track'
  const C = 2 * Math.PI * 14
  el.innerHTML = `
    <button class="home-goal" data-goto-profile-goal>
      <svg viewBox="0 0 36 36" class="home-goal-ring" aria-hidden="true">
        <circle cx="18" cy="18" r="14" class="goal-ring-track" />
        <circle cx="18" cy="18" r="14" class="goal-ring-progress ${read >= goal ? 'done' : ''}"
          stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - Math.min(1, read / goal))}" />
      </svg>
      <span class="home-goal-text">
        <span class="home-goal-main">${read} of ${goal} books in ${year}</span>
        <span class="home-goal-sub">${status}</span>
      </span>
      <span class="material-symbols-rounded">chevron_right</span>
    </button>`
  el.querySelector('[data-goto-profile-goal]').addEventListener('click', () => navigateTo('profile'))
}

function renderReading(container, books) {
  const el = container.querySelector('#home-reading')
  const reading = books.filter(b => b.shelf === 'reading').sort(byDesc(b => b.addedAt))
  el.innerHTML = `
    ${sectionHeader('Currently reading', reading.length > 1 ? reading.length : '')}
    ${reading.length ? reading.map(readingCardHTML).join('') : `
      <div class="home-empty">
        <span class="material-symbols-rounded">auto_stories</span>
        Not reading anything right now — pick something from your TBR.
      </div>`}
  `
}

function readingCardHTML(book) {
  const pct = book.pageCount ? Math.min(100, Math.round((book.progress || 0) / book.pageCount * 100)) : 0
  return `
    <div class="home-reading-card" data-book-id="${esc(book.id)}" role="button" tabindex="0">
      <div class="home-reading-cover">${coverImgHTML(book)}</div>
      <div class="home-reading-info">
        <div class="home-reading-title">${esc(book.title)}</div>
        <div class="home-reading-author">${esc(book.author)}</div>
        ${book.pageCount ? `
          <div class="bd-progress-bar"><div class="bd-progress-fill" style="width:${pct}%"></div></div>
          <div class="home-reading-pages">p. ${book.progress || 0} of ${book.pageCount} · ${pct}%</div>` : ''}
        <button class="btn btn-tonal home-update-btn" data-update-progress="${esc(book.id)}">
          <span class="material-symbols-rounded">bookmark</span>Update page
        </button>
      </div>
    </div>`
}

function renderRow(container, selector, title, books, preset, emptyText) {
  const el = container.querySelector(selector)
  el.innerHTML = `
    ${sectionHeader(title, '', books.length > ROW_LIMIT || books.length
      ? `<button class="home-see-all" data-see-all='${esc(JSON.stringify(preset))}'>See all ${books.length}</button>` : '')}
    ${books.length
      ? `<div class="shelf-scroll">${books.slice(0, ROW_LIMIT).map(b => bookCardHTML(b)).join('')}</div>`
      : `<div class="home-empty">${emptyText}</div>`}
  `
}

function renderSeriesInProgress(container, books) {
  const el = container.querySelector('#home-series')
  // Started but not finished: at least one read and one still to read
  const inProgress = groupSeries(books)
    .filter(s => s.read > 0 && s.next)
    .sort((a, b) => (b.lastRead?.getTime() ?? 0) - (a.lastRead?.getTime() ?? 0))
    .slice(0, 5)

  if (!inProgress.length) { el.innerHTML = ''; return }
  el.innerHTML = `
    ${sectionHeader('Series in progress', '',
      `<button class="home-see-all" data-see-all='${esc(JSON.stringify({ segment: 'series' }))}'>All series</button>`)}
    <div class="home-series-list">
      ${inProgress.map(s => `
        <div class="home-series-row" data-book-id="${esc(s.next.id)}" role="button" tabindex="0">
          <div class="home-series-cover">${coverImgHTML(s.next)}</div>
          <div class="home-series-info">
            <span class="home-series-name">${esc(s.name)}</span>
            <span class="home-series-next">Next: ${s.next.seriesNumber ? `#${esc(s.next.seriesNumber)} ` : ''}${esc(s.next.title)}</span>
            <div class="series-progress-bar"><div class="series-progress-fill" style="width:${Math.round(s.read / s.total * 100)}%"></div></div>
          </div>
          <span class="home-series-count">${s.read}/${s.total}</span>
        </div>`).join('')}
    </div>
  `
}

function sectionHeader(title, count = '', action = '') {
  return `
    <div class="home-section-head">
      <h2>${title}${count ? ` <span class="shelf-count">${count}</span>` : ''}</h2>
      ${action}
    </div>`
}

// ── Update page ───────────────────────────────────────────────────────────────

function openProgressSheet(book) {
  if (!book) return
  const { sheet, close } = openSheet(`
    <div class="progress-sheet">
      <div class="progress-sheet-head">
        <div class="home-reading-cover progress-sheet-cover">${coverImgHTML(book)}</div>
        <div>
          <div class="botm-page-kicker" style="color:var(--accent-text)">Update progress</div>
          <div class="home-reading-title">${esc(book.title)}</div>
        </div>
      </div>
      <label class="progress-sheet-label" for="progress-sheet-input">Current page</label>
      <div class="progress-sheet-row">
        <button class="icon-btn progress-step" data-step="-10" aria-label="Back 10 pages">
          <span class="material-symbols-rounded">remove</span>
        </button>
        <input id="progress-sheet-input" class="progress-sheet-input" type="number" inputmode="numeric"
          min="0" max="${book.pageCount || 99999}" value="${book.progress || 0}" />
        <button class="icon-btn progress-step" data-step="10" aria-label="Forward 10 pages">
          <span class="material-symbols-rounded">add</span>
        </button>
        ${book.pageCount ? `<span class="progress-sheet-total">of ${book.pageCount}</span>` : ''}
      </div>
      ${book.pageCount ? `<div class="bd-progress-bar"><div class="bd-progress-fill" id="progress-sheet-fill"></div></div>` : ''}
      <div class="progress-sheet-actions">
        <button class="btn btn-tonal" id="progress-finished">
          <span class="material-symbols-rounded">check_circle</span>Finished it
        </button>
        <button class="btn btn-filled" id="progress-save">Save</button>
      </div>
    </div>
  `)

  const input = sheet.querySelector('#progress-sheet-input')
  const fill = sheet.querySelector('#progress-sheet-fill')
  const sync = () => {
    if (fill) fill.style.width = `${Math.min(100, (Number(input.value) || 0) / book.pageCount * 100)}%`
  }
  sync()
  input.addEventListener('input', sync)
  sheet.querySelectorAll('.progress-step').forEach(btn => btn.addEventListener('click', () => {
    const max = book.pageCount || Infinity
    input.value = Math.max(0, Math.min(max, (Number(input.value) || 0) + Number(btn.dataset.step)))
    sync()
  }))

  sheet.querySelector('#progress-save').addEventListener('click', async () => {
    const page = Math.max(0, Math.round(Number(input.value) || 0))
    try {
      await updateBook(book.id, { progress: page })
      showSnackbar(book.pageCount ? `Page ${page} · ${Math.round(page / book.pageCount * 100)}%` : `Page ${page}`)
      close()
    } catch (err) { console.error(err); showSnackbar('Something went wrong') }
  })
  sheet.querySelector('#progress-finished').addEventListener('click', async () => {
    try {
      await updateBook(book.id, { shelf: 'read', progress: book.pageCount || 0, dateCompleted: new Date() })
      showSnackbar(`Finished ${book.title}`)
      close()
    } catch (err) { console.error(err); showSnackbar('Something went wrong') }
  })
}

// ── Shared book bits (also used by the library tab) ──────────────────────────

export function coverImgHTML(book) {
  return book.thumbnail
    ? `<img src="${esc(book.thumbnail)}" alt="${esc(book.title)}" loading="lazy"
         data-book-id="${esc(book.id)}" data-title="${esc(book.title)}" data-author="${esc(book.author)}" />`
    : `<div class="book-cover-placeholder">
         <span class="material-symbols-rounded">menu_book</span>
         <div class="placeholder-title">${esc(book.title)}</div>
       </div>`
}

export function bookCardHTML(book) {
  const botmBadge = book.isBOTM
    ? `<div class="botm-badge"><span class="material-symbols-rounded">workspace_premium</span></div>` : ''
  const botyBadge = book.isBOTY
    ? `<div class="boty-badge"><span class="material-symbols-rounded">emoji_events</span></div>` : ''
  const progressHTML = book.shelf === 'reading' && book.pageCount > 0
    ? `<div class="book-progress"><div class="book-progress-fill" style="width:${Math.round((book.progress / book.pageCount) * 100)}%"></div></div>`
    : ''
  return `
    <div class="book-card" data-book-id="${esc(book.id)}" role="button" tabindex="0">
      <div class="book-cover">${coverImgHTML(book)}${botmBadge}${botyBadge}</div>
      <div class="book-card-info">
        <div class="book-card-title">${esc(book.title)}</div>
        <div class="book-card-author">${esc(book.author)}</div>
        ${book.rating > 0 ? `<div class="book-card-rating">${'★'.repeat(book.rating)}${'☆'.repeat(5 - book.rating)}</div>` : ''}
        ${progressHTML}
      </div>
    </div>`
}

/** Books grouped by series, each with read count and the next unread book */
export function groupSeries(books) {
  const map = new Map()
  books.filter(b => b.series).forEach(b => {
    if (!map.has(b.series)) map.set(b.series, [])
    map.get(b.series).push(b)
  })
  return [...map.entries()].map(([name, list]) => {
    const sorted = [...list].sort((a, b) => (parseFloat(a.seriesNumber) || 0) - (parseFloat(b.seriesNumber) || 0))
    const read = sorted.filter(b => b.shelf === 'read')
    return {
      name,
      books: sorted,
      total: sorted.length,
      read: read.length,
      next: sorted.find(b => b.shelf !== 'read' && b.shelf !== 'dnf') || null,
      lastRead: read.reduce((max, b) => (b.dateCompleted && (!max || b.dateCompleted > max)) ? b.dateCompleted : max, null),
    }
  })
}

function skeletonReading() {
  return `
    <div class="home-section-head"><h2>Currently reading</h2></div>
    <div class="home-reading-card">
      <div class="home-reading-cover skeleton"></div>
      <div class="home-reading-info" style="gap:8px">
        <div class="skeleton" style="height:14px;border-radius:6px;width:80%"></div>
        <div class="skeleton" style="height:12px;border-radius:6px;width:50%"></div>
      </div>
    </div>`
}
