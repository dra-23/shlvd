import { auth, signOutUser } from '../firebase.js'
import { watchAllBooks, getBook } from '../db.js'
import { openBookDetail } from './book-detail.js'
import { backHandlerStack } from '../main.js'
import { Chart, registerables } from 'chart.js'

Chart.register(...registerables)
Chart.defaults.font.family = 'Nunito, system-ui, sans-serif'
Chart.defaults.font.size   = 12
Chart.defaults.color       = '#44483d'

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

// 1★→5★: pale rose → warm sand → deep sage (clearly distinct)
const RATING_PALETTE = ['#e8c5c0', '#d8ada8', '#c9b99a', '#afc49d', '#7d9070']

// Alternates green/rose families at different lightness so every
// adjacent slice contrasts regardless of how many genres there are
const DOUGHNUT_PALETTE = [
  '#7d9070', '#c49490', '#98ab88', '#d8ada8',
  '#afc49d', '#e8c5c0', '#b5c4a8', '#c9b99a',
]

let charts = {}
let calState   = { year: 0, month: 0 }
let calendarBooks = []

function killCharts() {
  Object.values(charts).forEach(c => c?.destroy())
  charts = {}
}

export function renderProfile(container) {
  const now = new Date()
  calState = { year: now.getFullYear(), month: now.getMonth() }
  calendarBooks = []

  const user = auth.currentUser
  container.innerHTML = buildHTML(user)

  container.querySelector('#sign-out-btn').addEventListener('click', () => signOutUser())
  initCalendar(container)

  let allBooks = []
  container.querySelector('#year-review-btn').addEventListener('click', () => {
    openYearInReview(allBooks)
  })

  const unsub = watchAllBooks(books => {
    allBooks = books
    calendarBooks = books.filter(b => b.shelf === 'read' && b.dateCompleted)
    updateStats(container, books)
    buildCharts(container, books)
    renderCalendarGrid(container)
  })

  return () => { unsub(); killCharts() }
}

export function destroyProfile() { killCharts() }

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(days) {
  if (days <= 1) return '1 day'
  if (days < 14) return `${Math.round(days)} days`
  if (days < 30) return `${Math.round(days / 7)} wks`
  return `${Math.round(days / 30)} mo`
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function updateStats(container, books) {
  const c = { want: 0, read: 0 }
  books.forEach(b => { if (b.shelf in c) c[b.shelf]++ })
  ;['want', 'read'].forEach(s => {
    const el = container.querySelector(`[data-stat="${s}"]`)
    if (el) el.textContent = c[s]
  })

  // Reading pace — total pages read ÷ days since first completed book
  const readWithPages = books.filter(b => b.shelf === 'read' && b.pageCount > 0 && b.dateCompleted)
  const paceEl = container.querySelector('[data-stat="pace"]')
  if (paceEl) {
    if (readWithPages.length) {
      const totalPg  = readWithPages.reduce((s, b) => s + b.pageCount, 0)
      const earliest = new Date(Math.min(...readWithPages.map(b => b.dateCompleted.getTime())))
      const days     = Math.max(1, Math.round((Date.now() - earliest.getTime()) / 86400000))
      paceEl.textContent = Math.round(totalPg / days)
    } else {
      paceEl.textContent = '—'
    }
  }

  // Total pages read
  const totalPages = books
    .filter(b => b.shelf === 'read' && b.pageCount > 0)
    .reduce((sum, b) => sum + b.pageCount, 0)
  const pagesEl = container.querySelector('[data-stat="pages"]')
  if (pagesEl) pagesEl.textContent = totalPages >= 1000
    ? `${(totalPages / 1000).toFixed(1)}k`
    : totalPages || '—'

  // Average star rating (rated books only)
  const rated = books.filter(b => b.rating > 0)
  const avgRatingEl = container.querySelector('[data-stat="avg-rating"]')
  if (avgRatingEl) avgRatingEl.textContent = rated.length
    ? (rated.reduce((s, b) => s + b.rating, 0) / rated.length).toFixed(1)
    : '—'

  // Average days between book completions
  const withDate = books.filter(b => b.shelf === 'read' && b.dateCompleted)
  const avgDaysEl = container.querySelector('[data-stat="avg-days"]')
  if (avgDaysEl) {
    if (withDate.length >= 2) {
      const earliest = new Date(Math.min(...withDate.map(b => b.dateCompleted.getTime())))
      const latest   = new Date(Math.max(...withDate.map(b => b.dateCompleted.getTime())))
      const span = Math.round((latest.getTime() - earliest.getTime()) / 86400000)
      avgDaysEl.textContent = formatDuration(Math.round(span / (withDate.length - 1)))
    } else {
      avgDaysEl.textContent = '—'
    }
  }

}

// ── Charts ────────────────────────────────────────────────────────────────────

function buildCharts(container, books) {
  killCharts()
  // Animate chart section into view on first data load
  const section = container.querySelector('.chart-section')
  if (section && !section.classList.contains('charts-shown')) {
    requestAnimationFrame(() => section.classList.add('charts-shown'))
  }
  const read = books.filter(b => b.shelf === 'read' && b.dateCompleted)
  chartByYear(container, read)
  chartByMonth(container, read)
  chartRatings(container, books)
  chartAuthors(container, books)
  chartGenres(container, books)
  chartGenreBreakdown(container, books)
}

// Bar — books read by year
function chartByYear(container, read) {
  const m = new Map()
  read.forEach(b => {
    const y = b.dateCompleted.getFullYear().toString()
    m.set(y, (m.get(y) || 0) + 1)
  })
  const labels = Array.from(m.keys()).sort()
  const data   = labels.map(y => m.get(y))
  const ctx = container.querySelector('#chart-year')
  if (!ctx) return
  charts.year = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: C.primary, borderRadius: 6, borderSkipped: false }] },
    options: baseOpts({ scales: { x: xAxis(), y: yAxis() } }),
  })
}

