import { watchShelf, getBook } from '../db.js'
import { openBookDetail } from './book-detail.js'
import { navigateTo } from '../main.js'

const SHELVES = [
  { id: 'reading', label: 'Reading',      icon: 'chrome_reader_mode' },
  { id: 'want',    label: 'Want to Read', icon: 'bookmark'           },
  { id: 'read',    label: 'Read',         icon: 'done_all'           },
]

// Snackbar helper — exported for use by other views
let snackbarTimeout = null
export function showSnackbar(msg) {
  document.querySelector('.snackbar')?.remove()
  clearTimeout(snackbarTimeout)
  const el = document.createElement('div')
  el.className = 'snackbar'
  el.textContent = msg
  document.body.appendChild(el)
  snackbarTimeout = setTimeout(() => el.remove(), 3000)
}

export function renderShelves(container) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;min-height:100%;">
      <div class="top-bar">
        <span class="top-bar-title">shlvd</span>
      </div>
      <div id="shelves-content" style="flex:1;padding-bottom:16px;">
        ${SHELVES.map(s => `
          <div class="shelf-section" id="shelf-${s.id}">
            <div class="shelf-header">
              <span class="shelf-title">${s.label}</span>
              <span class="shelf-count" id="count-${s.id}"></span>
            </div>
            <div class="shelf-scroll" id="scroll-${s.id}">
              ${skeletonCards(3)}
            </div>
          </div>
          <div class="divider"></div>
        `).join('')}
      </div>
    </div>
  `

  const unsubscribers = []

  SHELVES.forEach(shelf => {
    const unsub = watchShelf(shelf.id, books => {
      renderShelfBooks(container, shelf, books)
    })
    unsubscribers.push(unsub)
  })

  return () => unsubscribers.forEach(u => u())
}

function renderShelfBooks(container, shelf, books) {
  const scrollEl = container.querySelector(`#scroll-${shelf.id}`)
  const countEl  = container.querySelector(`#count-${shelf.id}`)
  if (!scrollEl) return

  countEl.textContent = books.length ? `${books.length}` : ''

  if (!books.length) {
    scrollEl.innerHTML = `
      <div class="shelf-empty">
        No books here yet —
        <button class="btn btn-text" style="padding:0 4px;font-size:0.875rem;" data-goto="search">
          search to add one
        </button>
      </div>
    `
    scrollEl.querySelector('[data-goto]')?.addEventListener('click', () => navigateTo('search'))
    return
  }

  scrollEl.innerHTML = books.map(book => bookCardHTML(book, shelf.id)).join('')

  scrollEl.querySelectorAll('.book-card').forEach((card, i) => {
    card.addEventListener('click', async () => {
      const bookData = await getBook(books[i].id)
      openBookDetail(
        { ...books[i], ...bookData },
        shelf.id,
        null // shelves auto-update via onSnapshot
      )
    })
  })
}

function bookCardHTML(book, shelf) {
  const coverHTML = book.thumbnail
    ? `<img src="${book.thumbnail}" alt="${book.title}" loading="lazy" />`
    : `<div class="book-cover-placeholder">
         <span class="material-symbols-rounded">menu_book</span>
         <div class="placeholder-title">${book.title}</div>
       </div>`

  const progressHTML = shelf === 'reading' && book.pageCount > 0
    ? `<div class="book-progress">
         <div class="book-progress-fill" style="width:${Math.round((book.progress / book.pageCount) * 100)}%"></div>
       </div>`
    : shelf === 'reading'
    ? ''
    : ''

  return `
    <div class="book-card">
      <div class="book-cover">${coverHTML}</div>
      <div class="book-card-info">
        <div class="book-card-title">${book.title}</div>
        <div class="book-card-author">${book.author}</div>
        ${progressHTML}
      </div>
    </div>
  `
}

function skeletonCards(n) {
  return Array.from({ length: n }, () => `
    <div class="book-card">
      <div class="book-cover skeleton"></div>
      <div style="padding:8px 4px;display:flex;flex-direction:column;gap:6px;">
        <div class="skeleton" style="height:12px;border-radius:6px;width:90%"></div>
        <div class="skeleton" style="height:10px;border-radius:6px;width:60%"></div>
      </div>
    </div>
  `).join('')
}

export function destroyShelves() {}
