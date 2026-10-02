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

// Avatar opens Profile; the logo goes Home (or back to the top if already there)
export function wireTopBar(container) {
  container.querySelector('[data-goto-profile]')
    ?.addEventListener('click', () => navigateTo('profile'))
  container.querySelector('[data-goto-home]')?.addEventListener('click', () => {
    const home = container.querySelector('#shelves-content')
    if (!home) return navigateTo('shelves')
    const start = home.scrollTop
    home.scrollTo({ top: 0, behavior: 'smooth' })
    // Some webviews ignore smooth scrolling — jump if nothing moved
    setTimeout(() => { if (home.scrollTop === start) home.scrollTop = 0 }, 500)
  })
}
