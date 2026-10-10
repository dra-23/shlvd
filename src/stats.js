// Small helpers shared by Profile and its full-screen stat pages.

export const DAY = 86400000
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const GENRE_SLOTS = 5

export const short = n => n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
export const dayKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
export const sumPages = list => list.reduce((s, b) => s + (b.pageCount > 0 ? b.pageCount : 0), 0)
export function avgRating(list) {
  const rated = list.filter(b => b.rating > 0)
  return rated.length ? rated.reduce((s, b) => s + b.rating, 0) / rated.length : null
}

// Weeks since a fixed Sunday, so consecutive weeks differ by exactly 1
export const weekIndex = d => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1970, 0, 4)) / (7 * DAY))

export function longestWeekStreak(list) {
  const weeks = [...new Set(list.map(b => weekIndex(b.dateCompleted)))].sort((a, b) => a - b)
  let best = 0, run = 0
  weeks.forEach((w, i) => { run = i && w === weeks[i - 1] + 1 ? run + 1 : 1; best = Math.max(best, run) })
  return best
}

/** Years you finished books in, newest first, always including this year */
export function readingYears(read) {
  const thisYear = new Date().getFullYear()
  return [...new Set([thisYear, ...read.map(b => b.dateCompleted.getFullYear())])].sort((a, b) => b - a)
}

export function yearChipsHTML(read, selected) {
  return [...readingYears(read), 'all'].map(y => `
    <button class="chip ${y === selected ? 'selected' : ''}" data-year="${y}" aria-pressed="${y === selected}">
      ${y === 'all' ? 'All time' : y}
    </button>`).join('')
}

/** Centre the selected chip sideways (scrollIntoView would also scroll the app shell) */
export function centreChip(row, y) {
  const chip = row?.querySelector(`[data-year="${y}"]`)
  if (chip) row.scrollTo({ left: chip.offsetLeft - row.clientWidth / 2 + chip.offsetWidth / 2, behavior: 'smooth' })
}

/** Genre → palette slot by all-time rank, so a genre keeps its colour in every view */
export function genreSlots(read) {
  const counts = new Map()
  read.forEach(b => { if (b.genre) counts.set(b.genre, (counts.get(b.genre) || 0) + 1) })
  return new Map([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, GENRE_SLOTS).map(([g], i) => [g, i]))
}

/**
 * Genre counts for `list`, sorted, each with a colour. The first `top` get
 * palette colours (all-time slot, or a slot nobody on screen is using);
 * the rest share the "other" colour.
 */
export function genreBreakdown(list, slots, top = GENRE_SLOTS) {
  const counts = new Map()
  list.forEach(b => { if (b.genre) counts.set(b.genre, (counts.get(b.genre) || 0) + 1) })
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const head = sorted.slice(0, top)
  const used = new Set(head.map(([g]) => slots.get(g)).filter(i => i !== undefined))
  const free = [...Array(GENRE_SLOTS).keys()].filter(i => !used.has(i))
  return sorted.map(([g, n], i) => {
    const slot = i < top ? (slots.has(g) ? slots.get(g) : free.shift()) : undefined
    return { genre: g, count: n, colour: slot === undefined ? 'var(--genre-other)' : `var(--genre-${slot + 1})` }
  })
}
