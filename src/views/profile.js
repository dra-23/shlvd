import { esc } from '../escape.js'
import { auth } from '../firebase.js'
import { watchAllBooks, updateBook } from '../db.js'
import { openBookDetail } from './book-detail.js'
import { showSnackbar, coverImgHTML } from './shelves.js'
import { mountReadingGoal } from './reading-goal.js'
import { drawYearCard, shareImage } from '../share.js'
import { suggestTitleFix, getConfirmedTitleIds, confirmTitle } from '../title-check.js'
import { backHandlerStack, popOwnHistoryEntry } from '../main.js'
import { splitAuthors, authorAvatarHTML, hydrateAuthorAvatars } from '../authors.js'
import { openAuthorPage } from './author.js'
import { openLibrary } from './library.js'
import { openSheet } from './sheet.js'
import { openSettingsPage } from './settings.js'
import { openStatDetail, bookRowHTML, genreRowHTML } from './profile-detail.js'
import {
  DAY, MONTHS, MONTHS_LONG, short, plural, dayKey, avgRating, sumPages, weekIndex,
  longestWeekStreak, yearChipsHTML, centreChip, genreSlots, genreBreakdown,
} from '../stats.js'

// Profile: your reading stats for one year (or all time). The year chips at
// the top filter every section below them. Charts are plain HTML/SVG styled
// from CSS variables, so they follow light/dark mode without redrawing.

