import { esc } from '../escape.js'
import { watchAllBooks, setGenres as saveGenres } from '../db.js'
import { openSheet } from './sheet.js'
import { showSnackbar } from './shelves.js'
import { openLibrary } from './library.js'
import { invalidateGenreCache } from './book-detail.js'
import { genreCounts, caseDuplicateFixes, looksLikeSubjectTag, suggestGenres, matchGenre } from '../genres.js'

const setGenres = changes => saveGenres(changes).then(() => invalidateGenreCache())

// Manage genres: fix capitalisation duplicates in one go, re-home library
// subject tags, and rename / merge / browse any genre. Every change can be undone.

export function openManageGenres() {
  let books = []
  let unsub = null
  const { sheet, close: closeManage } = openSheet(`
    <div class="genres-sheet" id="genres-root">
      <div class="lib-loading">${'<div class="skeleton" style="height:48px;border-radius:12px"></div>'.repeat(4)}</div>
    </div>
  `, { className: 'genres-sheet-wrap', onClose: () => unsub?.() })
  const root = sheet.querySelector('#genres-root')

  function render() {
    const all = genreCounts(books)
    const fixes = caseDuplicateFixes(books)
    const attention = all.filter(g => looksLikeSubjectTag(g.name))
    const scroll = sheet.scrollTop

    root.innerHTML = `
      <div class="filter-sheet-head">
        <h2>Genres</h2>
        <span class="lib-count">${all.length} genres</span>
      </div>

      ${fixes.length ? `
      <section class="bd-card genres-card">
        <h3 class="bd-card-title"><span class="material-symbols-rounded">auto_fix_high</span>Tidy up capitalisation</h3>
        <p class="genres-help">These only differ in capital letters. Each merges into the most-used spelling.</p>
        <ul class="genres-fix-list">
          ${fixes.map(f => `
            <li>
              <span class="genres-fix-from">${f.from.map(v => `<span class="nowrap">${esc(v.name)} <span class="lib-chip-count">${v.count}</span></span>`).join(', ')}</span>
              <span class="material-symbols-rounded">arrow_forward</span>
              <span class="genres-fix-to">${esc(f.to)}</span>
            </li>`).join('')}
        </ul>
        <button class="btn btn-filled genres-apply" id="genres-apply-fixes">
          Merge ${fixes.reduce((n, f) => n + f.from.length, 0)} duplicates
        </button>
      </section>` : ''}

      ${attention.length ? `
      <section class="bd-card genres-card">
        <h3 class="bd-card-title"><span class="material-symbols-rounded">flag</span>Needs attention</h3>
        <p class="genres-help">These look like library subject tags, not genres. Tap a suggestion to move their books.</p>
        ${attention.map(g => `
          <div class="genres-attention-row">
            <button class="genres-attention-name" data-genre="${esc(g.name)}">
              ${esc(g.name)} <span class="lib-chip-count">${g.count}</span>
            </button>
            <div class="chips">
              ${suggestGenres(g.name, books).map(s => `
                <button class="chip" data-merge-from="${esc(g.name)}" data-merge-to="${esc(s)}">${esc(s)}</button>`).join('')}
              <button class="chip" data-pick-for="${esc(g.name)}">Other…</button>
            </div>
          </div>`).join('')}
      </section>` : ''}

      <h3 class="genres-all-title">All genres</h3>
      <div class="genres-all">
        ${all.map(g => `
          <button class="genres-row" data-genre="${esc(g.name)}">
            <span class="genres-row-name">${esc(g.name)}</span>
            <span class="genres-row-count">${g.count}</span>
            <span class="material-symbols-rounded">chevron_right</span>
          </button>`).join('')}
      </div>
    `
    sheet.scrollTop = scroll
  }

  // Move every book in `from` genres into `to`, with an Undo
  async function merge(from, to, message) {
    const affected = books.filter(b => from.includes(b.genre))
    if (!affected.length || !to) return
    const undo = affected.map(b => ({ id: b.id, genre: b.genre }))
    try {
      await setGenres(affected.map(b => ({ id: b.id, genre: to })))
      showSnackbar(message || `Moved ${affected.length} book${affected.length === 1 ? '' : 's'} to ${to}`, {
        label: 'Undo',
        onClick: () => setGenres(undo).then(() => showSnackbar('Undone')).catch(() => showSnackbar('Couldn’t undo')),
      })
    } catch (err) {
      console.error(err)
      showSnackbar('Something went wrong')
    }
  }

  root.addEventListener('click', e => {
    if (e.target.closest('#genres-apply-fixes')) {
      const fixes = caseDuplicateFixes(books)
      const undo = books.filter(b => fixes.some(f => f.from.some(v => v.name === b.genre)))
        .map(b => ({ id: b.id, genre: b.genre }))
      const changes = fixes.flatMap(f => books
        .filter(b => f.from.some(v => v.name === b.genre))
        .map(b => ({ id: b.id, genre: f.to })))
      return setGenres(changes)
        .then(() => showSnackbar(`Merged ${fixes.reduce((n, f) => n + f.from.length, 0)} duplicates`, {
          label: 'Undo',
          onClick: () => setGenres(undo).then(() => showSnackbar('Undone')).catch(() => showSnackbar('Couldn’t undo')),
        }))
        .catch(err => { console.error(err); showSnackbar('Something went wrong') })
    }
    const quick = e.target.closest('[data-merge-from]')
    if (quick) return merge([quick.dataset.mergeFrom], quick.dataset.mergeTo)
    const pickFor = e.target.closest('[data-pick-for]')
    if (pickFor) {
      const from = pickFor.dataset.pickFor
      return openGenrePicker(books, from, to => merge([from], to))
    }
    const row = e.target.closest('[data-genre]')
    if (row) openGenreActions(books, row.dataset.genre, merge, closeManage)
  })

  unsub = watchAllBooks(b => { books = b; render() })
}

