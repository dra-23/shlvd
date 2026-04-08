import { watchBotm } from '../db.js'
import { openBookDetail } from './book-detail.js'

function formatMonth(date) {
  if (!date) return ''
  try {
    const d = date instanceof Date ? date : new Date(date)
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()
  } catch { return '' }
}

function starHTML(rating) {
  if (!rating) return ''
  // Define your gold color here for easy updates
  const goldColor = '#FFB800'; 
  const outlineColor = 'var(--md-outline-variant)';

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

  const unsub = watchBotm(books => {
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
      card.addEventListener('click', () => openBookDetail(books[i], books[i].shelf, null))
    })
  })

  return unsub
}

function groupByYear(books) {
  const map = new Map()
  books.forEach(book => {
    const d = book.dateCompleted
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
      <div class="botm-cover-wrap">
        ${coverHTML}
      </div>
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