// Line — books read by month
function chartByMonth(container, read) {
  if (!read.length) return
  const m = new Map()
  read.forEach(b => {
    const d   = b.dateCompleted
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    m.set(key, (m.get(key) || 0) + 1)
  })
  const sorted = Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  const labels = sorted.map(([k]) => {
    const [y, mo] = k.split('-')
    return new Date(+y, +mo - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  })
  const data = sorted.map(([, v]) => v)
  const ctx = container.querySelector('#chart-month')
  if (!ctx) return
  charts.month = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: C.secondary,
        backgroundColor: `${C.secondary}44`,
        pointBackgroundColor: C.secondary,
        fill: true,
        tension: 0.35,
        pointRadius: data.length > 24 ? 2 : 4,
        pointHoverRadius: data.length > 24 ? 5 : 7,
        pointHitRadius: 24,
      }],
    },
    options: baseOpts({
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: xAxis({ ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 12 } }),
        y: yAxis(),
      },
    }),
  })
}

// Doughnut — rating breakdown
function chartRatings(container, books) {
  const rated = books.filter(b => b.rating > 0)
  if (!rated.length) return
  const m = new Map([[1,0],[2,0],[3,0],[4,0],[5,0]])
  rated.forEach(b => m.set(b.rating, m.get(b.rating) + 1))
  const ctx = container.querySelector('#chart-ratings')
  if (!ctx) return
  charts.ratings = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['1 ★','2 ★','3 ★','4 ★','5 ★'],
      datasets: [{
        data: [1,2,3,4,5].map(n => m.get(n)),
        backgroundColor: RATING_PALETTE,
        borderWidth: 0,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '60%',
      animation: { duration: 500, easing: 'easeOutQuart' },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { padding: 14, color: C.text, font: { family: 'Nunito, system-ui', size: 12 } },
        },
        tooltip: tooltipStyle(),
      },
    },
  })
}

// Horizontal bar — top 5 authors
function chartAuthors(container, books) {
  const m = new Map()
  books.forEach(b => { if (b.author) m.set(b.author, (m.get(b.author) || 0) + 1) })
  const top = Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
  if (!top.length) return
  const ctx = container.querySelector('#chart-authors')
  if (!ctx) return
  charts.authors = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top.map(([a]) => a),
      datasets: [{ data: top.map(([, n]) => n), backgroundColor: C.primary2, borderRadius: 6, borderSkipped: false }],
    },
    options: baseOpts({ indexAxis: 'y', aspectRatio: 1.4, scales: { x: yAxis(), y: xAxis() } }),
  })
}

// Horizontal bar — top 5 genres
function chartGenres(container, books) {
  const m = new Map()
  books.forEach(b => { if (b.genre) m.set(b.genre, (m.get(b.genre) || 0) + 1) })
  const top = Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
  if (!top.length) return
  const ctx = container.querySelector('#chart-genres')
  if (!ctx) return
  charts.genres = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top.map(([g]) => g),
      datasets: [{ data: top.map(([, n]) => n), backgroundColor: C.tertiary, borderRadius: 6, borderSkipped: false }],
    },
    options: baseOpts({ indexAxis: 'y', aspectRatio: 1.4, scales: { x: yAxis(), y: xAxis() } }),
  })
}