export function renderProfile(container) {
  const now = new Date()
  const thisYear = now.getFullYear()
  const user = auth.currentUser

  let books = []        // every book
  let read = []         // finished books with a completion date
  let year = thisYear   // or 'all'
  let cal = { y: thisYear, m: now.getMonth() }
  let genreColour = new Map() // genre → palette slot, by all-time rank so colours stay put

  container.innerHTML = buildHTML(user)
  const $ = sel => container.querySelector(sel)
  const scroller = $('.profile-scroll')

  $('#profile-back').addEventListener('click', () => history.back())
  $('#profile-settings').addEventListener('click', () => openSettingsPage())
  $('#year-review-btn').addEventListener('click', () => openYearInReview(books, year === 'all' ? thisYear : year))

  const goal = mountReadingGoal($('#goal-card'))

  const unsub = watchAllBooks(all => {
    books = all
    read = all.filter(b => b.shelf === 'read' && b.dateCompleted)
    goal.update(all)
    rankGenres()
    renderAll()
    renderFixTitles(container, all)
  })
  initFixTitles(container)

  // ── Period helpers ────────────────────────────────────────────────────────

  const inPeriod = b => year === 'all' || b.dateCompleted.getFullYear() === year
  const periodBooks = () => read.filter(inPeriod)
  const periodName = () => year === 'all' ? 'all time' : String(year)

  function periodDays() {
    if (year === 'all') {
      if (!read.length) return 1
      const first = Math.min(...read.map(b => b.dateCompleted.getTime()))
      return Math.max(1, Math.round((now - first) / DAY))
    }
    const end = year === thisYear ? now : new Date(year + 1, 0, 1)
    return Math.max(1, Math.round((end - new Date(year, 0, 1)) / DAY))
  }

  // Last year to compare against — up to the same date when looking at this year
  function comparison() {
    if (year === 'all') return null
    const cutoff = year === thisYear ? new Date(year - 1, now.getMonth(), now.getDate(), 23, 59) : null
    const list = read.filter(b => b.dateCompleted.getFullYear() === year - 1 && (!cutoff || b.dateCompleted <= cutoff))
    if (!list.length) return null
    const days = cutoff ? Math.max(1, Math.round((cutoff - new Date(year - 1, 0, 1)) / DAY)) : Math.round((new Date(year, 0, 1) - new Date(year - 1, 0, 1)) / DAY)
    return { list, days, label: cutoff ? 'this time last year' : String(year - 1) }
  }

  function rankGenres() { genreColour = genreSlots(read) }

  // ── Render ────────────────────────────────────────────────────────────────

  function renderAll() {
    renderSummary()
    renderYears()
    renderYir()
    $('#goal-card').hidden = year !== thisYear
    renderTiles()
    renderActivity()
    renderMonthly()
    renderCalendar()
    renderRatings()
    renderAuthors()
    renderGenres()
    if (!container.querySelector('.pf-sections.shown')) {
      requestAnimationFrame(() => $('.pf-sections')?.classList.add('shown'))
    }
  }

  function renderSummary() {
    const first = read.length ? Math.min(...read.map(b => b.dateCompleted.getFullYear())) : null
    $('#pf-summary').textContent = read.length
      ? `${plural(read.length, 'book')} read since ${first}`
      : 'Your reading stats live here'
  }

  function renderYears() { $('#pf-years').innerHTML = yearChipsHTML(read, year) }

  function renderYir() {
    const y = year === 'all' ? thisYear : year
    const n = read.filter(b => b.dateCompleted.getFullYear() === y).length
    $('#yir-title').textContent = `Your ${y} in review`
    $('#yir-sub').textContent = n
      ? `${plural(n, 'book')}${y === thisYear ? ' so far' : ''} · see it and share it`
      : 'Look back on any year'
  }

  function renderTiles() {
    const list = periodBooks()
    const days = periodDays()
    const pages = sumPages(list)
    const rating = avgRating(list)
    const cmp = comparison()

    const delta = (now, then, { pct = false, digits = 0 } = {}) => {
      if (!cmp || then == null || now == null) return ''
      const d = pct ? (then ? (now - then) / then * 100 : null) : now - then
      if (d == null) return ''
      const shown = Math.abs(d).toFixed(pct ? 0 : digits)
      if (Number(shown) === 0) return '<span class="pf-delta">same</span>'
      return `<span class="pf-delta">${d > 0 ? '↑' : '↓'} ${shown}${pct ? '%' : ''}</span>`
    }

    const prevPages = cmp && sumPages(cmp.list)
    const tiles = [
      [list.length || '0', 'books', delta(list.length, cmp?.list.length)],
      [pages ? short(pages) : '—', 'pages', delta(pages, prevPages, { pct: true })],
      [rating ? `${rating.toFixed(1)}★` : '—', 'avg rating', delta(rating, cmp && avgRating(cmp.list), { digits: 1 })],
      [pages ? Math.round(pages / days) : '—', 'pages / day', pages ? delta(pages / days, cmp && prevPages / cmp.days, { pct: true }) : ''],
      [list.length ? Math.round(days / list.length) : '—', 'days / book', ''],
      [list.length ? longestWeekStreak(list) : '—', 'week streak', ''],
    ]
    $('#pf-tiles').innerHTML = tiles.map(([value, label, d]) => `
      <div class="pf-tile">
        <div class="pf-tile-value">${value}</div>
        <div class="pf-tile-label">${label}</div>
        ${d}
      </div>`).join('')
    $('#pf-tiles-note').textContent = cmp ? `Arrows compare with ${cmp.label}` : ''
  }

  // ── Reading activity heatmap ──────────────────────────────────────────────

  const level = (n, max) => n ? Math.max(1, Math.min(4, Math.ceil(n / max * 4))) : 0
  const legendHTML = `
    <div class="pf-legend" aria-hidden="true">Less ${[0, 1, 2, 3, 4].map(l => `<i class="hm-cell" style="--l:${l}"></i>`).join('')} More</div>`

  function renderActivity() {
    const el = $('#pf-activity')
    if (year === 'all') return renderActivityAllTime(el)

    const byDay = new Map()
    periodBooks().forEach(b => {
      const k = dayKey(b.dateCompleted)
      byDay.set(k, [...(byDay.get(k) || []), b])
    })
    const start = new Date(year, 0, 1)
    start.setDate(1 - start.getDay()) // back to Sunday
    const end = new Date(year, 11, 31)
    end.setDate(end.getDate() + (6 - end.getDay()))

    let cells = '', labels = '', col = 0
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0) col++
      if (d.getDate() === 1 && d.getFullYear() === year) labels += `<span style="grid-column:${col}">${MONTHS[d.getMonth()]}</span>`
      const outside = d.getFullYear() !== year
      const future = d > now
      const list = byDay.get(dayKey(d)) || []
      const l = list.length ? Math.min(4, list.length + 1) : 0
      cells += outside
        ? '<i class="hm-cell hm-out"></i>'
        : `<button class="hm-cell ${future ? 'hm-future' : ''}" style="--l:${l}" data-day="${d.getTime()}"
            aria-label="${d.toDateString()}: ${plural(list.length, 'book')}"></button>`
    }
    const active = byDay.size
    el.innerHTML = `
      <div class="pf-card-head"><h2>Reading activity</h2><span>${plural(active, 'day')} with a book</span><button class="icon-btn pf-expand" data-expand="activity" aria-label="Expand"><span class="material-symbols-rounded">open_in_full</span></button></div>
      <div class="hm-scroll">
        <div class="hm-months" style="--cols:${col}">${labels}</div>
        <div class="hm-grid" style="--cols:${col}">${cells}</div>
      </div>
      ${legendHTML}
      <div class="pf-readout" id="hm-readout">Tap a day to see what you finished</div>`

    el._byDay = byDay
    // Show the most recent weeks first
    const scroll = el.querySelector('.hm-scroll')
    if (year === thisYear) {
      const cellW = scroll.scrollWidth / col
      scroll.scrollLeft = Math.max(0, weekIndex(now) - weekIndex(start) - 14) * cellW
    }
  }

  function renderActivityAllTime(el) {
    const counts = new Map()
    read.forEach(b => {
      const k = `${b.dateCompleted.getFullYear()}-${b.dateCompleted.getMonth()}`
      counts.set(k, (counts.get(k) || 0) + 1)
    })
    const years = [...new Set(read.map(b => b.dateCompleted.getFullYear()))].sort((a, b) => b - a)
    const max = Math.max(1, ...counts.values())
    el.innerHTML = `
      <div class="pf-card-head"><h2>Reading activity</h2><span>books per month</span><button class="icon-btn pf-expand" data-expand="activity" aria-label="Expand"><span class="material-symbols-rounded">open_in_full</span></button></div>
      <div class="hm-year-grid">
        <span></span>${MONTHS.map(m => `<span class="hm-col-label">${m[0]}</span>`).join('')}
        ${years.map(y => `
          <span class="hm-row-label">${y}</span>
          ${MONTHS.map((_, m) => {
            const n = counts.get(`${y}-${m}`) || 0
            const future = new Date(y, m, 1) > now
            return `<button class="hm-cell ${future ? 'hm-future' : ''}" style="--l:${level(n, max)}" data-ym="${y}-${m}"
              aria-label="${MONTHS_LONG[m]} ${y}: ${plural(n, 'book')}"></button>`
          }).join('')}`).join('')}
      </div>
      ${legendHTML}
      <div class="pf-readout" id="hm-readout">Tap a month to see it in the calendar below</div>`
    el._counts = counts
  }

  function selectHeatCell(cell) {
    const el = $('#pf-activity')
    el.querySelectorAll('.hm-cell.selected').forEach(c => c.classList.remove('selected'))
    cell.classList.add('selected')
    const out = $('#hm-readout')
    if (cell.dataset.day) {
      const d = new Date(Number(cell.dataset.day))
      const list = el._byDay.get(dayKey(d)) || []
      const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      out.innerHTML = list.length
        ? `<b>${date}</b> · ${list.map(b => `<button class="pf-book-link" data-open-book="${esc(b.id)}">${esc(b.title)}</button>`).join(', ')}`
        : `<b>${date}</b> · no books finished`
    } else {
      const [y, m] = cell.dataset.ym.split('-').map(Number)
      const n = el._counts.get(cell.dataset.ym) || 0
      out.innerHTML = `<b>${MONTHS_LONG[m]} ${y}</b> · ${plural(n, 'book')}`
      cal = { y, m }
      renderCalendar()
    }
  }

  // ── Books per month (or per year, all time) ──────────────────────────────

  function renderMonthly() {
    const el = $('#pf-monthly')
    let labels, counts, pages, selected, avg, title, note
    if (year === 'all') {
      const years = [...new Set(read.map(b => b.dateCompleted.getFullYear()))].sort((a, b) => a - b)
      const span = years.length ? Array.from({ length: thisYear - years[0] + 1 }, (_, i) => years[0] + i) : []
      labels = span.map(y => `’${String(y).slice(2)}`)
      counts = span.map(y => read.filter(b => b.dateCompleted.getFullYear() === y).length)
      pages = span.map(y => sumPages(read.filter(b => b.dateCompleted.getFullYear() === y)))
      el._keys = span
      selected = -1
      avg = counts.length ? counts.reduce((s, n) => s + n, 0) / counts.length : 0
      title = 'Books per year'
      note = 'Tap a year to explore it'
    } else {
      const list = periodBooks()
      labels = MONTHS.map(m => m[0])
      counts = MONTHS.map((_, m) => list.filter(b => b.dateCompleted.getMonth() === m).length)
      pages = MONTHS.map((_, m) => sumPages(list.filter(b => b.dateCompleted.getMonth() === m)))
      el._keys = MONTHS.map((_, m) => m)
      const elapsed = year === thisYear ? now.getMonth() + 1 : 12
      avg = counts.slice(0, elapsed).reduce((s, n) => s + n, 0) / elapsed
      selected = cal.y === year ? cal.m : counts.indexOf(Math.max(...counts))
      title = 'Books per month'
      note = ''
    }
    el._counts = counts
    el._pages = pages
    const max = Math.max(1, ...counts)
    el.innerHTML = `
      <div class="pf-card-head"><h2>${title}</h2><span>avg ${avg.toFixed(1)}</span><button class="icon-btn pf-expand" data-expand="monthly" aria-label="Expand"><span class="material-symbols-rounded">open_in_full</span></button></div>
      <div class="pf-bars" style="--n:${counts.length}">
        ${avg ? `<div class="pf-avg" style="bottom:${avg / max * 100}%" aria-hidden="true"></div>` : ''}
        ${counts.map((n, i) => `
          <button class="pf-bar-col ${i === selected ? 'selected' : ''}" data-bar="${i}"
            aria-label="${year === 'all' ? el._keys[i] : MONTHS_LONG[i]}: ${plural(n, 'book')}">
            <span class="pf-bar-val">${n}</span>
            <span class="pf-bar" style="height:${n / max * 100}%; animation-delay:${i * 25}ms"></span>
          </button>`).join('')}
      </div>
      <div class="pf-bar-labels" style="--n:${counts.length}">${labels.map(l => `<span>${l}</span>`).join('')}</div>
      <div class="pf-readout" id="bars-readout">${note}</div>`
    if (selected >= 0) describeBar(selected)
  }

  function describeBar(i) {
    const el = $('#pf-monthly')
    const n = el._counts[i], pg = el._pages[i]
    $('#bars-readout').innerHTML = `<b>${MONTHS_LONG[i]} ${year}</b> · ${plural(n, 'book')}${pg ? ` · ${pg.toLocaleString()} pages` : ''}`
  }

  function selectBar(i) {
    const el = $('#pf-monthly')
    if (year === 'all') return setYear(el._keys[i])
    el.querySelectorAll('.pf-bar-col').forEach(c => c.classList.toggle('selected', Number(c.dataset.bar) === i))
    describeBar(i)
    cal = { y: year, m: i }
    renderCalendar()
  }

  // ── Cover calendar ────────────────────────────────────────────────────────

  function renderCalendar() {
    const el = $('#pf-calendar')
    const { y, m } = cal
    const byDay = new Map()
    read.forEach(b => {
      const d = b.dateCompleted
      if (d.getFullYear() === y && d.getMonth() === m) byDay.set(d.getDate(), [...(byDay.get(d.getDate()) || []), b])
    })
    const first = new Date(y, m, 1).getDay()
    const last = new Date(y, m + 1, 0).getDate()
    const total = [...byDay.values()].reduce((s, l) => s + l.length, 0)

    let cells = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<span class="pf-cal-head">${d}</span>`).join('')
    cells += '<span></span>'.repeat(first)
    for (let d = 1; d <= last; d++) {
      const list = byDay.get(d) || []
      const isToday = y === thisYear && m === now.getMonth() && d === now.getDate()
      if (!list.length) {
        cells += `<span class="pf-cal-day ${isToday ? 'today' : ''}"><span class="pf-cal-num">${d}</span></span>`
        continue
      }
      const b = list[0]
      cells += `
        <button class="pf-cal-day has-book ${list.some(x => x.isBOTM) ? 'is-botm' : ''}" data-cal-day="${d}"
          aria-label="${MONTHS_LONG[m]} ${d}: ${esc(list.map(x => x.title).join(', '))}">
          ${b.thumbnail ? `<img src="${esc(b.thumbnail)}" alt="" loading="lazy" />` : `<span class="pf-cal-noimg">${esc(b.title)}</span>`}
          <span class="pf-cal-num">${d}</span>
          ${list.length > 1 ? `<span class="pf-cal-more">+${list.length - 1}</span>` : ''}
        </button>`
    }
    el._byDay = byDay
    el.innerHTML = `
      <div class="pf-cal-nav">
        <button class="icon-btn" data-cal-step="-1" aria-label="Previous month"><span class="material-symbols-rounded">chevron_left</span></button>
        <div class="pf-cal-title"><h2>${MONTHS_LONG[m]} ${y}</h2><span>${total ? plural(total, 'book') + ' finished' : 'No books finished'}</span></div>
        <button class="icon-btn" data-cal-step="1" aria-label="Next month"><span class="material-symbols-rounded">chevron_right</span></button>
        <button class="icon-btn pf-expand" data-expand="calendar" aria-label="Expand"><span class="material-symbols-rounded">open_in_full</span></button>
      </div>
      <div class="pf-cal-grid">${cells}</div>
      <div class="pf-cal-list" id="pf-cal-list"></div>`
  }

  function stepCalendar(step) {
    let { y, m } = cal
    m += step
    if (m < 0) { m = 11; y-- }
    if (m > 11) { m = 0; y++ }
    cal = { y, m }
    renderCalendar()
    // Keep the month bars in step when the calendar stays inside the chosen year
    if (y === year) {
      $('#pf-monthly').querySelectorAll('.pf-bar-col').forEach(c => c.classList.toggle('selected', Number(c.dataset.bar) === m))
      describeBar(m)
    }
  }

  function tapCalendarDay(d) {
    const list = $('#pf-calendar')._byDay.get(d) || []
    if (list.length === 1) return openBook(list[0])
    $('#pf-cal-list').innerHTML = `
      <div class="pf-cal-list-head">${MONTHS_LONG[cal.m]} ${d}</div>
      ${list.map(bookRowHTML).join('')}`
  }

  // ── Ratings ───────────────────────────────────────────────────────────────

  function renderRatings() {
    const el = $('#pf-ratings')
    const list = periodBooks()
    const rated = list.filter(b => b.rating > 0)
    const counts = [5, 4, 3, 2, 1].map(s => rated.filter(b => b.rating === s).length)
    const max = Math.max(1, ...counts)
    const avg = avgRating(list)
    el.innerHTML = `
      <div class="pf-card-head"><h2>Ratings</h2><span>${avg ? `${avg.toFixed(1)}★ average` : 'No ratings yet'}</span><button class="icon-btn pf-expand" data-expand="ratings" aria-label="Expand"><span class="material-symbols-rounded">open_in_full</span></button></div>
      ${[5, 4, 3, 2, 1].map((s, i) => `
        <button class="pf-hbar-row" data-rating="${s}" ${counts[i] ? '' : 'disabled'}
          aria-label="${s} stars: ${plural(counts[i], 'book')}">
          <span class="pf-hbar-label">${s}★</span>
          <span class="pf-hbar-track"><span class="pf-hbar" style="width:${counts[i] / max * 100}%"></span></span>
          <span class="pf-hbar-count">${counts[i]}</span>
        </button>`).join('')}
      ${list.length - rated.length ? `<div class="pf-foot">${list.length - rated.length} unrated</div>` : ''}`
  }

  function openRatingSheet(stars) {
    const list = periodBooks().filter(b => b.rating === stars)
      .sort((a, b) => b.dateCompleted - a.dateCompleted)
    const { sheet, close } = openSheet(`
      <div class="sheet-header">
        <div class="sheet-meta" style="flex:1;">
          <div class="sheet-title" style="font-size:1.1rem;">${'★'.repeat(stars)} books</div>
          <div class="pf-sheet-sub">${plural(list.length, 'book')} · ${periodName()}</div>
        </div>
      </div>
      <div class="sheet-body pf-sheet-list">${list.map(bookRowHTML).join('')}</div>`)
    sheet.addEventListener('click', e => {
      const row = e.target.closest('[data-open-book]')
      if (!row) return
      close('manual')
      const book = books.find(b => b.id === row.dataset.openBook)
      setTimeout(() => openBook(book), 320)
    })
  }

  // ── Top authors ───────────────────────────────────────────────────────────

  function renderAuthors() {
    const el = $('#pf-authors')
    const stats = new Map()
    periodBooks().forEach(b => splitAuthors(b.author).forEach(a => {
      const s = stats.get(a) || { name: a, count: 0, list: [] }
      s.count++; s.list.push(b)
      stats.set(a, s)
    }))
    const top = [...stats.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 5)
    const max = top[0]?.count || 1
    el.innerHTML = `
      <div class="pf-card-head"><h2>Top authors</h2><span>${plural(stats.size, 'author')}</span><button class="icon-btn pf-expand" data-expand="authors" aria-label="Expand"><span class="material-symbols-rounded">open_in_full</span></button></div>
      ${top.length ? top.map(a => {
        const avg = avgRating(a.list)
        return `
        <button class="pf-author-row" data-author="${esc(a.name)}">
          ${authorAvatarHTML(a.name)}
          <span class="pf-author-main">
            <span class="pf-author-name">${esc(a.name)}</span>
            <span class="pf-hbar-track pf-hbar-track--thin"><span class="pf-hbar" style="width:${a.count / max * 100}%"></span></span>
          </span>
          <span class="pf-author-count">${a.count}${avg ? `<small>${avg.toFixed(1)}★</small>` : ''}</span>
        </button>`
      }).join('') : '<div class="pf-foot">Finish a book to see your top authors</div>'}`
    hydrateAuthorAvatars(el)
  }

  // ── Genres ────────────────────────────────────────────────────────────────

  function renderGenres() {
    const el = $('#pf-genres')
    const list = periodBooks()
    const all = genreBreakdown(list, genreColour)
    const top = all.slice(0, GENRE_SLOTS_SHOWN)
    const other = all.slice(GENRE_SLOTS_SHOWN).reduce((s, r) => s + r.count, 0)
    const total = all.reduce((s, r) => s + r.count, 0)
    const rows = [...top, ...(other ? [{ genre: 'Other', count: other, colour: 'var(--genre-other)', other: true }] : [])]
    el.innerHTML = `
      <div class="pf-card-head"><h2>Genres</h2><span>${plural(all.length, 'genre')}</span><button class="icon-btn pf-expand" data-expand="genres" aria-label="Expand"><span class="material-symbols-rounded">open_in_full</span></button></div>
      ${total ? `
        <div class="pf-stack" role="img" aria-label="${esc(rows.map(r => `${r.genre} ${Math.round(r.count / total * 100)}%`).join(', '))}">
          ${rows.map(r => `<span style="flex:${r.count};background:${r.colour}"></span>`).join('')}
        </div>
        ${rows.map(r => genreRowHTML(r, total)).join('')}
        ${list.length - total ? `<div class="pf-foot">${list.length - total} without a genre</div>` : ''}`
      : '<div class="pf-foot">No genres yet</div>'}`
  }

  // ── Shared bits ───────────────────────────────────────────────────────────

  function openBook(book) {
    if (book) openBookDetail(book, book.shelf, null)
  }

  function setYear(y) {
    year = y
    if (y !== 'all') {
      // Land the calendar on this month, or the last month you finished a book that year
      const months = read.filter(b => b.dateCompleted.getFullYear() === y).map(b => b.dateCompleted.getMonth())
      cal = { y, m: y === thisYear ? now.getMonth() : months.length ? Math.max(...months) : 11 }
    }
    renderAll()
    centreChip($('#pf-years'), y)
  }

  scroller.addEventListener('click', e => {
    const t = e.target
    const yearChip = t.closest('[data-year]')
    if (yearChip) return setYear(yearChip.dataset.year === 'all' ? 'all' : Number(yearChip.dataset.year))
    const bookLink = t.closest('[data-open-book]')
    if (bookLink) return openBook(books.find(b => b.id === bookLink.dataset.openBook))
    const cell = t.closest('.hm-cell[data-day], .hm-cell[data-ym]')
    if (cell) return selectHeatCell(cell)
    const bar = t.closest('[data-bar]')
    if (bar) return selectBar(Number(bar.dataset.bar))
    const step = t.closest('[data-cal-step]')
    if (step) return stepCalendar(Number(step.dataset.calStep))
    const day = t.closest('[data-cal-day]')
    if (day) return tapCalendarDay(Number(day.dataset.calDay))
    const rating = t.closest('[data-rating]')
    if (rating) return openRatingSheet(Number(rating.dataset.rating))
    const author = t.closest('[data-author]')
    if (author) return openAuthorPage(author.dataset.author)
    const expandBtn = t.closest('[data-expand]')
    if (expandBtn) {
      return openStatDetail(expandBtn.dataset.expand, {
        books, read, year, cal, genreColour,
        onClose: y => { if (y !== year) setYear(y) },
      })
    }
    const genre = t.closest('[data-genre]')
    if (genre) return openLibrary({ shelf: 'read', filters: { genres: [genre.dataset.genre], years: year === 'all' ? [] : [year] } })
  })

  return () => { unsub(); goal.destroy() }
}

export function destroyProfile() {}

const GENRE_SLOTS_SHOWN = 5

// ── HTML ──────────────────────────────────────────────────────────────────────

function buildHTML(user) {
  const avatar = user?.photoURL
    ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer" />`
    : '<span class="material-symbols-rounded">person</span>'
  return `
    <div class="profile-screen">
      <div class="profile-bar">
        <button class="icon-btn" id="profile-back" aria-label="Back">
          <span class="material-symbols-rounded">arrow_back</span>
        </button>
        <div class="pf-avatar">${avatar}</div>
        <div class="pf-id">
          <div class="pf-name">${esc(user?.displayName || 'Reader')}</div>
          <div class="pf-summary" id="pf-summary"></div>
        </div>
        <button class="icon-btn" id="profile-settings" aria-label="Settings">
          <span class="material-symbols-rounded">settings</span>
        </button>
      </div>

      <div class="profile-scroll">
        <div class="pf-years" id="pf-years" role="group" aria-label="Year"></div>

        <div class="pf-sections">
          <button class="pf-yir" id="year-review-btn">
            <span class="material-symbols-rounded pf-yir-icon">auto_awesome</span>
            <span class="pf-yir-text"><b id="yir-title">Year in review</b><small id="yir-sub"></small></span>
            <span class="material-symbols-rounded">chevron_right</span>
          </button>

          <div id="fix-titles"></div>

          <div class="chart-card goal-card pf-card" id="goal-card"></div>

          <section class="pf-card pf-tiles-card">
            <div class="pf-tiles" id="pf-tiles"></div>
            <div class="pf-foot" id="pf-tiles-note"></div>
          </section>

          <section class="pf-card" id="pf-activity"></section>
          <section class="pf-card" id="pf-monthly"></section>
          <section class="pf-card" id="pf-calendar"></section>
          <section class="pf-card" id="pf-ratings"></section>
          <section class="pf-card" id="pf-authors"></section>
          <section class="pf-card" id="pf-genres"></section>
        </div>
      </div>
    </div>
  `
}