// ── One genre: rename, merge, see books ──────────────────────────────────────

function openGenreActions(books, genre, merge, closeManage) {
  const count = books.filter(b => b.genre === genre).length
  const { sheet, close } = openSheet(`
    <div class="filter-sheet genre-actions">
      <div class="filter-sheet-head">
        <h2>${esc(genre)}</h2>
        <span class="lib-count">${count} book${count === 1 ? '' : 's'}</span>
      </div>
      <label class="bd-label" for="genre-rename">Rename</label>
      <div class="goal-edit-row">
        <input id="genre-rename" class="goal-input" type="text" value="${esc(genre)}" autocomplete="off" />
        <button class="btn btn-filled" id="genre-rename-save">Save</button>
      </div>
      <div class="genre-actions-list">
        <button class="genres-row" id="genre-merge">
          <span class="material-symbols-rounded">call_merge</span>
          <span class="genres-row-name">Merge into another genre</span>
          <span class="material-symbols-rounded">chevron_right</span>
        </button>
        <button class="genres-row" id="genre-see">
          <span class="material-symbols-rounded">auto_stories</span>
          <span class="genres-row-name">See these books</span>
          <span class="material-symbols-rounded">chevron_right</span>
        </button>
      </div>
    </div>
    <div style="height:12px"></div>
  `)

  const input = sheet.querySelector('#genre-rename')
  const save = () => {
    const raw = input.value.trim()
    if (!raw || raw === genre) return close()
    // Renaming onto an existing genre (any capitalisation) merges into it
    const existing = matchGenre(raw, genreCounts(books).map(g => g.name).filter(g => g !== genre))
    merge([genre], existing || raw, existing
      ? `Merged ${genre} into ${existing}`
      : `Renamed to ${raw}`)
    close()
  }
  sheet.querySelector('#genre-rename-save').addEventListener('click', save)
  input.addEventListener('keydown', e => { if (e.key === 'Enter') save() })

  sheet.querySelector('#genre-merge').addEventListener('click', () => {
    openGenrePicker(books, genre, to => { merge([genre], to, `Merged ${genre} into ${to}`); close() })
  })
  sheet.querySelector('#genre-see').addEventListener('click', () => {
    // Close both sheets before navigating so their history entries unwind first
    close()
    closeManage()
    setTimeout(() => openLibrary({ shelf: 'all', filters: { genres: [genre] } }), 400)
  })
}

// ── Pick a target genre (or type a new one) ──────────────────────────────────

function openGenrePicker(books, exclude, onPick) {
  const genres = genreCounts(books).filter(g => g.name !== exclude)
  const { sheet, close } = openSheet(`
    <div class="filter-sheet">
      <div class="filter-sheet-head"><h2>Move to…</h2></div>
      <div class="search-bar genre-picker-search">
        <span class="material-symbols-rounded">search</span>
        <input class="search-input" id="genre-picker-input" type="text" placeholder="Find or type a genre" autocomplete="off" />
      </div>
      <div class="genres-all" id="genre-picker-list"></div>
    </div>
  `)
  const input = sheet.querySelector('#genre-picker-input')
  const list = sheet.querySelector('#genre-picker-list')
  const draw = () => {
    const q = input.value.trim()
    const hits = genres.filter(g => g.name.toLowerCase().includes(q.toLowerCase()))
    const exact = genres.some(g => g.name.toLowerCase() === q.toLowerCase())
    list.innerHTML = `
      ${q && !exact ? `
        <button class="genres-row" data-pick="${esc(q)}">
          <span class="material-symbols-rounded">add</span>
          <span class="genres-row-name">Use “${esc(q)}”</span>
        </button>` : ''}
      ${hits.map(g => `
        <button class="genres-row" data-pick="${esc(g.name)}">
          <span class="genres-row-name">${esc(g.name)}</span>
          <span class="genres-row-count">${g.count}</span>
        </button>`).join('')}`
  }
  draw()
  input.addEventListener('input', draw)
  list.addEventListener('click', e => {
    const row = e.target.closest('[data-pick]')
    if (!row) return
    close()
    onPick(row.dataset.pick)
  })
}
