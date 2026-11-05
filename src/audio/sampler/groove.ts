// Human feel for the sampled band: per-slot timing offsets and drum velocities taken from real
// drummers (grooves.json, from the Groove MIDI Dataset), looked up by feel.
import type { Feel } from '../../music/parts'
import { FEELS } from '../../music/parts'
import raw from './grooves.json'
import type { GrooveFeel, Grooves } from './types'

/** No slot moves more than this; beat 1 of a bar never moves. */
export const MAX_OFFSET_MS = 15
const MAX_JITTER_MS = 4

export interface Groove {
  offsets: Float64Array // seconds per 8th slot, slot 0 = 0
  kick: Float64Array // 0..1, 0 = no data
  snare: Float64Array
  hat: Float64Array
  jitter: number // seconds
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function slots(a: unknown, f: (v: number, i: number) => number): Float64Array {
  const out = new Float64Array(8)
  for (let i = 0; i < 8; i++) {
    const v = Array.isArray(a) ? Number(a[i]) : 0
    out[i] = f(Number.isFinite(v) ? v : 0, i)
  }
  return out
}

function normalise(g: GrooveFeel | undefined): Groove {
  return {
    offsets: slots(g?.offsetsMs, (v, i) => (i === 0 ? 0 : clamp(v, -MAX_OFFSET_MS, MAX_OFFSET_MS) / 1000)),
    kick: slots(g?.velocities?.kick, (v) => clamp(v, 0, 1)),
    snare: slots(g?.velocities?.snare, (v) => clamp(v, 0, 1)),
    hat: slots(g?.velocities?.hat, (v) => clamp(v, 0, 1)),
    jitter: clamp(Number(g?.jitterMs) || 0, 0, MAX_JITTER_MS) / 1000,
  }
}

/**
 * Scales one drum's velocities so its loudest hit in the pattern reaches `top`: the drummer's
 * accents stay, but a softly played source recording doesn't make that feel's drums quiet.
 */
function level(v: Float64Array, pattern: string, top: number) {
  let max = 0
  for (let i = 0; i < 8; i++) if (pattern[i] === 'x') max = Math.max(max, v[i])
  if (max <= 0.05) return
  const k = clamp(top / max, 0.5, 3)
  for (let i = 0; i < 8; i++) v[i] = clamp(v[i] * k, 0, 1)
}

const data = raw as unknown as Grooves
const byFeel = new Map<Feel, Groove>()
for (const [id, feel] of Object.entries(FEELS)) {
  // a feel with no groove data borrows the blues groove when it swings, else pop
  const g = normalise(data.feels?.[id] ?? (feel.swing ? data.feels?.blues : undefined) ?? data.feels?.pop)
  const top = id === 'ballad' || id === 'slowblues' ? 0.72 : 0.9
  level(g.kick, feel.drums.kick, top)
  level(g.snare, feel.drums.snare, top)
  level(g.hat, feel.drums.hat, top * 0.9)
  byFeel.set(feel, g)
}
const plain = normalise(undefined)

export const grooveFor = (feel: Feel): Groove => byFeel.get(feel) ?? plain

/** The time to play slot `step` at: `t` plus the groove offset and a little jitter, slot 0 untouched. */
export function humanise(g: Groove, step: number, t: number): number {
  if (step === 0) return t
  const d = g.offsets[step] + (Math.random() * 2 - 1) * g.jitter
  return t + clamp(d, -MAX_OFFSET_MS / 1000, MAX_OFFSET_MS / 1000)
}
