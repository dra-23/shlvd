import './style.css'
import { auth, onAuthStateChanged } from './firebase.js'
import { initCoverFix } from './cover-fix.js'
initCoverFix()
import { renderAuth } from './views/auth.js'
import { renderShelves, destroyShelves } from './views/shelves.js'
import { renderSearch, destroySearch } from './views/search.js'
import { renderProfile, destroyProfile } from './views/profile.js'
import { renderBotm, destroyBotm } from './views/botm.js'

// Register service worker in production only — skip during local dev
// so that git pull + npm run dev always shows fresh changes on refresh
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

// ── App state ────────────────────────────────────────────────────────────────

export let currentUser = null
let activeTab = 'shelves'
let activeViewDestroy = null

// Back-gesture handler stack (sheets push onto this)
export const backHandlerStack = []

window.addEventListener('popstate', (e) => {
  if (backHandlerStack.length > 0) {
    backHandlerStack.pop()('popstate')
  } else {
    const tab = e.state?.tab || 'shelves'
    _navigateInternal(tab)
  }
})

const TAB_CONFIG = [
  { id: 'shelves', icon: 'auto_stories', label: 'Shlvd' },
  { id: 'search',  icon: 'search',       label: 'Search'  },
  { id: 'botm',    icon: 'workspace_premium', label: 'BotM'    },
  { id: 'profile', icon: 'person',       label: 'Profile' },
]

// ── Shell template ───────────────────────────────────────────────────────────

function shellHTML() {
  return `
    <div class="app-shell">
      <main class="view-container" id="view-container"></main>
      <nav class="bottom-nav" id="bottom-nav">
        ${TAB_CONFIG.map(t => `
          <button class="nav-item ${t.id === activeTab ? 'active' : ''}" data-tab="${t.id}" aria-label="${t.label}">
            <span class="nav-indicator">
              <span class="material-symbols-rounded">${t.icon}</span>
            </span>
            <span class="nav-label">${t.label}</span>
          </button>
        `).join('')}
      </nav>
    </div>
  `
}

// ── Router ───────────────────────────────────────────────────────────────────

// Internal navigate — does NOT push history (used by popstate handler)
function _navigateInternal(tab) {
  if (tab === activeTab) return
  activeTab = tab

  if (activeViewDestroy) {
    activeViewDestroy()
    activeViewDestroy = null
  }

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab)
  })

  swapView(tab)
}

export function navigateTo(tab) {
  if (tab === activeTab) return
  history.pushState({ tab }, '')
  _navigateInternal(tab)
}

function swapView(tab) {
  const container = document.getElementById('view-container')
  if (!container) return

  // Remove outgoing view immediately (no exit animation)
  container.querySelector('.view')?.remove()

  const incoming = document.createElement('div')
  incoming.className = 'view view--active'
  activeViewDestroy = mountView(tab, incoming)
  container.appendChild(incoming)
}

function mountView(tab, el) {
  switch (tab) {
    case 'shelves': return renderShelves(el)
    case 'search':  return renderSearch(el)
    case 'botm':    return renderBotm(el)
    case 'profile': return renderProfile(el)
  }
}

// ── Auth state ───────────────────────────────────────────────────────────────

const app = document.getElementById('app')

onAuthStateChanged(auth, user => {
  currentUser = user
  if (user) {
    renderShell()
  } else {
    renderSignIn()
  }
})

function renderShell() {
  app.innerHTML = shellHTML()

  // Seed history so back from home tab exits the app naturally
  history.replaceState({ tab: 'shelves' }, '')

  // Nav click handlers
  document.getElementById('bottom-nav').addEventListener('click', e => {
    const btn = e.target.closest('[data-tab]')
    if (btn) navigateTo(btn.dataset.tab)
  })

  // Mount initial view
  const container = document.getElementById('view-container')
  const initial = document.createElement('div')
  initial.className = 'view view--active'
  activeViewDestroy = mountView(activeTab, initial)
  container.appendChild(initial)
}

function renderSignIn() {
  if (activeViewDestroy) {
    activeViewDestroy()
    activeViewDestroy = null
  }
  app.innerHTML = ''
  renderAuth(app)
}
