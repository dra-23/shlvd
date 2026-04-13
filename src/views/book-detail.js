import { addBook, updateBook, removeBook } from '../db.js'
import { showSnackbar } from './shelves.js'
import { backHandlerStack } from '../main.js'

const SHELF_LABELS = { want: 'TBR', reading: 'Reading', read: 'Read', dnf: 'DNF' }

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

export function openBookDetail(book, existingShelf, onDone, extraHTML = '', onMounted = null, onClose = null) {
  const scrim = document.createElement('div')
  scrim.className = 'sheet-scrim'

  const sheet = document.createElement('div')
  sheet.className = 'bottom-sheet'
  sheet.innerHTML = buildSheetHTML(book, existingShelf, extraHTML)

  document.body.appendChild(scrim)
  document.body.appendChild(sheet)

  if (onMounted) requestAnimationFrame(() => onMounted(sheet))

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

  // ── BotM toggle (auto-saves if book already on shelf) ────
  const botmBtn = sheet.querySelector('#botm-btn')
  const applyBotmUI = (val) => {
    botmBtn.classList.toggle('active', val)
    botmBtn.querySelector('.material-symbols-rounded').style.fontVariationSettings =
      val ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" : "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24"
  }
  applyBotmUI(isBOTM)
  botmBtn.addEventListener('click', async () => {
    isBOTM = !isBOTM
    applyBotmUI(isBOTM)
    if (existingShelf) {
      try {
        await updateBook(book.id || book.googleBooksId, { isBOTM })
        showSnackbar(isBOTM ? '✦ Book of the Month!' : 'BotM removed')
      } catch (err) {
        console.error('BotM auto-save error:', err)
      }
    }
  })

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
          googleBooksId:  book.googleBooksId,
          title:          book.title,
          author:         book.author,
          thumbnail:      book.thumbnail || '',
          pageCount:      book.pageCount || 0,
          shelf:          selectedShelf,
          description:    book.description || '',
          dateReleased:   book.publishedDate || book.dateReleased || '',
          genre:          genre,
        })
        if (rating || notes || isBOTM || genre || updates.dateCompleted) {
          await updateBook(book.googleBooksId, updates)
        }
        showSnackbar(`Added to ${SHELF_LABELS[selectedShelf]}`)
      } else {
        await updateBook(book.id || book.googleBooksId, updates)
        showSnackbar('Updated')
      }
      closeSheet('manual')
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
      closeSheet('manual')
      onDone?.()
    } catch (err) {
      console.error(err)
      showSnackbar('Something went wrong')
    }
  })

  // ── Close ─────────────────────────────────────────────
  history.pushState({ sheet: true }, '')

  function closeSheet(source) {
    // Remove from back stack in case of manual close
    const idx = backHandlerStack.indexOf(closeSheet)
    if (idx !== -1) backHandlerStack.splice(idx, 1)
    // If manually closed, pop the history entry we pushed
    if (source !== 'popstate') history.back()
    scrim.classList.add('closing')
    sheet.classList.add('closing')
    onClose?.()
    setTimeout(() => { scrim.remove(); sheet.remove() }, 300)
  }

  backHandlerStack.push(closeSheet)

  scrim.addEventListener('click', () => closeSheet('manual'))
  sheet.querySelector('#close-btn')?.addEventListener('click', () => closeSheet('manual'))

  // ── Swipe down to dismiss ─────────────────────────────
  let dragStartY = 0
  let dragging = false

  sheet.addEventListener('touchstart', e => {
    dragStartY = e.touches[0].clientY
    dragging = true
    sheet.style.transition = 'none'
  }, { passive: true })

  sheet.addEventListener('touchmove', e => {
    if (!dragging) return
    const dy = e.touches[0].clientY - dragStartY
    if (dy > 0) sheet.style.transform = `translateY(${dy}px)`
  }, { passive: true })

  sheet.addEventListener('touchend', e => {
    if (!dragging) return
    dragging = false
    sheet.style.transition = ''
    const dy = e.changedTouches[0].clientY - dragStartY
    if (dy > 120) {
      closeSheet('manual')
    } else {
      sheet.style.transform = ''
    }
  }, { passive: true })
}

// ── Manual add ───────────────────────────────────────────────────────────────

