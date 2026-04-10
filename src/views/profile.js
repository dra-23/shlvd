import { auth, signOutUser } from '../firebase.js'
import { watchAllBooks } from '../db.js'
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

function killCharts() {
  Object.values(charts).forEach(c => c?.destroy())
  charts = {}
}

export function renderProfile(container) {
  const user = auth.currentUser
  container.innerHTML = buildHTML(user)

  container.querySelector('#sign-out-btn').addEventListener('click', () => signOutUser())

  const unsub = watchAllBooks(books => {
    updateStats(container, books)
    buildCharts(container, books)
  })

  return () => { unsub(); killCharts() }
}

export function destroyProfile() { killCharts() }

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

  // Average book length (all shelves with a page count)
  const withPages = books.filter(b => b.pageCount > 0)
  const avgLenEl = container.querySelector('[data-stat="avg-length"]')
  if (avgLenEl) avgLenEl.textContent = withPages.length
    ? Math.round(withPages.reduce((s, b) => s + b.pageCount, 0) / withPages.length)
    : '—'

  // Average star rating (rated books only)
  const rated = books.filter(b => b.rating > 0)
  const avgRatingEl = container.querySelector('[data-stat="avg-rating"]')
  if (avgRatingEl) avgRatingEl.textContent = rated.length
    ? (rated.reduce((s, b) => s + b.rating, 0) / rated.length).toFixed(1)
    : '—'
}

// ── Charts ────────────────────────────────────────────────────────────────────

function buildCharts(container, books) {
  killCharts()
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
      }],
    },
    options: baseOpts({
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
          <div class="stat-label">Queued</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" data-stat="pages">—</div>
          <div class="stat-label">Pages Read</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" data-stat="avg-length">—</div>
          <div class="stat-label">Avg Length</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" data-stat="avg-rating">—</div>
          <div class="stat-label">Avg Rating</div>
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

      <div class="profile-actions">
        <button class="btn btn-outlined" id="sign-out-btn" style="width:100%; height:48px;">
          <span class="material-symbols-rounded">logout</span>
          Sign out
        </button>
      </div>
    </div>
  `
}
