import { db, auth } from './firebase.js'
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

const booksCol = () =>
  collection(db, 'users', auth.currentUser.uid, 'books')

/** Add a book to a shelf (upserts by googleBooksId) */
export const addBook = async (bookData) => {
  const ref = doc(booksCol(), bookData.googleBooksId)
  await setDoc(ref, {
    title: bookData.title,
    author: bookData.author,
    thumbnail: bookData.thumbnail || '',
    pageCount: bookData.pageCount || 0,
    shelf: bookData.shelf,
    progress: 0,
    rating: 0,
    notes: '',
    addedAt: serverTimestamp(),
    startedAt: null,
    finishedAt: null,
  })
}

/** Move book to a different shelf or update fields */
export const updateBook = async (googleBooksId, updates) => {
  const ref = doc(booksCol(), googleBooksId)
  await updateDoc(ref, updates)
}

/** Remove a book entirely */
export const removeBook = async (googleBooksId) => {
  const ref = doc(booksCol(), googleBooksId)
  await deleteDoc(ref)
}

/** Get a single book */
export const getBook = async (googleBooksId) => {
  const ref = doc(booksCol(), googleBooksId)
  const snap = await getDoc(ref)
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

/** Real-time listener for a specific shelf */
export const watchShelf = (shelf, callback) => {
  const q = query(booksCol(), where('shelf', '==', shelf))
  return onSnapshot(q, snap => {
    const books = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.addedAt?.seconds ?? 0) - (a.addedAt?.seconds ?? 0))
    callback(books)
  })
}

/** Real-time listener for all books (used for stats) */
export const watchAllBooks = (callback) => {
  return onSnapshot(booksCol(), snap =>
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  )
}
