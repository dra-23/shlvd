// Spreadsheet apps silently turn some titles into dates during import
// (e.g. "November 9" → "9-Nov"). Detect those and suggest the original.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const monthIndex = abbr =>
  MONTHS.findIndex(m => m.slice(0, 3).toLowerCase() === abbr.toLowerCase())

/** Returns a suggested title if `title` looks date-mangled, otherwise null */
export function suggestTitleFix(title) {
  const t = String(title ?? '').trim()
  let m

  // "9-Nov" ← "November 9"
  if ((m = t.match(/^(\d{1,2})-([a-z]{3})$/i)) && monthIndex(m[2]) >= 0)
    return `${MONTHS[monthIndex(m[2])]} ${Number(m[1])}`

  // "Nov-63" ← "November 63"
  if ((m = t.match(/^([a-z]{3})-(\d{2,4})$/i)) && monthIndex(m[1]) >= 0)
    return `${MONTHS[monthIndex(m[1])]} ${m[2]}`

  // "22-Nov-63" ← "11/22/63"
  if ((m = t.match(/^(\d{1,2})-([a-z]{3})-(\d{2,4})$/i)) && monthIndex(m[2]) >= 0)
    return `${monthIndex(m[2]) + 1}/${Number(m[1])}/${m[3]}`

  // ISO dates or scientific notation — clearly mangled, but no way to guess the original
  if (/^\d{4}-\d{2}-\d{2}([ T].*)?$/.test(t) || /^\d+(\.\d+)?E[+-]\d+$/i.test(t))
    return t

  return null
}

// Titles the user confirmed are correct, remembered on this device
const OK_KEY = 'shlvd-title-ok'

export function getConfirmedTitleIds() {
  try { return new Set(JSON.parse(localStorage.getItem(OK_KEY) || '[]')) }
  catch { return new Set() }
}

export function confirmTitle(id) {
  const ids = getConfirmedTitleIds()
  ids.add(id)
  try { localStorage.setItem(OK_KEY, JSON.stringify([...ids])) } catch {}
}