// Doughnut — genre percentage breakdown (all shelves)
function chartGenreBreakdown(container, books) {
  const m = new Map()
  books.forEach(b => { if (b.genre) m.set(b.genre, (m.get(b.genre) || 0) + 1) })
  const entries = Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  if (!entries.length) return
  const ctx = container.querySelector('#chart-genre-breakdown')
  if (!ctx) return
  const total = entries.reduce((s, [, n]) => s + n, 0)
  charts.genreBreakdown = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: entries.map(([g]) => g),
      datasets: [{
        data: entries.map(([, n]) => n),
        backgroundColor: entries.map((_, i) => DOUGHNUT_PALETTE[i % DOUGHNUT_PALETTE.length]),
        borderWidth: 0,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '55%',
      animation: { duration: 500, easing: 'easeOutQuart' },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { padding: 14, color: C.text, font: { family: 'Nunito, system-ui', size: 12 } },
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
  })
}

// ── Chart helpers ─────────────────────────────────────────────────────────────

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

function baseOpts(overrides = {}) {
  return {
    responsive: true,
    maintainAspectRatio: true,
    animation: { duration: 500, easing: 'easeOutQuart' },
    plugins: {
      legend: { display: false },
      tooltip: tooltipStyle(),
    },
    ...overrides,
  }
}

function xAxis(extra = {}) {
  return { grid: { display: false }, border: { display: false }, ticks: { color: C.text }, ...extra }
}

function yAxis(extra = {}) {
  return { grid: { color: C.grid }, border: { display: false }, ticks: { color: C.text, precision: 0 }, ...extra }
}

// ── Reading Calendar ──────────────────────────────────────────────────────────

function initCalendar(container) {
  container.querySelector('#cal-prev')?.addEventListener('click', () => {
    calState.month--
    if (calState.month < 0) { calState.month = 11; calState.year-- }
    renderCalendarGrid(container)
  })
  container.querySelector('#cal-next')?.addEventListener('click', () => {
    calState.month++
    if (calState.month > 11) { calState.month = 0; calState.year++ }
    renderCalendarGrid(container)
  })
}

function renderCalendarGrid(container) {
  const { year, month } = calState
  const monthLabel = new Date(year, month, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const monthEl = container.querySelector('#cal-month-label')
  if (monthEl) monthEl.textContent = monthLabel

  const gridEl = container.querySelector('#cal-grid')
  if (!gridEl) return

  // Map day → books completed that day
  const dayMap = new Map()
  calendarBooks.forEach(b => {
    const d = b.dateCompleted
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate()
      if (!dayMap.has(day)) dayMap.set(day, [])
      dayMap.get(day).push(b)
    }
  })

  const firstDay = new Date(year, month, 1).getDay()  // 0 = Sun
  const lastDay  = new Date(year, month + 1, 0).getDate()
  const DAY_HDRS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

  let html = DAY_HDRS.map(d => `<div class="cal-day-header">${d}</div>`).join('')

  for (let i = 0; i < firstDay; i++) html += `<div class="cal-day cal-day-empty"></div>`

  const today = new Date()
  for (let d = 1; d <= lastDay; d++) {
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d
    const bks = dayMap.get(d) || []
    const chips = bks.map(b =>
      `<button class="cal-book-chip" data-book-id="${b.id}">${b.title}</button>`
    ).join('')
    html += `<div class="cal-day${isToday ? ' cal-today' : ''}${bks.length ? ' cal-has-books' : ''}">
      <div class="cal-day-num">${d}</div>
      ${chips}
    </div>`
  }

  gridEl.innerHTML = html

  // Animate calendar section into view on first render
  const calSection = container.querySelector('.reading-calendar-section')
  if (calSection && !calSection.classList.contains('charts-shown')) {
    requestAnimationFrame(() => calSection.classList.add('charts-shown'))
  }

  // Wire up chip taps → open book detail sheet
  gridEl.querySelectorAll('.cal-book-chip').forEach(chip => {
    chip.addEventListener('click', async e => {
      e.stopPropagation()
      const id = chip.dataset.bookId
      const book = calendarBooks.find(b => b.id === id)
      if (!book) return
      try {
        const full = await getBook(id)
        openBookDetail({ ...book, ...full }, 'read', null)
      } catch {
        openBookDetail(book, 'read', null)
      }
    })
  })
}

// ── Year in Review ────────────────────────────────────────────────────────────

