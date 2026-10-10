import { esc } from '../escape.js'
import { auth, signOutUser } from '../firebase.js'
import { backHandlerStack, popOwnHistoryEntry } from '../main.js'
import { openManageGenres } from './manage-genres.js'
import { getThemePref, setThemePref } from '../theme.js'

// Settings page, opened from the cog on Profile: account, appearance,
// genre management and sign out. Slides in over the Profile view.

const THEMES = [['system', 'brightness_auto', 'System'], ['light', 'light_mode', 'Light'], ['dark', 'dark_mode', 'Dark']]

export function openSettingsPage() {
  const host = document.querySelector('#view-container .view')
  if (!host) return
  const user = auth.currentUser

  const page = document.createElement('div')
  page.className = 'settings-page'
  page.style.transform = 'translateX(100%)'
  page.innerHTML = `
    <div class="profile-bar">
      <button class="icon-btn settings-back" aria-label="Back">
        <span class="material-symbols-rounded">arrow_back</span>
      </button>
      <span class="botm-page-title">Settings</span>
    </div>
    <div class="settings-scroll">
      <div class="settings-account">
        <div class="pf-avatar pf-avatar--lg">
          ${user?.photoURL
            ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer" />`
            : '<span class="material-symbols-rounded">person</span>'}
        </div>
        <div class="settings-account-text">
          <div class="settings-account-name">${esc(user?.displayName || 'Reader')}</div>
          <div class="settings-account-email">${esc(user?.email || '')}</div>
        </div>
      </div>

      <div class="settings-label">Appearance</div>
      <div class="settings-group">
        <div class="settings-segmented" id="theme-chips" role="radiogroup" aria-label="Theme">
          ${THEMES.map(([id, icon, label]) => `
            <button class="settings-seg ${getThemePref() === id ? 'selected' : ''}" data-theme-pref="${id}"
              role="radio" aria-checked="${getThemePref() === id}">
              <span class="material-symbols-rounded">${icon}</span>${label}
            </button>`).join('')}
        </div>
      </div>

      <div class="settings-label">Library</div>
      <div class="settings-group">
        <button class="settings-row" id="settings-genres">
          <span class="material-symbols-rounded">sell</span>
          <span class="settings-row-text">Manage genres<small>Rename, merge and tidy genres</small></span>
          <span class="material-symbols-rounded settings-chevron">chevron_right</span>
        </button>
      </div>

      <div class="settings-label">Account</div>
      <div class="settings-group">
        <button class="settings-row settings-row--danger" id="settings-sign-out">
          <span class="material-symbols-rounded">logout</span>
          <span class="settings-row-text">Sign out</span>
        </button>
      </div>
    </div>
  `
  host.appendChild(page)
  requestAnimationFrame(() => {
    page.style.transition = 'transform 300ms cubic-bezier(0,0,0,1)'
    page.style.transform = 'translateX(0)'
  })

  page.querySelector('.settings-back').addEventListener('click', () => closePage('manual'))
  page.querySelector('#settings-genres').addEventListener('click', () => openManageGenres())
  page.querySelector('#settings-sign-out').addEventListener('click', () => signOutUser())
  page.querySelector('#theme-chips').addEventListener('click', e => {
    const seg = e.target.closest('[data-theme-pref]')
    if (!seg) return
    page.querySelectorAll('[data-theme-pref]').forEach(s => {
      s.classList.toggle('selected', s === seg)
      s.setAttribute('aria-checked', s === seg)
    })
    setThemePref(seg.dataset.themePref)
  })

  history.pushState({ settings: true }, '')
  function closePage(source) {
    const idx = backHandlerStack.indexOf(closePage)
    if (idx !== -1) backHandlerStack.splice(idx, 1)
    if (source !== 'popstate') popOwnHistoryEntry()
    page.style.transition = 'transform 250ms cubic-bezier(0.3,0,1,1)'
    page.style.transform = 'translateX(100%)'
    setTimeout(() => page.remove(), 260)
  }
  backHandlerStack.push(closePage)
}
