import { esc } from '../escape.js'
import { backHandlerStack, popOwnHistoryEntry } from '../main.js'
import { openBookDetail } from './book-detail.js'
import { coverImgHTML } from './shelves.js'
import { openAuthorPage } from './author.js'
import { openLibrary } from './library.js'
import { splitAuthors, authorAvatarHTML, hydrateAuthorAvatars } from '../authors.js'
import {
  MONTHS, MONTHS_LONG, plural, dayKey, avgRating, sumPages, yearChipsHTML, centreChip, genreBreakdown,
} from '../stats.js'

// Full-screen versions of the Profile cards. Each shows more than its card
// can, has its own year chips, and hands the chosen year back to Profile on close.

const TITLES = {
  activity: 'Reading activity',
  monthly: 'Books per month',
  calendar: 'Calendar',
  ratings: 'Ratings',
  authors: 'Authors',
  genres: 'Genres',
}

export function bookRowHTML(b) {
  return `
    <button class="pf-book-row" data-open-book="${esc(b.id)}">
      <span class="pf-book-row-cover">${coverImgHTML(b)}</span>
      <span class="pf-book-row-text">
        <span class="pf-book-row-title">${esc(b.title)}</span>
        <span class="pf-book-row-sub">${esc(b.author)} · ${b.dateCompleted.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      </span>
    </button>`
}

export function genreRowHTML(r, total) {
  const tag = r.other ? 'div' : 'button'
  return `
    <${tag} class="pf-genre-row" ${r.other ? '' : `data-genre="${esc(r.genre)}"`}>
      <span class="pf-swatch" style="background:${r.colour}"></span>
      <span class="pf-genre-name">${esc(r.genre)}</span>
      <span class="pf-genre-count">${r.count} · ${Math.round(r.count / total * 100)}%</span>
      ${r.other ? '' : '<span class="material-symbols-rounded pf-chevron">chevron_right</span>'}
    </${tag}>`
}

const coverTile = b => `
  <button class="sd-cover" data-open-book="${esc(b.id)}" aria-label="${esc(b.title)}">${coverImgHTML(b)}</button>`

