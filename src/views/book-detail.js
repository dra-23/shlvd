import { addBook, updateBook, removeBook } from '../db.js'
import { showSnackbar } from './shelves.js'

const SHELF_LABELS = { want: 'Want to Read', reading: 'Reading', read: 'Read' }

function tsToDateInput(date) {
  if (!date) return ''
  try {
    const d = date instanceof Date ? date : new Date(date)
    return d.toISOString().split('T')[0]
  } catch { return '' }
}

function formatDisplayDate(date) {
  if (!date) return ''
  try {
    const d = date instanceof Date ? date : new Date(date)
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  } catch { return '' }
}

export function openBookDetail(book, existingShelf, onDone) {
  const scrim = document.createElement('div')
  scrim.className = 'sheet-scrim'

  const sheet = document.createElement('div')
  sheet.className = 'bottom-sheet'
  sheet.innerHTML = buildSheetHTML(book, existingShelf)

  document.body.appendChild(scrim)
  document.body.appendChild(sheet)

  // ── State ─────────────────────────────────────────────
  let selectedShelf = existingShelf || 'want'
  let rating = book.rating || 0
  let isBOTM = book.isBOTM || false

  // ── Shelf chips ───────────────────────────────────────
  sheet.querySelectorAll('.shelf-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      sheet.querySelectorAll('.shelf-chip').forEach(c => c.classList.remove('selected'))
      chip.classList.add('selected')
      selectedShelf = chip.dataset.shelf
      sheet.querySelector('#progress-section').style.display =
        selectedShelf === 'reading' ? 'block' : 'none'
      sheet.querySelector('#date-completed-section').style.display =
        selectedShelf === 'read' ? 'block' : 'none'
    })
  })

  // ── Star rating ───────────────────────────────────────
  const stars = sheet.querySelectorAll('.star-btn')
  const setStars = n => {
    rating = n
    stars.forEach((s, i) => s.classList.toggle('filled', i < n))
  }
  setStars(rating)
  stars.forEach((s, i) => s.addEventListener('click', () => setStars(rating === i + 1 ? 0 : i + 1)))

  // ── BotM toggle ───────────────────────────────────────
  const botmBtn = sheet.querySelector('#botm-btn')
  const setBotm = val => {
    isBOTM = val
    botmBtn.classList.toggle('active', isBOTM)
    botmBtn.querySelector('.material-symbols-rounded').style.fontVariationSettings =
      isBOTM ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" : "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24"
  }
  setBotm(isBOTM)
  botmBtn.addEventListener('click', () => setBotm(!isBOTM))

  // ── Description expand ────────────────────────────────
  const descEl = sheet.querySelector('#description-text')
  const descBtn = sheet.querySelector('#desc-toggle')
  if (descEl && descBtn) {
    descBtn.addEventListener('click', () => {
      const expanded = descEl.classList.toggle('expanded')
      descBtn.textContent = expanded ? 'Show less' : 'Show more'
    })
  }

  // ── Save ──────────────────────────────────────────────
  sheet.querySelector('#save-btn').addEventListener('click', async () => {
    const progress = parseInt(sheet.querySelector('#progress-input')?.value || '0', 10)
    const notes = sheet.querySelector('#notes-input')?.value.trim() || ''
    const genre = sheet.querySelector('#genre-input')?.value.trim() || ''
    const dateStr = sheet.querySelector('#date-completed-input')?.value

    const updates = { shelf: selectedShelf, rating, notes, isBOTM, genre }
    if (selectedShelf === 'reading') updates.progress = progress
    if (selectedShelf === 'read' && dateStr) {
      updates.dateCompleted = new Date(dateStr + 'T12:00:00')
    }

    try {
      if (!existingShelf) {
        await addBook({
          googleBooksId: book.googleBooksId,
          title: book.title,
          author: book.author,
          thumbnail: book.thumbnail || '',
          pageCount: book.pageCount || 0,
          shelf: selectedShelf,
        })
        if (rating || notes || isBOTM || genre || updates.dateCompleted) {
          await updateBook(book.googleBooksId, updates)
        }
        showSnackbar(`Added to ${SHELF_LABELS[selectedShelf]}`)
      } else {
        await updateBook(book.id || book.googleBooksId, updates)
        showSnackbar('Updated')
      }
      closeSheet()
      onDone?.()
    } catch (err) {
      console.error(err)
      showSnackbar('Something went wrong')
    }
  })

  // ── Remove ────────────────────────────────────────────
  sheet.querySelector('#remove-btn')?.addEventListener('click', async () => {
    try {
      await removeBook(book.id || book.googleBooksId)
      showSnackbar('Removed from shelf')
      closeSheet()
      onDone?.()
    } catch (err) {
      console.error(err)
      showSnackbar('Something went wrong')
    }
  })

  // ── Close ─────────────────────────────────────────────
  function closeSheet() {
    scrim.classList.add('closing')
    sheet.classList.add('closing')
    setTimeout(() => { scrim.remove(); sheet.remove() }, 300)
  }

  scrim.addEventListener('click', closeSheet)
  sheet.querySelector('#close-btn')?.addEventListener('click', closeSheet)
}

