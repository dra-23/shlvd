import { esc } from '../escape.js'
import { watchAllBooks, addBook, updateBook, getGenreList } from '../db.js'
import { titleKey } from '../books-api.js'
import { matchGenre } from '../genres.js'
import { authorAvatarHTML, hydrateAuthorAvatars } from '../authors.js'
import {
  continueSeries, moreInFinishedSeries, newFromFavouriteAuthors,
  tbrPicks, popularInGenres, similarAuthors, dismiss, getDismissed,
} from '../recommendations.js'
import { openBookDetail } from './book-detail.js'
import { openAuthorPage } from './author.js'
import { showSnackbar } from './shelves.js'
import { missingCoverAttrs } from '../cover-fix.js'

// "For you" feed shown on the Search tab while the search box is empty.
// Rows fill in as their data arrives; network results are cached for a day.

const SECTIONS = [
  { id: 'series',  title: 'Continue your series',     icon: 'collections_bookmark' },
  { id: 'authors', title: 'New from authors you love', icon: 'favorite' },
  { id: 'similar', title: 'Authors you might like',    icon: 'auto_awesome', note: 'Gemini' },
  { id: 'tbr',     title: 'Pick your next read',       icon: 'bookmark', note: 'Your TBR' },
  { id: 'genres',  title: 'Popular in your genres',    icon: 'local_fire_department', note: 'Open Library' },
]