function openYearInReview(books) {
  let year = new Date().getFullYear()

  const scrim = document.createElement('div')
  scrim.className = 'sheet-scrim'
  const sheet = document.createElement('div')
  sheet.className = 'bottom-sheet'
  document.body.appendChild(scrim)
  document.body.appendChild(sheet)

  function render() {
    const readThisYear = books.filter(b =>
      b.shelf === 'read' && b.dateCompleted &&
      b.dateCompleted.getFullYear() === year
    )

    const bookCount   = readThisYear.length
    const pageCount   = readThisYear.reduce((s, b) => s + (b.pageCount || 0), 0)
    const rated       = readThisYear.filter(b => b.rating > 0)
    const avgRating   = rated.length
      ? (rated.reduce((s, b) => s + b.rating, 0) / rated.length).toFixed(1)
      : null

    // Top genre
    const genreMap = new Map()
    readThisYear.forEach(b => { if (b.genre) genreMap.set(b.genre, (genreMap.get(b.genre) || 0) + 1) })
    const topGenre = Array.from(genreMap.entries()).sort((a, b) => b[1] - a[1])[0]

    // Top author
    const authorMap = new Map()
    readThisYear.forEach(b => { if (b.author) authorMap.set(b.author, (authorMap.get(b.author) || 0) + 1) })
    const topAuthor = Array.from(authorMap.entries()).sort((a, b) => b[1] - a[1])[0]

    // Best rated book (highest rating, most recent as tiebreaker)
    const bestBook = rated.length
      ? [...rated].sort((a, b) =>
          b.rating !== a.rating
            ? b.rating - a.rating
            : (b.dateCompleted?.getTime?.() ?? 0) - (a.dateCompleted?.getTime?.() ?? 0)
        )[0]
      : null

    const starsHTML = n => '★'.repeat(n) + '☆'.repeat(5 - n)

    sheet.innerHTML = `
      <div class="sheet-handle"><div class="sheet-handle-bar"></div></div>
      <div class="sheet-header" style="align-items:center;">
        <div class="sheet-meta" style="flex:1;">
          <div class="sheet-title" style="font-size:1.1rem;">Year in Review</div>
        </div>
        <button class="icon-btn" id="yir-close">
          <span class="material-symbols-rounded">close</span>
        </button>
      </div>
      <div class="sheet-body">

        <!-- Year selector -->
        <div class="yir-year-nav">
          <button class="icon-btn" id="yir-prev">
            <span class="material-symbols-rounded">chevron_left</span>
          </button>
          <span class="yir-year-label">${year}</span>
          <button class="icon-btn" id="yir-next">
            <span class="material-symbols-rounded">chevron_right</span>
          </button>
        </div>

        <!-- Review card -->
        <div class="yir-card">
          <div class="yir-card-header">
            <span class="material-symbols-rounded yir-icon">auto_stories</span>
            <span class="yir-card-year">${year}</span>
          </div>

          ${bookCount === 0 ? `
            <div class="yir-empty">No books completed in ${year}</div>
          ` : `
            <div class="yir-hero">
              <div class="yir-hero-num">${bookCount}</div>
              <div class="yir-hero-label">book${bookCount !== 1 ? 's' : ''} finished</div>
            </div>

            <div class="yir-stats-row">
              <div class="yir-stat">
                <div class="yir-stat-num">${pageCount >= 1000 ? `${(pageCount/1000).toFixed(1)}k` : pageCount || '—'}</div>
                <div class="yir-stat-label">pages</div>
              </div>
              <div class="yir-stat-divider"></div>
              <div class="yir-stat">
                <div class="yir-stat-num">${avgRating ? `${avgRating}★` : '—'}</div>
                <div class="yir-stat-label">avg rating</div>
              </div>
            </div>

            ${topGenre ? `
            <div class="yir-detail-row">
              <span class="yir-detail-label">Top Genre</span>
              <span class="yir-detail-value">${topGenre[0]}</span>
            </div>` : ''}

            ${topAuthor ? `
            <div class="yir-detail-row">
              <span class="yir-detail-label">Top Author</span>
              <span class="yir-detail-value">${topAuthor[0]}</span>
            </div>` : ''}

            ${bestBook ? `
            <div class="yir-best-book">
              <div class="yir-best-label">Favourite read</div>
              <div class="yir-best-title">${bestBook.title}</div>
              <div class="yir-best-author">${bestBook.author}</div>
              <div class="yir-best-stars">${starsHTML(bestBook.rating)}</div>
            </div>` : ''}
          `}

          <div class="yir-footer">shlvd</div>
        </div>

      </div>
    `

    sheet.querySelector('#yir-close').addEventListener('click', () => closeSheet('manual'))
    sheet.querySelector('#yir-prev').addEventListener('click', () => { year--; render() })
    sheet.querySelector('#yir-next').addEventListener('click', () => { year++; render() })
  }

  history.pushState({ sheet: true }, '')

  function closeSheet(source) {
    const idx = backHandlerStack.indexOf(closeSheet)
    if (idx !== -1) backHandlerStack.splice(idx, 1)
    if (source !== 'popstate') history.back()
    scrim.classList.add('closing')
    sheet.classList.add('closing')
    setTimeout(() => { scrim.remove(); sheet.remove() }, 300)
  }

  backHandlerStack.push(closeSheet)
  scrim.addEventListener('click', () => closeSheet('manual'))

  let dragStartY = 0, dragging = false
  sheet.addEventListener('touchstart', e => {
    dragStartY = e.touches[0].clientY; dragging = true; sheet.style.transition = 'none'
  }, { passive: true })
  sheet.addEventListener('touchmove', e => {
    if (!dragging) return
    const dy = e.touches[0].clientY - dragStartY
    if (dy > 0) sheet.style.transform = `translateY(${dy}px)`
  }, { passive: true })
  sheet.addEventListener('touchend', e => {
    if (!dragging) return
    dragging = false; sheet.style.transition = ''
    if (e.changedTouches[0].clientY - dragStartY > 120) closeSheet('manual')
    else sheet.style.transform = ''
  }, { passive: true })

  render()
}

