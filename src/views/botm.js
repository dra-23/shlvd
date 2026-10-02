import { esc } from '../escape.js'
import { watchBotm, watchAllBooks, updateBook } from '../db.js'
import { backHandlerStack, popOwnHistoryEntry } from '../main.js'
import { openBookDetail } from './book-detail.js'
import { showSnackbar } from './shelves.js'
import { drawBotmCard, shareImage } from '../share.js'
import { avatarButtonHTML, wireAvatar } from './topbar.js'
import { loadChart } from '../charts.js'
import { chartColors } from '../theme.js'

// Set once Chart.js has loaded (see charts.js)
let Chart = null

const C = {
  primary:   '#98ab88',
  primary2:  '#b5c4a8',
  primary3:  '#7d9070',
  secondary: '#afc49d',
  tertiary:  '#d8ada8',
  tertiary2: '#c49490',
  tertiary3: '#e8c5c0',
  grid:      '#e4e9e0',
  text:      '#44483d',
}

const RATING_PALETTE = ['#e8c5c0', '#d8ada8', '#c9b99a', '#afc49d', '#7d9070']

const DOUGHNUT_PALETTE = [
  '#7d9070', '#c49490', '#98ab88', '#d8ada8',
  '#afc49d', '#e8c5c0', '#b5c4a8', '#c9b99a',
]

// All read books — kept fresh by a background watcher
let allReadBooks = []

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMonth(date) {
  if (!date) return ''
  try {
    const d = date instanceof Date ? date : new Date(date)
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()
  } catch { return '' }
}

