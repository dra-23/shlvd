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

// Reads from the existing root 'books' collection
const booksCol = () => collection(db, 'books')

// Map existing DB fields → shlvd internal format
function normalize(id, d) {
  return {
    id,
    googleBooksId: id,
    title:     d.title   || '',
    author:    d.author  || '',
    thumbnail: d.cover   || '',
    pageCount: d.pages   || 0,
    shelf:     normalizeStatus(d.status),
    progress:  d.progress || 0,
    rating:    d.rating  || 0,
    notes:     d.review  || '',
    addedAt:   d.addedAt || d.dateCompleted || null,
    finishedAt: d.dateCompleted || null,
  }
}

// Handle variations in status values from the existing app
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
  if ('shelf'    in updates) dbUpdates.status = updates.shelf
  if ('rating'   in updates) dbUpdates.rating = updates.rating
  if ('notes'    in updates) dbUpdates.review = updates.notes
  if ('progress' in updates) dbUpdates.progress = updates.progress
  if (updates.shelf === 'read' && !updates._keepDate) {
    dbUpdates.dateCompleted = serverTimestamp()
  }
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
  // Map shlvd shelf name back to the DB status field value
  const statusMap = { want: 'want', reading: 'reading', read: 'read' }
  const q = query(booksCol(), where('status', '==', statusMap[shelf] || shelf))
  return onSnapshot(q, snap => {
    const books = snap.docs
      .map(d => normalize(d.id, d.data()))
      .sort((a, b) => (b.addedAt?.seconds ?? 0) - (a.addedAt?.seconds ?? 0))
    callback(books)
  })
}

/** Real-time listener for all books (used for stats) */
export const watchAllBooks = (callback) => {
  return onSnapshot(booksCol(), snap =>
    callback(snap.docs.map(d => normalize(d.id, d.data())))
  )
}
