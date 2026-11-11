// Runway effects: picks that fly off a hit, strings that shake, the beat's pulse, Roar's warm glow,
// the light that runs along the strings on a chain milestone, and the end-of-run sweep.
// Tiered by how often they happen: a clean hit gets a few picks, a miss only cracks and sinks, milestones a
// sweep and a 50 ms freeze of the decoration (the notes never stop: they are the timing cue).
// All state lives in preallocated arrays; nothing is created per frame. Times are rAF / performance.now() ms.
import type { Chart, ChartEvent } from '../types'
import type { RunwayColors } from '../runwayDraw'
import { fxBusFor } from './bus'
import type { FxBus, FxHit } from './bus'
import { LAYER_BACK, LAYER_FRONT, Particles, SHAPE_NOTE, SHAPE_PICK } from './particles'

// palette slots
const C_TARGET = 0
const C_TEXT = 1
const C_NEXT = 2
const C_ACCENT = 3
const C_CHORD = 4

// what happened to a judged event
const R_HIT = 1
const R_MISS = 2
const R_WRONG = 3

const RHYTHM = 6 // lane index of the rhythm lane
const HOLD_MS = 50
const SWEEP_MS = 560
const CELEBRATE_MS = 850
const STAGE_ORDER = [2, 1, 3, 0, 4] // stage lights come on from the middle out

/** How a judged pill is drawn this frame. */
export interface PillXf {
  dx: number
  dy: number
  sx: number
  sy: number
  rot: number
  alpha: number
  crack: boolean
}

const easeOutBack = (k: number) => {
  const c1 = 1.70158
  const m = k - 1
  return 1 + (c1 + 1) * m * m * m + c1 * m * m
}
const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - ((2 - 2 * k) * (2 - 2 * k)) / 2)
const easeOut = (k: number) => 1 - (1 - k) * (1 - k)

export class RunwayFx {
  /** reduced motion; follows the setting while the run plays */
  still: boolean
  dpr = 1
  /** the run is counting in or playing: the beat pulse runs */
  live = false
  /** 0–1, high right on a beat (stronger on beat 1) */
  pulse = 0
  /** 0–1, eases in when Roar starts and out fast when it ends */
  roarLevel = 0

  private bus: FxBus
  private seen: number
  private celebSeen: number
  private events: (ChartEvent | undefined)[] = []
  private judgedAt: Float64Array
  private react: Uint8Array
  private now = 0
  private dt = 0
  private holdUntil = 0
  // strings 0–5 and the rhythm lane: pluck strength, when, colour, and this frame's two standing modes
  private amp = new Float32Array(7)
  private hitAt = new Float64Array(7)
  private laneCol = new Uint8Array(7)
  private m1 = new Float32Array(7)
  private m3 = new Float32Array(7)
  private roarOn = false
  /** 0–1: how warmed up the stage is. Every hit lifts it, a miss or wrong note drops it; the stage lights follow. */
  private heat = 0
  private coolAt = -1e9
  private sweepAt = -1e9
  private sweepK = 0
  private celebrateAt = -1e9
  private emberAcc = 0
  private parts = new Particles()
  private palette: string[] = ['', '', '', '', '']
  private colors: RunwayColors | null = null
  private wash: CanvasGradient | null = null
  private washH = 0
  // geometry from the last begin()
  private beat = 0
  private left = 0
  private pickX = 0
  private ppb = 100
  private top = 0
  private gap = 10
  private w = 0

  constructor(run: { chart: Chart }, still: boolean) {
    this.still = still
    this.bus = fxBusFor(run)
    this.seen = this.bus.seq
    this.celebSeen = this.bus.celebrateSeq
    let maxId = 0
    for (const ev of run.chart.events) maxId = Math.max(maxId, ev.id)
    this.events = new Array<ChartEvent | undefined>(maxId + 1)
    for (const ev of run.chart.events) this.events[ev.id] = ev
    this.judgedAt = new Float64Array(maxId + 1)
    this.react = new Uint8Array(maxId + 1)
  }

  /** Called once per frame before drawing, with the frame's timestamp. */
  tick(now: number) {
    this.dt = this.now ? Math.min(0.05, Math.max(0, (now - this.now) / 1000)) : 0
    this.now = now
  }

