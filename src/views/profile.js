import { auth, signOutUser } from '../firebase.js'
import { watchAllBooks } from '../db.js'

export function renderProfile(container) {
  const user = auth.currentUser
  container.innerHTML = buildProfileHTML(user, { want: 0, reading: 0, read: 0 })

  // Real-time stats
  const unsub = watchAllBooks(books => {
    const stats = {
      want:    books.filter(b => b.shelf === 'want').length,
      reading: books.filter(b => b.shelf === 'reading').length,
      read:    books.filter(b => b.shelf === 'read').length,
    }
    const grid = container.querySelector('.stats-grid')
    if (grid) grid.outerHTML = buildStatsGrid(stats)
    // Re-inject since outerHTML replaces the element
    container.querySelector('.stats-placeholder')?.replaceWith(
      Object.assign(document.createElement('div'), { innerHTML: buildStatsGrid(stats) }).firstElementChild
    )
    // Simpler: just update numbers
    container.querySelector('[data-stat="want"]')  && (container.querySelector('[data-stat="want"]').textContent  = stats.want)
    container.querySelector('[data-stat="reading"]') && (container.querySelector('[data-stat="reading"]').textContent = stats.reading)
    container.querySelector('[data-stat="read"]')  && (container.querySelector('[data-stat="read"]').textContent  = stats.read)
  })

  container.querySelector('#sign-out-btn').addEventListener('click', async () => {
    await signOutUser()
  })

  return unsub
}

function buildProfileHTML(user, stats) {
  const avatarHTML = user?.photoURL
    ? `<img src="${user.photoURL}" alt="Avatar" />`
    : `<span class="material-symbols-rounded">person</span>`

  return `
    <div class="profile-screen">
      <div class="profile-hero">
        <div class="profile-avatar">${avatarHTML}</div>
        <div class="profile-name">${user?.displayName || 'Reader'}</div>
        <div class="profile-email">${user?.email || ''}</div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-number" data-stat="read">0</div>
          <div class="stat-label">Read</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" data-stat="reading">0</div>
          <div class="stat-label">Reading</div>
        </div>
        <div class="stat-card">
          <div class="stat-number" data-stat="want">0</div>
          <div class="stat-label">Want</div>
        </div>
      </div>

      <div class="profile-actions">
        <button class="btn btn-outlined" id="sign-out-btn" style="width:100%; height:48px;">
          <span class="material-symbols-rounded">logout</span>
          Sign out
        </button>
      </div>
    </div>
  `
}

export function destroyProfile() {}
