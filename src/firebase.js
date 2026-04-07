import { initializeApp } from 'firebase/app'
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyC6Ohp3EXV1K98DQTzQ19dwqRgfh-iagB8',
  authDomain: 'shlvd-39d3c.firebaseapp.com',
  projectId: 'shlvd-39d3c',
  storageBucket: 'shlvd-39d3c.firebasestorage.app',
  messagingSenderId: '216784506910',
  appId: '1:216784506910:web:06fc0ac8f1773aaebf9e0f',
  measurementId: 'G-3H37V2GZJX',
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)

const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

export const signInWithGoogle = () => signInWithPopup(auth, googleProvider)
export const signOutUser = () => signOut(auth)
export { onAuthStateChanged }
