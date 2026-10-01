import { watchReadingGoals, setReadingGoal } from '../db.js'
import { showSnackbar } from './shelves.js'

// Yearly reading goal card for the Profile page — a progress ring plus
// an ahead/behind-schedule line. Goals live in Firestore (settings/library)
// so they're shared across devices.

const RING_R = 52
const RING_C = 2 * Math.PI * RING_R

export function mountReadingGoal(el) {
  const year = new Date().getFullYear()
  let goals = {}
  let readThisYear = 0
  let editing = false

  const unsub = watchReadingGoals(
    g => { goals = g; render() },
    () => render(),
  )

  function render() {
    if (editing) return
    const goal = Number(goals[year]) || 0
    el.innerHTML = goal ? goalHTML(goal) : noGoalHTML()
    // Animate the ring from empty on first paint
    const arc = el.querySelector('.goal-ring-progress')
    if (arc) requestAnimationFrame(() => {
      arc.style.strokeDashoffset = RING_C * (1 - Math.min(1, readThisYear / goal))
    })
  }

  function goalHTML(goal) {
    const done = readThisYear >= goal
    return `
      <div class="chart-title goal-header">
        <span>${year} Reading Goal</span>
        <button class="icon-btn goal-edit" aria-label="Edit goal">
          <span class="material-symbols-rounded">edit</span>
        </button>
      </div>
      <div class="goal-body">
        <svg class="goal-ring" viewBox="0 0 120 120" aria-hidden="true">
          <circle class="goal-ring-track" cx="60" cy="60" r="${RING_R}" />
          <circle class="goal-ring-progress ${done ? 'done' : ''}" cx="60" cy="60" r="${RING_R}"
            stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}" />
          <text x="60" y="58" class="goal-ring-count">${readThisYear}</text>
          <text x="60" y="78" class="goal-ring-of">of ${goal}</text>
        </svg>
        <div class="goal-text">
          <div class="goal-headline">${readThisYear} of ${goal} books in ${year}</div>
          <div class="goal-status ${done ? 'done' : ''}">${statusText(goal)}</div>
          ${done ? '' : `<div class="goal-status">${goal - readThisYear} to go</div>`}
        </div>
      </div>
    `
  }

  function noGoalHTML() {
    return `
      <div class="chart-title">${year} Reading Goal</div>
      <div class="goal-empty">
        ${readThisYear} book${readThisYear === 1 ? '' : 's'} read so far this year.
        Set a goal to track your progress.
      </div>
      <button class="btn btn-tonal goal-edit" style="width:100%;">
        <span class="material-symbols-rounded">flag</span>
        Set a goal
      </button>
    `
  }

  function statusText(goal) {
    if (readThisYear >= goal) return '🎉 Goal reached!'
    const start = new Date(year, 0, 1)
    const daysInYear = (new Date(year + 1, 0, 1) - start) / 86400000
    const dayOfYear = Math.floor((Date.now() - start) / 86400000) + 1
    const diff = readThisYear - Math.floor(goal * dayOfYear / daysInYear)
    if (diff > 0) return `${diff} book${diff === 1 ? '' : 's'} ahead of schedule`
    if (diff < 0) return `${-diff} book${diff === -1 ? '' : 's'} behind schedule`
    return 'Right on track'
  }

  function openEditor() {
    editing = true
    const goal = Number(goals[year]) || 0
    el.innerHTML = `
      <div class="chart-title">${year} Reading Goal</div>
      <label class="goal-edit-label" for="goal-input">How many books do you want to read in ${year}?</label>
      <div class="goal-edit-row">
        <input id="goal-input" class="goal-input" type="number" inputmode="numeric"
          min="1" max="9999" placeholder="e.g. 50" value="${goal || ''}" />
        <button class="btn btn-filled goal-save">Save</button>
        <button class="btn btn-text goal-cancel">Cancel</button>
      </div>
      ${goal ? `<button class="btn btn-text goal-remove">Remove goal</button>` : ''}
    `
    const input = el.querySelector('#goal-input')
    input.focus()
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(input.value) })
  }

  async function save(raw, removing = false) {
    const count = removing ? 0 : Math.round(Number(raw))
    if (!removing && !(count > 0 && count < 10000)) {
      showSnackbar('Enter a number of books')
      return
    }
    try {
      await setReadingGoal(year, count)
      goals = { ...goals, [year]: count }
      showSnackbar(removing ? 'Goal removed' : `Goal set: ${count} books in ${year}`)
    } catch (err) {
      showSnackbar(err?.code === 'permission-denied'
        ? 'Couldn’t save — check Firestore rules for settings'
        : 'Couldn’t save goal')
    }
    editing = false
    render()
  }

  el.addEventListener('click', e => {
    if (e.target.closest('.goal-edit')) return openEditor()
    if (e.target.closest('.goal-cancel')) { editing = false; return render() }
    if (e.target.closest('.goal-remove')) return save(0, true)
    if (e.target.closest('.goal-save')) return save(el.querySelector('#goal-input').value)
  })

  render()

  return {
    update(books) {
      readThisYear = books.filter(b =>
        b.shelf === 'read' && b.dateCompleted?.getFullYear() === year).length
      render()
    },
    destroy: unsub,
  }
}
