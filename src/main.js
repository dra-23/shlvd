import './style.css'
import { auth, onAuthStateChanged } from './firebase.js'
import { renderAuth } from './views/auth.js'
import { renderShelves, destroyShelves } from './views/shelves.js'
import { renderSearch, destroySearch } from './views/search.js'
import { renderProfile, destroyProfile } from './views/profile.js'
import { renderBotm, destroyBotm } from './views/botm.js'

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

// ── App state ────────────────────────────────────────────────────────────────

export let currentUser = null
let activeTab = 'shelves'
let activeViewDestroy = null

const TAB_CONFIG = [
  { id: 'shelves', icon: 'auto_stories', label: 'Shelves' },
  { id: 'search',  icon: 'search',       label: 'Search'  },
  { id: 'botm',    icon: 'auto_awesome', label: 'BotM'    },
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

export function navigateTo(tab) {
  if (tab === activeTab) return
  const prev = activeTab
  activeTab = tab

  // Destroy previous view's listeners
  if (activeViewDestroy) {
    activeViewDestroy()
    activeViewDestroy = null
  }

  // Update nav
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab)
  })

  // Determine slide direction
  const order = TAB_CONFIG.map(t => t.id)
  const direction = order.indexOf(tab) > order.indexOf(prev) ? 'left' : 'right'

  swapView(tab, direction)
}

function swapView(tab, direction = 'left') {
  const container = document.getElementById('view-container')
  if (!container) return

  const outgoing = container.querySelector('.view')
  const incoming = document.createElement('div')
  incoming.className = `view view--enter-${direction}`

  // Mount new view
  activeViewDestroy = mountView(tab, incoming)

  if (outgoing) {
    outgoing.classList.add(`view--exit-${direction}`)
    container.appendChild(incoming)
    requestAnimationFrame(() => {
      incoming.classList.remove(`view--enter-${direction}`)
      incoming.classList.add('view--active')
    })
    outgoing.addEventListener('animationend', () => outgoing.remove(), { once: true })
  } else {
    incoming.classList.add('view--active')
    container.appendChild(incoming)
  }
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
