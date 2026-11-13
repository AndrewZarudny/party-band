// A foot pedal (a Bluetooth page turner) for practising hands-free: one pedal presses the screen's main button
// (Start, Again, Play the next step), the other its Next button. Buttons say which they are with
// data-pedal="go" or data-pedal="next"; a pedal press clicks the first visible one. Page turners send a key
// (usually Page Down / Page Up, some the arrow keys); the player can teach the app theirs in Lessons settings.

export type PedalRole = 'go' | 'next'

export interface PedalSetup {
  on: boolean
  go: string[] // KeyboardEvent.key values
  next: string[]
}

const KEY = 'pedal'
export const DEFAULT_PEDAL: PedalSetup = { on: true, go: ['PageDown'], next: ['PageUp'] }

export function loadPedal(): PedalSetup {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PedalSetup> | null
    if (!o) return DEFAULT_PEDAL
    const keys = (v: unknown, d: string[]) => (Array.isArray(v) && v.every((k) => typeof k === 'string') && v.length ? (v as string[]) : d)
    return { on: o.on !== false, go: keys(o.go, DEFAULT_PEDAL.go), next: keys(o.next, DEFAULT_PEDAL.next) }
  } catch {
    return DEFAULT_PEDAL
  }
}

export function savePedal(p: PedalSetup) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable: this page keeps it */
  }
  setup = p
}

let setup: PedalSetup | null = null
let learning: ((key: string) => void) | null = null

/** What a key does: 'go', 'next' or nothing. */
export function roleOf(p: PedalSetup, key: string): PedalRole | null {
  if (!p.on) return null
  if (p.go.includes(key)) return 'go'
  if (p.next.includes(key)) return 'next'
  return null
}

/** The button a pedal presses now: the first visible, enabled one marked for that role. */
export function pedalTarget(role: PedalRole, root: ParentNode = document): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>(`[data-pedal="${role}"]`)) {
    const off = (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true'
    if (!off && el.getClientRects().length > 0) return el
  }
  return null
}

/** A key press in a text field or menu is typing, not a pedal. */
const typing = (t: EventTarget | null) => {
  const el = t as { tagName?: string; isContentEditable?: boolean } | null
  return !!el && (!!el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''))
}

/** The button a key press should click, or null (not a pedal key, typing, a modifier held, nothing to press). */
export function pedalPress(
  ev: { key: string; repeat?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; target: EventTarget | null },
  p: PedalSetup,
  root: ParentNode = document,
): HTMLElement | null {
  if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey || typing(ev.target)) return null
  const role = roleOf(p, ev.key)
  return role ? pedalTarget(role, root) : null
}

/** The next key pressed (for teaching the app a pedal); Escape cancels with null. */
export function learnPedalKey(): Promise<string | null> {
  return new Promise((resolve) => {
    learning = (key) => {
      learning = null
      resolve(key === 'Escape' ? null : key)
    }
  })
}

/** Listens for pedal presses on the whole page. Call once. */
export function installPedal() {
  window.addEventListener(
    'keydown',
    (ev) => {
      if (learning) {
        ev.preventDefault()
        ev.stopPropagation()
        learning(ev.key)
        return
      }
      const target = pedalPress(ev, (setup ??= loadPedal()))
      if (!target) return
      ev.preventDefault()
      ev.stopPropagation()
      target.click()
    },
    true,
  )
}
