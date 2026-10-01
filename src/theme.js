// Light / dark theme. The preference is 'system', 'light' or 'dark';
// index.html applies it before first paint so there's no flash.

const KEY = 'shlvd-theme'
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

// Browser bar / status bar colour per theme
const THEME_COLOR = { light: '#98ab88', dark: '#121411' }

export function getThemePref() {
  try { return localStorage.getItem(KEY) || 'system' } catch { return 'system' }
}

export function setThemePref(pref) {
  try { localStorage.setItem(KEY, pref) } catch {}
  applyTheme()
}

function resolvedTheme() {
  const pref = getThemePref()
  if (pref === 'light' || pref === 'dark') return pref
  return darkQuery.matches ? 'dark' : 'light'
}

export function applyTheme() {
  const theme = resolvedTheme()
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
  window.dispatchEvent(new CustomEvent('themechange', { detail: theme }))
}

darkQuery.addEventListener('change', () => {
  if (getThemePref() === 'system') applyTheme()
})

const cssVar = name =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Theme-dependent chart colours — call right before building charts */
export function chartColors() {
  return {
    text:         cssVar('--md-on-surface-variant'),
    grid:         cssVar('--md-surface-container-high'),
    tooltipBg:    cssVar('--md-surface-container-lowest'),
    tooltipTitle: cssVar('--md-on-surface'),
  }
}