// ── HTML ──────────────────────────────────────────────────────────────────────

function buildHTML(user) {
  const avatarHTML = user?.photoURL
    ? `<img src="${user.photoURL}" alt="Avatar" />`
    : `<span class="material-symbols-rounded">person</span>`

  return `
    <div class="profile-screen">
      <div class="profile-hero">
        <div class="profile-avatar">${avatarHTML}</div>
        <div class="profile-name">${user?.displayName || 'Reader'}</div>
        <div class="profile-email">${user?.email || ''}</div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-number" data-stat="read">—</div>
          <div class="stat-label">Read</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" data-stat="pace">—</div>
          <div class="stat-label">Pages / Day</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" data-stat="want">—</div>
          <div class="stat-label">TBR</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" data-stat="pages">—</div>
          <div class="stat-label">Pages Read</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" data-stat="avg-rating">—</div>
          <div class="stat-label">Avg Rating</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" data-stat="avg-days">—</div>
          <div class="stat-label">Days / Book</div>
        </div>
      </div>

      <div class="chart-section">
        <div class="chart-card">
          <div class="chart-title">Books Read by Year</div>
          <canvas id="chart-year"></canvas>
        </div>
        <div class="chart-card">
          <div class="chart-title">Books Read by Month</div>
          <canvas id="chart-month"></canvas>
        </div>
        <div class="chart-card">
          <div class="chart-title">Rating Breakdown</div>
          <div style="max-width:240px;margin:0 auto;">
            <canvas id="chart-ratings"></canvas>
          </div>
        </div>
        <div class="chart-card">
          <div class="chart-title">Top 5 Authors</div>
          <canvas id="chart-authors"></canvas>
        </div>
        <div class="chart-card">
          <div class="chart-title">Top 5 Genres</div>
          <canvas id="chart-genres"></canvas>
        </div>
        <div class="chart-card">
          <div class="chart-title">Genre Breakdown</div>
          <div style="max-width:260px;margin:0 auto;">
            <canvas id="chart-genre-breakdown"></canvas>
          </div>
        </div>
      </div>

      <!-- Reading Calendar -->
      <div class="reading-calendar-section">
        <div class="chart-card" style="padding:12px 16px 16px;">
          <div class="cal-nav">
            <button class="icon-btn" id="cal-prev" aria-label="Previous month">
              <span class="material-symbols-rounded">chevron_left</span>
            </button>
            <span id="cal-month-label" class="chart-title" style="margin:0;flex:1;text-align:center;"></span>
            <button class="icon-btn" id="cal-next" aria-label="Next month">
              <span class="material-symbols-rounded">chevron_right</span>
            </button>
          </div>
          <div id="cal-grid" class="cal-grid"></div>
        </div>
      </div>

      <div class="profile-actions">
        <button class="btn btn-tonal" id="year-review-btn" style="width:100%; height:48px;">
          <span class="material-symbols-rounded">auto_stories</span>
          Year in Review
        </button>
        <button class="btn btn-outlined" id="sign-out-btn" style="width:100%; height:48px;">
          <span class="material-symbols-rounded">logout</span>
          Sign out
        </button>
      </div>
    </div>
  `
}
