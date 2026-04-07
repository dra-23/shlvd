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
  return `<div class="botm-stars">${[1,2,3,4,5].map(n =>
    `<span class="material-symbols-rounded botm-star ${n <= rating ? 'filled' : ''}"
      style="font-size:16px;${n <= rating ? "font-variation-settings:'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 24;color:#F5A623;" : 'color:var(--md-outline-variant);'}">star</span>`
  ).join('')}</div>`
}

export function renderBotm(container) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;min-height:100%;">
      <div class="top-bar">
        <span class="top-bar-title">Book of the Month</span>
      </div>
      <div id="botm-content" style="padding:16px 16px 24px;">
        ${skeletonList()}
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

    content.innerHTML = `<div class="botm-list">${books.map(botmCardHTML).join('')}</div>`

    content.querySelectorAll('.botm-card').forEach((card, i) => {
      card.addEventListener('click', () => openBookDetail(books[i], books[i].shelf, null))
    })
  })

  return unsub
}

function botmCardHTML(book) {
  const month = formatMonth(book.dateCompleted)

  const coverHTML = book.thumbnail
    ? `<img src="${book.thumbnail}" alt="${book.title}" loading="lazy" />`
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
