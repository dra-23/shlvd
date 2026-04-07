import { db } from './firebase.js'
import {
  collection,
  doc,
  getDoc,
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
    genre:         d.genre        || '',
    description:   d.description  || '',
    dateReleased:  d.dateReleased  || '',
    dateCompleted: toDate(d.dateCompleted),
    addedAt:       toDate(d.addedAt) || toDate(d.dateCompleted),
  }
}

function normalizeStatus(status) {
  if (!status) return 'want'
  const s = status.toLowerCase()
  if (s === 'read') return 'read'
  if (s === 'reading' || s === 'currentlyreading') return 'reading'
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
    description:   'No description available.',
    genre:         '',
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
  if ('genre'         in updates) dbUpdates.genre         = updates.genre
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

/** Real-time listener for all books (used for stats) */
export const watchAllBooks = (callback) => {
  return onSnapshot(booksCol(), snap =>
    callback(snap.docs.map(d => normalize(d.id, d.data())))
  )
}
