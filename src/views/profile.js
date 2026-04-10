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
  secondary: '#afc49d',
  tertiary:  '#d8ada8',
  tertiary2: '#c49490',
  tertiary3: '#e8c5c0',
  grid:      '#e4e9e0',
  text:      '#44483d',
}

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
  const c = { want: 0, reading: 0, read: 0 }
  books.forEach(b => { if (b.shelf in c) c[b.shelf]++ })
  ;['want', 'reading', 'read'].forEach(s => {
    const el = container.querySelector(`[data-stat="${s}"]`)
    if (el) el.textContent = c[s]
  })
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
        backgroundColor: [C.tertiary3, C.tertiary, C.tertiary2, C.secondary, C.primary],
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
          <div class="stat-number" data-stat="reading">—</div>
          <div class="stat-label">Reading</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" data-stat="want">—</div>
          <div class="stat-label">Queued</div>
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