// ── Fix date-mangled titles ───────────────────────────────────────────────────

function renderFixTitles(container, books) {
  const el = container.querySelector('#fix-titles')
  if (!el) return
  const confirmed = getConfirmedTitleIds()
  const suspects = books
    .filter(b => !confirmed.has(b.id))
    .map(b => ({ book: b, suggestion: suggestTitleFix(b.title) }))
    .filter(s => s.suggestion !== null)

  if (!suspects.length) { el.innerHTML = ''; return }

  el.innerHTML = `
    <div class="fix-titles-section">
      <div class="chart-card">
        <div class="chart-title" style="margin-bottom:4px;">
          ${suspects.length === 1 ? '1 title looks' : `${suspects.length} titles look`} like a date
        </div>
        <div class="fix-titles-body">
          Spreadsheet imports sometimes turn titles like “November 9” into dates.
          Check the suggestion, edit it if needed, and save.
        </div>
        ${suspects.map(({ book, suggestion }) => `
          <div class="fix-title-row" data-id="${esc(book.id)}">
            <div class="fix-title-current">
              Currently <b>${esc(book.title)}</b> · ${esc(book.author)}
            </div>
            <div class="fix-title-controls">
              <input class="fix-title-input" type="text" value="${esc(suggestion)}"
                aria-label="Corrected title" autocomplete="off" />
              <button class="btn btn-filled fix-title-save">Save</button>
              <button class="btn btn-text fix-title-ok">It’s right</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `
}

function initFixTitles(container) {
  const el = container.querySelector('#fix-titles')
  el?.addEventListener('click', async e => {
    const row = e.target.closest('.fix-title-row')
    if (!row) return
    const id = row.dataset.id

    if (e.target.closest('.fix-title-ok')) {
      confirmTitle(id)
      row.remove()
      if (!el.querySelector('.fix-title-row')) el.innerHTML = ''
      return
    }

    const saveBtn = e.target.closest('.fix-title-save')
    if (!saveBtn) return
    const title = row.querySelector('.fix-title-input').value.trim()
    if (!title) return
    saveBtn.disabled = true
    try {
      await updateBook(id, { title })
      // The library listener re-renders this card once the save lands
      showSnackbar(`Title updated to “${title}”`)
    } catch (err) {
      console.error(err)
      saveBtn.disabled = false
      showSnackbar('Something went wrong')
    }
  })
}

// ── Year in Review ────────────────────────────────────────────────────────────

function openYearInReview(books, startYear = new Date().getFullYear()) {
  let year = startYear

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
    const bookOfYear = books.find(b => b.isBOTY && (b.botyYear ?? b.dateCompleted?.getFullYear()) === year)
    const featured = bookOfYear || bestBook
    // Cover wall: Books of the Month in month order, then the best of the rest
    const botm = readThisYear.filter(b => b.isBOTM && b !== featured).sort((a, b) => a.dateCompleted - b.dateCompleted)
    const rest = readThisYear.filter(b => !b.isBOTM && b !== featured && b.thumbnail)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0) || b.dateCompleted - a.dateCompleted)
    const highlights = [...botm, ...rest].slice(0, 12)

    sheet.innerHTML = `
      <div class="sheet-handle"><div class="sheet-handle-bar"></div></div>
      <div class="sheet-header" style="align-items:center;">
        <div class="sheet-meta" style="flex:1;">
          <div class="sheet-title" style="font-size:1.1rem;">Year in Review</div>
        </div>
        ${bookCount ? `
        <button class="icon-btn" id="yir-share" aria-label="Share as image">
          <span class="material-symbols-rounded">share</span>
        </button>` : ''}
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
              <span class="yir-detail-value">${esc(topGenre[0])}</span>
            </div>` : ''}

            ${topAuthor ? `
            <div class="yir-detail-row">
              <span class="yir-detail-label">Top Author</span>
              <span class="yir-detail-value">${esc(topAuthor[0])}</span>
            </div>` : ''}

            ${featured ? `
            <div class="yir-best-book">
              <div class="yir-best-cover">${coverImgHTML(featured)}</div>
              <div class="yir-best-text">
                <div class="yir-best-label">${bookOfYear ? 'Book of the Year' : 'Favourite read'}</div>
                <div class="yir-best-title">${esc(featured.title)}</div>
                <div class="yir-best-author">${esc(featured.author)}</div>
                ${featured.rating ? `<div class="yir-best-stars">${starsHTML(featured.rating)}</div>` : ''}
              </div>
            </div>` : ''}

            ${highlights.length ? `
            <div class="yir-best-label yir-wall-label">${highlights.every(b => b.isBOTM) ? 'Books of the Month' : 'Highlights'}</div>
            <div class="yir-wall">${highlights.map(b => `<div class="yir-wall-cover">${coverImgHTML(b)}</div>`).join('')}</div>` : ''}
          `}

          <div class="yir-footer">shlvd</div>
        </div>

      </div>
    `

    sheet.querySelector('#yir-close').addEventListener('click', () => closeSheet('manual'))
    sheet.querySelector('#yir-share')?.addEventListener('click', async e => {
      const btn = e.currentTarget
      btn.disabled = true
      try {
        const stats = {
          bookCount, pageCount, avgRating,
          topGenre: topGenre?.[0], topAuthor: topAuthor?.[0], bestBook, bookOfYear, highlights,
          botmCount: readThisYear.filter(b => b.isBOTM).length,
        }
        showSnackbar('Creating image…')
        const result = await shareImage(await drawYearCard(year, stats), `shlvd-${year}-in-books.jpg`, `My ${year} in books`)
        if (result === 'downloaded') showSnackbar('Image saved')
      } catch (err) {
        console.error(err)
        showSnackbar('Couldn’t create the image')
      } finally { btn.disabled = false }
    })
    sheet.querySelector('#yir-prev').addEventListener('click', () => { year--; render() })
    sheet.querySelector('#yir-next').addEventListener('click', () => { year++; render() })
  }

  history.pushState({ sheet: true }, '')

  function closeSheet(source) {
    const idx = backHandlerStack.indexOf(closeSheet)
    if (idx !== -1) backHandlerStack.splice(idx, 1)
    if (source !== 'popstate') popOwnHistoryEntry()
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