export function openManualAdd(onDone) {
  const scrim = document.createElement('div')
  scrim.className = 'sheet-scrim'

  const sheet = document.createElement('div')
  sheet.className = 'bottom-sheet'
  sheet.innerHTML = `
    <div class="sheet-handle"><div class="sheet-handle-bar"></div></div>

    <div class="sheet-header" style="align-items:center;">
      <div class="sheet-meta" style="flex:1;">
        <div class="sheet-title" style="font-size:1.1rem;">Add Book Manually</div>
      </div>
      <button class="icon-btn" id="close-btn">
        <span class="material-symbols-rounded">close</span>
      </button>
    </div>

    <div class="sheet-body">

      <!-- Required fields -->
      <div>
        <div class="sheet-section-label">Title <span style="color:var(--md-error)">*</span></div>
        <input type="text" class="manual-input" id="manual-title" placeholder="Book title" autocomplete="off" />
      </div>

      <div>
        <div class="sheet-section-label">Author</div>
        <input type="text" class="manual-input" id="manual-author" placeholder="Author name" autocomplete="off" />
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <div class="sheet-section-label">Genre</div>
          <input type="text" class="manual-input" id="manual-genre" placeholder="e.g. Fiction" autocomplete="off" />
        </div>
        <div>
          <div class="sheet-section-label">Published</div>
          <input type="text" class="manual-input" id="manual-published" placeholder="e.g. 2024" autocomplete="off" />
        </div>
      </div>

      <div>
        <div class="sheet-section-label">Page Count</div>
        <input type="number" class="manual-input" id="manual-pages" placeholder="0" min="0" />
      </div>

      <div>
        <div class="sheet-section-label">Description</div>
        <textarea class="notes-textarea" id="manual-desc" placeholder="Short description…" style="min-height:80px;"></textarea>
      </div>

      <!-- Shelf -->
      <div>
        <div class="sheet-section-label">Shelf</div>
        <div class="chips" id="manual-chips">
          ${Object.entries(SHELF_LABELS).map(([id, label]) => `
            <button class="chip shelf-chip ${id === 'want' ? 'selected' : ''}" data-shelf="${id}">${label}</button>
          `).join('')}
        </div>
      </div>

      <!-- Progress -->
      <div id="manual-progress-section" style="display:none">
        <div class="sheet-section-label">Progress (pages)</div>
        <div class="progress-row">
          <div class="progress-input-wrap">
            <span class="material-symbols-rounded" style="font-size:20px;color:var(--md-on-surface-variant)">bookmark</span>
            <input type="number" class="progress-num-input" id="manual-progress" min="0" value="0" placeholder="0" />
          </div>
        </div>
      </div>

      <!-- Date Completed -->
      <div id="manual-date-section" style="display:none">
        <div class="sheet-section-label">Date Completed</div>
        <input type="date" class="date-input" id="manual-date-completed" />
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

      <!-- BotM toggle -->
      <button class="botm-toggle-btn" id="manual-botm-btn">
        <span class="material-symbols-rounded">workspace_premium</span>
        Book of the Month
      </button>

      <!-- Notes -->
      <div>
        <div class="sheet-section-label">Notes</div>
        <textarea class="notes-textarea" id="manual-notes" placeholder="Your thoughts…"></textarea>
      </div>

      <button class="btn btn-filled" id="manual-save-btn" style="width:100%;height:48px">
        <span class="material-symbols-rounded">add</span>
        Add to shelf
      </button>

    </div>
  `

  document.body.appendChild(scrim)
  document.body.appendChild(sheet)

  // ── State ──────────────────────────────────────────────
  let selectedShelf = 'want'
  let rating = 0
  let isBOTM = false

  // ── Shelf chips ────────────────────────────────────────
  sheet.querySelectorAll('.shelf-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      sheet.querySelectorAll('.shelf-chip').forEach(c => c.classList.remove('selected'))
      chip.classList.add('selected')
      selectedShelf = chip.dataset.shelf
      sheet.querySelector('#manual-progress-section').style.display =
        selectedShelf === 'reading' ? 'block' : 'none'
      sheet.querySelector('#manual-date-section').style.display =
        selectedShelf === 'read' ? 'block' : 'none'
    })
  })

  // ── Stars ──────────────────────────────────────────────
  const stars = sheet.querySelectorAll('.star-btn')
  const setStars = n => {
    rating = n
    stars.forEach((s, i) => s.classList.toggle('filled', i < n))
  }
  stars.forEach((s, i) => s.addEventListener('click', () => setStars(rating === i + 1 ? 0 : i + 1)))

  // ── BotM ───────────────────────────────────────────────
  const botmBtn = sheet.querySelector('#manual-botm-btn')
  const applyBotmUI = val => {
    botmBtn.classList.toggle('active', val)
    botmBtn.querySelector('.material-symbols-rounded').style.fontVariationSettings =
      val ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" : "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24"
  }
  botmBtn.addEventListener('click', () => { isBOTM = !isBOTM; applyBotmUI(isBOTM) })

  // ── Save ───────────────────────────────────────────────
  sheet.querySelector('#manual-save-btn').addEventListener('click', async () => {
    const title = sheet.querySelector('#manual-title').value.trim()
    if (!title) {
      sheet.querySelector('#manual-title').focus()
      sheet.querySelector('#manual-title').classList.add('input-error')
      return
    }
    const author      = sheet.querySelector('#manual-author').value.trim() || 'Unknown author'
    const genre       = sheet.querySelector('#manual-genre').value.trim()
    const published   = sheet.querySelector('#manual-published').value.trim()
    const pages       = parseInt(sheet.querySelector('#manual-pages').value || '0', 10)
    const description = sheet.querySelector('#manual-desc').value.trim()
    const notes       = sheet.querySelector('#manual-notes').value.trim()
    const progress    = parseInt(sheet.querySelector('#manual-progress')?.value || '0', 10)
    const dateStr     = sheet.querySelector('#manual-date-completed')?.value

    const bookId = `manual_${Date.now()}`

    try {
      await addBook({
        googleBooksId: bookId,
        title,
        author,
        thumbnail: '',
        pageCount: pages,
        shelf: selectedShelf,
        description,
        dateReleased: published,
        genre,
      })

      const updates = { rating, notes, isBOTM, genre }
      if (selectedShelf === 'reading') updates.progress = progress
      if (selectedShelf === 'read' && dateStr) {
        updates.dateCompleted = new Date(dateStr + 'T12:00:00')
      }

      if (rating || notes || isBOTM || genre || updates.dateCompleted) {
        await updateBook(bookId, updates)
      }

      showSnackbar(`Added to ${SHELF_LABELS[selectedShelf]}`)
      closeSheet('manual')
      onDone?.()
    } catch (err) {
      console.error(err)
      showSnackbar('Something went wrong')
    }
  })

  // ── Close ──────────────────────────────────────────────
  history.pushState({ sheet: true }, '')

  function closeSheet(source) {
    const idx = backHandlerStack.indexOf(closeSheet)
    if (idx !== -1) backHandlerStack.splice(idx, 1)
    if (source !== 'popstate') history.back()
    scrim.classList.add('closing')
    sheet.classList.add('closing')
    setTimeout(() => { scrim.remove(); sheet.remove() }, 300)
  }

  backHandlerStack.push(closeSheet)

  scrim.addEventListener('click', () => closeSheet('manual'))
  sheet.querySelector('#close-btn').addEventListener('click', () => closeSheet('manual'))

  // ── Swipe to dismiss ───────────────────────────────────
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
    const dy = e.changedTouches[0].clientY - dragStartY
    if (dy > 120) closeSheet('manual'); else sheet.style.transform = ''
  }, { passive: true })
}

