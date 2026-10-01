// Escape text before interpolating it into an HTML template string
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Google Books descriptions contain light HTML formatting — keep only
// harmless formatting tags (no attributes) and escape everything else
const ALLOWED_TAGS = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI'])

export function safeHTML(html) {
  const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html')
  const walk = node => [...node.childNodes].map(child => {
    if (child.nodeType === Node.TEXT_NODE) return esc(child.textContent)
    if (child.nodeType !== Node.ELEMENT_NODE) return ''
    const inner = walk(child)
    if (!ALLOWED_TAGS.has(child.tagName)) return inner
    const tag = child.tagName.toLowerCase()
    return tag === 'br' ? '<br>' : `<${tag}>${inner}</${tag}>`
  }).join('')
  return walk(doc.body)
}
