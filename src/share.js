// Story-sized (1080×1920) share cards drawn on a canvas.
// Google Books covers can't be drawn into an exportable canvas (no CORS), so
// the book is shown as a typographic "cover" instead of the cover photo.

const W = 1080, H = 1920
const GOLD = '#F5A623'
const CREAM = '#f6f8f2'
// Cover colours for the typographic book, picked by title so a book always gets the same one
const COVER_COLOURS = ['#b5655c', '#d8a24a', '#7d9070', '#5c6bc0', '#c49490', '#4f7a8a', '#8a6d9e', '#a0714f']

const FONT = 'Nunito, system-ui, sans-serif'
const font = (weight, size) => `${weight} ${size}px ${FONT}`

async function ensureFonts() {
  try { await Promise.all([document.fonts.load(font(800, 80)), document.fonts.load(font(600, 40))]) } catch {}
}

function hash(str) {
  let h = 0
  for (const ch of str) h = (h * 31 + ch.codePointAt(0)) >>> 0
  return h
}

// Wrap text to a max width; returns lines (ellipsised past maxLines)
function wrap(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/)
  const lines = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width <= maxWidth || !line) line = test
    else { lines.push(line); line = word }
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    let last = kept[maxLines - 1]
    while (ctx.measureText(`${last}…`).width > maxWidth && last.includes(' ')) last = last.slice(0, last.lastIndexOf(' '))
    kept[maxLines - 1] = `${last}…`
    return kept
  }
  return lines
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function background(ctx) {
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, '#2f4229')
  g.addColorStop(0.55, '#4d6344')
  g.addColorStop(1, '#7d9070')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // soft light circles for depth
  ctx.fillStyle = 'rgba(255,255,255,0.05)'
  ctx.beginPath(); ctx.arc(W * 0.9, H * 0.12, 360, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(W * 0.05, H * 0.82, 420, 0, Math.PI * 2); ctx.fill()
}

function wordmark(ctx, y) {
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(246,248,242,0.75)'
  ctx.font = font(800, 40)
  ctx.fillText('shlvd', W / 2, y)
}

function stars(ctx, rating, cx, y, size) {
  if (!rating) return
  ctx.textAlign = 'center'
  ctx.font = font(800, size)
  const filled = '★'.repeat(rating), empty = '★'.repeat(5 - rating)
  const total = ctx.measureText(filled + empty).width
  let x = cx - total / 2
  ctx.textAlign = 'left'
  ctx.fillStyle = GOLD
  ctx.fillText(filled, x, y)
  x += ctx.measureText(filled).width
  ctx.fillStyle = 'rgba(255,255,255,0.25)'
  ctx.fillText(empty, x, y)
}

// A book drawn as a coloured cover with its title — stands in for the cover photo
function typographicBook(ctx, book, x, y, w, h) {
  const k = w / 600 // everything below is sized for a 600px-wide cover
  const base = COVER_COLOURS[hash(book.title) % COVER_COLOURS.length]
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 50 * k
  ctx.shadowOffsetY = 24 * k
  roundRect(ctx, x, y, w, h, 28 * k)
  ctx.fillStyle = base
  ctx.fill()
  ctx.restore()

  // spine highlight + inner frame
  ctx.save()
  roundRect(ctx, x, y, w, h, 28 * k)
  ctx.clip()
  const shade = ctx.createLinearGradient(x, 0, x + w, 0)
  shade.addColorStop(0, 'rgba(0,0,0,0.28)')
  shade.addColorStop(0.07, 'rgba(255,255,255,0.12)')
  shade.addColorStop(0.12, 'rgba(0,0,0,0)')
  shade.addColorStop(1, 'rgba(0,0,0,0.12)')
  ctx.fillStyle = shade
  ctx.fillRect(x, y, w, h)
  ctx.restore()
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = Math.max(2, 4 * k)
  roundRect(ctx, x + 40 * k, y + 40 * k, w - 80 * k, h - 80 * k, 14 * k)
  ctx.stroke()

  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  let size = 76 * k
  let lines
  do {
    ctx.font = font(800, size)
    lines = wrap(ctx, book.title, w - 150 * k, 5)
    size -= 4 * k
  } while (lines.length * size * 1.15 > h * 0.55 && size > 34 * k)
  const lineH = (size + 4 * k) * 1.15
  let ty = y + h * 0.42 - (lines.length - 1) * lineH / 2
  lines.forEach(l => { ctx.fillText(l, x + w / 2, ty); ty += lineH })

  ctx.font = font(700, 36 * k)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillText(wrap(ctx, book.author, w - 150 * k, 1)[0] || '', x + w / 2, y + h - 90 * k)
}

