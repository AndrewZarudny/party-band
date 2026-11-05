// The practice log: seconds per day and activity. Each browser counts into its own bucket and only ever adds to
// it, so two browsers' copies combine by taking the larger number per bucket: nothing is lost or counted twice.

export const PRACTICE_KEY = 'practice-log'
export const DEVICE_KEY = 'practice-device'

/** Most specific first: a second goes to the first one that is running. */
export const KINDS = ['lessons', 'songs', 'jam', 'guitar'] as const
export type PracticeKind = (typeof KINDS)[number]
export type Secs = number[] // seconds, in KINDS order

const KEEP_DAYS = 400
/** A practice day runs from 4 am to 4 am (lessons/progress.ts dayKey): seconds before this hour belong to the day before. */
export const EARLY_HOUR = 4

export interface DeviceLog {
  days: Record<string, Secs> // 'YYYY-MM-DD' (local) → seconds per kind
  before: Secs // days older than `upto`, folded in
  upto: string // '' when nothing was folded yet
  early?: Record<string, number> // 'YYYY-MM-DD' → seconds of that day before EARLY_HOUR (part of days[k]), all kinds
}
export interface PracticeLog {
  v: 1
  devices: Record<string, DeviceLog>
}

export const zero = (): Secs => KINDS.map(() => 0)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0)
const secsOf = (v: unknown): Secs => (Array.isArray(v) ? KINDS.map((_, i) => num(v[i])) : zero())
export const sum = (s: Secs) => s.reduce((n, x) => n + x, 0)
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** The date `n` days before `d` (local, noon so DST never skips a day). */
export function daysBefore(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n, 12)
}

export function emptyLog(): PracticeLog {
  return { v: 1, devices: {} }
}

export function parseLog(raw: string | null): PracticeLog {
  const log = emptyLog()
  if (!raw) return log
  try {
    const o = JSON.parse(raw) as { devices?: unknown } | null
    if (!o || typeof o.devices !== 'object' || !o.devices) return log
    for (const [id, d] of Object.entries(o.devices as Record<string, unknown>)) {
      if (!d || typeof d !== 'object') continue
      const dv = d as { days?: unknown; before?: unknown; upto?: unknown }
      const days: Record<string, Secs> = {}
      if (dv.days && typeof dv.days === 'object')
        for (const [k, v] of Object.entries(dv.days as Record<string, unknown>)) if (DAY_RE.test(k)) days[k] = secsOf(v)
      const upto = typeof dv.upto === 'string' && DAY_RE.test(dv.upto) ? dv.upto : ''
      log.devices[id] = { days, before: secsOf(dv.before), upto }
      const early: Record<string, number> = {}
      const raw = (d as { early?: unknown }).early
      if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (DAY_RE.test(k) && num(v)) early[k] = num(v)
      if (Object.keys(early).length) log.devices[id].early = early
    }
  } catch {
    /* unreadable: start empty */
  }
  return log
}

/** Days older than the keep window are folded into the device's `before` total. */
export function prune(log: PracticeLog, now: Date): PracticeLog {
  const cutoff = dayKey(daysBefore(now, KEEP_DAYS))
  for (const d of Object.values(log.devices)) {
    for (const [k, s] of Object.entries(d.days)) {
      if (k >= cutoff) continue
      d.before = d.before.map((x, i) => x + s[i])
      delete d.days[k]
      if (cutoff > d.upto) d.upto = cutoff
    }
    for (const k of Object.keys(d.early ?? {})) if (k < cutoff) delete d.early?.[k]
  }
  return log
}

/** The larger of each number: both copies only ever grew from the same start. */
function mergeDevice(a: DeviceLog, b: DeviceLog): DeviceLog {
  // The side that folded more recently owns the old totals; the other side's days before that are in them.
  const [base, other] = a.upto > b.upto ? [a, b] : [b, a]
  const before = a.upto === b.upto ? base.before.map((x, i) => Math.max(x, other.before[i])) : base.before
  const days: Record<string, Secs> = {}
  for (const [k, s] of Object.entries(base.days)) days[k] = s
  for (const [k, s] of Object.entries(other.days)) {
    if (base.upto && k < base.upto) continue
    const cur = days[k]
    days[k] = cur ? cur.map((x, i) => Math.max(x, s[i])) : s
  }
  const out: DeviceLog = { days, before, upto: base.upto }
  const early: Record<string, number> = { ...(base.early ?? {}) }
  for (const [k, v] of Object.entries(other.early ?? {})) if (!base.upto || k >= base.upto) early[k] = Math.max(early[k] ?? 0, v)
  if (Object.keys(early).length) out.early = early
  return out
}

export function mergeLogs(a: PracticeLog, b: PracticeLog, now = new Date()): PracticeLog {
  const out = emptyLog()
  for (const id of new Set([...Object.keys(a.devices), ...Object.keys(b.devices)])) {
    const x = a.devices[id]
    const y = b.devices[id]
    out.devices[id] = x && y ? mergeDevice(x, y) : (x ?? y)
  }
  return prune(out, now)
}

/** The account sync's merge for the practice key (either side may be missing). */
export function mergePracticeRaw(a: string | null, b: string | null): string {
  return JSON.stringify(mergeLogs(parseLog(a), parseLog(b)))
}

/** Every browser's seconds added together, per day (and before EARLY_HOUR per day), plus the folded older total. */
export function totalsOf(log: PracticeLog): { days: Map<string, Secs>; early: Map<string, number>; before: Secs } {
  const days = new Map<string, Secs>()
  const early = new Map<string, number>()
  let before = zero()
  for (const d of Object.values(log.devices)) {
    before = before.map((x, i) => x + d.before[i])
    for (const [k, s] of Object.entries(d.days)) {
      const cur = days.get(k)
      days.set(k, cur ? cur.map((x, i) => x + s[i]) : [...s])
    }
    for (const [k, v] of Object.entries(d.early ?? {})) early.set(k, (early.get(k) ?? 0) + v)
  }
  return { days, early, before }
}

/** The calendar day after a 'YYYY-MM-DD' key. */
export function nextDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return dayKey(new Date(y, m - 1, d + 1, 12))
}

/**
 * Seconds in a 4 am to 4 am practice day (named by its start date): the calendar day without its early hours,
 * plus the early hours of the next day. Saves from before early hours were kept count by the calendar day.
 */
export function practiceDaySec(t: { days: Map<string, Secs>; early: Map<string, number> }, day: string): number {
  const own = sum(t.days.get(day) ?? zero()) - (t.early.get(day) ?? 0)
  return Math.max(0, own) + (t.early.get(nextDay(day)) ?? 0)
}
