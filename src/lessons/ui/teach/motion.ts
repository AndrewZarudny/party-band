// Easings, glides and the picking pendulum for the teaching demos. Pure: no DOM.
import type { PickDir } from '../../types'

export type Ease = (k: number) => number

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
export const clamp01 = (v: number) => clamp(v, 0, 1)
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of progress 0–1. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t
  const sy = (t: number) => ((ay * t + by) * t + cy) * t
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (k: number) => {
    if (k <= 0) return 0
    if (k >= 1) return 1
    // Newton first, bisection if the slope is too flat
    let t = k
    for (let i = 0; i < 6; i++) {
      const err = sx(t) - k
      const d = dx(t)
      if (Math.abs(err) < 1e-5) return sy(t)
      if (Math.abs(d) < 1e-6) break
      t -= err / d
    }
    let lo = 0
    let hi = 1
    t = k
    for (let i = 0; i < 20; i++) {
      const x = sx(t)
      if (Math.abs(x - k) < 1e-5) break
      if (x < k) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return sy(t)
  }
}

export const easeOut = cubicBezier(0.2, 0.8, 0.2, 1)
export const easeIn = cubicBezier(0.55, 0, 0.85, 0.35)
export const easeInOut = cubicBezier(0.65, 0, 0.35, 1)

/** Overshoots past 1 and settles back: the fingertip's contact squash. */
export function easeOutBack(k: number, overshoot = 1.4): number {
  const m = clamp01(k) - 1
  return 1 + (overshoot + 1) * m * m * m + overshoot * m * m
}

/** Tween of `t` seconds into a `dur` second move. */
export const tween = (t: number, dur: number, ease: Ease) => ease(clamp01(t / dur))

/**
 * The picking hand as a pendulum: y = amp * sin(PI t / g).
 * It crosses the string on every grid slot (t = k * g): down on even slots, up on odd ones.
 */
export function pendulum(tSec: number, gridSec: number, amp: number): { y: number; dir: PickDir } {
  const a = (Math.PI * tSec) / gridSec
  return { y: amp * Math.sin(a), dir: Math.cos(a) >= 0 ? 'D' : 'U' }
}

/** A number that glides to each new target over a set time. Time is any seconds clock. */
export class Glide {
  private from: number
  private to: number
  private t0 = 0
  private dur = 0
  private ease: Ease = easeInOut

  constructor(v: number) {
    this.from = v
    this.to = v
  }

  get target() {
    return this.to
  }

  /** Glide to `to`, starting at `now + delay`. Same target: nothing changes. */
  set(to: number, now: number, dur: number, ease: Ease, delay = 0) {
    if (to === this.to) return
    this.from = this.at(now)
    this.to = to
    this.t0 = now + delay
    this.dur = dur
    this.ease = ease
  }

  jump(v: number) {
    this.from = v
    this.to = v
    this.dur = 0
  }

  at(now: number): number {
    if (this.dur <= 0 || now >= this.t0 + this.dur) return this.to
    if (now <= this.t0) return this.from
    return lerp(this.from, this.to, this.ease((now - this.t0) / this.dur))
  }
}
