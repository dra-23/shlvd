import { watchBotm } from '../db.js'
import { openBookDetail } from './book-detail.js'

function formatMonth(date) {
  if (!date) return ''
  try {
    const d = date instanceof Date ? date : new Date(date)
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  } catch { return '' }
}

export function renderBotm(container) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;min-height:100%;">
      <div class="top-bar">
        <span class="top-bar-title">Book of the Month</span>
      </div>
      <div id="botm-content" style="padding:16px 16px 24px;">
        ${skeletonGrid()}
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

    content.innerHTML = `<div class="botm-grid">${books.map(botmCardHTML).join('')}</div>`

    content.querySelectorAll('.botm-card').forEach((card, i) => {
      card.addEventListener('click', () => {
        openBookDetail(books[i], books[i].shelf, null)
      })
    })
  })

  return unsub
}

function botmCardHTML(book) {
  const coverHTML = book.thumbnail
    ? `<img src="${book.thumbnail}" alt="${book.title}" loading="lazy" />`
    : `<div class="book-cover-placeholder">
         <span class="material-symbols-rounded">menu_book</span>
         <div class="placeholder-title">${book.title}</div>
       </div>`

  const month = formatMonth(book.dateCompleted)

  return `
    <div class="botm-card">
      <div class="botm-cover">${coverHTML}</div>
      ${month ? `<div class="botm-month-badge">${month}</div>` : ''}
      <div class="botm-info">
        <div class="botm-title">${book.title}</div>
        <div class="botm-author">${book.author}</div>
      </div>
    </div>
  `
}

function skeletonGrid() {
  return `
    <div class="botm-grid">
      ${Array.from({ length: 4 }, () => `
        <div class="botm-card">
          <div class="botm-cover skeleton"></div>
          <div style="display:flex;flex-direction:column;gap:6px;padding:8px 4px;">
            <div class="skeleton" style="height:11px;border-radius:6px;width:55%"></div>
            <div class="skeleton" style="height:13px;border-radius:6px;width:85%"></div>
            <div class="skeleton" style="height:11px;border-radius:6px;width:60%"></div>
          </div>
        </div>
      `).join('')}
    </div>
  `
}

export function destroyBotm() {}