function statsRow(ctx, stats, y) {
  const colW = (W - 160) / stats.length
  stats.forEach(([value, label], i) => {
    const cx = 80 + colW * i + colW / 2
    ctx.textAlign = 'center'
    ctx.fillStyle = CREAM
    ctx.font = font(800, 68)
    ctx.fillText(value, cx, y)
    ctx.fillStyle = 'rgba(246,248,242,0.7)'
    ctx.font = font(700, 30)
    ctx.fillText(label, cx, y + 48)
  })
}

const short = n => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

async function finish(canvas) {
  return new Promise((resolve, reject) =>
    // JPEG: the gradient card looks the same and is a fraction of the PNG size
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not create image')), 'image/jpeg', 0.92))
}

/** Card for one Book of the Month pick and that month's reading */
export async function drawBotmCard(book, monthBooks) {
  await ensureFonts()
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  background(ctx)

  const d = book.dateCompleted
  const month = d ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : ''

  ctx.textAlign = 'center'
  ctx.fillStyle = GOLD
  ctx.font = font(800, 40)
  ctx.letterSpacing = '6px'
  ctx.fillText('BOOK OF THE MONTH', W / 2, 190)
  ctx.letterSpacing = '0px'
  ctx.fillStyle = CREAM
  ctx.font = font(800, 92)
  ctx.fillText(month, W / 2, 300)

  typographicBook(ctx, book, (W - 600) / 2, 380, 600, 880)

  ctx.textAlign = 'center'
  ctx.fillStyle = CREAM
  ctx.font = font(800, 58)
  const titleLines = wrap(ctx, book.title, W - 180, 2)
  let ty = 1370
  titleLines.forEach(l => { ctx.fillText(l, W / 2, ty); ty += 68 })
  ctx.fillStyle = 'rgba(246,248,242,0.8)'
  ctx.font = font(700, 40)
  ctx.fillText(book.author, W / 2, ty + 4)
  stars(ctx, book.rating, W / 2, ty + 90, 64)

  const pages = monthBooks.reduce((s, b) => s + (b.pageCount || 0), 0)
  const rated = monthBooks.filter(b => b.rating > 0)
  const avg = rated.length ? (rated.reduce((s, b) => s + b.rating, 0) / rated.length).toFixed(1) : '—'
  ctx.strokeStyle = 'rgba(246,248,242,0.2)'
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(140, 1625); ctx.lineTo(W - 140, 1625); ctx.stroke()
  statsRow(ctx, [[String(monthBooks.length), 'books read'], [short(pages), 'pages'], [`${avg}★`, 'avg rating']], 1715)

  wordmark(ctx, 1872)
  return finish(canvas)
}

/** Card summarising a year of reading */
export async function drawYearCard(year, s) {
  await ensureFonts()
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  background(ctx)

  ctx.textAlign = 'center'
  ctx.fillStyle = GOLD
  ctx.font = font(800, 40)
  ctx.letterSpacing = '6px'
  ctx.fillText('MY YEAR IN BOOKS', W / 2, 190)
  ctx.letterSpacing = '0px'
  ctx.fillStyle = CREAM
  ctx.font = font(800, 120)
  ctx.fillText(String(year), W / 2, 330)

  ctx.font = font(800, 300)
  ctx.fillText(String(s.bookCount), W / 2, 640)
  ctx.font = font(700, 52)
  ctx.fillStyle = 'rgba(246,248,242,0.8)'
  ctx.fillText(`book${s.bookCount === 1 ? '' : 's'} finished`, W / 2, 720)

  statsRow(ctx, [[short(s.pageCount), 'pages'], [s.avgRating ? `${s.avgRating}★` : '—', 'avg rating'], [String(s.botmCount), 'BotM picks']], 870)

  // Detail rows
  const rows = [['Top genre', s.topGenre], ['Top author', s.topAuthor]].filter(r => r[1])
  let y = 1040
  rows.forEach(([label, value]) => {
    ctx.strokeStyle = 'rgba(246,248,242,0.18)'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(110, y - 62); ctx.lineTo(W - 110, y - 62); ctx.stroke()
    ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(246,248,242,0.7)'
    ctx.font = font(700, 38)
    ctx.fillText(label, 110, y)
    ctx.textAlign = 'right'
    ctx.fillStyle = CREAM
    ctx.font = font(800, 42)
    ctx.fillText(wrap(ctx, value, 560, 1)[0], W - 110, y)
    y += 110
  })

  // Favourite read / Book of the Year panel
  const fav = s.bookOfYear || s.bestBook
  if (fav) {
    const px = 90, py = y + 10, pw = W - 180, ph = 1700 - py
    ctx.fillStyle = 'rgba(255,255,255,0.1)'
    roundRect(ctx, px, py, pw, ph, 36)
    ctx.fill()
    const bookW = Math.min(300, (ph - 80) / 1.47)
    typographicBook(ctx, fav, px + 50, py + (ph - bookW * 1.47) / 2, bookW, bookW * 1.47)
    const tx = px + 50 + bookW + 50, tw = pw - bookW - 150
    ctx.textAlign = 'left'
    ctx.fillStyle = GOLD
    ctx.font = font(800, 32)
    ctx.letterSpacing = '4px'
    ctx.fillText(s.bookOfYear ? 'BOOK OF THE YEAR' : 'FAVOURITE READ', tx, py + ph / 2 - 90)
    ctx.letterSpacing = '0px'
    ctx.fillStyle = CREAM
    ctx.font = font(800, 50)
    let ly = py + ph / 2 - 20
    wrap(ctx, fav.title, tw, 3).forEach(l => { ctx.fillText(l, tx, ly); ly += 60 })
    ctx.fillStyle = 'rgba(246,248,242,0.8)'
    ctx.font = font(700, 36)
    ctx.fillText(wrap(ctx, fav.author, tw, 1)[0], tx, ly + 8)
  }

  wordmark(ctx, 1840)
  return finish(canvas)
}

// Wikipedia images allow cross-origin use, so an author photo can usually be
// drawn; resolves null (→ initials) if it can't
function loadDrawableImage(src) {
  if (!src) return Promise.resolve(null)
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const probe = document.createElement('canvas').getContext('2d')
        probe.drawImage(img, 0, 0, 1, 1)
        probe.getImageData(0, 0, 1, 1)
        resolve(img)
      } catch { resolve(null) }
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** Card for an author: photo, your stats for them and your favourite of theirs */
export async function drawAuthorCard(name, info, books) {
  await ensureFonts()
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  background(ctx)

  ctx.textAlign = 'center'
  ctx.fillStyle = GOLD
  ctx.font = font(800, 40)
  ctx.letterSpacing = '6px'
  ctx.fillText('AUTHOR SPOTLIGHT', W / 2, 190)
  ctx.letterSpacing = '0px'

  // Round photo (or initials)
  const cx = W / 2, cy = 470, r = 210
  const photo = await loadDrawableImage(info?.image)
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 40
  ctx.shadowOffsetY = 16
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#7d9070'; ctx.fill()
  ctx.restore()
  ctx.save()
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip()
  if (photo) {
    // cover-fit, biased upwards so faces aren't cropped off
    const s = Math.max((2 * r) / photo.width, (2 * r) / photo.height)
    const w = photo.width * s, h = photo.height * s
    ctx.drawImage(photo, cx - w / 2, cy - r - Math.max(0, (h - 2 * r) * 0.2), w, h)
  } else {
    ctx.fillStyle = CREAM
    ctx.font = font(800, 150)
    ctx.textBaseline = 'middle'
    ctx.fillText(name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase(), cx, cy + 6)
    ctx.textBaseline = 'alphabetic'
  }
  ctx.restore()
  ctx.strokeStyle = 'rgba(246,248,242,0.85)'
  ctx.lineWidth = 10
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()

  ctx.fillStyle = CREAM
  ctx.font = font(800, 84)
  let y = 800
  wrap(ctx, name, W - 160, 2).forEach(l => { ctx.fillText(l, W / 2, y); y += 92 })
  if (info?.description) {
    ctx.fillStyle = 'rgba(246,248,242,0.75)'
    ctx.font = font(700, 38)
    ctx.fillText(wrap(ctx, info.description, W - 200, 1)[0], W / 2, y + 4)
  }

  const read = books.filter(b => b.shelf === 'read')
  const pages = read.reduce((n, b) => n + (b.pageCount || 0), 0)
  const rated = read.filter(b => b.rating > 0)
  const avg = rated.length ? (rated.reduce((n, b) => n + b.rating, 0) / rated.length).toFixed(1) : '—'
  statsRow(ctx, [[String(read.length), `book${read.length === 1 ? '' : 's'} read`], [short(pages), 'pages'], [`${avg}★`, 'avg rating']], 1110)

  // Awards line, only when there's something to brag about
  const botm = books.filter(b => b.isBOTM).length
  const boty = books.filter(b => b.isBOTY).length
  const awards = [
    botm && `${botm} Book${botm === 1 ? '' : 's'} of the Month`,
    boty && `${boty} Book${boty === 1 ? '' : 's'} of the Year`,
  ].filter(Boolean)
  if (awards.length) {
    ctx.textAlign = 'center'
    ctx.fillStyle = GOLD
    ctx.font = font(800, 40)
    ctx.fillText(`★ ${awards.join('  ·  ')}`, W / 2, 1245)
  }

  const fav = [...rated].sort((a, b) => b.rating - a.rating || b.dateCompleted - a.dateCompleted)[0]
  if (fav) {
    const px = 90, py = awards.length ? 1300 : 1230, pw = W - 180, ph = awards.length ? 460 : 500
    ctx.fillStyle = 'rgba(255,255,255,0.1)'
    roundRect(ctx, px, py, pw, ph, 36)
    ctx.fill()
    const bookW = 280
    typographicBook(ctx, fav, px + 50, py + (ph - bookW * 1.47) / 2, bookW, bookW * 1.47)
    const tx = px + 50 + bookW + 50, tw = pw - bookW - 150
    ctx.textAlign = 'left'
    ctx.fillStyle = GOLD
    ctx.font = font(800, 32)
    ctx.letterSpacing = '4px'
    ctx.fillText('MY FAVOURITE', tx, py + ph / 2 - 80)
    ctx.letterSpacing = '0px'
    ctx.fillStyle = CREAM
    ctx.font = font(800, 50)
    let ly = py + ph / 2 - 10
    wrap(ctx, fav.title, tw, 3).forEach(l => { ctx.fillText(l, tx, ly); ly += 60 })
    ctx.textAlign = 'left'
    ctx.font = font(800, 44)
    ctx.fillStyle = GOLD
    ctx.fillText('★'.repeat(fav.rating), tx, ly + 14)
  }

  wordmark(ctx, 1840)
  return finish(canvas)
}

/** Share an image through the phone's share sheet, or download it */
export async function shareImage(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled'
      // fall through to download
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return 'downloaded'
}
