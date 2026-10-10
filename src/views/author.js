import { esc } from '../escape.js'
import { watchAllBooks, addBook, getGenreList } from '../db.js'
import { searchByAuthor, titleKey } from '../books-api.js'
import { getAuthorInfo, splitAuthors, initials, avatarColour } from '../authors.js'
import { matchGenre } from '../genres.js'
import { backHandlerStack, popOwnHistoryEntry } from '../main.js'
import { openBookDetail } from './book-detail.js'
import { bookCardHTML, coverImgHTML, groupSeries, showSnackbar, SHELF_BADGE } from './shelves.js'
import { seriesCardHTML } from './library.js'
import { drawAuthorCard, shareImage } from '../share.js'

// Author page: photo and bio, your stats for this author, their books on your
// shelves and series, and more of their books from Google Books.

const SHELF_ORDER = ['read', 'reading', 'want', 'dnf']
const monthYear = d => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
const short = n => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
const firstName = name => name.split(/\s+/)[0]

// "More by" results per author, for this session
const moreCache = new Map()

/** Books in `books` written (or co-written) by `name` */
export function booksByAuthor(books, name) {
  const k = name.toLowerCase()
  return books.filter(b => splitAuthors(b.author).some(a => a.toLowerCase() === k))
}

export function openAuthorPage(name) {
  const host = document.querySelector('#view-container .view')
  if (!host || !name) return

  const page = document.createElement('div')
  page.className = 'author-page'
  page.style.transform = 'translateX(100%)'
  page.innerHTML = `
    <div class="author-bar">
      <button class="icon-btn author-back" aria-label="Back">
        <span class="material-symbols-rounded">arrow_back</span>
      </button>
      <span class="author-bar-avatar"></span>
      <span class="author-bar-name">${esc(name)}</span>
      <button class="icon-btn author-share" aria-label="Share as image">
        <span class="material-symbols-rounded">share</span>
      </button>
    </div>
    <div class="author-scroll">
      <header class="author-hero">
        <div class="author-photo" style="--avatar:${avatarColour(name)}">
          <span class="author-avatar-initials">${esc(initials(name))}</span>
        </div>
        <h1 class="author-name">${esc(name)}</h1>
        <div class="author-desc"></div>
      </header>
      <section class="author-bio" id="author-bio">
        <div class="skeleton" style="height:12px;border-radius:6px;width:95%"></div>
        <div class="skeleton" style="height:12px;border-radius:6px;width:88%;margin-top:8px"></div>
        <div class="skeleton" style="height:12px;border-radius:6px;width:60%;margin-top:8px"></div>
      </section>
      <div id="author-library"></div>
      <section class="author-section" id="author-more">
        <div class="home-section-head"><h2>More by ${esc(firstName(name))}</h2><span class="author-source">Google Books</span></div>
        <div class="author-more-grid">${'<div class="skeleton author-more-skel"></div>'.repeat(3)}</div>
      </section>
    </div>
  `
  host.appendChild(page)
  requestAnimationFrame(() => {
    page.style.transition = 'transform 300ms cubic-bezier(0,0,0,1)'
    page.style.transform = 'translateX(0)'
  })

  const scroller = page.querySelector('.author-scroll')
  let books = []
  let info = null
  let more = null
  let shelf = null // which shelf's covers are showing

  // Compact name + photo in the bar once the big header scrolls away
  scroller.addEventListener('scroll', () => {
    page.classList.toggle('scrolled', scroller.scrollTop > 190)
  }, { passive: true })

  // ── Photo + bio ───────────────────────────────────────
  getAuthorInfo(name).then(i => {
    info = i
    if (!page.isConnected) return
    const bioEl = page.querySelector('#author-bio')
    if (!i) { bioEl.remove(); return }
    page.querySelector('.author-desc').textContent = i.description || ''
    if (i.image) {
      for (const slot of [page.querySelector('.author-photo'), page.querySelector('.author-bar-avatar')]) {
        const img = new Image()
        img.alt = slot.classList.contains('author-photo') ? `Photo of ${name}` : ''
        img.referrerPolicy = 'no-referrer'
        img.onload = () => slot.classList.add('has-photo')
        img.src = i.image
        slot.appendChild(img)
      }
    }
    bioEl.innerHTML = i.bio ? `
      <p class="author-bio-text">${esc(i.bio)}</p>
      <div class="author-bio-foot">
        ${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">Read more</a>` : '<span></span>'}
        <span class="author-source">${esc(i.source)}</span>
      </div>` : ''
    if (!i.bio) bioEl.remove()
  })

  // ── Your library ──────────────────────────────────────
  function renderLibrary() {
    const el = page.querySelector('#author-library')
    const mine = booksByAuthor(books, name)
    const read = mine.filter(b => b.shelf === 'read')
    const byShelf = Object.fromEntries(SHELF_ORDER.map(s => [s, mine.filter(b => b.shelf === s)]))
    shelf ??= SHELF_ORDER.find(s => byShelf[s].length) || 'read'

    const pages = read.reduce((n, b) => n + (b.pageCount || 0), 0)
    const rated = read.filter(b => b.rating > 0)
    const avg = rated.length ? (rated.reduce((n, b) => n + b.rating, 0) / rated.length).toFixed(1) : null
    const dates = read.map(b => b.dateCompleted).filter(Boolean).sort((a, b) => a - b)
    const favourite = [...rated].sort((a, b) => b.rating - a.rating || (b.isBOTY - a.isBOTY) || (b.isBOTM - a.isBOTM) || b.dateCompleted - a.dateCompleted)[0]
    const botmCount = mine.filter(b => b.isBOTM).length
    const botyCount = mine.filter(b => b.isBOTY).length
    const series = groupSeries(mine)
    const genres = new Map()
    read.forEach(b => b.genre && genres.set(b.genre, (genres.get(b.genre) || 0) + 1))

    const shelfBooks = [...byShelf[shelf]].sort((a, b) =>
      (b.dateCompleted?.getTime() ?? b.addedAt?.getTime() ?? 0) - (a.dateCompleted?.getTime() ?? a.addedAt?.getTime() ?? 0))

    el.innerHTML = !mine.length ? '' : `
      <section class="author-section">
        <div class="home-section-head"><h2>You and ${esc(firstName(name))}</h2></div>
        <div class="botm-stats author-stats">
          <div class="botm-stat"><span class="botm-stat-num">${read.length}</span><span class="botm-stat-label">book${read.length === 1 ? '' : 's'} read</span></div>
          <div class="botm-stat"><span class="botm-stat-num">${pages ? short(pages) : '—'}</span><span class="botm-stat-label">pages</span></div>
          <div class="botm-stat"><span class="botm-stat-num">${avg ? `${avg}★` : '—'}</span><span class="botm-stat-label">avg rating</span></div>
          <div class="botm-stat author-award author-award--botm">
            <span class="botm-stat-num"><span class="material-symbols-rounded">workspace_premium</span>${botmCount}</span>
            <span class="botm-stat-label">Book${botmCount === 1 ? '' : 's'} of the Month</span>
          </div>
          <div class="botm-stat author-award author-award--boty">
            <span class="botm-stat-num"><span class="material-symbols-rounded">emoji_events</span>${botyCount}</span>
            <span class="botm-stat-label">Book${botyCount === 1 ? '' : 's'} of the Year</span>
          </div>
        </div>
        ${dates.length ? `<div class="sc-span author-span"><span class="material-symbols-rounded">calendar_month</span>
          Reading since ${monthYear(dates[0])}${dates.length > 1 ? ` · last ${monthYear(dates.at(-1))}` : ''}</div>` : ''}
      </section>

      ${favourite ? `
      <section class="author-section">
        <div class="author-fav" data-book-id="${esc(favourite.id)}" role="button" tabindex="0">
          <div class="author-fav-cover">${coverImgHTML(favourite)}</div>
          <div class="author-fav-info">
            <span class="author-fav-label">Your favourite</span>
            <span class="author-fav-title">${esc(favourite.title)}</span>
            <span class="author-fav-stars">${'★'.repeat(favourite.rating)}</span>
            ${favourite.isBOTY ? `<span class="author-fav-meta">Book of ${favourite.botyYear || favourite.dateCompleted?.getFullYear() || 'the Year'}</span>`
              : favourite.isBOTM && favourite.dateCompleted ? `<span class="author-fav-meta">Book of the Month · ${monthYear(favourite.dateCompleted)}</span>` : ''}
          </div>
        </div>
      </section>` : ''}

      <section class="author-section">
        <div class="home-section-head"><h2>On your shelves</h2></div>
        <div class="lib-chips author-chips">
          ${SHELF_ORDER.filter(s => byShelf[s].length).map(s => `
            <button class="chip ${s === shelf ? 'selected' : ''}" data-author-shelf="${s}">
              ${SHELF_BADGE[s]} <span class="lib-chip-count">${byShelf[s].length}</span>
            </button>`).join('')}
        </div>
        <div class="shelf-scroll author-shelf-row">${shelfBooks.map(b => bookCardHTML(b)).join('')}</div>
      </section>

      ${series.length ? `
      <section class="author-section">
        <div class="home-section-head"><h2>Series</h2></div>
        <div class="author-series">${series.map(s => seriesCardHTML(s)).join('')}</div>
      </section>` : ''}

      ${genres.size ? `
      <section class="author-section">
        <div class="home-section-head"><h2>Genres you read by ${esc(firstName(name))}</h2></div>
        <div class="chips">${[...genres].sort((a, b) => b[1] - a[1]).map(([g, n]) =>
          `<span class="chip">${esc(g)} <span class="lib-chip-count">${n}</span></span>`).join('')}</div>
      </section>` : ''}
    `
    renderMore()
  }

  // ── More by this author ───────────────────────────────
  function renderMore() {
    const grid = page.querySelector('.author-more-grid')
    if (!more) return
    const owned = new Map(books.map(b => [titleKey(b.title), b]))
    const list = more.filter(b => !owned.has(titleKey(b.title)) || owned.get(titleKey(b.title)).shelf === 'want').slice(0, 18)
    if (!list.length) { page.querySelector('#author-more').remove(); return }
    grid.innerHTML = list.map((b, i) => {
      const onTbr = owned.has(titleKey(b.title))
      return `
        <div class="author-more-item">
          <button class="author-more-cover" data-more="${i}" aria-label="${esc(b.title)}">
            ${b.thumbnail ? `<img src="${esc(b.thumbnail)}" alt="" loading="lazy" />`
              : `<div class="book-cover-placeholder" style="width:100%;height:100%;"><span class="material-symbols-rounded">menu_book</span></div>`}
          </button>
          <span class="author-more-title">${esc(b.title)}</span>
          <span class="author-more-year">${esc(b.publishedDate.slice(0, 4))}</span>
          ${onTbr
            ? `<span class="author-more-add done"><span class="material-symbols-rounded">check</span>On TBR</span>`
            : `<button class="author-more-add" data-add="${i}"><span class="material-symbols-rounded">add</span>TBR</button>`}
        </div>`
    }).join('')
    grid._list = list
  }

  if (moreCache.has(name)) more = moreCache.get(name)
  else searchByAuthor(name)
    .then(list => { more = list; moreCache.set(name, list); if (page.isConnected) renderMore() })
    .catch(() => {
      const sec = page.querySelector('#author-more')
      if (sec) sec.querySelector('.author-more-grid').innerHTML = `<div class="home-empty">Couldn’t load more books right now.</div>`
    })

  // ── Interactions ──────────────────────────────────────
  page.addEventListener('click', async e => {
    const t = e.target
    if (t.closest('.author-back')) return closePage('manual')
    if (t.closest('.author-share')) return shareAuthor()

    const chip = t.closest('[data-author-shelf]')
    if (chip) { shelf = chip.dataset.authorShelf; return renderLibrary() }

    const seriesHeader = t.closest('.series-card-header')
    if (seriesHeader) {
      const card = seriesHeader.closest('.series-card')
      const open = card.classList.toggle('open')
      card.querySelector('.series-expand-btn .material-symbols-rounded').textContent = open ? 'expand_less' : 'expand_more'
      return
    }

    const grid = page.querySelector('.author-more-grid')
    const add = t.closest('[data-add]')
    if (add) {
      const b = grid._list[Number(add.dataset.add)]
      add.disabled = true
      try {
        const genres = await getGenreList().catch(() => [])
        await addBook({
          googleBooksId: b.googleBooksId, title: b.title, author: b.author, thumbnail: b.thumbnail,
          pageCount: b.pageCount, shelf: 'want', description: b.description, dateReleased: b.publishedDate,
          genre: b.categories.map(c => matchGenre(c, genres)).find(Boolean) || '',
        })
        showSnackbar(`Added ${b.title} to TBR`)
      } catch (err) {
        console.error(err)
        add.disabled = false
        showSnackbar('Something went wrong')
      }
      return
    }
    const moreCover = t.closest('[data-more]')
    if (moreCover) {
      const b = grid._list[Number(moreCover.dataset.more)]
      const owned = books.find(x => titleKey(x.title) === titleKey(b.title))
      return owned ? openBookDetail(owned, owned.shelf, null) : openBookDetail(b, null, null)
    }

    const el = t.closest('.book-card, .author-fav, .series-book-row')
    const book = el && books.find(b => b.id === el.dataset.bookId)
    if (book) openBookDetail(book, book.shelf, null)
  })

  async function shareAuthor() {
    const btn = page.querySelector('.author-share')
    btn.disabled = true
    try {
      const mine = booksByAuthor(books, name)
      const blob = await drawAuthorCard(name, info, mine)
      const result = await shareImage(blob, `shlvd-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`, `My ${name} books`)
      if (result === 'downloaded') showSnackbar('Image saved')
    } catch (err) {
      console.error(err)
      showSnackbar('Couldn’t create the image')
    } finally { btn.disabled = false }
  }

  // ── Back handling ─────────────────────────────────────
  history.pushState({ author: true }, '')
  const unsub = watchAllBooks(b => { books = b; renderLibrary() })

  function closePage(source) {
    unsub()
    const idx = backHandlerStack.indexOf(closePage)
    if (idx !== -1) backHandlerStack.splice(idx, 1)
    if (source !== 'popstate') popOwnHistoryEntry()
    page.style.transition = 'transform 250ms cubic-bezier(0.3,0,1,1)'
    page.style.transform = 'translateX(100%)'
    setTimeout(() => page.remove(), 260)
  }
  backHandlerStack.push(closePage)
}