// ── Book detail sheet ─────────────────────────────────────────────────────────

function buildSheetHTML(book, existingShelf, extraHTML = '') {
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
        <input type="text" class="genre-meta-input" id="genre-input"
          value="${book.genre || book.categories?.[0] || ''}" placeholder="Add genre…" />
        ${book.dateReleased ? `<div class="body-small" style="color:var(--md-on-surface-variant)">Published ${book.dateReleased}</div>` : ''}
      </div>
      <button class="icon-btn" id="close-btn">
        <span class="material-symbols-rounded">close</span>
      </button>
    </div>

    <div class="sheet-body">

      ${hasDescription ? `
      <!-- Description -->
      <div>
        <div class="sheet-section-label">Description</div>
        <div class="description-text" id="description-text">${book.description}</div>
        <button class="btn btn-text" id="desc-toggle" style="padding:4px 0;margin-top:4px;">Show more</button>
      </div>
      ` : ''}

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

      <!-- BotM toggle -->
      <button class="botm-toggle-btn" id="botm-btn">
        <span class="material-symbols-rounded">workspace_premium</span>
        Book of the Month
      </button>

      <!-- Notes -->
      <div>
        <div class="sheet-section-label">Notes</div>
        <textarea class="notes-textarea" id="notes-input"
          placeholder="Your thoughts…">${book.notes || ''}</textarea>
      </div>

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

      ${extraHTML}

    </div>
  `
}
