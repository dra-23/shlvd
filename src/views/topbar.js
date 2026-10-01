import { auth } from '../firebase.js'
import { esc } from '../escape.js'
import { navigateTo } from '../main.js'

// Profile lives behind the avatar in each tab's top bar

export function avatarButtonHTML() {
  const user = auth.currentUser
  const initials = (user?.displayName || 'Reader')
    .split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  return `
    <button class="topbar-avatar" data-goto-profile aria-label="Profile">
      ${user?.photoURL
        ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer" />`
        : `<span>${esc(initials)}</span>`}
    </button>`
}

export function wireAvatar(container) {
  container.querySelector('[data-goto-profile]')
    ?.addEventListener('click', () => navigateTo('profile'))
}
