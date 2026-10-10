import { esc } from './escape.js'

// Author photos and bios from Wikipedia (falling back to Open Library),
// cached on the device so pages and avatars load instantly the second time.

const CACHE_PREFIX = 'shlvd-author:'
const CACHE_DAYS = 30
const memory = new Map()

// A Wikipedia match only counts if it's described as a writer — otherwise a
// namesake (an actor, a footballer) would show up on the author page
const WRITER = /\b(author|writer|novelist|poet|journalist|screenwriter|playwright|essayist|columnist|memoirist)\b/i

/** "A & B", "A and B", "A, B" → ["A", "B"] */
export function splitAuthors(str) {
  return String(str || '')
    .split(/\s*(?:,|&|\band\b)\s*/i)
    .map(s => s.trim())
    .filter(s => s && s.toLowerCase() !== 'unknown author')
}

export function initials(name) {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

// Stable colour per author for the initials fallback
const AVATAR_COLOURS = ['#7d9070', '#b5655c', '#5c6bc0', '#c49490', '#4f7a8a', '#8a6d9e', '#a0714f', '#d8a24a']
export function avatarColour(name) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length]
}

/** Round author photo, or coloured initials until/unless a photo is found */
export function authorAvatarHTML(name, className = '') {
  return `
    <span class="author-avatar ${className}" data-author-photo="${esc(name)}"
      style="--avatar:${avatarColour(name)}" aria-hidden="true">
      <span class="author-avatar-initials">${esc(initials(name))}</span>
    </span>`
}

/** Each author as a tappable link with a small photo; plain text if there's no usable name */
export function authorLinksHTML(authorString, { photos = true } = {}) {
  const names = splitAuthors(authorString)
  if (!names.length) return esc(authorString || '')
  return names.map(name => `
    <button class="author-link" data-author="${esc(name)}">
      ${photos ? authorAvatarHTML(name, 'author-avatar--sm') : ''}
      <span class="author-link-name">${esc(name)}</span>
      <span class="material-symbols-rounded author-link-chevron">chevron_right</span>
    </button>`).join('')
}

/** Fill every [data-author-photo] inside `root` with the author's photo when known */
export function hydrateAuthorAvatars(root) {
  root.querySelectorAll('[data-author-photo]').forEach(el => {
    getAuthorInfo(el.dataset.authorPhoto).then(info => {
      if (!info?.image || el.querySelector('img')) return
      const img = new Image()
      img.alt = ''
      img.referrerPolicy = 'no-referrer'
      img.onload = () => el.classList.add('has-photo')
      img.src = info.image
      el.appendChild(img)
    })
  })
}

function readCache(name) {
  try {
    const hit = JSON.parse(localStorage.getItem(CACHE_PREFIX + name) || 'null')
    if (hit && Date.now() - hit.at < CACHE_DAYS * 86400000) return hit.info
  } catch {}
  return undefined
}

function writeCache(name, info) {
  try { localStorage.setItem(CACHE_PREFIX + name, JSON.stringify({ at: Date.now(), info })) } catch {}
}

async function json(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

async function wikipediaSummary(title) {
  const s = await json(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`)
  if (s.type === 'disambiguation' || !WRITER.test(`${s.description || ''} ${s.extract || ''}`.slice(0, 400))) return null
  return {
    description: s.description || '',
    bio: s.extract || '',
    image: s.thumbnail?.source || s.originalimage?.source || '',
    url: s.content_urls?.mobile?.page || s.content_urls?.desktop?.page || '',
    source: 'Wikipedia',
  }
}

async function fromWikipedia(name) {
  // Exact title first, then a search biased towards writers
  try {
    const direct = await wikipediaSummary(name)
    if (direct) return direct
  } catch {}
  try {
    const q = await json(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`${name} author`)}&srlimit=3&format=json&origin=*`)
    for (const hit of q.query?.search || []) {
      // The page has to actually be about this name, not just mention it
      if (!hit.title.toLowerCase().includes(name.split(' ').at(-1).toLowerCase())) continue
      const s = await wikipediaSummary(hit.title)
      if (s) return s
    }
  } catch {}
  return null
}

async function fromOpenLibrary(name) {
  try {
    const q = await json(`https://openlibrary.org/search/authors.json?q=${encodeURIComponent(name)}&limit=1`)
    const doc = q.docs?.[0]
    if (!doc || doc.name?.toLowerCase() !== name.toLowerCase()) return null
    const details = await json(`https://openlibrary.org/authors/${doc.key}.json`).catch(() => ({}))
    const bio = typeof details.bio === 'string' ? details.bio : details.bio?.value || ''
    const photoId = details.photos?.find(p => p > 0)
    return {
      description: [doc.birth_date && `Born ${doc.birth_date}`, doc.top_work && `Known for ${doc.top_work}`].filter(Boolean).join(' · '),
      bio: bio.replace(/\s*\(\[Source\].*$/s, '').trim(),
      image: photoId ? `https://covers.openlibrary.org/a/id/${photoId}-M.jpg` : '',
      url: `https://openlibrary.org/authors/${doc.key}`,
      source: 'Open Library',
    }
  } catch { return null }
}

/**
 * { description, bio, image, url, source } for an author, or null if no
 * reliable match. Wikipedia first; Open Library fills a missing photo or bio.
 */
export function getAuthorInfo(name) {
  if (memory.has(name)) return memory.get(name)
  const cached = readCache(name)
  if (cached !== undefined) {
    const p = Promise.resolve(cached)
    memory.set(name, p)
    return p
  }
  const p = (async () => {
    const wiki = await fromWikipedia(name)
    const ol = (!wiki || !wiki.image || !wiki.bio) ? await fromOpenLibrary(name) : null
    const info = wiki
      ? { ...wiki, image: wiki.image || ol?.image || '', bio: wiki.bio || ol?.bio || '' }
      : ol
    // Only cache real answers (or a definite "nothing found") — not network failures
    if (navigator.onLine) writeCache(name, info)
    return info
  })()
  memory.set(name, p)
  return p
}