  /** Geometry for this frame; drains new judgements and steps everything. Called by drawRunway. */
  begin(beat: number, left: number, pickX: number, ppb: number, top: number, gap: number, w: number, c: RunwayColors) {
    this.beat = beat
    this.left = left
    this.pickX = pickX
    this.ppb = ppb
    this.top = top
    this.gap = gap
    this.w = w
    if (c !== this.colors) {
      this.colors = c
      this.palette[C_TARGET] = c.target
      this.palette[C_TEXT] = c.text
      this.palette[C_NEXT] = c.next
      this.palette[C_ACCENT] = c.accent
      this.palette[C_CHORD] = c.chord
      this.wash = null
    }
    const now = this.now
    const dt = this.dt
    this.seen = this.bus.drain(this.seen, this.onHit)
    if (this.bus.celebrateSeq !== this.celebSeen) {
      this.celebSeen = this.bus.celebrateSeq
      this.celebrate()
    }

    if (this.live && !this.still) {
      const fl = Math.floor(beat)
      const down = ((fl % 4) + 4) % 4 === 0
      this.pulse = Math.exp(-(beat - fl) * 6) * (down ? 1 : 0.5)
    } else this.pulse = 0

    const target = this.roarOn ? 1 : 0
    if (this.still) this.roarLevel = target
    else this.roarLevel += (target - this.roarLevel) * (1 - Math.exp(-dt * (target ? 2.5 : 8)))

    for (let s = 0; s < 7; s++) {
      if (this.amp[s] <= 0) continue
      const age = (now - this.hitAt[s]) / 1000
      const env = this.amp[s] * Math.exp(-age * 6)
      if (env < 0.12) {
        this.amp[s] = 0
        this.m1[s] = 0
        this.m3[s] = 0
        continue
      }
      this.m1[s] = env * 0.7 * Math.sin(Math.PI * 2 * 13 * age)
      this.m3[s] = env * 0.45 * Math.sin(Math.PI * 2 * 21 * age + 1)
    }

    if (!this.still && this.roarLevel > 0.3) {
      this.emberAcc += dt * 8 * this.roarLevel
      while (this.emberAcc >= 1) {
        this.emberAcc--
        this.ember()
      }
    }
    // a milestone's hit-stop freezes the picks in flight for a moment; the scroll keeps time
    if (now >= this.holdUntil) this.parts.step(dt)
  }

  laneY(s: number) {
    return Math.round(this.top + (5 - s) * this.gap + this.gap / 2)
  }

  /** This frame's two standing-wave amplitudes (px) of a lane; both 0 when it is at rest. */
  mode1(s: number) {
    return this.m1[s]
  }
  mode3(s: number) {
    return this.m3[s]
  }

  /** 0–1 brief glow on a lane after a hit (kept in reduced motion: it is only colour). */
  glow(s: number) {
    const age = (this.now - this.hitAt[s]) / 1000
    return age >= 0 && age < 0.6 ? Math.exp(-age * 7) : 0
  }
  laneColor(s: number) {
    return this.palette[this.laneCol[s]]
  }
  /** Fills `o` with a judged pill's pop, fall or shake. False when the pill draws as usual. */
  pill(id: number, ghost: number, o: PillXf): boolean {
    const at = this.judgedAt[id]
    if (!at || this.still) return false
    const a = (this.now - at) / 1000
    o.dx = 0
    o.dy = 0
    o.sx = 1
    o.sy = 1
    o.rot = 0
    o.alpha = 1
    o.crack = false
    const r = this.react[id]
    if (r === R_HIT) {
      // squashed by the pick, springs back past round, then thins out into its picks
      if (a < 0.3) {
        const m = 1 - easeOutBack(a / 0.3)
        o.sx = 1 - 0.24 * m
        o.sy = 1 + 0.3 * m
      }
      if (a > 0.12) o.alpha = 1 - (1 - ghost) * Math.min(1, (a - 0.12) / 0.33)
      return true
    }
    if (r === R_MISS) {
      // misses are frequent for beginners: a crack and a small settle, and the pill stays as the record
      // (it already draws dimmed as missed, red tick included)
      o.crack = true
      o.dy = 5 * easeOut(Math.min(1, a / 0.25))
      return true
    }
    if (r === R_WRONG) {
      if (a >= 0.3) return false
      o.dx = 5 * (1 - a / 0.3) * Math.sin(a * 75)
      return true
    }
    return false
  }

