import { addBook, updateBook, removeBook, getBook } from '../db.js'
import { showSnackbar } from './shelves.js'

const SHELF_LABELS = { want: 'Want to Read', reading: 'Reading', read: 'Read' }

/**
 * Open the book detail bottom sheet.
 * @param {Object} book - normalized book (from Google Books API or Firestore)
 * @param {string|null} existingShelf - current shelf if already added, else null
 * @param {Function} onDone - called after any change (add/update/remove)
 */
export function openBookDetail(book, existingShelf, onDone) {
  // Build scrim + sheet
  const scrim = document.createElement('div')
  scrim.className = 'sheet-scrim'

  const sheet = document.createElement('div')
  sheet.className = 'bottom-sheet'
  sheet.innerHTML = buildSheetHTML(book, existingShelf)

  document.body.appendChild(scrim)
  document.body.appendChild(sheet)

  // State
  let selectedShelf = existingShelf || 'want'
  let rating = book.rating || 0
  let isDirty = false

  // ── Shelf chip selection ──────────────────────────────
  sheet.querySelectorAll('.shelf-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      sheet.querySelectorAll('.shelf-chip').forEach(c => c.classList.remove('selected'))
      chip.classList.add('selected')
      selectedShelf = chip.dataset.shelf

      // Show/hide progress section
      const progressSection = sheet.querySelector('#progress-section')
      if (progressSection) {
        progressSection.style.display = selectedShelf === 'reading' ? 'block' : 'none'
      }
      isDirty = true
    })
  })

  // ── Star rating ───────────────────────────────────────
  const stars = sheet.querySelectorAll('.star-btn')
  const setStars = (n) => {
    rating = n
    stars.forEach((s, i) => s.classList.toggle('filled', i < n))
  }
  setStars(rating)

  stars.forEach((star, i) => {
    star.addEventListener('click', () => {
      setStars(rating === i + 1 ? 0 : i + 1) // tap same star to clear
      isDirty = true
    })
  })

  // ── Save button ───────────────────────────────────────
  sheet.querySelector('#save-btn').addEventListener('click', async () => {
    const progress = parseInt(sheet.querySelector('#progress-input')?.value || '0', 10)
    const notes = sheet.querySelector('#notes-input')?.value.trim() || ''

    try {
      if (!existingShelf) {
        // New book
        await addBook({
          googleBooksId: book.googleBooksId,
          title: book.title,
          author: book.author,
          thumbnail: book.thumbnail || '',
          pageCount: book.pageCount || 0,
          shelf: selectedShelf,
        })
        if (rating || notes) {
          await updateBook(book.googleBooksId, { rating, notes })
        }
        if (selectedShelf === 'reading' && progress > 0) {
          await updateBook(book.googleBooksId, { progress })
        }
        showSnackbar(`Added to ${SHELF_LABELS[selectedShelf]}`)
      } else {
        // Existing — update everything
        const updates = { shelf: selectedShelf, rating, notes }
        if (selectedShelf === 'reading') updates.progress = progress
        await updateBook(book.googleBooksId, updates)
        showSnackbar('Updated')
      }
      closeSheet()
      onDone?.()
    } catch (err) {
      console.error(err)
      showSnackbar('Something went wrong')
    }
  })

  // ── Remove button ─────────────────────────────────────
  const removeBtn = sheet.querySelector('#remove-btn')
  if (removeBtn) {
    removeBtn.addEventListener('click', async () => {
      try {
        await removeBook(book.googleBooksId)
        showSnackbar('Removed from shelf')
        closeSheet()
        onDone?.()
      } catch (err) {
        console.error(err)
        showSnackbar('Something went wrong')
      }
    })
  }

  // ── Close ─────────────────────────────────────────────
  function closeSheet() {
    scrim.classList.add('closing')
    sheet.classList.add('closing')
    setTimeout(() => {
      scrim.remove()
      sheet.remove()
    }, 300)
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

  const shelfButtons = Object.entries(SHELF_LABELS).map(([id, label]) => `
    <button class="chip shelf-chip ${existingShelf === id ? 'selected' : ''}" data-shelf="${id}">
      ${label}
    </button>
  `).join('')

  const progressHTML = `
    <div id="progress-section" style="display:${existingShelf === 'reading' ? 'block' : 'none'}">
      <div class="sheet-section-label">Progress</div>
      <div class="progress-row">
        <div class="progress-input-wrap">
          <span class="material-symbols-rounded" style="font-size:20px;color:var(--md-on-surface-variant)">bookmark</span>
          <input
            type="number"
            class="progress-num-input"
            id="progress-input"
            min="0"
            max="${book.pageCount || 9999}"
            value="${book.progress || 0}"
            placeholder="0"
          />
          <span class="progress-sep">/</span>
          <span class="progress-total">${book.pageCount ? `${book.pageCount} pp` : '—'}</span>
        </div>
      </div>
    </div>
  `

  const removeHTML = existingShelf
    ? `<button class="btn btn-danger" id="remove-btn" style="width:100%">
         <span class="material-symbols-rounded">delete</span>
         Remove from shelf
       </button>`
    : ''

  return `
    <div class="sheet-handle"><div class="sheet-handle-bar"></div></div>

    <div class="sheet-header">
      <div class="sheet-cover">${coverHTML}</div>
      <div class="sheet-meta">
        <div class="sheet-title">${book.title}</div>
        <div class="sheet-author">${book.author}</div>
        ${book.publishedDate ? `<div class="body-small mt-4" style="color:var(--md-on-surface-variant)">${book.publishedDate.substring(0,4)}</div>` : ''}
      </div>
      <button class="icon-btn" id="close-btn">
        <span class="material-symbols-rounded">close</span>
      </button>
    </div>

    <div class="sheet-body">
      <div>
        <div class="sheet-section-label">Shelf</div>
        <div class="chips">${shelfButtons}</div>
      </div>

      ${progressHTML}

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

      <div>
        <div class="sheet-section-label">Notes</div>
        <textarea
          class="notes-textarea"
          id="notes-input"
          placeholder="Your thoughts…"
        >${book.notes || ''}</textarea>
      </div>

      <button class="btn btn-filled" id="save-btn" style="width:100%;height:48px">
        <span class="material-symbols-rounded">${existingShelf ? 'save' : 'add'}</span>
        ${existingShelf ? 'Save changes' : 'Add to shelf'}
      </button>

      ${removeHTML}
    </div>
  `
}