function buildSheetHTML(book, existingShelf) {
  const coverHTML = book.thumbnail
    ? `<img src="${book.thumbnail}" alt="${book.title}" />`
    : `<div class="book-cover-placeholder">
         <span class="material-symbols-rounded">menu_book</span>
       </div>`

  const shelfChips = Object.entries(SHELF_LABELS).map(([id, label]) => `
    <button class="chip shelf-chip ${existingShelf === id ? 'selected' : ''}" data-shelf="${id}">${label}</button>
  `).join('')

  const hasDescription = book.description && book.description !== 'No description available.'

  return `
    <div class="sheet-handle"><div class="sheet-handle-bar"></div></div>

    <div class="sheet-header">
      <div class="sheet-cover">${coverHTML}</div>
      <div class="sheet-meta">
        <div class="sheet-title">${book.title}</div>
        <div class="sheet-author">${book.author}</div>
        ${book.dateReleased ? `<div class="body-small mt-4" style="color:var(--md-on-surface-variant)">Published ${book.dateReleased}</div>` : ''}
      </div>
      <button class="icon-btn" id="close-btn">
        <span class="material-symbols-rounded">close</span>
      </button>
    </div>

    <div class="sheet-body">

      <!-- Shelf -->
      <div>
        <div class="sheet-section-label">Shelf</div>
        <div class="chips">${shelfChips}</div>
      </div>

      <!-- Progress (reading only) -->
      <div id="progress-section" style="display:${existingShelf === 'reading' ? 'block' : 'none'}">
        <div class="sheet-section-label">Progress</div>
        <div class="progress-row">
          <div class="progress-input-wrap">
            <span class="material-symbols-rounded" style="font-size:20px;color:var(--md-on-surface-variant)">bookmark</span>
            <input type="number" class="progress-num-input" id="progress-input"
              min="0" max="${book.pageCount || 9999}"
              value="${book.progress || 0}" placeholder="0" />
            <span class="progress-sep">/</span>
            <span class="progress-total">${book.pageCount ? `${book.pageCount} pp` : '—'}</span>
          </div>
        </div>
      </div>

      <!-- Date Completed (read only) -->
      <div id="date-completed-section" style="display:${existingShelf === 'read' ? 'block' : 'none'}">
        <div class="sheet-section-label">Date Completed</div>
        <input type="date" class="date-input" id="date-completed-input"
          value="${tsToDateInput(book.dateCompleted)}" />
      </div>

      <!-- Rating -->
      <div>
        <div class="sheet-section-label">Rating</div>
        <div class="star-rating">
          ${[1,2,3,4,5].map(n => `
            <button class="star-btn" data-star="${n}">
              <span class="material-symbols-rounded">star</span>
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Genre -->
      <div>
        <div class="sheet-section-label">Genre</div>
        <input type="text" class="genre-input-field" id="genre-input"
          value="${book.genre || ''}" placeholder="e.g. Fantasy, Literary Fiction…" />
      </div>

      <!-- BotM toggle -->
      <button class="botm-toggle-btn" id="botm-btn">
        <span class="material-symbols-rounded">auto_awesome</span>
        Book of the Month
      </button>

      <!-- Notes -->
      <div>
        <div class="sheet-section-label">Notes</div>
        <textarea class="notes-textarea" id="notes-input"
          placeholder="Your thoughts…">${book.notes || ''}</textarea>
      </div>

      ${hasDescription ? `
      <!-- Description -->
      <div>
        <div class="sheet-section-label">Description</div>
        <div class="description-text" id="description-text">${book.description}</div>
        <button class="btn btn-text" id="desc-toggle" style="padding:4px 0;margin-top:4px;">Show more</button>
      </div>
      ` : ''}

      <!-- Save -->
      <button class="btn btn-filled" id="save-btn" style="width:100%;height:48px">
        <span class="material-symbols-rounded">${existingShelf ? 'save' : 'add'}</span>
        ${existingShelf ? 'Save changes' : 'Add to shelf'}
      </button>

      ${existingShelf ? `
      <button class="btn btn-danger" id="remove-btn" style="width:100%">
        <span class="material-symbols-rounded">delete</span>
        Remove from shelf
      </button>` : ''}

    </div>
  `
}