export function mountForYou(el) {
  let books = null
  let alive = true
  // Network-backed rows, kept so library changes re-render without refetching
  const fetched = { seriesMore: null, authors: null, similar: null, genres: null }
  const errors = {}
  const items = {} // section id → the items currently rendered, for click handlers

  // Loading placeholders: shimmering cards whose shimmer ripples along the row
  const skeletonCards = n => Array.from({ length: n }, (_, i) => `
    <div class="fy-card fy-skel" style="--i:${i}" aria-hidden="true">
      <div class="fy-skel-cover skeleton"></div>
      <div class="fy-skel-line skeleton"></div>
      <div class="fy-skel-line fy-skel-line--short skeleton"></div>
      <div class="fy-skel-pill skeleton"></div>
    </div>`).join('')
  const skeletonAuthors = n => Array.from({ length: n }, (_, i) => `
    <div class="fy-author-card fy-skel" style="--i:${i}" aria-hidden="true">
      <div class="fy-skel-author">
        <div class="fy-skel-avatar skeleton"></div>
        <div style="flex:1">
          <div class="fy-skel-line skeleton" style="width:60%"></div>
          <div class="fy-skel-line fy-skel-line--short skeleton" style="width:85%"></div>
        </div>
      </div>
      <div class="fy-author-books">${skeletonCards(2)}</div>
    </div>`).join('')

  el.innerHTML = `
    <div class="fy" aria-busy="true">
      ${SECTIONS.map(s => `
        <section class="fy-section" id="fy-${s.id}">
          <div class="fy-head">
            <h2><span class="material-symbols-rounded">${s.icon}</span>${s.title}</h2>
            ${s.id === 'similar'
              ? `<span class="fy-note fy-thinking"><span class="material-symbols-rounded">auto_awesome</span>Thinking…</span>`
              : s.note ? `<span class="fy-note">${s.note}</span>` : ''}
          </div>
          <div class="fy-row">${s.id === 'similar' ? skeletonAuthors(2) : skeletonCards(4)}</div>
        </section>`).join('')}
    </div>`

  // Covers fade in as their images arrive instead of popping in
  el.addEventListener('load', e => {
    if (e.target.tagName === 'IMG') e.target.classList.add('loaded')
  }, true)

  function cardHTML(sectionId, item, i) {
    const b = item.book
    const owned = books.find(x => titleKey(x.title) === titleKey(b.title))
    const action = !owned
      ? `<button class="fy-action" data-add="${sectionId}:${i}"><span class="material-symbols-rounded">add</span>TBR</button>`
      : owned.shelf === 'want'
        ? `<button class="fy-action" data-start="${sectionId}:${i}"><span class="material-symbols-rounded">play_arrow</span>Start</button>`
        : `<span class="fy-action done">${owned.shelf === 'reading' ? 'Reading' : 'On a shelf'}</span>`
    return `
      <div class="fy-card" style="--i:${i % 6}">
        <button class="fy-cover" data-open="${sectionId}:${i}" aria-label="${esc(b.title)}">
          ${b.thumbnail ? `<img src="${esc(b.thumbnail)}" alt="" loading="lazy" />`
            : `<div class="book-cover-placeholder" style="width:100%;height:100%;" ${owned ? missingCoverAttrs(owned) : ''}><span class="material-symbols-rounded">menu_book</span></div>`}
        </button>
        ${owned ? '' : `<button class="fy-dismiss" data-dismiss="${sectionId}:${i}" aria-label="Not interested">
          <span class="material-symbols-rounded">close</span></button>`}
        <span class="fy-title">${esc(b.title)}</span>
        <span class="fy-author">${esc(b.author)}</span>
        ${item.reason ? `<span class="fy-reason">${esc(item.reason)}</span>` : ''}
        ${action}
      </div>`
  }

  // Rows animate in the first time they fill; later re-renders (dismissals,
  // library changes) swap content without replaying the entrance
  const entered = new Set()
  const enter = (id, row) => {
    row.classList.toggle('fy-enter', !entered.has(id))
    entered.add(id)
    if (SECTIONS.every(sec => entered.has(sec.id) || el.querySelector(`#fy-${sec.id}`)?.hidden)) {
      el.querySelector('.fy')?.setAttribute('aria-busy', 'false')
    }
  }

  // Only touch the DOM when a row's content actually changed — rebuilding
  // identical rows would recreate every cover and replay its fade-in (flicker)
  const setRow = (row, html) => {
    if (row._html === html) return false
    row._html = html
    row.innerHTML = html
    return true
  }

  function fillRow(id, list, emptyText) {
    const section = el.querySelector(`#fy-${id}`)
    if (!section) return
    items[id] = list
    if (!list.length) {
      if (emptyText) setRow(section.querySelector('.fy-row'), `<div class="home-empty fy-empty">${emptyText}</div>`)
      else section.hidden = true
      return
    }
    section.hidden = false
    const row = section.querySelector('.fy-row')
    if (setRow(row, list.map((item, i) => cardHTML(id, item, i)).join(''))) enter(id, row)
  }

  function fillSimilar() {
    const section = el.querySelector('#fy-similar')
    if (fetched.similar || errors.similar) {
      const note = section.querySelector('.fy-thinking')
      if (note) { note.classList.remove('fy-thinking'); note.textContent = 'Gemini' }
    }
    if (errors.similar) {
      setRow(section.querySelector('.fy-row'), `<div class="home-empty fy-empty">Suggestions aren’t available right now.</div>`)
      return
    }
    if (!fetched.similar) return
    const similar = fetched.similar
      .map(s => ({ ...s, books: notDismissed(s.books.map(book => ({ book }))).map(i => i.book) }))
      .filter(s => s.books.length)
    if (!similar.length) { section.hidden = true; return }
    const flat = []
    const row = section.querySelector('.fy-row')
    const changed = setRow(row, similar.map((s, n) => `
      <div class="fy-author-card" style="--i:${n}">
        <button class="fy-author-head" data-author="${esc(s.author)}">
          ${authorAvatarHTML(s.author, 'fy-avatar')}
          <span class="fy-author-text">
            <span class="fy-author-name">${esc(s.author)}</span>
            <span class="fy-because">${esc(s.because)}</span>
          </span>
          <span class="material-symbols-rounded">chevron_right</span>
        </button>
        <div class="fy-author-books">
          ${s.books.map(b => { flat.push({ book: b }); return cardHTML('similar', { book: b }, flat.length - 1) }).join('')}
        </div>
      </div>`).join(''))
    items.similar = flat
    if (changed) { enter('similar', row); hydrateAuthorAvatars(section) }
  }

  // Rows from the network were filtered when they arrived — drop anything
  // dismissed since, on every render
  const notDismissed = list => {
    const d = getDismissed()
    return list.filter(item => !d.has(titleKey(item.book.title)))
  }

  function render() {
    if (!books || !alive) return
    fillRow('series', notDismissed([...continueSeries(books), ...(fetched.seriesMore || [])]).slice(0, 12),
      fetched.seriesMore ? '' : null)
    if (fetched.authors) fillRow('authors', notDismissed(fetched.authors), '')
    fillSimilar()
    fillRow('tbr', tbrPicks(books), 'Add books to your TBR and the best fits show up here.')
    if (fetched.genres) fillRow('genres', notDismissed(fetched.genres), '')
  }

  // Load the network rows one after another (gentler on API rate limits);
  // each re-filters against the latest library when it lands
  async function loadNetworkRows() {
    const run = async (key, fn) => {
      try { fetched[key] = await fn() } catch (err) { console.error(`For you: ${key}`, err); errors[key] = err; fetched[key] = [] }
      render()
    }
    await run('authors', () => newFromFavouriteAuthors(books))
    await run('similar', () => similarAuthors(books))
    await run('seriesMore', () => moreInFinishedSeries(books))
    await run('genres', () => popularInGenres(books))
  }

  // ── Actions ─────────────────────────────────────────────
  const itemAt = ref => { const [id, i] = ref.split(':'); return items[id]?.[Number(i)] }

  el.addEventListener('click', async e => {
    const t = e.target
    const authorBtn = t.closest('[data-author]')
    if (authorBtn) return openAuthorPage(authorBtn.dataset.author)

    const open = t.closest('[data-open]')
    if (open) {
      const b = itemAt(open.dataset.open)?.book
      if (!b) return
      const owned = books.find(x => titleKey(x.title) === titleKey(b.title))
      return owned ? openBookDetail(owned, owned.shelf, null) : openBookDetail(b, null, null)
    }

    const dis = t.closest('[data-dismiss]')
    if (dis) {
      const b = itemAt(dis.dataset.dismiss)?.book
      if (!b) return
      dismiss(b.title)
      dis.closest('.fy-card').classList.add('fy-gone')
      setTimeout(render, 250)
      return showSnackbar('Won’t suggest that again')
    }

    const add = t.closest('[data-add]')
    if (add) {
      const b = itemAt(add.dataset.add)?.book
      if (!b) return
      add.disabled = true
      try {
        const genres = await getGenreList().catch(() => [])
        await addBook({
          googleBooksId: b.googleBooksId, title: b.title, author: b.author, thumbnail: b.thumbnail,
          pageCount: b.pageCount, shelf: 'want', description: b.description, dateReleased: b.publishedDate,
          genre: (b.categories || []).map(c => matchGenre(c, genres)).find(Boolean) || '',
        })
        showSnackbar(`Added ${b.title} to TBR`)
      } catch (err) {
        console.error(err); add.disabled = false; showSnackbar('Something went wrong')
      }
      return
    }

    const start = t.closest('[data-start]')
    if (start) {
      const b = itemAt(start.dataset.start)?.book
      const owned = b && books.find(x => titleKey(x.title) === titleKey(b.title))
      if (!owned) return
      start.disabled = true
      try {
        await updateBook(owned.id, { shelf: 'reading' })
        showSnackbar(`Started ${owned.title}`)
      } catch (err) {
        console.error(err); start.disabled = false; showSnackbar('Something went wrong')
      }
    }
  })

  let started = false
  const unsub = watchAllBooks(b => {
    books = b
    render()
    if (!started) { started = true; loadNetworkRows() }
  })

  return () => { alive = false; unsub() }
}
