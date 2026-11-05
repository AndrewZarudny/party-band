// Counts practice time: one tick a second while the tab is visible. A second counts once, for the most specific
// thing running: a lesson (counting in or playing), a song playing, the jam clock running, or else the guitar
// being played (input above the noise floor within the last 10 seconds). Seconds gather in memory and are added
// to this browser's bucket in storage every 15 seconds and when the page goes away.
import { engine } from '../audio/engine'
import { onSignOut, practisingNow } from '../account/activity'
import type { PracticeKind, Secs } from './data'
import { DEVICE_KEY, EARLY_HOUR, KINDS, PRACTICE_KEY, dayKey, parseLog, prune, totalsOf, zero } from './data'

const NOISE_RMS = 0.004 // above string noise and hum, below a softly picked note
const IDLE_MS = 10000
const SAVE_MS = 15000
// Two windows of this browser can both be visible: only the one holding this lease counts a second.
const LEASE_KEY = 'fretwise-practice-tab'
const LEASE_MS = 2500

let started = false
let stopped = false // signing out: nothing more is written
let lastSound = -Infinity
let pending: Record<string, Secs> = {}
let pendingEarly: Record<string, number> = {} // seconds before EARLY_HOUR, per calendar day
let pendingCount = 0
let lastSave = 0
const tabId = Math.random().toString(36).slice(2, 10)
const listeners = new Set<() => void>()

function kindNow(): PracticeKind | null {
  if (document.visibilityState !== 'visible') return null
  const on = practisingNow()
  for (const k of KINDS) if (k !== 'guitar' && on.has(k)) return k
  if (engine.running && performance.now() - lastSound < IDLE_MS) return 'guitar'
  return null
}

/** True when this tab counts this second: it has focus, or no other tab counted lately. */
function holdLease(): boolean {
  try {
    const now = Date.now()
    if (!document.hasFocus()) {
      const [id, t] = (localStorage.getItem(LEASE_KEY) ?? '').split(':')
      if (id && id !== tabId && now - Number(t) < LEASE_MS) return false
    }
    localStorage.setItem(LEASE_KEY, `${tabId}:${now}`)
  } catch {
    /* storage unavailable: count here */
  }
  return true
}

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return 'here'
  }
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(PRACTICE_KEY)
  } catch {
    return null
  }
}

/** Adds the gathered seconds to what storage holds now (it may have changed: sync, another tab). */
function save() {
  lastSave = Date.now()
  if (!pendingCount || stopped) return
  const log = parseLog(readRaw())
  const id = deviceId()
  const dev = (log.devices[id] ??= { days: {}, before: zero(), upto: '' })
  for (const [day, s] of Object.entries(pending)) {
    const cur = dev.days[day] ?? zero()
    dev.days[day] = cur.map((x, i) => x + s[i])
  }
  for (const [day, n] of Object.entries(pendingEarly)) {
    dev.early ??= {}
    dev.early[day] = (dev.early[day] ?? 0) + n
  }
  try {
    localStorage.setItem(PRACTICE_KEY, JSON.stringify(prune(log, new Date())))
    pending = {}
    pendingEarly = {}
    pendingCount = 0
  } catch {
    /* storage full or blocked: keep counting in memory */
  }
}

function tick() {
  if (stopped) return
  const k = kindNow()
  if (k && holdLease()) {
    const t = new Date()
    const day = dayKey(t)
    const s = (pending[day] ??= zero())
    s[KINDS.indexOf(k)]++
    if (t.getHours() < EARLY_HOUR) pendingEarly[day] = (pendingEarly[day] ?? 0) + 1
    pendingCount++
    snapshot = null
    listeners.forEach((fn) => fn())
  }
  if (Date.now() - lastSave >= SAVE_MS) save()
}

/** Starts the counter once, after the account's data is in place. */
export function startPracticeLog(): void {
  if (started) return
  started = true
  lastSave = Date.now()
  engine.level.on((rms) => {
    if (rms > NOISE_RMS) lastSound = performance.now()
  })
  window.setInterval(tick, 1000)
  onSignOut({
    save,
    stop: () => {
      stopped = true
      pending = {}
      pendingEarly = {}
      pendingCount = 0
    },
  })
  window.addEventListener('pagehide', save)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save()
  })
  // Another tab or a pull changed the stored log.
  window.addEventListener('storage', (ev) => {
    if (ev.key !== PRACTICE_KEY && ev.key !== null) return
    snapshot = null
    listeners.forEach((fn) => fn())
  })
}

export interface PracticeSnapshot {
  days: Map<string, Secs> // every browser, plus seconds not saved yet
  early: Map<string, number> // per calendar day, the seconds before EARLY_HOUR
  before: Secs
  today: Date
}

let snapshot: PracticeSnapshot | null = null
let snapshotRaw: string | null = null

/** For useSyncExternalStore: the same object until something changes. */
export function getPracticeSnapshot(): PracticeSnapshot {
  const raw = readRaw()
  if (snapshot && raw === snapshotRaw && dayKey(snapshot.today) === dayKey(new Date())) return snapshot
  const t = totalsOf(parseLog(raw))
  for (const [day, s] of Object.entries(pending)) {
    const cur = t.days.get(day) ?? zero()
    t.days.set(
      day,
      cur.map((x, i) => x + s[i]),
    )
  }
  for (const [day, n] of Object.entries(pendingEarly)) t.early.set(day, (t.early.get(day) ?? 0) + n)
  snapshot = { ...t, today: new Date() }
  snapshotRaw = raw
  return snapshot
}

export function subscribePractice(fn: () => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
