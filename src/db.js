import { db } from './firebase.js'
import {
  collection,
  doc,
  getDoc,
  getDocFromCache,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore'

const booksCol = () => collection(db, 'books')

// Firestore applies writes to the local cache immediately, but the promise
// only settles once the server confirms. Don't leave the UI waiting on that
// when offline (or on a connection that has stalled) — the write is queued
// and syncs automatically when the connection is back.
function commit(write) {
  const logged = write.catch(err => { console.error('Write failed', err); throw err })
  if (!navigator.onLine) { logged.catch(() => {}); return Promise.resolve() }
  return Promise.race([logged, new Promise(r => setTimeout(r, 3000))])
}

// Convert Firestore Timestamp or plain object to JS Date
function toDate(ts) {
  if (!ts) return null
  if (ts.toDate) return ts.toDate()
  if (ts.seconds) return new Date(ts.seconds * 1000)
  return null
}

// Spreadsheet-imported books store some text fields as numbers
// (e.g. dateReleased: 2024, title: 1984) — always hand the UI strings
const text = v => (v === null || v === undefined) ? '' : String(v)

// Map existing DB fields → shlvd internal format
function normalize(id, d) {
  return {
    id,
    googleBooksId: id,
    title:         text(d.title),
    author:        text(d.author),
    thumbnail:     d.cover        || '',
    pageCount:     d.pages        || 0,
    shelf:         normalizeStatus(d.status),
    progress:      d.progress     || 0,
    rating:        d.rating       || 0,
    notes:         text(d.review),
    isBOTM:        d.isBOTM       || false,
    isBOTY:        d.isBOTY       || false,
    botyYear:      d.botyYear     || null,
    genre:         text(d.genre),
    description:   text(d.description),
    dateReleased:  text(d.dateReleased),
    series:        text(d.series),
    seriesNumber:  text(d.seriesNumber),
    dateCompleted: toDate(d.dateCompleted),
    addedAt:       toDate(d.addedAt) || toDate(d.dateCompleted),
  }
}

function normalizeStatus(status) {
  if (!status) return 'want'
  const s = String(status).toLowerCase()
  if (s === 'read') return 'read'
  if (s === 'reading' || s === 'currentlyreading') return 'reading'
  if (s === 'dnf') return 'dnf'
  return 'want'
}

/** Add a new book (written in the existing schema format) */
export const addBook = async (bookData) => {
  const ref = doc(booksCol(), bookData.googleBooksId)
  await commit(setDoc(ref, {
    title:         bookData.title,
    author:        bookData.author,
    cover:         bookData.thumbnail || '',
    pages:         bookData.pageCount || 0,
    status:        bookData.shelf,
    progress:      0,
    rating:        0,
    review:        '',
    description:   bookData.description || '',
    genre:         bookData.genre || '',
    dateReleased:  bookData.dateReleased || '',
    series:        bookData.series || '',
    seriesNumber:  bookData.seriesNumber || '',
    isBOTM:        false,
    bookId:        bookData.googleBooksId,
    libraryId:     bookData.googleBooksId,
    dateCompleted: bookData.shelf === 'read' ? serverTimestamp() : null,
    addedAt:       serverTimestamp(),
  }))
}

/** Update fields on an existing book */
export const updateBook = async (id, updates) => {
  const ref = doc(booksCol(), id)
  const dbUpdates = {}
  if ('title'         in updates) dbUpdates.title         = updates.title
  if ('shelf'       in updates) dbUpdates.status        = updates.shelf
  if ('rating'        in updates) dbUpdates.rating        = updates.rating
  if ('notes'         in updates) dbUpdates.review        = updates.notes
  if ('progress'      in updates) dbUpdates.progress      = updates.progress
  if ('isBOTM'        in updates) dbUpdates.isBOTM        = updates.isBOTM
  if ('isBOTY'        in updates) dbUpdates.isBOTY        = updates.isBOTY
  if ('botyYear'      in updates) dbUpdates.botyYear      = updates.botyYear
  if ('genre'         in updates) dbUpdates.genre         = updates.genre
  if ('series'        in updates) dbUpdates.series        = updates.series
  if ('seriesNumber'  in updates) dbUpdates.seriesNumber  = updates.seriesNumber
  if ('thumbnail'     in updates) dbUpdates.cover         = updates.thumbnail
  if ('dateCompleted' in updates) dbUpdates.dateCompleted = updates.dateCompleted
  await commit(updateDoc(ref, dbUpdates))
}

/** Remove a book — returns its raw data so the removal can be undone */
export const removeBook = async (id) => {
  const ref = doc(booksCol(), id)
  const snap = await getDocFromCache(ref).catch(() => getDoc(ref))
  await commit(deleteDoc(ref))
  return snap.exists() ? snap.data() : null
}

/** Put back a book removed with removeBook, exactly as it was */
export const restoreBook = async (id, data) => {
  await commit(setDoc(doc(booksCol(), id), data))
}

/** Get a single book */
export const getBook = async (id) => {
  const snap = await getDoc(doc(booksCol(), id))
  return snap.exists() ? normalize(snap.id, snap.data()) : null
}

/** Real-time listener for a specific shelf */
export const watchShelf = (shelf, callback) => {
  const q = query(booksCol(), where('status', '==', shelf))
  return onSnapshot(q, snap => {
    const books = snap.docs
      .map(d => normalize(d.id, d.data()))
      .sort((a, b) => (b.addedAt?.getTime?.() ?? 0) - (a.addedAt?.getTime?.() ?? 0))
    callback(books)
  })
}

/** Real-time listener for BotM books */
export const watchBotm = (callback) => {
  const q = query(booksCol(), where('isBOTM', '==', true))
  return onSnapshot(q, snap => {
    const books = snap.docs
      .map(d => normalize(d.id, d.data()))
      .sort((a, b) => (b.dateCompleted?.getTime?.() ?? 0) - (a.dateCompleted?.getTime?.() ?? 0))
    callback(books)
  })
}

/** Set Book of the Year — clears any existing BOTY for the same year first */
export const setBOTY = async (bookId, year) => {
  const snap = await getDocs(query(booksCol(), where('isBOTY', '==', true)))
  await Promise.all(
    snap.docs
      .filter(d => d.data().botyYear === year && d.id !== bookId)
      .map(d => commit(updateDoc(d.ref, { isBOTY: false, botyYear: null })))
  )
  if (bookId) {
    await commit(updateDoc(doc(booksCol(), bookId), { isBOTY: true, botyYear: year }))
  }
}

/** Return sorted list of unique series names across all books */
export const getSeriesList = async () => {
  const snap = await getDocs(booksCol())
  const set = new Set()
  snap.docs.forEach(d => { if (d.data().series) set.add(text(d.data().series)) })
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

/** Genres in use, most common first (for autocomplete and matching) */
export const getGenreList = async () => {
  const snap = await getDocs(booksCol())
  const counts = new Map()
  snap.docs.forEach(d => {
    const g = text(d.data().genre).trim()
    if (g) counts.set(g, (counts.get(g) || 0) + 1)
  })
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g)
}

/**
 * Set the genre on many books at once. `changes` is [{ id, genre }].
 * Firestore batches hold up to 500 writes, so larger sets are split.
 */
export const setGenres = async (changes) => {
  for (let i = 0; i < changes.length; i += 450) {
    const batch = writeBatch(db)
    changes.slice(i, i + 450).forEach(({ id, genre }) => batch.update(doc(booksCol(), id), { genre }))
    await commit(batch.commit())
  }
}

/** Real-time listener for all books (used for stats) */
export const watchAllBooks = (callback) => {
  return onSnapshot(booksCol(), snap =>
    callback(snap.docs.map(d => normalize(d.id, d.data())))
  )
}

// ── Library settings (settings/library) ─────────────────────────────────────

const settingsRef = () => doc(db, 'settings', 'library')

/** Real-time listener for yearly reading goals: { [year]: bookCount } */
export const watchReadingGoals = (callback, onError) =>
  onSnapshot(settingsRef(),
    snap => callback(snap.data()?.readingGoals || {}),
    err => { console.error(err); onError?.(err) })

/** Set (or clear, with 0) the reading goal for a year */
export const setReadingGoal = (year, count) =>
  commit(setDoc(settingsRef(), { readingGoals: { [year]: count } }, { merge: true }))