  /** Behind the lanes: Roar's warm wash, the cool-down, drifting embers. */
  drawBack(g: CanvasRenderingContext2D, w: number, h: number) {
    const c = this.colors
    if (!c) return
    const r = this.roarLevel
    this.stage(g, w, h)
    if (r > 0.01) {
      if (!this.wash || this.washH !== h) {
        this.wash = g.createLinearGradient(0, h, 0, 0)
        this.wash.addColorStop(0, c.accent)
        this.wash.addColorStop(1, 'transparent')
        this.washH = h
      }
      g.globalAlpha = r * 0.2
      g.fillStyle = this.wash
      g.fillRect(0, 0, w, h)
      g.globalAlpha = r * 0.04
      g.fillStyle = c.accent
      g.fillRect(0, 0, w, h)
    }
    if (!this.still) {
      const cool = Math.exp(((this.coolAt - this.now) / 1000) * 5)
      if (cool > 0.02) {
        g.globalAlpha = cool * 0.12
        g.fillStyle = c.next
        g.fillRect(0, 0, w, h)
      }
    }
    g.globalAlpha = 1
    this.parts.draw(g, this.dpr, LAYER_BACK, this.palette, 0.45 * r)
  }

  /** Over the lanes, under the notes: the milestone sweep, so the fret numbers ahead stay readable. */
  drawMid(g: CanvasRenderingContext2D) {
    if (this.still) return
    const ks = (this.now - this.sweepAt) / SWEEP_MS
    if (ks >= 0 && ks < 1 && this.colors) this.sweep(g, ks, this.colors.accent, this.sweepK)
  }

  /** Over the notes, under the pick line: the end sweep (nothing left to read then) and the hit bursts. */
  drawFront(g: CanvasRenderingContext2D) {
    if (this.still) return
    const kc = (this.now - this.celebrateAt) / CELEBRATE_MS
    if (kc >= 0 && kc < 1 && this.colors) this.sweep(g, kc, this.colors.target, 1)
    this.parts.draw(g, this.dpr, LAYER_FRONT, this.palette, 1)
  }

  // ---- internals ----

  private onHit = (h: FxHit) => {
    if (h.roar !== this.roarOn) {
      if (h.roar && !this.still) for (let i = 0; i < 14; i++) this.ember()
      if (!h.roar) this.coolAt = this.now
      this.roarOn = h.roar
    }
    // a milestone plays whatever closed the chain (a clean rest counts too)
    if (h.milestone) {
      this.sweepAt = this.now
      this.sweepK = h.milestone >= 32 ? 1 : 0.75
      if (!this.still) this.holdUntil = this.now + HOLD_MS
    }
    const ev = this.events[h.eventId]
    if (!ev || ev.kind === 'rest') return
    const v = h.verdict
    const r = h.hit ? R_HIT : v === 'wrong' ? R_WRONG : v === 'miss' ? R_MISS : 0
    this.judgedAt[h.eventId] = this.now
    this.react[h.eventId] = r
    // The stage warms up hit by hit (about a dozen clean ones to full) and loses a light on a slip.
    if (r === R_HIT) this.heat = Math.min(1, this.heat + (v === 'perfect' ? 0.09 : v === 'good' ? 0.07 : 0.04))
    else if (r) this.heat = Math.max(0, this.heat - 0.2)
    if (r !== R_HIT) return
    const q = v === 'perfect' ? 1 : v === 'good' ? 0.7 : 0.45
    const col = v === 'perfect' ? C_TARGET : v === 'good' ? C_TEXT : C_NEXT
    // hits are the most frequent event: a few picks for perfect and good, early or late only glow
    const n = v === 'perfect' ? 4 : v === 'good' ? 2 : 0
    const x = this.pickX + (ev.beat - this.beat) * this.ppb
    if (ev.kind === 'note') {
      this.pluck(ev.string, q, col)
      this.burst(x, this.laneY(ev.string), q, col, n)
    } else if (ev.kind === 'chord') {
      for (let s = 0; s < 6; s++) if (ev.frets[s] >= 0) this.pluck(s, q * 0.8, col)
      // one burst from the middle of the chord, not one per string
      this.burst(x, (this.laneY(5) + this.laneY(0)) / 2, q, col, Math.round(n * 1.5))
    } else {
      this.pluck(RHYTHM, q, col)
      this.burst(x, this.laneY(-1), q * 0.7, col, n)
    }
  }

  private pluck(s: number, q: number, col: number) {
    this.amp[s] = this.still ? 0 : 1.6 + 2.6 * q
    this.hitAt[s] = this.now
    this.laneCol[s] = col
  }

  /** Small picks that fly back the way the note came (left), so the notes ahead stay clear. */
  private burst(x: number, y: number, q: number, col: number, n: number) {
    if (this.still) return
    for (let i = 0; i < n; i++) {
      const ang = Math.PI + (Math.random() - 0.5) * 2.3
      const sp = (90 + Math.random() * 190) * (0.6 + 0.4 * q)
      const size = (3 + Math.random() * 2.2) * (0.8 + 0.3 * q)
      this.parts.spawn(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp - 30, 0.32 + Math.random() * 0.3, size, SHAPE_PICK, col, LAYER_FRONT, 380, 2.6)
    }
  }