export function openStatDetail(kind, ctx) {
  const host = document.querySelector('#view-container .view')
  if (!host || !TITLES[kind]) return
  const { books, read, genreColour, onClose } = ctx
  const now = new Date()
  const thisYear = now.getFullYear()

  let year = ctx.year
  let cal = { ...ctx.cal }
  let compare = false        // monthly: show last year behind this year
  let ratingTab = null       // ratings: which star count is showing
  let authorSort = 'count'   // authors: 'count' or 'rating'
  let avatarObserver = null

  const page = document.createElement('div')
  page.className = 'stat-page'
  page.style.transform = 'translateX(100%)'
  page.innerHTML = `
    <div class="profile-bar">
      <button class="icon-btn sd-back" aria-label="Back">
        <span class="material-symbols-rounded">arrow_back</span>
      </button>
      <span class="botm-page-title">${TITLES[kind]}</span>
    </div>
    <div class="stat-scroll">
      <div class="pf-years" role="group" aria-label="Year"></div>
      <div class="sd-body"></div>
    </div>`
  host.appendChild(page)
  requestAnimationFrame(() => {
    page.style.transition = 'transform 300ms cubic-bezier(0,0,0,1)'
    page.style.transform = 'translateX(0)'
  })

  const scroller = page.querySelector('.stat-scroll')
  const body = page.querySelector('.sd-body')
  const chips = page.querySelector('.pf-years')
  const periodBooks = () => year === 'all' ? read : read.filter(b => b.dateCompleted.getFullYear() === year)
  const byYear = y => read.filter(b => b.dateCompleted.getFullYear() === y)
  const yearsAsc = () => {
    const ys = read.map(b => b.dateCompleted.getFullYear())
    if (!ys.length) return []
    const first = Math.min(...ys)
    return Array.from({ length: thisYear - first + 1 }, (_, i) => first + i)
  }

  function render() {
    chips.innerHTML = yearChipsHTML(read, year)
    avatarObserver?.disconnect()
    body.innerHTML = RENDER[kind]()
    if (kind === 'authors') observeAvatars()
  }

  // ── Reading activity ──────────────────────────────────────────────────────

  function yearRowsHTML() {
    return `
      <div class="sd-section-label">Years</div>
      <div class="pf-card sd-list-card">
        ${yearsAsc().reverse().map(y => {
          const list = byYear(y), avg = avgRating(list)
          return `
            <button class="sd-year-row" data-year="${y}">
              <span class="sd-year-row-year">${y}</span>
              <span class="sd-year-row-stats">${plural(list.length, 'book')} · ${sumPages(list).toLocaleString()} pages${avg ? ` · ${avg.toFixed(1)}★` : ''}</span>
              <span class="material-symbols-rounded pf-chevron">chevron_right</span>
            </button>`
        }).join('')}
      </div>`
  }

  function renderActivity() {
    if (year === 'all') {
      const counts = new Map()
      read.forEach(b => {
        const k = `${b.dateCompleted.getFullYear()}-${b.dateCompleted.getMonth()}`
        counts.set(k, (counts.get(k) || 0) + 1)
      })
      const max = Math.max(1, ...counts.values())
      const level = n => n ? Math.max(1, Math.min(4, Math.ceil(n / max * 4))) : 0
      return `
        <div class="pf-card">
          <div class="pf-card-head"><h2>Books per month</h2><span>tap a year to explore it</span></div>
          <div class="hm-year-grid sd-year-grid">
            <span></span>${MONTHS.map(m => `<span class="hm-col-label">${m[0]}</span>`).join('')}
            ${yearsAsc().reverse().map(y => `
              <button class="hm-row-label sd-link" data-year="${y}">${y}</button>
              ${MONTHS.map((_, m) => {
                const n = counts.get(`${y}-${m}`) || 0
                return `<span class="hm-cell ${new Date(y, m, 1) > now ? 'hm-future' : ''}" style="--l:${level(n)}"
                  title="${MONTHS_LONG[m]} ${y}: ${plural(n, 'book')}"><span class="sd-cell-n">${n || ''}</span></span>`
              }).join('')}`).join('')}
          </div>
        </div>
        ${yearRowsHTML()}`
    }

    const byDay = new Map()
    periodBooks().forEach(b => {
      const k = dayKey(b.dateCompleted)
      byDay.set(k, [...(byDay.get(k) || []), b])
    })
    const monthGrid = m => {
      const first = new Date(year, m, 1).getDay()
      const last = new Date(year, m + 1, 0).getDate()
      let n = 0, cells = '<span></span>'.repeat(first)
      for (let d = 1; d <= last; d++) {
        const date = new Date(year, m, d)
        const list = byDay.get(dayKey(date)) || []
        n += list.length
        cells += list.length
          ? `<button class="hm-cell sd-day" style="--l:${Math.min(4, list.length + 1)}" data-jump="${dayKey(date)}"
              aria-label="${MONTHS_LONG[m]} ${d}: ${esc(list.map(b => b.title).join(', '))}"></button>`
          : `<span class="hm-cell sd-day ${date > now ? 'hm-future' : ''}" style="--l:0"></span>`
      }
      return `
        <div class="sd-month">
          <div class="sd-month-head"><b>${MONTHS[m]}</b><span>${n || ''}</span></div>
          <div class="sd-month-grid">${cells}</div>
        </div>`
    }
    const months = [...Array(12).keys()]
    const days = [...byDay.entries()].sort((a, b) => b[1][0].dateCompleted - a[1][0].dateCompleted)
    let lastMonth = -1
    const list = days.map(([k, bs]) => {
      const m = bs[0].dateCompleted.getMonth()
      const head = m !== lastMonth ? `<div class="sd-section-label">${MONTHS_LONG[m]}</div>` : ''
      lastMonth = m
      return `${head}<div class="sd-day-group" id="sd-day-${k}">${bs.map(bookRowHTML).join('')}</div>`
    }).join('')
    return `
      <div class="pf-card">
        <div class="pf-card-head"><h2>${year}</h2><span>${plural(byDay.size, 'day')} with a finished book</span></div>
        <div class="sd-months">${months.map(monthGrid).join('')}</div>
        <div class="pf-legend" aria-hidden="true">Less ${[0, 1, 2, 3, 4].map(l => `<i class="hm-cell" style="--l:${l}"></i>`).join('')} More</div>
      </div>
      ${days.length ? `<div class="sd-days">${list}</div>` : ''}`
  }

  function jumpToDay(k) {
    const group = page.querySelector(`[id="sd-day-${k}"]`)
    if (!group) return
    const top = scroller.scrollTop + group.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 72
    scroller.scrollTo({ top, behavior: 'smooth' })
    group.classList.remove('flash')
    requestAnimationFrame(() => group.classList.add('flash'))
  }

  // ── Books per month ───────────────────────────────────────────────────────

  function barsHTML(series, labels, keys, ghost = null) {
    const max = Math.max(1, ...series, ...(ghost || []))
    return `
      <div class="pf-bars sd-bars" style="--n:${series.length}">
        ${series.map((n, i) => `
          <button class="pf-bar-col" data-jump-bar="${keys[i]}" aria-label="${labels[i]}: ${plural(n, 'book')}${ghost ? `, ${ghost[i]} the year before` : ''}">
            <span class="pf-bar-val">${n}</span>
            ${ghost ? `<span class="sd-ghost" style="height:${ghost[i] / max * 100}%"></span>` : ''}
            <span class="pf-bar" style="height:${n / max * 100}%; animation-delay:${i * 25}ms"></span>
          </button>`).join('')}
      </div>
      <div class="pf-bar-labels" style="--n:${series.length}">${labels.map(l => `<span>${l}</span>`).join('')}</div>`
  }

  function renderMonthly() {
    if (year === 'all') {
      const ys = yearsAsc()
      return `
        <div class="pf-card">
          <div class="pf-card-head"><h2>Books per year</h2><span>tap a bar to explore that year</span></div>
          ${barsHTML(ys.map(y => byYear(y).length), ys.map(y => `’${String(y).slice(2)}`), ys)}
        </div>
        ${yearRowsHTML()}`
    }
    const list = periodBooks()
    const perMonth = m => list.filter(b => b.dateCompleted.getMonth() === m)
    const counts = MONTHS.map((_, m) => perMonth(m).length)
    const prev = byYear(year - 1)
    const ghost = compare && prev.length ? MONTHS.map((_, m) => prev.filter(b => b.dateCompleted.getMonth() === m).length) : null
    const lastMonth = year === thisYear ? now.getMonth() : 11
    const rows = [...Array(lastMonth + 1).keys()].reverse().map(m => {
      const bs = perMonth(m).sort((a, b) => b.dateCompleted - a.dateCompleted)
      const avg = avgRating(bs), pg = sumPages(bs)
      return `
        <div class="sd-month-row" id="sd-month-${m}">
          <div class="sd-month-row-head">
            <b>${MONTHS_LONG[m]}</b>
            <span>${bs.length ? `${plural(bs.length, 'book')}${pg ? ` · ${pg.toLocaleString()} pages` : ''}${avg ? ` · ${avg.toFixed(1)}★` : ''}` : 'No books finished'}</span>
          </div>
          ${bs.length ? `<div class="sd-cover-strip">${bs.map(coverTile).join('')}</div>` : ''}
        </div>`
    }).join('')
    return `
      <div class="pf-card">
        <div class="pf-card-head"><h2>${year}</h2><span>${plural(list.length, 'book')}</span></div>
        ${barsHTML(counts, MONTHS.map(m => m[0]), MONTHS.map((_, m) => m), ghost)}
        ${prev.length ? `
          <div class="sd-compare">
            <button class="chip ${compare ? 'selected' : ''}" data-compare aria-pressed="${compare}">
              <span class="material-symbols-rounded">${compare ? 'check' : 'compare_arrows'}</span>Compare with ${year - 1}
            </button>
            ${compare ? `<span class="sd-key"><i class="sd-key-now"></i>${year}<i class="sd-key-ghost"></i>${year - 1}</span>` : ''}
          </div>` : ''}
      </div>
      <div class="pf-card sd-list-card">${rows}</div>`
  }

  function jumpToMonth(m) {
    const row = page.querySelector(`#sd-month-${m}`)
    if (!row) return
    const top = scroller.scrollTop + row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 72
    scroller.scrollTo({ top, behavior: 'smooth' })
    row.classList.remove('flash')
    requestAnimationFrame(() => row.classList.add('flash'))
  }

  // ── Calendar ──────────────────────────────────────────────────────────────

  function renderCalendar() {
    const { y, m } = cal
    const byDay = new Map()
    read.forEach(b => {
      const d = b.dateCompleted
      if (d.getFullYear() === y && d.getMonth() === m) byDay.set(d.getDate(), [...(byDay.get(d.getDate()) || []), b])
    })
    const first = new Date(y, m, 1).getDay()
    const last = new Date(y, m + 1, 0).getDate()
    const monthBooks = [...byDay.values()].flat().sort((a, b) => a.dateCompleted - b.dateCompleted)
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
        <button class="pf-cal-day has-book ${list.some(x => x.isBOTM) ? 'is-botm' : ''}" data-open-book="${esc(b.id)}"
          aria-label="${MONTHS_LONG[m]} ${d}: ${esc(list.map(x => x.title).join(', '))}">
          ${b.thumbnail ? `<img src="${esc(b.thumbnail)}" alt="" loading="lazy" />` : `<span class="pf-cal-noimg">${esc(b.title)}</span>`}
          <span class="pf-cal-num">${d}</span>
          ${list.length > 1 ? `<span class="pf-cal-more">+${list.length - 1}</span>` : ''}
        </button>`
    }
    return `
      <div class="pf-card sd-cal-card">
        <div class="pf-cal-nav">
          <button class="icon-btn" data-cal-step="-1" aria-label="Previous month"><span class="material-symbols-rounded">chevron_left</span></button>
          <div class="pf-cal-title"><h2>${MONTHS_LONG[m]} ${y}</h2><span>${monthBooks.length ? plural(monthBooks.length, 'book') + ' finished' : 'No books finished'}</span></div>
          <button class="icon-btn" data-cal-step="1" aria-label="Next month"><span class="material-symbols-rounded">chevron_right</span></button>
        </div>
        <div class="pf-cal-grid sd-cal-grid">${cells}</div>
        <div class="pf-foot">Swipe to change month</div>
      </div>
      ${monthBooks.length ? `<div class="pf-card sd-list-card">${monthBooks.map(bookRowHTML).join('')}</div>` : ''}`
  }

  function stepCalendar(step) {
    let { y, m } = cal
    m += step
    if (m < 0) { m = 11; y-- }
    if (m > 11) { m = 0; y++ }
    cal = { y, m }
    body.innerHTML = renderCalendar()
  }

  let touch = null
  page.addEventListener('touchstart', e => {
    if (kind !== 'calendar' || !e.target.closest('.sd-cal-card')) return
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }, { passive: true })
  page.addEventListener('touchend', e => {
    if (!touch) return
    const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y
    touch = null
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) stepCalendar(dx < 0 ? 1 : -1)
  }, { passive: true })

  // ── Ratings ───────────────────────────────────────────────────────────────

  function renderRatings() {
    const list = periodBooks()
    const tabs = [5, 4, 3, 2, 1, 0].map(s => ({ s, books: list.filter(b => (b.rating || 0) === s) }))
    if (ratingTab === null || !tabs.find(t => t.s === ratingTab)?.books.length) {
      ratingTab = tabs.find(t => t.books.length)?.s ?? 5
    }
    const current = tabs.find(t => t.s === ratingTab).books.sort((a, b) => b.dateCompleted - a.dateCompleted)
    const avg = avgRating(list)
    return `
      <div class="sd-tabs" role="tablist">
        ${tabs.filter(t => t.books.length || t.s).map(t => `
          <button class="chip ${t.s === ratingTab ? 'selected' : ''}" data-rating-tab="${t.s}" role="tab"
            aria-selected="${t.s === ratingTab}" ${t.books.length ? '' : 'disabled'}>
            ${t.s ? `${t.s}★` : 'Unrated'} <span class="sd-tab-n">${t.books.length}</span>
          </button>`).join('')}
      </div>
      <div class="pf-foot sd-tab-foot">${avg ? `${avg.toFixed(1)}★ average across ${plural(list.filter(b => b.rating > 0).length, 'rated book')}` : ''}</div>
      <div class="sd-cover-grid">
        ${current.map(b => `
          <button class="sd-grid-item" data-open-book="${esc(b.id)}">
            <span class="sd-cover">${coverImgHTML(b)}</span>
            <span class="sd-grid-title">${esc(b.title)}</span>
            <span class="sd-grid-sub">${b.dateCompleted.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </button>`).join('')}
      </div>`
  }

  // ── Authors ───────────────────────────────────────────────────────────────

  function renderAuthors() {
    const stats = new Map()
    periodBooks().forEach(b => splitAuthors(b.author).forEach(a => {
      const s = stats.get(a) || { name: a, list: [] }
      s.list.push(b)
      stats.set(a, s)
    }))
    let rows = [...stats.values()].map(s => {
      const rated = s.list.filter(b => b.rating > 0)
      return { ...s, count: s.list.length, rated: rated.length, avg: avgRating(s.list) }
    })
    if (authorSort === 'rating') {
      rows = rows.filter(r => r.rated >= 2).sort((a, b) => b.avg - a.avg || b.count - a.count || a.name.localeCompare(b.name))
    } else {
      rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    }
    const max = Math.max(1, ...rows.map(r => r.count))
    return `
      <div class="settings-segmented sd-sort" role="radiogroup" aria-label="Sort authors">
        ${[['count', 'Most read'], ['rating', 'Highest rated']].map(([id, label]) => `
          <button class="settings-seg ${authorSort === id ? 'selected' : ''}" data-author-sort="${id}" role="radio" aria-checked="${authorSort === id}">${label}</button>`).join('')}
      </div>
      <div class="pf-card sd-list-card">
        ${rows.map((a, i) => `
          <button class="pf-author-row" data-author="${esc(a.name)}">
            <span class="sd-rank">${i + 1}</span>
            ${authorAvatarHTML(a.name)}
            <span class="pf-author-main">
              <span class="pf-author-name">${esc(a.name)}</span>
              <span class="pf-hbar-track pf-hbar-track--thin"><span class="pf-hbar" style="width:${a.count / max * 100}%"></span></span>
            </span>
            <span class="pf-author-count">${a.count}${a.avg ? `<small>${a.avg.toFixed(1)}★</small>` : ''}</span>
          </button>`).join('') || '<div class="pf-foot">No authors yet</div>'}
      </div>
      <div class="pf-foot">${authorSort === 'rating' ? 'Authors with at least 2 rated books' : `${plural(rows.length, 'author')}`}</div>`
  }

  // Photos load as rows scroll into view, not all 100+ at once
  function observeAvatars() {
    avatarObserver = new IntersectionObserver(entries => entries.forEach(e => {
      if (!e.isIntersecting) return
      avatarObserver.unobserve(e.target)
      hydrateAuthorAvatars(e.target)
    }), { root: scroller, rootMargin: '200px' })
    body.querySelectorAll('.pf-author-row').forEach(r => avatarObserver.observe(r))
  }

  // ── Genres ────────────────────────────────────────────────────────────────

  function renderGenres() {
    const list = periodBooks()
    const rows = genreBreakdown(list, genreColour)
    const total = rows.reduce((s, r) => s + r.count, 0)
    const max = Math.max(1, ...rows.map(r => r.count))
    return `
      <div class="pf-card sd-list-card">
        ${rows.map(r => `
          <button class="sd-genre-row" data-genre="${esc(r.genre)}">
            <span class="sd-genre-top">
              <span class="pf-genre-name">${esc(r.genre)}</span>
              <span class="pf-genre-count">${r.count} · ${Math.round(r.count / total * 100)}%</span>
              <span class="material-symbols-rounded pf-chevron">chevron_right</span>
            </span>
            <span class="pf-hbar-track pf-hbar-track--thin"><span class="pf-hbar" style="width:${r.count / max * 100}%; background:${r.colour}"></span></span>
          </button>`).join('') || '<div class="pf-foot">No genres yet</div>'}
      </div>
      ${list.length - total ? `<div class="pf-foot">${list.length - total} without a genre</div>` : ''}`
  }

  const RENDER = {
    activity: renderActivity, monthly: renderMonthly, calendar: renderCalendar,
    ratings: renderRatings, authors: renderAuthors, genres: renderGenres,
  }

  // ── Events ────────────────────────────────────────────────────────────────

  function setYear(y) {
    year = y
    if (kind === 'calendar' && y !== 'all') {
      const months = byYear(y).map(b => b.dateCompleted.getMonth())
      cal = { y, m: y === thisYear ? now.getMonth() : months.length ? Math.max(...months) : 11 }
    }
    render()
    scroller.scrollTop = 0
    centreChip(chips, y)
  }

  page.querySelector('.sd-back').addEventListener('click', () => closePage('manual'))
  scroller.addEventListener('click', e => {
    const t = e.target
    const yr = t.closest('[data-year]')
    if (yr) return setYear(yr.dataset.year === 'all' ? 'all' : Number(yr.dataset.year))
    const book = t.closest('[data-open-book]')
    if (book) {
      const b = books.find(x => x.id === book.dataset.openBook)
      return b && openBookDetail(b, b.shelf, null)
    }
    const jump = t.closest('[data-jump]')
    if (jump) return jumpToDay(jump.dataset.jump)
    const bar = t.closest('[data-jump-bar]')
    if (bar) return year === 'all' ? setYear(Number(bar.dataset.jumpBar)) : jumpToMonth(bar.dataset.jumpBar)
    if (t.closest('[data-compare]')) { compare = !compare; return render() }
    const step = t.closest('[data-cal-step]')
    if (step) return stepCalendar(Number(step.dataset.calStep))
    const tab = t.closest('[data-rating-tab]')
    if (tab) { ratingTab = Number(tab.dataset.ratingTab); return render() }
    const sort = t.closest('[data-author-sort]')
    if (sort) { authorSort = sort.dataset.authorSort; return render() }
    const author = t.closest('[data-author]')
    if (author) return openAuthorPage(author.dataset.author)
    const genre = t.closest('[data-genre]')
    if (genre) {
      // Leave this page first so Back from Shlvd lands somewhere sensible
      const preset = { shelf: 'read', filters: { genres: [genre.dataset.genre], years: year === 'all' ? [] : [year] } }
      closePage('manual')
      setTimeout(() => openLibrary(preset), 320)
    }
  })

  history.pushState({ statPage: kind }, '')
  function closePage(source) {
    avatarObserver?.disconnect()
    const idx = backHandlerStack.indexOf(closePage)
    if (idx !== -1) backHandlerStack.splice(idx, 1)
    if (source !== 'popstate') popOwnHistoryEntry()
    page.style.transition = 'transform 250ms cubic-bezier(0.3,0,1,1)'
    page.style.transform = 'translateX(100%)'
    setTimeout(() => page.remove(), 260)
    onClose?.(year)
  }
  backHandlerStack.push(closePage)

  render()
  requestAnimationFrame(() => centreChip(chips, year))
}