function starHTML(rating) {
  if (!rating) return ''
  const gold    = '#FFB800'
  const outline = 'var(--md-outline-variant)'
  return `<div class="botm-stars">${[1,2,3,4,5].map(n =>
    `<span class="material-symbols-rounded botm-star"
      style="font-size:18px;${n <= rating
        ? `font-variation-settings:'FILL' 1;color:${gold};`
        : `color:${outline};`}">star</span>`
  ).join('')}</div>`
}

function formatDuration(days) {
  if (days <= 1) return '1 day'
  if (days < 14) return `${Math.round(days)} days`
  if (days < 30) return `${Math.round(days / 7)} wks`
  return `${Math.round(days / 30)} mo`
}

// ── BotM list view ────────────────────────────────────────────────────────────

export function renderBotm(container) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;">

      <div class="shelves-top" style="display:flex;align-items:center;">
        <img src="/icons/logo2-512.png" class="shelves-logo" alt="shlvd" />
        <div style="height:56px;display:flex;align-items:center;margin-left:12px;">
          <span class="top-bar-title" style="margin:0;">Book of the Month</span>
        </div>
        <button class="icon-btn botm-view-toggle" id="botm-view-toggle" style="margin-left:auto"></button>
        ${avatarButtonHTML()}
      </div>

      <div id="botm-content" style="padding:0 0 16px;flex:1;overflow-y:auto;">
        <div class="botm-list-container">
          ${skeletonList()}
        </div>
      </div>
    </div>
  `

  wireAvatar(container)
  const content = container.querySelector('#botm-content')
  let picks = null, allBooks = null

  // List or cover wall, remembered on this device
  const VIEW_KEY = 'shlvd-botm-view'
  let view = 'list'
  try { view = localStorage.getItem(VIEW_KEY) === 'wall' ? 'wall' : 'list' } catch {}
  const toggle = container.querySelector('#botm-view-toggle')
  const syncToggle = () => {
    toggle.innerHTML = `<span class="material-symbols-rounded">${view === 'wall' ? 'view_agenda' : 'grid_view'}</span>`
    toggle.setAttribute('aria-label', view === 'wall' ? 'Show as list' : 'Show as cover wall')
  }
  syncToggle()
  toggle.addEventListener('click', () => {
    view = view === 'wall' ? 'list' : 'wall'
    try { localStorage.setItem(VIEW_KEY, view) } catch {}
    syncToggle()
    render()
  })

  // Both watchers feed the list: picks for the cards, all books for
  // Book of the Year and the "choose from N books" counts on empty months
  const render = () => {
    if (!picks || !allBooks) return
    if (!picks.length) {
      content.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-rounded">auto_awesome</span>
          <div class="empty-state-title">No BotM books yet</div>
          <div class="empty-state-body">Open any book and tap the ✦ Book of the Month button to flag it.</div>
        </div>
      `
      return
    }
    // Page navigation steps through dated picks newest-first, undated last
    botmBooks = [...picks.filter(b => b.dateCompleted), ...picks.filter(b => !b.dateCompleted)]
    content.innerHTML = buildListHTML(botmBooks, allBooks, view)
  }

  content.addEventListener('click', e => {
    const card = e.target.closest('[data-index]')
    // In a shared-month row, the first tap on a collapsed card just expands it
    const row = card?.closest('.botm-duo')
    if (row && !card.classList.contains('expanded')) return expandDuoCard(row, card)
    if (card) return openBotmPage(Number(card.dataset.index), container)
    const boty = e.target.closest('[data-boty-id]')
    if (boty) {
      const book = allBooks.find(b => b.id === boty.dataset.botyId)
      if (book) openBookDetail(book, book.shelf, null)
      return
    }
    const slot = e.target.closest('[data-year][data-month]') // list slot or wall tile
    if (slot) openPickChooser(Number(slot.dataset.year), Number(slot.dataset.month))
  })

  const unsubBotm = watchBotm(books => { picks = books; render() })
  const unsubAll = watchAllBooks(books => {
    allBooks = books
    allReadBooks = books.filter(b => b.shelf === 'read')
    render()
  })

  return () => { unsubBotm(); unsubAll() }
}

const monthKey = d => `${d.getFullYear()}-${d.getMonth()}`

function buildListHTML(picks, allBooks, view = 'list') {
  const wall = view === 'wall'
  const dated = picks.filter(b => b.dateCompleted)
  const undated = picks.filter(b => !b.dateCompleted)
  const indexOf = book => picks.indexOf(book)

  // Picks and books read, bucketed by month
  const picksByMonth = new Map()
  dated.forEach(b => {
    const k = monthKey(b.dateCompleted)
    if (!picksByMonth.has(k)) picksByMonth.set(k, [])
    picksByMonth.get(k).push(b)
  })
  const readByMonth = new Map()
  allReadBooks.forEach(b => {
    if (!b.dateCompleted) return
    const k = monthKey(b.dateCompleted)
    readByMonth.set(k, (readByMonth.get(k) || 0) + 1)
  })

  // Every month from the first pick up to this month
  const now = new Date()
  const first = dated.length
    ? dated.reduce((min, b) => b.dateCompleted < min ? b.dateCompleted : min, dated[0].dateCompleted)
    : now
  let html = ''

  for (let y = now.getFullYear(); y >= first.getFullYear(); y--) {
    const lastMonth  = y === now.getFullYear() ? now.getMonth() : 11
    const firstMonth = y === first.getFullYear() ? first.getMonth() : 0

    const yearPicks = dated.filter(b => b.dateCompleted.getFullYear() === y)
    const rated = yearPicks.filter(b => b.rating > 0)
    const avg = rated.length ? (rated.reduce((s, b) => s + b.rating, 0) / rated.length).toFixed(1) : null

    html += `
      <div class="botm-year-header">
        <span>${y}</span>
        <span class="botm-year-summary">${yearPicks.length} pick${yearPicks.length === 1 ? '' : 's'}${avg ? ` · ★ ${avg}` : ''}</span>
      </div>
      ${botySpotlightHTML(y, yearPicks, allBooks)}
      <div class="${wall ? 'botm-wall' : 'botm-list'}">`

    for (let m = lastMonth; m >= firstMonth; m--) {
      const k = `${y}-${m}`
      const monthPicks = picksByMonth.get(k)
      const isCurrent = y === now.getFullYear() && m === now.getMonth()
      if (wall) {
        html += monthPicks
          ? monthPicks.map(b => wallTileHTML(b, indexOf(b))).join('')
          : emptyTileHTML(y, m, readByMonth.get(k) || 0, isCurrent)
      } else if (monthPicks) {
        html += monthPicks.length > 1
          ? duoRowHTML(monthPicks, indexOf)
          : botmCardHTML(monthPicks[0], indexOf(monthPicks[0]))
      } else {
        html += emptySlotHTML(y, m, readByMonth.get(k) || 0, isCurrent)
      }
    }
    html += `</div>`
  }

  if (undated.length) {
    html += `
      <div class="botm-year-header"><span>No date</span></div>
      <div class="${wall ? 'botm-wall' : 'botm-list'}">
        ${undated.map(b => wall ? wallTileHTML(b, indexOf(b)) : botmCardHTML(b, indexOf(b))).join('')}
      </div>`
  }
  return html
}

// ── Cover wall: one cover per month ──────────────────────────────────────────

const shortMonth = (y, m) => new Date(y, m, 1).toLocaleDateString('en-US', { month: 'short' })
const longMonth  = (y, m) => new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long' })

function wallTileHTML(book, index) {
  const d = book.dateCompleted
  return `
    <button class="botm-tile" data-index="${index}">
      <div class="botm-tile-cover">
        ${book.thumbnail
          ? `<img src="${esc(book.thumbnail)}" alt="${esc(book.title)}" loading="lazy" />`
          : `<div class="book-cover-placeholder" style="width:100%;height:100%;"><span class="material-symbols-rounded">menu_book</span></div>`}
        ${book.isBOTY ? `<span class="botm-tile-boty material-symbols-rounded" aria-label="Book of the Year">emoji_events</span>` : ''}
      </div>
      <span class="botm-tile-month">${d ? longMonth(d.getFullYear(), d.getMonth()) : '—'}</span>
    </button>`
}

function emptyTileHTML(year, month, readCount, isCurrent) {
  const canPick = readCount > 0
  return `
    <div class="botm-tile botm-tile--empty ${canPick ? '' : 'botm-tile--none'}"
      ${canPick ? `data-year="${year}" data-month="${month}" role="button" tabindex="0" aria-label="Choose a pick for ${shortMonth(year, month)}"` : ''}>
      <div class="botm-tile-cover">
        <span class="material-symbols-rounded">${isCurrent ? 'hourglass_top' : canPick ? 'add' : 'remove'}</span>
      </div>
      <span class="botm-tile-month">${longMonth(year, month)}</span>
    </div>`
}

// ── Months with more than one pick: one row, one card expanded ───────────────

// Collapsed cards shrink to their cover. Widths are plain px/% (not fr) so
// the browser can animate the columns when a different card expands.
const DUO_COLLAPSED = 96
const DUO_GAP = 8

function duoColumns(count, expandedAt) {
  const rest = (count - 1) * (DUO_COLLAPSED + DUO_GAP)
  return Array.from({ length: count }, (_, i) =>
    i === expandedAt ? `calc(100% - ${rest}px)` : `${DUO_COLLAPSED}px`).join(' ')
}

function duoRowHTML(picks, indexOf) {
  return `
    <div class="botm-duo" style="grid-template-columns:${duoColumns(picks.length, 0)}">
      ${picks.map((b, i) => botmCardHTML(b, indexOf(b), i === 0 ? 'expanded' : 'collapsed')).join('')}
    </div>`
}

function expandDuoCard(row, card) {
  const cards = [...row.querySelectorAll('.botm-card')]
  cards.forEach(c => {
    c.classList.toggle('expanded', c === card)
    c.classList.toggle('collapsed', c !== card)
    c.setAttribute('aria-expanded', c === card)
  })
  row.style.gridTemplateColumns = duoColumns(cards.length, cards.indexOf(card))
}

function botySpotlightHTML(year, yearPicks, allBooks) {
  const boty = allBooks.find(b => b.isBOTY &&
    (b.botyYear ?? b.dateCompleted?.getFullYear()) === year)

  if (!boty) {
    // Only nudge once there's something to choose from
    if (!yearPicks.length) return ''
    return `
      <div class="botm-boty-hint">
        <span class="material-symbols-rounded">emoji_events</span>
        <span>No Book of the Year for ${year} yet — open a pick below and tap <b>Book of the Year</b>.</span>
      </div>`
  }

  const pickIndex = botmBooks.indexOf(boty)
  const target = pickIndex >= 0 ? `data-index="${pickIndex}"` : `data-boty-id="${esc(boty.id)}"`
  const cover = boty.thumbnail
    ? `<img src="${esc(boty.thumbnail)}" alt="${esc(boty.title)}" />`
    : `<div class="book-cover-placeholder" style="width:100%;height:100%;"><span class="material-symbols-rounded">menu_book</span></div>`

  return `
    <button class="botm-boty-spotlight" ${target}
      style="--cover:url(${esc(JSON.stringify(boty.thumbnail || ''))})">
      <div class="botm-boty-cover">${cover}</div>
      <div class="botm-boty-info">
        <span class="botm-boty-label">
          <span class="material-symbols-rounded">emoji_events</span>Book of the Year
        </span>
        <span class="botm-boty-title">${esc(boty.title)}</span>
        <span class="botm-boty-author">${esc(boty.author)}</span>
        ${starHTML(boty.rating)}
        ${boty.dateCompleted ? `<span class="botm-boty-month">${boty.dateCompleted.toLocaleDateString('en-US', { month: 'long' })} pick</span>` : ''}
      </div>
    </button>`
}

function emptySlotHTML(year, month, readCount, isCurrent) {
  const label = new Date(year, month, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()
  const canPick = readCount > 0
  const sub = isCurrent
    ? (canPick ? `In progress · ${readCount} book${readCount === 1 ? '' : 's'} so far` : 'In progress')
    : (canPick ? `Choose from ${readCount} book${readCount === 1 ? '' : 's'} read` : 'No books read')

  return `
    <div class="botm-slot ${canPick ? '' : 'botm-slot--empty'}"
      ${canPick ? `data-year="${year}" data-month="${month}" role="button" tabindex="0"` : ''}>
      <div class="botm-slot-icon">
        <span class="material-symbols-rounded">${isCurrent ? 'hourglass_top' : canPick ? 'add' : 'remove'}</span>
      </div>
      <div class="botm-info">
        <div class="botm-month-badge botm-month-badge--muted">${label}</div>
        <div class="botm-slot-title">${isCurrent ? 'This month' : 'No pick yet'}</div>
        <div class="botm-slot-sub">${sub}</div>
      </div>
      ${canPick ? `<span class="material-symbols-rounded botm-chevron">chevron_right</span>` : ''}
    </div>`
}

// ── Choose a pick for an empty month ──────────────────────────────────────────

function openPickChooser(year, month) {
  const monthName = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const books = allReadBooks
    .filter(b => b.dateCompleted && b.dateCompleted.getFullYear() === year && b.dateCompleted.getMonth() === month)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.dateCompleted - b.dateCompleted)

  const scrim = document.createElement('div')
  scrim.className = 'sheet-scrim'
  const sheet = document.createElement('div')
  sheet.className = 'bottom-sheet'
  sheet.innerHTML = `
    <div class="sheet-handle"><div class="sheet-handle-bar"></div></div>
    <div class="botm-chooser-head">
      <div>
        <div class="botm-page-kicker">Choose Book of the Month</div>
        <div class="botm-chooser-title">${monthName}</div>
      </div>
      <button class="icon-btn" id="chooser-close" aria-label="Close">
        <span class="material-symbols-rounded">close</span>
      </button>
    </div>
    <div class="botm-chooser-list">
      ${books.map((b, i) => `
        <button class="botm-chooser-row" data-i="${i}">
          <div class="botm-chooser-cover">
            ${b.thumbnail ? `<img src="${esc(b.thumbnail)}" alt="" loading="lazy" />`
              : `<div class="book-cover-placeholder" style="width:100%;height:100%;"><span class="material-symbols-rounded">menu_book</span></div>`}
          </div>
          <div class="botm-chooser-info">
            <span class="botm-chooser-book">${esc(b.title)}</span>
            <span class="botm-chooser-author">${esc(b.author)}</span>
            ${b.rating ? `<span class="botm-chooser-rating">${'★'.repeat(b.rating)}<span>${'★'.repeat(5 - b.rating)}</span></span>` : ''}
          </div>
          <span class="material-symbols-rounded botm-chooser-pick">workspace_premium</span>
        </button>`).join('')}
    </div>
  `
  document.body.appendChild(scrim)
  document.body.appendChild(sheet)

  history.pushState({ sheet: true }, '')
  function close(source) {
    const idx = backHandlerStack.indexOf(close)
    if (idx !== -1) backHandlerStack.splice(idx, 1)
    if (source !== 'popstate') popOwnHistoryEntry()
    scrim.classList.add('closing')
    sheet.classList.add('closing')
    setTimeout(() => { scrim.remove(); sheet.remove() }, 300)
  }
  backHandlerStack.push(close)
  scrim.addEventListener('click', () => close('manual'))
  sheet.querySelector('#chooser-close').addEventListener('click', () => close('manual'))

  sheet.querySelector('.botm-chooser-list').addEventListener('click', async e => {
    const row = e.target.closest('.botm-chooser-row')
    if (!row) return
    const book = books[Number(row.dataset.i)]
    row.disabled = true
    try {
      await updateBook(book.id, { isBOTM: true })
      showSnackbar(`✦ ${book.title} is ${monthName.split(' ')[0]}’s Book of the Month`)
      close('manual')
    } catch (err) {
      console.error(err)
      row.disabled = false
      showSnackbar('Something went wrong')
    }
  })
}

// ── BotM detail page ──────────────────────────────────────────────────────────

// Picks in list order (newest first) — the month page steps through these
let botmBooks = []

function openBotmPage(index, viewEl) {
  if (!botmBooks[index]) return
  const page = document.createElement('div')
  page.className = 'botm-detail-page'
  page.style.transform = 'translateX(100%)'

  // Append inside the .view so it's clipped by overflow-x:hidden during
  // the slide animation and automatically removed when navigating away
  viewEl.appendChild(page)

  let current = index
  let chartInstances = []
  let renderToken = 0

  function render(direction = null) {
    chartInstances.forEach(c => c?.destroy())
    const book = botmBooks[current]
    // The pick can disappear if it was edited out of BotM — leave the page
    if (!book) return closePage('manual')
    const monthBooks = booksReadInMonth(book.dateCompleted)
    page.innerHTML = buildPageHTML(book, monthBooks, current)

    if (book.thumbnail) {
      page.querySelector('.bd-hero').style.setProperty('--cover', `url(${JSON.stringify(book.thumbnail)})`)
    }
    if (direction) {
      page.querySelector('.botm-page-scroll').classList.add(direction === 'newer' ? 'botm-swap-newer' : 'botm-swap-older')
    }

    page.querySelector('.botm-back-btn').addEventListener('click', () => closePage('manual'))
    page.querySelector('.botm-older-btn')?.addEventListener('click', () => step('older'))
    page.querySelector('.botm-share-btn').addEventListener('click', async e => {
      const btn = e.currentTarget
      btn.disabled = true
      try {
        const d = book.dateCompleted
        const stamp = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : 'pick'
        const result = await shareImage(await drawBotmCard(book, monthBooks),
          `shlvd-botm-${stamp}.jpg`, `My Book of the Month: ${book.title}`)
        if (result === 'downloaded') showSnackbar('Image saved')
      } catch (err) {
        console.error(err)
        showSnackbar('Couldn’t create the image')
      } finally { btn.disabled = false }
    })
    page.querySelector('.botm-edit-btn').addEventListener('click', () => {
      // Re-render after saving. Find the pick by id — editing its finish
      // date can move it in the list; if it's no longer a BotM, leave
      openBookDetail(book, book.shelf, () => setTimeout(() => {
        const i = botmBooks.findIndex(b => b.id === book.id)
        if (i < 0) return closePage('manual')
        current = i
        render()
      }, 50))
    })
    page.querySelector('.botm-newer-btn')?.addEventListener('click', () => step('newer'))

    const others = monthBooks.filter(b => b.id !== book.id)
    page.querySelectorAll('.botm-also-item').forEach((el, i) => {
      el.addEventListener('click', () => openBookDetail(others[i], 'read', () => render()))
    })

    const token = ++renderToken
    loadChart().then(c => {
      Chart = c
      // Skip if the page closed or moved to another pick while Chart.js loaded
      if (token === renderToken && page.isConnected) chartInstances = mountMonthCharts(page, monthBooks)
    })
  }

  // botmBooks is newest-first, so "older" moves forward through the list
  function step(direction) {
    const next = current + (direction === 'older' ? 1 : -1)
    if (next < 0 || next >= botmBooks.length) return
    current = next
    render(direction)
  }

  render()
  requestAnimationFrame(() => {
    page.style.transition = 'transform 300ms cubic-bezier(0,0,0,1)'
    page.style.transform = 'translateX(0)'
  })

  // Swipe left/right between picks (but let the cover strip scroll)
  let touchX = 0, touchY = 0, tracking = false
  page.addEventListener('touchstart', e => {
    tracking = !e.target.closest('.botm-also-strip')
    touchX = e.touches[0].clientX
    touchY = e.touches[0].clientY
  }, { passive: true })
  page.addEventListener('touchend', e => {
    if (!tracking) return
    const dx = e.changedTouches[0].clientX - touchX
    const dy = e.changedTouches[0].clientY - touchY
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) step(dx < 0 ? 'newer' : 'older')
  }, { passive: true })

  // Back handling
  history.pushState({ botmDetail: true }, '')

  function closePage(source) {
    chartInstances.forEach(c => c?.destroy())
    chartInstances = []
    const idx = backHandlerStack.indexOf(closePage)
    if (idx !== -1) backHandlerStack.splice(idx, 1)
    if (source !== 'popstate') popOwnHistoryEntry()
    page.style.transition = 'transform 250ms cubic-bezier(0.3,0,1,1)'
    page.style.transform = 'translateX(100%)'
    setTimeout(() => page.remove(), 260)
  }

  backHandlerStack.push(closePage)
}

function booksReadInMonth(date) {
  if (!date) return []
  return allReadBooks
    .filter(b => b.dateCompleted &&
      b.dateCompleted.getFullYear() === date.getFullYear() &&
      b.dateCompleted.getMonth() === date.getMonth())
    .sort((a, b) => a.dateCompleted - b.dateCompleted)
}

// "2017-06-14" → "June 14, 2017"; leaves "2017" or free text as-is
function formatReleased(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return new Date(value + 'T12:00:00')
    .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// ── Page HTML ─────────────────────────────────────────────────────────────────

function buildPageHTML(book, monthBooks, index) {
  const d     = book.dateCompleted
  const year  = d ? d.getFullYear() : null
  const month = d ? d.getMonth() : null
  const days  = d ? new Date(year, month + 1, 0).getDate() : 30
  const monthLabel = d ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'Book of the Month'
  const monthName  = d ? d.toLocaleDateString('en-US', { month: 'long' }) : 'this month'

  const count      = monthBooks.length
  const totalPages = monthBooks.filter(b => b.pageCount > 0).reduce((s, b) => s + b.pageCount, 0)
  const rated      = monthBooks.filter(b => b.rating > 0)
  const avgRating  = rated.length
    ? (rated.reduce((s, b) => s + b.rating, 0) / rated.length).toFixed(1) : '—'
  const pagesDisplay = totalPages >= 1000
    ? `${(totalPages / 1000).toFixed(1)}k` : (totalPages || '—')
  const pace = totalPages > 0 ? Math.round(totalPages / days) : 0
  const paceDisplay = pace > 0 ? pace : '—'

  // Avg days per book this month
  const withDates = monthBooks.filter(b => b.dateCompleted)
  let avgDaysDisplay = '—'
  if (count > 0) {
    if (withDates.length >= 2) {
      const earliest = new Date(Math.min(...withDates.map(b => b.dateCompleted.getTime())))
      const latest   = new Date(Math.max(...withDates.map(b => b.dateCompleted.getTime())))
      const span = Math.round((latest.getTime() - earliest.getTime()) / 86400000)
      avgDaysDisplay = formatDuration(Math.round(span / (withDates.length - 1)))
    } else {
      avgDaysDisplay = formatDuration(Math.round(days / count))
    }
  }

  const hasRatings    = rated.length > 0
  const hasAuthors    = monthBooks.some(b => b.author)
  const hasGenres     = monthBooks.some(b => b.genre)
  const hasGenresBar  = monthBooks.filter(b => b.genre).length >= 2

  const coverHTML = book.thumbnail
    ? `<img src="${esc(book.thumbnail)}" alt="${esc(book.title)}" />`
    : `<div class="book-cover-placeholder" style="width:100%;height:100%;">
         <span class="material-symbols-rounded">menu_book</span>
       </div>`

  const released = book.dateReleased || ''
  const facts = [
    book.pageCount > 0 && fact('menu_book', `${book.pageCount} pages`),
    book.genre && fact('sell', esc(book.genre)),
    released && fact('calendar_today', esc(released.match(/\d{4}/)?.[0] || released)),
  ].filter(Boolean).join('')

  const pills = [
    d && `<span class="bd-pill"><span class="material-symbols-rounded">check_circle</span>Finished ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>`,
    book.isBOTY && `<span class="bd-pill bd-pill-boty"><span class="material-symbols-rounded">emoji_events</span>Book of ${book.botyYear || year}</span>`,
  ].filter(Boolean).join('')

  const others = monthBooks.filter(b => b.id !== book.id)

  // Some months have more than one pick — say which one this is
  const sameMonth = d ? botmBooks.filter(b => b.dateCompleted &&
    b.dateCompleted.getFullYear() === year && b.dateCompleted.getMonth() === month) : []
  // botmBooks is newest-first, so count from the end for "1 of 2" in date order
  const pickOf = sameMonth.length > 1
    ? ` · ${sameMonth.length - sameMonth.indexOf(book)} of ${sameMonth.length}` : ''
  const hasOlder = index < botmBooks.length - 1
  const hasNewer = index > 0

  return `
    <div class="botm-page-bar">
      <button class="icon-btn botm-back-btn" aria-label="Back">
        <span class="material-symbols-rounded">arrow_back</span>
      </button>
      <div class="botm-page-heading">
        <span class="botm-page-kicker">Book of the Month${pickOf}</span>
        <span class="botm-page-title">${monthLabel}</span>
      </div>
      <button class="icon-btn botm-share-btn" aria-label="Share as image">
        <span class="material-symbols-rounded">ios_share</span>
      </button>
      <button class="icon-btn botm-edit-btn" aria-label="Edit book">
        <span class="material-symbols-rounded">edit</span>
      </button>
      <button class="icon-btn botm-older-btn" aria-label="Previous pick" ${hasOlder ? '' : 'disabled'}>
        <span class="material-symbols-rounded">chevron_left</span>
      </button>
      <button class="icon-btn botm-newer-btn" aria-label="Next pick" ${hasNewer ? '' : 'disabled'}>
        <span class="material-symbols-rounded">chevron_right</span>
      </button>
    </div>

    <div class="botm-page-scroll">

      <header class="bd-hero bd-hero--page">
        <div class="bd-cover">${coverHTML}</div>
        <div class="bd-hero-text">
          <h2 class="bd-title">${esc(book.title)}</h2>
          <div class="bd-author">${esc(book.author)}</div>
          ${book.rating ? `<div class="botm-page-stars">${starHTML(book.rating)}</div>` : ''}
          ${facts ? `<div class="bd-facts">${facts}</div>` : ''}
          ${pills ? `<div class="bd-pills">${pills}</div>` : ''}
        </div>
      </header>

      <div class="bd-body botm-page-body">

        ${book.notes ? `
        <section class="bd-card">
          ${cardTitle('format_quote', 'Your thoughts')}
          <blockquote class="botm-quote">${esc(book.notes)}</blockquote>
        </section>` : ''}

        ${others.length ? `
        <section class="bd-card botm-also-card">
          ${cardTitle('auto_stories', `Also read in ${monthName}`)}
          <div class="botm-also-strip">
            ${others.map(b => `
              <button class="botm-also-item">
                <div class="botm-also-cover">
                  ${b.thumbnail
                    ? `<img src="${esc(b.thumbnail)}" alt="" loading="lazy" />`
                    : `<div class="book-cover-placeholder" style="width:100%;height:100%;"><span class="material-symbols-rounded">menu_book</span></div>`}
                </div>
                <span class="botm-also-title">${esc(b.title)}</span>
                ${b.rating ? `<span class="botm-also-rating">${'★'.repeat(b.rating)}</span>` : ''}
              </button>
            `).join('')}
          </div>
        </section>` : ''}

        <section class="bd-card">
          ${cardTitle('insights', `${monthName} in review`)}
          <div class="botm-stats">
            <div class="botm-stat"><span class="botm-stat-num">${count}</span><span class="botm-stat-label">Books read</span></div>
            <div class="botm-stat"><span class="botm-stat-num">${pagesDisplay}</span><span class="botm-stat-label">Pages read</span></div>
            <div class="botm-stat"><span class="botm-stat-num">${avgRating}</span><span class="botm-stat-label">Avg rating</span></div>
            <div class="botm-stat"><span class="botm-stat-num">${paceDisplay}</span><span class="botm-stat-label">Pages / day</span></div>
            <div class="botm-stat"><span class="botm-stat-num">${avgDaysDisplay}</span><span class="botm-stat-label">Days / book</span></div>
          </div>
        </section>

        <div class="chart-section botm-page-charts">
          ${hasRatings ? `
          <div class="chart-card">
            <div class="chart-title">Rating Breakdown</div>
            <div style="max-width:240px;margin:0 auto;">
              <canvas id="botm-chart-ratings"></canvas>
            </div>
          </div>` : ''}

          ${hasAuthors ? `
          <div class="chart-card">
            <div class="chart-title">Authors</div>
            <canvas id="botm-chart-authors"></canvas>
          </div>` : ''}

          ${hasGenresBar ? `
          <div class="chart-card">
            <div class="chart-title">Top Genres</div>
            <canvas id="botm-chart-genres-bar"></canvas>
          </div>` : ''}

          ${hasGenres ? `
          <div class="chart-card">
            <div class="chart-title">Genre Breakdown</div>
            <div style="max-width:240px;margin:0 auto;">
              <canvas id="botm-chart-genres"></canvas>
            </div>
          </div>` : ''}
        </div>
      </div>
    </div>
  `
}

function fact(icon, text) {
  return `<span class="bd-fact"><span class="material-symbols-rounded">${icon}</span>${text}</span>`
}

function cardTitle(icon, text) {
  return `<h3 class="bd-card-title"><span class="material-symbols-rounded">${icon}</span>${text}</h3>`
}

// ── Month charts ──────────────────────────────────────────────────────────────

function mountMonthCharts(el, books) {
  const instances = []
  Object.assign(C, chartColors())
  Chart.defaults.color = C.text

  // Doughnut — ratings
  const rCtx = el.querySelector('#botm-chart-ratings')
  if (rCtx) {
    const m = new Map([[1,0],[2,0],[3,0],[4,0],[5,0]])
    books.filter(b => b.rating > 0).forEach(b => m.set(b.rating, m.get(b.rating) + 1))
    instances.push(new Chart(rCtx, {
      type: 'doughnut',
      data: {
        labels: ['1 ★','2 ★','3 ★','4 ★','5 ★'],
        datasets: [{
          data: [1,2,3,4,5].map(n => m.get(n)),
          backgroundColor: RATING_PALETTE,
          borderWidth: 0,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '60%',
        animation: { duration: 400, easing: 'easeOutQuart' },
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: { padding: 12, color: C.text, font: { family: 'Nunito, system-ui', size: 11 } },
          },
          tooltip: tooltipStyle(),
        },
      },
    }))
  }

  // Horizontal bar — authors
  const aCtx = el.querySelector('#botm-chart-authors')
  if (aCtx) {
    const m = new Map()
    books.forEach(b => { if (b.author) m.set(b.author, (m.get(b.author) || 0) + 1) })
    const top = Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
    if (top.length) {
      instances.push(new Chart(aCtx, {
        type: 'bar',
        data: {
          labels: top.map(([a]) => a),
          datasets: [{
            data: top.map(([, n]) => n),
            backgroundColor: C.primary2,
            borderRadius: 6,
            borderSkipped: false,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          indexAxis: 'y',
          aspectRatio: top.length <= 2 ? 2.5 : 1.5,
          animation: { duration: 400, easing: 'easeOutQuart' },
          plugins: { legend: { display: false }, tooltip: tooltipStyle() },
          scales: {
            x: { grid: { color: C.grid }, border: { display: false }, ticks: { color: C.text, precision: 0 } },
            y: { grid: { display: false }, border: { display: false }, ticks: { color: C.text } },
          },
        },
      }))
    }
  }

  // Horizontal bar — top 5 genres
  const gbCtx = el.querySelector('#botm-chart-genres-bar')
  if (gbCtx) {
    const m = new Map()
    books.forEach(b => { if (b.genre) m.set(b.genre, (m.get(b.genre) || 0) + 1) })
    const top = Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
    if (top.length) {
      instances.push(new Chart(gbCtx, {
        type: 'bar',
        data: {
          labels: top.map(([g]) => g),
          datasets: [{
            data: top.map(([, n]) => n),
            backgroundColor: C.tertiary,
            borderRadius: 6,
            borderSkipped: false,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          indexAxis: 'y',
          aspectRatio: top.length <= 2 ? 2.5 : 1.5,
          animation: { duration: 400, easing: 'easeOutQuart' },
          plugins: { legend: { display: false }, tooltip: tooltipStyle() },
          scales: {
            x: { grid: { color: C.grid }, border: { display: false }, ticks: { color: C.text, precision: 0 } },
            y: { grid: { display: false }, border: { display: false }, ticks: { color: C.text } },
          },
        },
      }))
    }
  }

  // Doughnut — genre percentage breakdown
  const gCtx = el.querySelector('#botm-chart-genres')
  if (gCtx) {
    const m = new Map()
    books.forEach(b => { if (b.genre) m.set(b.genre, (m.get(b.genre) || 0) + 1) })
    const entries = Array.from(m.entries()).sort((a, b) => b[1] - a[1])
    if (entries.length) {
      const total = entries.reduce((s, [, n]) => s + n, 0)
      instances.push(new Chart(gCtx, {
        type: 'doughnut',
        data: {
          labels: entries.map(([g]) => g),
          datasets: [{
            data: entries.map(([, n]) => n),
            backgroundColor: entries.map((_, i) => DOUGHNUT_PALETTE[i % DOUGHNUT_PALETTE.length]),
            borderWidth: 0,
            hoverOffset: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          cutout: '55%',
          animation: { duration: 400, easing: 'easeOutQuart' },
          plugins: {
            legend: {
              display: true,
              position: 'bottom',
              labels: { padding: 12, color: C.text, font: { family: 'Nunito, system-ui', size: 11 } },
            },
            tooltip: {
              ...tooltipStyle(),
              callbacks: {
                label: ctx => {
                  const pct = Math.round((ctx.raw / total) * 100)
                  return ` ${ctx.label}: ${ctx.raw} book${ctx.raw !== 1 ? 's' : ''} (${pct}%)`
                },
              },
            },
          },
        },
      }))
    }
  }

  // Animate chart section in after mount
  requestAnimationFrame(() => {
    el.querySelector('.chart-section')?.classList.add('charts-shown')
  })

  return instances
}

function tooltipStyle() {
  return {
    backgroundColor: C.tooltipBg,
    titleColor: C.tooltipTitle,
    bodyColor: C.text,
    borderColor: C.grid,
    borderWidth: 1,
    padding: 10,
    cornerRadius: 8,
  }
}

// ── BotM list helpers ─────────────────────────────────────────────────────────

// state: undefined for a normal card, or 'expanded' / 'collapsed' inside a shared-month row
function botmCardHTML(book, index, state) {
  const month = formatMonth(book.dateCompleted)

  const coverHTML = book.thumbnail
    ? `<img src="${esc(book.thumbnail)}" alt="${esc(book.title)}" loading="lazy"
           data-book-id="${book.id}"
           data-title="${esc(book.title)}"
           data-author="${esc(book.author)}" />`
    : `<div class="book-cover-placeholder" style="width:100%;height:100%;">
         <span class="material-symbols-rounded" style="font-size:28px">menu_book</span>
       </div>`

  return `
    <div class="botm-card ${state || ''}" data-index="${index}" role="button" tabindex="0"
      ${state ? `aria-expanded="${state === 'expanded'}"` : ''}>
      <div class="botm-cover-wrap">${coverHTML}</div>
      <div class="botm-info">
        ${month ? `<div class="botm-month-badge">${month}</div>` : ''}
        <div class="botm-title">${esc(book.title)}</div>
        <div class="botm-author">${esc(book.author)}</div>
        ${starHTML(book.rating)}
        ${book.genre ? `<div class="botm-genre">${esc(book.genre)}</div>` : ''}
      </div>
      ${book.isBOTY ? `<span class="material-symbols-rounded botm-boty-icon">emoji_events</span>` : ''}
      <span class="material-symbols-rounded botm-chevron">chevron_right</span>
    </div>
  `
}

function skeletonList() {
  return Array.from({ length: 3 }, () => `
    <div class="botm-card">
      <div class="botm-cover-wrap skeleton"></div>
      <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
        <div class="skeleton" style="height:11px;border-radius:6px;width:40%"></div>
        <div class="skeleton" style="height:15px;border-radius:6px;width:85%"></div>
        <div class="skeleton" style="height:12px;border-radius:6px;width:55%"></div>
      </div>
    </div>
  `).join('')
}

export function destroyBotm() {}

