import { watchBotm, watchAllBooks } from '../db.js'
import { openBookDetail } from './book-detail.js'
import { Chart, registerables } from 'chart.js'

Chart.register(...registerables)

const C = {
  primary:   '#98ab88',
  primary2:  '#b5c4a8',
  secondary: '#afc49d',
  tertiary:  '#d8ada8',
  tertiary2: '#c49490',
  tertiary3: '#e8c5c0',
  grid:      '#e4e9e0',
  text:      '#44483d',
}

// All read books — kept fresh by a background watcher
let allReadBooks = []

function formatMonth(date) {
  if (!date) return ''
  try {
    const d = date instanceof Date ? date : new Date(date)
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()
  } catch { return '' }
}

function starHTML(rating) {
  if (!rating) return ''
  const goldColor    = '#FFB800'
  const outlineColor = 'var(--md-outline-variant)'
  return `<div class="botm-stars">${[1,2,3,4,5].map(n =>
    `<span class="material-symbols-rounded botm-star"
      style="font-size:18px; ${n <= rating
        ? `font-variation-settings:'FILL' 1; color:${goldColor};`
        : `color:${outlineColor};`}">star</span>`
  ).join('')}</div>`
}

export function renderBotm(container) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;">

      <div class="shelves-top" style="display:flex; align-items:center;">
        <img src="/icons/logo2-512.png" class="shelves-logo" alt="shlvd" />
        <div style="height:56px; display:flex; align-items:center; margin-left:12px;">
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
    content.innerHTML = groups.map(({ year, books: yb }) => `
      <div class="botm-year-header">${year}</div>
      <div class="botm-list">${yb.map(botmCardHTML).join('')}</div>
    `).join('')

    content.querySelectorAll('.botm-card').forEach((card, i) => {
      card.addEventListener('click', () => openBotmDetail(books[i]))
    })
  })

  // Keep allReadBooks fresh so month stats are accurate
  const unsubAll = watchAllBooks(books => {
    allReadBooks = books.filter(b => b.shelf === 'read')
  })

  return () => { unsubBotm(); unsubAll() }
}

// ── BotM detail sheet with month stats ───────────────────────────────────────

function openBotmDetail(book) {
  if (!book.dateCompleted) {
    // No date — fall back to plain book detail
    openBookDetail(book, book.shelf, null)
    return
  }

  const d     = book.dateCompleted
  const year  = d.getFullYear()
  const month = d.getMonth()

  const monthBooks = allReadBooks.filter(b => {
    if (!b.dateCompleted) return false
    return b.dateCompleted.getFullYear() === year && b.dateCompleted.getMonth() === month
  })

  const monthLabel = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const extraHTML  = buildMonthStatsHTML(monthLabel, monthBooks)

  let chartInstances = []

  openBookDetail(
    book,
    book.shelf,
    null,
    extraHTML,
    (sheet) => { chartInstances = mountMonthCharts(sheet, monthBooks) },
    ()      => { chartInstances.forEach(c => c?.destroy()); chartInstances = [] }
  )
}

// ── Month stats HTML ──────────────────────────────────────────────────────────

function buildMonthStatsHTML(label, books) {
  const count      = books.length
  const totalPages = books.filter(b => b.pageCount > 0).reduce((s, b) => s + b.pageCount, 0)
  const rated      = books.filter(b => b.rating > 0)
  const avgRating  = rated.length
    ? (rated.reduce((s, b) => s + b.rating, 0) / rated.length).toFixed(1)
    : '—'
  const pagesDisplay = totalPages >= 1000
    ? `${(totalPages / 1000).toFixed(1)}k`
    : (totalPages || '—')

  const hasRatings = rated.length > 0
  const hasGenres  = books.some(b => b.genre)

  return `
    <div style="margin-top:8px;padding-top:16px;border-top:1px solid var(--md-outline-variant);">
      <div class="sheet-section-label" style="margin-bottom:12px;">${label.toUpperCase()} IN REVIEW</div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">
        <div class="stat-card">
          <div class="stat-number" style="font-size:1.5rem;">${count}</div>
          <div class="stat-label">Books</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" style="font-size:1.5rem;">${pagesDisplay}</div>
          <div class="stat-label">Pages</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" style="font-size:1.5rem;">${avgRating}</div>
          <div class="stat-label">Avg Rating</div>
        </div>
      </div>

      ${hasRatings ? `
      <div class="chart-card" style="margin-bottom:8px;">
        <div class="chart-title">Rating Breakdown</div>
        <div style="max-width:220px;margin:0 auto;">
          <canvas id="botm-chart-ratings"></canvas>
        </div>
      </div>` : ''}

      ${hasGenres ? `
      <div class="chart-card">
        <div class="chart-title">Genres</div>
        <canvas id="botm-chart-genres"></canvas>
      </div>` : ''}
    </div>
  `
}

// ── Month charts ──────────────────────────────────────────────────────────────

function mountMonthCharts(sheet, books) {
  const instances = []

  // Doughnut — ratings
  const rCtx = sheet.querySelector('#botm-chart-ratings')
  if (rCtx) {
    const m = new Map([[1,0],[2,0],[3,0],[4,0],[5,0]])
    books.filter(b => b.rating > 0).forEach(b => m.set(b.rating, m.get(b.rating) + 1))
    instances.push(new Chart(rCtx, {
      type: 'doughnut',
      data: {
        labels: ['1 ★','2 ★','3 ★','4 ★','5 ★'],
        datasets: [{
          data: [1,2,3,4,5].map(n => m.get(n)),
          backgroundColor: [C.tertiary3, C.tertiary, C.tertiary2, C.secondary, C.primary],
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

  // Horizontal bar — genres
  const gCtx = sheet.querySelector('#botm-chart-genres')
  if (gCtx) {
    const m = new Map()
    books.forEach(b => { if (b.genre) m.set(b.genre, (m.get(b.genre) || 0) + 1) })
    const top = Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
    if (top.length) {
      instances.push(new Chart(gCtx, {
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

  return instances
}

function tooltipStyle() {
  return {
    backgroundColor: '#fff',
    titleColor: '#1a1c18',
    bodyColor: C.text,
    borderColor: C.grid,
    borderWidth: 1,
    padding: 10,
    cornerRadius: 8,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    ? `<img src="${book.thumbnail}" alt="${book.title}" loading="lazy"
           data-book-id="${book.id}"
           data-title="${book.title.replace(/"/g, '&quot;')}"
           data-author="${(book.author || '').replace(/"/g, '&quot;')}" />`
    : `<div class="book-cover-placeholder" style="width:100%;height:100%;">
         <span class="material-symbols-rounded" style="font-size:28px">menu_book</span>
       </div>`

  return `
    <div class="botm-card">
      <div class="botm-cover-wrap">${coverHTML}</div>
      <div class="botm-info">
        ${month ? `<div class="botm-month-badge">${month}</div>` : ''}
        <div class="botm-title">${book.title}</div>
        <div class="botm-author">${book.author}</div>
        ${starHTML(book.rating)}
        ${book.genre ? `<div class="botm-genre">${book.genre}</div>` : ''}
      </div>
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
