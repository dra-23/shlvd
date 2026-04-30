import { db } from './firebase.js'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore'

const booksCol = () => collection(db, 'books')

// Convert Firestore Timestamp or plain object to JS Date
function toDate(ts) {
  if (!ts) return null
  if (ts.toDate) return ts.toDate()
  if (ts.seconds) return new Date(ts.seconds * 1000)
  return null
}

// Map existing DB fields → shlvd internal format
function normalize(id, d) {
  return {
    id,
    googleBooksId: id,
    title:         d.title        || '',
    author:        d.author       || '',
    thumbnail:     d.cover        || '',
    pageCount:     d.pages        || 0,
    shelf:         normalizeStatus(d.status),
    progress:      d.progress     || 0,
    rating:        d.rating       || 0,
    notes:         d.review       || '',
    isBOTM:        d.isBOTM       || false,
    isBOTY:        d.isBOTY       || false,
    botyYear:      d.botyYear     || null,
    genre:         d.genre        || '',
    description:   d.description  || '',
    dateReleased:  d.dateReleased  || '',
    series:        d.series        || '',
    seriesNumber:  d.seriesNumber  || '',
    dateCompleted: toDate(d.dateCompleted),
    addedAt:       toDate(d.addedAt) || toDate(d.dateCompleted),
  }
}

function normalizeStatus(status) {
  if (!status) return 'want'
  const s = status.toLowerCase()
  if (s === 'read') return 'read'
  if (s === 'reading' || s === 'currentlyreading') return 'reading'
  if (s === 'dnf') return 'dnf'
  return 'want'
}

/** Add a new book (written in the existing schema format) */
export const addBook = async (bookData) => {
  const ref = doc(booksCol(), bookData.googleBooksId)
  await setDoc(ref, {
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
  })
}

/** Update fields on an existing book */
export const updateBook = async (id, updates) => {
  const ref = doc(booksCol(), id)
  const dbUpdates = {}
  if ('shelf'         in updates) dbUpdates.status        = updates.shelf
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
  await updateDoc(ref, dbUpdates)
}

/** Remove a book */
export const removeBook = async (id) => {
  await deleteDoc(doc(booksCol(), id))
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
      .map(d => updateDoc(d.ref, { isBOTY: false, botyYear: null }))
  )
  if (bookId) {
    await updateDoc(doc(booksCol(), bookId), { isBOTY: true, botyYear: year })
  }
}

/** Return sorted list of unique series names across all books */
export const getSeriesList = async () => {
  const snap = await getDocs(booksCol())
  const set = new Set()
  snap.docs.forEach(d => { if (d.data().series) set.add(d.data().series) })
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

/** Real-time listener for all books (used for stats) */
export const watchAllBooks = (callback) => {
  return onSnapshot(booksCol(), snap =>
    callback(snap.docs.map(d => normalize(d.id, d.data())))
  )
}
