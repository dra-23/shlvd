import { backHandlerStack, popOwnHistoryEntry } from '../main.js'

// Minimal bottom sheet: scrim, drag handle, back-gesture and swipe-down to close.
// Returns { sheet, close }. `onClose` runs once however the sheet is closed.
export function openSheet(html, { className = '', onClose } = {}) {
  const scrim = document.createElement('div')
  scrim.className = 'sheet-scrim'
  const sheet = document.createElement('div')
  sheet.className = `bottom-sheet ${className}`
  sheet.innerHTML = `<div class="sheet-handle"><div class="sheet-handle-bar"></div></div>${html}`
  document.body.appendChild(scrim)
  document.body.appendChild(sheet)

  history.pushState({ sheet: true }, '')
  let closed = false
  function close(source) {
    if (closed) return
    closed = true
    const idx = backHandlerStack.indexOf(close)
    if (idx !== -1) backHandlerStack.splice(idx, 1)
    if (source !== 'popstate') popOwnHistoryEntry()
    scrim.classList.add('closing')
    sheet.classList.add('closing')
    onClose?.()
    setTimeout(() => { scrim.remove(); sheet.remove() }, 300)
  }
  backHandlerStack.push(close)
  scrim.addEventListener('click', () => close('manual'))

  // Swipe down on the handle area to dismiss (content may scroll)
  let startY = 0, dragging = false
  sheet.addEventListener('touchstart', e => {
    dragging = sheet.scrollTop <= 0
    startY = e.touches[0].clientY
    sheet.style.transition = 'none'
  }, { passive: true })
  sheet.addEventListener('touchmove', e => {
    if (!dragging) return
    const dy = e.touches[0].clientY - startY
    if (dy > 0) sheet.style.transform = `translateY(${dy}px)`
  }, { passive: true })
  sheet.addEventListener('touchend', e => {
    if (!dragging) return
    dragging = false
    sheet.style.transition = ''
    if (e.changedTouches[0].clientY - startY > 120) close('manual')
    else sheet.style.transform = ''
  }, { passive: true })

  return { sheet, close: () => close('manual') }
}
