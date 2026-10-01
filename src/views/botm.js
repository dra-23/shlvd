import { esc } from '../escape.js'
import { watchBotm, watchAllBooks } from '../db.js'
import { backHandlerStack, popOwnHistoryEntry } from '../main.js'
import { openBookDetail } from './book-detail.js'
import { Chart, registerables } from 'chart.js'
import { chartColors } from '../theme.js'

Chart.register(...registerables)

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
      </div>

      <div id="botm-content" style="padding:0 0 16px;flex:1;overflow-y:auto;">
        <div class="botm-list-container">
          ${skeletonList()}
        </div>
      </div>
    </div>
  `

  const content = container.querySelector('#botm-content')

  const unsubBotm = watchBotm(books => {
    if (!books.length) {
      content.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-rounded">auto_awesome</span>
          <div class="empty-state-title">No BotM books yet</div>
          <div class="empty-state-body">Open any book and tap the ✦ Book of the Month button to flag it.</div>
        </div>
      `
      return
    }

    const groups = groupByYear(books)
    // Same order as the cards on screen, so card i is botmBooks[i]
    botmBooks = groups.flatMap(g => g.books)
    content.innerHTML = groups.map(({ year, books: yb }) => `
      <div class="botm-year-header">${year}</div>
      <div class="botm-list">${yb.map(botmCardHTML).join('')}</div>
    `).join('')

    content.querySelectorAll('.botm-card').forEach((card, i) => {
      card.addEventListener('click', () => openBotmPage(i, container))
    })
  })

  const unsubAll = watchAllBooks(books => {
    allReadBooks = books.filter(b => b.shelf === 'read')
  })

  return () => { unsubBotm(); unsubAll() }
}

// ── BotM detail page ──────────────────────────────────────────────────────────

// Picks in list order (newest first) — the month page steps through these
let botmBooks = []

function openBotmPage(index, viewEl) {
  const page = document.createElement('div')
  page.className = 'botm-detail-page'
  page.style.transform = 'translateX(100%)'

  // Append inside the .view so it's clipped by overflow-x:hidden during
  // the slide animation and automatically removed when navigating away
  viewEl.appendChild(page)

  let current = index
  let chartInstances = []

  function render(direction = null) {
    chartInstances.forEach(c => c?.destroy())
    const book = botmBooks[current]
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
    page.querySelector('.botm-newer-btn')?.addEventListener('click', () => step('newer'))

    const others = monthBooks.filter(b => b.id !== book.id)
    page.querySelectorAll('.botm-also-item').forEach((el, i) => {
      el.addEventListener('click', () => openBookDetail(others[i], 'read', () => render()))
    })

    requestAnimationFrame(() => { chartInstances = mountMonthCharts(page, monthBooks) })
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

function groupByYear(books) {
  const map = new Map()
  books.forEach(book => {
    const d    = book.dateCompleted
    const year = d ? (d instanceof Date ? d : new Date(d)).getFullYear().toString() : 'Unknown'
    if (!map.has(year)) map.set(year, [])
    map.get(year).push(book)
  })
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, books]) => ({ year, books }))
}

function botmCardHTML(book) {
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
    <div class="botm-card">
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
