import { esc, safeHTML } from '../escape.js'
import { addBook, updateBook, removeBook, restoreBook, setBOTY, getSeriesList, getGenreList } from '../db.js'
import { matchGenre } from '../genres.js'

// Cached series list for autocomplete — invalidated on every save
let _seriesCache = null
async function populateSeriesDatalist(sheet) {
  if (!_seriesCache) {
    try { _seriesCache = await getSeriesList() } catch { _seriesCache = [] }
  }
  const list = sheet.querySelector('#series-datalist')
  if (list) list.innerHTML = _seriesCache.map(s => `<option value="${esc(s)}">`).join('')
}

// Same for genres, so typing suggests the spellings already in use
let _genreCache = null
/** Call after genres change elsewhere (e.g. Manage genres) */
export function invalidateGenreCache() { _genreCache = null }
async function populateGenreDatalist(sheet, book) {
  if (!_genreCache) {
    try { _genreCache = await getGenreList() } catch { _genreCache = [] }
  }
  const list = sheet.querySelector('#genre-datalist')
  if (list) list.innerHTML = _genreCache.map(g => `<option value="${esc(g)}">`).join('')

  // A book from Search has Google's categories, which are often subject tags
  // ("Brothers", "Amnesia"). Only pre-fill one that matches a genre you use.
  const input = sheet.querySelector('#genre-input')
  if (input && !input.value && book?.categories?.length) {
    input.value = book.categories.map(c => matchGenre(c, _genreCache)).find(Boolean) || ''
  }
}
import { showSnackbar } from './shelves.js'
import { backHandlerStack, popOwnHistoryEntry } from '../main.js'

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
  sheet.className = 'bottom-sheet book-detail-sheet'
  sheet.innerHTML = buildSheetHTML(book, existingShelf, extraHTML)
  // Blurred cover behind the header (set here rather than in the template
  // so the URL never has to survive HTML + CSS escaping)
  if (book.thumbnail) {
    sheet.querySelector('.bd-hero').style.setProperty('--cover', `url(${JSON.stringify(book.thumbnail)})`)
  }

  document.body.appendChild(scrim)
  document.body.appendChild(sheet)

  if (onMounted) requestAnimationFrame(() => onMounted(sheet))

  // ── State ─────────────────────────────────────────────
  let selectedShelf = existingShelf || 'want'
  let rating = book.rating || 0
  let isBOTM = book.isBOTM || false
  let isBOTY = book.isBOTY || false
  const botyYear = book.dateCompleted
    ? new Date(book.dateCompleted).getFullYear()
    : new Date().getFullYear()

  // Populate series and genre autocomplete asynchronously
  populateSeriesDatalist(sheet)
  populateGenreDatalist(sheet, book)

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
  const ratingLabel = sheet.querySelector('#rating-label')
  const RATING_WORDS = ['Tap to rate', 'Not for me', 'It was OK', 'Liked it', 'Really liked it', 'Loved it']
  const setStars = n => {
    rating = n
    stars.forEach((s, i) => s.classList.toggle('filled', i < n))
    ratingLabel.textContent = RATING_WORDS[n]
  }
  setStars(rating)
  stars.forEach((s, i) => s.addEventListener('click', () => setStars(rating === i + 1 ? 0 : i + 1)))

  // ── Progress bar follows the page input ──────────────
  const progressInput = sheet.querySelector('#progress-input')
  const progressFill  = sheet.querySelector('#progress-fill')
  const progressPct   = sheet.querySelector('#progress-pct')
  if (progressInput && progressFill && book.pageCount) {
    progressInput.addEventListener('input', () => {
      const p = Math.max(0, Math.min(100, Math.round((Number(progressInput.value) || 0) / book.pageCount * 100)))
      progressFill.style.width = `${p}%`
      progressPct.textContent = `${p}%`
    })
  }

  // ── BotM / BOTY toggles ───────────────────────────────
  const botmBtn = sheet.querySelector('#botm-btn')
  const botyBtn = sheet.querySelector('#boty-btn')
  const applyBotmUI = (val) => {
    botmBtn.classList.toggle('active', val)
    botmBtn.querySelector('.material-symbols-rounded').style.fontVariationSettings =
      val ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" : "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24"
  }
  applyBotmUI(isBOTM)
  botmBtn.addEventListener('click', async () => {
    isBOTM = !isBOTM
    applyBotmUI(isBOTM)
    // Show/hide BOTY button based on BotM state
    botyBtn.style.display = isBOTM ? 'flex' : 'none'
    if (!isBOTM && isBOTY) {
      isBOTY = false
      applyBotyUI(false)
    }
    if (existingShelf) {
      try {
        await updateBook(book.id || book.googleBooksId, { isBOTM })
        showSnackbar(isBOTM ? '✦ Book of the Month!' : 'BotM removed')
      } catch (err) {
        console.error('BotM auto-save error:', err)
      }
    }
  })

  // ── BOTY toggle ───────────────────────────────────────
  const applyBotyUI = (val) => {
    botyBtn.classList.toggle('active', val)
    botyBtn.querySelector('.material-symbols-rounded').style.fontVariationSettings =
      val ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" : "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24"
  }
  applyBotyUI(isBOTY)
  botyBtn.addEventListener('click', async () => {
    isBOTY = !isBOTY
    applyBotyUI(isBOTY)
    if (existingShelf) {
      try {
        if (isBOTY) {
          await setBOTY(book.id || book.googleBooksId, botyYear)
          showSnackbar(`🏆 Book of ${botyYear}!`)
        } else {
          await updateBook(book.id || book.googleBooksId, { isBOTY: false, botyYear: null })
          showSnackbar('Book of the Year removed')
        }
      } catch (err) { console.error('BOTY error:', err) }
    }
  })

  // ── Description expand ────────────────────────────────
  const descEl = sheet.querySelector('#description-text')
  const descBtn = sheet.querySelector('#desc-toggle')
  if (descEl && descBtn) {
    // Short descriptions fit without clamping — no need for the toggle
    requestAnimationFrame(() => {
      if (descEl.scrollHeight <= descEl.clientHeight + 2) descBtn.remove()
    })
    descBtn.addEventListener('click', () => {
      const expanded = descEl.classList.toggle('expanded')
      descBtn.textContent = expanded ? 'Show less' : 'Show more'
    })
  }

  // ── Save ──────────────────────────────────────────────
  sheet.querySelector('#save-btn').addEventListener('click', async () => {
    const progress     = parseInt(sheet.querySelector('#progress-input')?.value || '0', 10)
    const notes        = sheet.querySelector('#notes-input')?.value.trim() || ''
    const genre        = sheet.querySelector('#genre-input')?.value.trim() || ''
    const series       = sheet.querySelector('#series-input')?.value.trim() || ''
    const seriesNumber = sheet.querySelector('#series-num-input')?.value.trim() || ''
    const dateStr      = sheet.querySelector('#date-completed-input')?.value

    const updates = { shelf: selectedShelf, rating, notes, isBOTM, isBOTY, genre, series, seriesNumber }
    if (selectedShelf === 'reading') updates.progress = progress
    if (selectedShelf === 'read') {
      updates.dateCompleted = dateStr
        ? new Date(dateStr + 'T12:00:00')
        : new Date()
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
          genre,
          series,
          seriesNumber,
        })
        if (rating || notes || isBOTM || isBOTY || genre || series || seriesNumber || updates.dateCompleted) {
          await updateBook(book.googleBooksId, updates)
        }
        if (isBOTY) await setBOTY(book.googleBooksId, botyYear)
        showSnackbar(`Added to ${SHELF_LABELS[selectedShelf]}`)
      } else {
        await updateBook(book.id || book.googleBooksId, updates)
        if (isBOTY) await setBOTY(book.id || book.googleBooksId, botyYear)
        showSnackbar('Updated')
      }
      _seriesCache = null // invalidate so next open reflects new series and genres
      _genreCache = null
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
      const id = book.id || book.googleBooksId
      const removed = await removeBook(id)
      showSnackbar('Removed from shelf', removed && {
        label: 'Undo',
        onClick: () => restoreBook(id, removed)
          .then(() => showSnackbar('Book restored'))
          .catch(err => { console.error(err); showSnackbar('Couldn\'t restore book') }),
      })
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
    if (source !== 'popstate') popOwnHistoryEntry()
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
          <input type="text" class="manual-input" id="manual-genre" list="genre-datalist" placeholder="e.g. Fiction" autocomplete="off" />
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

      <datalist id="series-datalist"></datalist>
      <datalist id="genre-datalist"></datalist>
      <div style="display:grid;grid-template-columns:1fr 72px;gap:12px;align-items:end;">
        <div>
          <div class="sheet-section-label">Series</div>
          <input type="text" class="manual-input" id="manual-series"
            list="series-datalist" placeholder="Series name…" autocomplete="off" />
        </div>
        <div>
          <div class="sheet-section-label">Book #</div>
          <input type="text" class="manual-input" id="manual-series-num" placeholder="1" autocomplete="off" />
        </div>
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

  populateSeriesDatalist(sheet)
  populateGenreDatalist(sheet)

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
    const author       = sheet.querySelector('#manual-author').value.trim() || 'Unknown author'
    const genre        = sheet.querySelector('#manual-genre').value.trim()
    const published    = sheet.querySelector('#manual-published').value.trim()
    const pages        = parseInt(sheet.querySelector('#manual-pages').value || '0', 10)
    const series       = sheet.querySelector('#manual-series').value.trim()
    const seriesNumber = sheet.querySelector('#manual-series-num').value.trim()
    const description  = sheet.querySelector('#manual-desc').value.trim()
    const notes        = sheet.querySelector('#manual-notes').value.trim()
    const progress     = parseInt(sheet.querySelector('#manual-progress')?.value || '0', 10)
    const dateStr      = sheet.querySelector('#manual-date-completed')?.value

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
        series,
        seriesNumber,
      })

      const updates = { rating, notes, isBOTM, genre, series, seriesNumber }
      if (selectedShelf === 'reading') updates.progress = progress
      if (selectedShelf === 'read' && dateStr) {
        updates.dateCompleted = new Date(dateStr + 'T12:00:00')
      }

      if (rating || notes || isBOTM || genre || series || seriesNumber || updates.dateCompleted) {
        await updateBook(bookId, updates)
      }

      _seriesCache = null
      _genreCache = null
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
    if (source !== 'popstate') popOwnHistoryEntry()
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
    ? `<img src="${esc(book.thumbnail)}" alt="${esc(book.title)}" />`
    : `<div class="book-cover-placeholder">
         <span class="material-symbols-rounded">menu_book</span>
       </div>`

  const hasDescription = book.description && book.description !== 'No description available.'
  const released = book.dateReleased || book.publishedDate || ''
  const year = released.match(/\d{4}/)?.[0]
  const pct = book.pageCount ? Math.min(100, Math.round(((book.progress || 0) / book.pageCount) * 100)) : 0

  // ── Header ──────────────────────────────────────────
  const facts = [
    book.pageCount > 0 && fact('menu_book', `${book.pageCount} pages`),
    year && fact('calendar_today', year),
    book.series && fact('collections_bookmark',
      `${esc(book.series)}${book.seriesNumber ? ` #${esc(book.seriesNumber)}` : ''}`),
  ].filter(Boolean).join('')

  const statusPills = existingShelf ? [
    `<span class="bd-pill">${statusText(book, existingShelf, pct)}</span>`,
    book.isBOTM && `<span class="bd-pill bd-pill-botm"><span class="material-symbols-rounded">workspace_premium</span>BotM</span>`,
    book.isBOTY && `<span class="bd-pill bd-pill-boty"><span class="material-symbols-rounded">emoji_events</span>Book of ${book.botyYear || 'the Year'}</span>`,
  ].filter(Boolean).join('') : ''

  // ── Sections ────────────────────────────────────────
  const aboutCard = hasDescription ? `
    <section class="bd-card">
      ${cardTitle('auto_stories', 'About this book')}
      <div class="description-text" id="description-text">${safeHTML(book.description)}</div>
      <button class="btn btn-text bd-more" id="desc-toggle">Show more</button>
    </section>` : ''

  const readingCard = `
    <section class="bd-card">
      ${cardTitle('bookmark', 'Your reading')}

      <div class="bd-label">Shelf</div>
      <div class="bd-segmented" role="group" aria-label="Shelf">
        ${Object.entries(SHELF_LABELS).map(([id, label]) => `
          <button class="shelf-chip ${(existingShelf || 'want') === id ? 'selected' : ''}" data-shelf="${id}">${label}</button>
        `).join('')}
      </div>

      <div id="progress-section" style="display:${existingShelf === 'reading' ? 'block' : 'none'}">
        <div class="bd-label">Progress</div>
        <div class="bd-progress">
          <div class="progress-input-wrap">
            <input type="number" class="progress-num-input" id="progress-input" inputmode="numeric"
              min="0" max="${book.pageCount || 9999}" value="${book.progress || 0}" placeholder="0" aria-label="Current page" />
            <span class="progress-sep">of</span>
            <span class="progress-total">${book.pageCount ? `${book.pageCount} pages` : '—'}</span>
          </div>
          <span class="bd-progress-pct" id="progress-pct">${book.pageCount ? `${pct}%` : ''}</span>
        </div>
        ${book.pageCount ? `<div class="bd-progress-bar"><div class="bd-progress-fill" id="progress-fill" style="width:${pct}%"></div></div>` : ''}
      </div>

      <div id="date-completed-section" style="display:${existingShelf === 'read' ? 'block' : 'none'}">
        <div class="bd-label">Finished on</div>
        <div class="date-input-wrap">
          <input type="date" class="date-input" id="date-completed-input"
            value="${tsToDateInput(book.dateCompleted)}" />
          <span class="material-symbols-rounded date-input-icon">calendar_month</span>
        </div>
      </div>

      <div class="bd-label">Rating</div>
      <div class="bd-rating">
        <div class="star-rating">
          ${[1, 2, 3, 4, 5].map(n => `
            <button class="star-btn" data-star="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">
              <span class="material-symbols-rounded">star</span>
            </button>
          `).join('')}
        </div>
        <span class="bd-rating-label" id="rating-label"></span>
      </div>
    </section>`

  const notesCard = `
    <section class="bd-card">
      ${cardTitle('edit_note', 'Notes')}
      <textarea class="notes-textarea" id="notes-input"
        placeholder="What did you think? Favourite moments, quotes…">${esc(book.notes)}</textarea>
    </section>`

  const detailsCard = `
    <section class="bd-card">
      ${cardTitle('info', 'Details')}
      <datalist id="series-datalist"></datalist>
      <datalist id="genre-datalist"></datalist>
      <div class="bd-rows">
        <label class="bd-row">
          <span class="bd-row-label">Genre</span>
          <input type="text" class="bd-row-input" id="genre-input" list="genre-datalist"
            value="${esc(book.genre)}" placeholder="Add genre" autocomplete="off" />
        </label>
        <label class="bd-row">
          <span class="bd-row-label">Series</span>
          <input type="text" class="bd-row-input" id="series-input" list="series-datalist"
            value="${esc(book.series)}" placeholder="Add series" autocomplete="off" />
        </label>
        <label class="bd-row">
          <span class="bd-row-label">Book #</span>
          <input type="text" class="bd-row-input" id="series-num-input" inputmode="numeric"
            value="${esc(book.seriesNumber)}" placeholder="—" autocomplete="off" />
        </label>
        ${released ? `
        <div class="bd-row">
          <span class="bd-row-label">Published</span>
          <span class="bd-row-value">${esc(formatReleased(released))}</span>
        </div>` : ''}
        ${book.addedAt ? `
        <div class="bd-row">
          <span class="bd-row-label">Added</span>
          <span class="bd-row-value">${formatDisplayDate(book.addedAt)}</span>
        </div>` : ''}
      </div>
    </section>`

  const recognitionCard = `
    <section class="bd-card">
      ${cardTitle('military_tech', 'Recognition')}
      <button class="botm-toggle-btn bd-toggle" id="botm-btn">
        <span class="material-symbols-rounded">workspace_premium</span>
        <span class="bd-toggle-text">
          <span class="bd-toggle-title">Book of the Month</span>
          <span class="bd-toggle-sub">Feature it on the BotM page</span>
        </span>
        <span class="material-symbols-rounded bd-toggle-check">check_circle</span>
      </button>
      <!-- Only offered once the book is a BotM -->
      <button class="botm-toggle-btn boty-toggle-btn bd-toggle" id="boty-btn"
        style="display:${book.isBOTM ? 'flex' : 'none'}">
        <span class="material-symbols-rounded">emoji_events</span>
        <span class="bd-toggle-text">
          <span class="bd-toggle-title">Book of the Year</span>
          <span class="bd-toggle-sub">Your top pick of the year</span>
        </span>
        <span class="material-symbols-rounded bd-toggle-check">check_circle</span>
      </button>
    </section>`

  return `
    <div class="sheet-handle"><div class="sheet-handle-bar"></div></div>
    <button class="icon-btn bd-close" id="close-btn" aria-label="Close">
      <span class="material-symbols-rounded">close</span>
    </button>

    <header class="bd-hero">
      <div class="bd-cover">${coverHTML}</div>
      <div class="bd-hero-text">
        <h2 class="bd-title">${esc(book.title)}</h2>
        <div class="bd-author">${esc(book.author)}</div>
        ${facts ? `<div class="bd-facts">${facts}</div>` : ''}
        ${statusPills ? `<div class="bd-pills">${statusPills}</div>` : ''}
      </div>
    </header>

    <div class="bd-body">
      ${existingShelf
        ? readingCard + notesCard + aboutCard
        : aboutCard + readingCard + notesCard}
      ${detailsCard}
      ${recognitionCard}

      ${existingShelf ? `
      <button class="btn btn-text bd-remove" id="remove-btn">
        <span class="material-symbols-rounded">delete</span>
        Remove from shelf
      </button>` : ''}

      ${extraHTML}
    </div>

    <div class="bd-footer">
      <button class="btn btn-filled" id="save-btn">
        <span class="material-symbols-rounded">${existingShelf ? 'check' : 'add'}</span>
        ${existingShelf ? 'Save changes' : 'Add to shelf'}
      </button>
    </div>
  `
}

function fact(icon, text) {
  return `<span class="bd-fact"><span class="material-symbols-rounded">${icon}</span>${text}</span>`
}

function cardTitle(icon, text) {
  return `<h3 class="bd-card-title"><span class="material-symbols-rounded">${icon}</span>${text}</h3>`
}

function statusText(book, shelf, pct) {
  if (shelf === 'read' && book.dateCompleted)
    return `Read · ${new Date(book.dateCompleted).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  if (shelf === 'reading' && book.pageCount) return `Reading · ${pct}%`
  return SHELF_LABELS[shelf] || shelf
}

// "2017-06-14" → "June 14, 2017"; leaves "2017" or free text as-is
function formatReleased(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return formatDisplayDate(new Date(value + 'T12:00:00'))
}