  /** A tiny pick or note that drifts up and left behind the runway while Roar lasts. */
  private ember() {
    const x = this.left + Math.random() * (this.w - this.left)
    const y = this.laneY(-1) + this.gap * (0.2 + Math.random() * 0.6)
    const shape = Math.random() < 0.5 ? SHAPE_PICK : SHAPE_NOTE
    const col = Math.random() < 0.6 ? C_ACCENT : C_CHORD
    this.parts.spawn(x, y, -(14 + Math.random() * 26), -(16 + Math.random() * 22), 2.4 + Math.random() * 1.6, 2.4 + Math.random() * 1.8, shape, col, LAYER_BACK, -3, 0.2)
  }

  private celebrate() {
    this.celebrateAt = this.now
    // the finish: every stage light on
    this.heat = 1
    if (this.still) return
    for (let s = 0; s < 6; s++) {
      this.amp[s] = 3.5
      this.hitAt[s] = this.now
      this.laneCol[s] = C_TARGET
    }
    for (let i = 0; i < 36; i++) {
      const x = this.left + Math.random() * (this.w - this.left)
      const y = this.laneY(Math.floor(Math.random() * 6))
      this.parts.spawn(x, y, (Math.random() - 0.5) * 120, -(60 + Math.random() * 140), 0.7 + Math.random() * 0.5, 2.8 + Math.random() * 2, SHAPE_PICK, i % 3 ? C_TARGET : C_ACCENT, LAYER_FRONT, 260, 1.2)
    }
  }

  /**
   * Stage lights behind the lanes: beams come on one by one as the stage warms up (middle first), sway slowly,
   * and breathe with the beat. Kept faint so the fret numbers stay the brightest thing. Reduced motion: no sway, no breathing.
   */
  private stage(g: CanvasRenderingContext2D, w: number, h: number) {
    const heat = this.heat
    if (heat < 0.04) return
    const t = this.still ? 0 : this.now / 1000
    // the closing sweep turns the lights up full for a moment
    const kc = (this.now - this.celebrateAt) / CELEBRATE_MS
    const finale = kc >= 0 && kc < 1 ? 1.6 * (1 - kc) : 0
    const lift = (this.still ? 0.8 : 0.65 + 0.35 * this.pulse) + finale
    for (let k = 0; k < 5; k++) {
      const on = Math.min(1, heat * 5 - k)
      if (on <= 0) break
      const i = STAGE_ORDER[k]
      const x0 = w * (0.14 + 0.18 * i)
      const x1 = x0 + Math.sin(t * (0.33 + 0.06 * i) + i * 1.7) * w * 0.06
      g.fillStyle = this.palette[i % 3 === 0 ? C_ACCENT : i % 3 === 1 ? C_CHORD : C_TARGET]
      // three nested cones give the beam a soft edge
      for (let j = 1; j <= 3; j++) {
        const spread = w * 0.035 * j
        g.globalAlpha = on * 0.045 * lift
        g.beginPath()
        g.moveTo(x0 - 3, 0)
        g.lineTo(x0 + 3, 0)
        g.lineTo(x1 + spread, h)
        g.lineTo(x1 - spread, h)
        g.closePath()
        g.fill()
      }
    }
    // the stage floor glows on the beat
    if (!this.still) {
      g.globalAlpha = heat * 0.16 * this.pulse
      g.fillStyle = this.palette[C_ACCENT]
      g.fillRect(0, h - 5, w, 5)
    }
    g.globalAlpha = 1
  }

  /** A band of light that runs left to right along the strings. */
  private sweep(g: CanvasRenderingContext2D, k: number, color: string, strength: number) {
    const x = this.left - 60 + (this.w - this.left + 120) * easeInOut(k)
    const fade = strength * (1 - k * 0.6)
    const y0 = this.laneY(5) - this.gap / 2
    const y1 = this.laneY(-1) + this.gap / 2
    g.fillStyle = color
    for (let j = -4; j <= 4; j++) {
      g.globalAlpha = (1 - Math.abs(j) / 5) * 0.07 * fade
      g.fillRect(x + j * 9 - 4.5, y0, 9, y1 - y0)
    }
    for (let s = 0; s < 6; s++) {
      const y = this.laneY(s)
      for (let j = -4; j <= 4; j++) {
        g.globalAlpha = (1 - Math.abs(j) / 5) * 0.85 * fade
        g.fillRect(x + j * 6 - 3, y - 1, 6, 3)
      }
    }
    g.globalAlpha = 1
  }
}
