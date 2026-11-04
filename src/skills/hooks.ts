// Shared plumbing for the skill games: guitar and keyboard input, practice time, a ticking clock.
import { useEffect, useReducer, useRef } from 'react'
import { engine } from '../audio/engine'
import { holdReload, practice } from '../account/activity'
import { KEYBOARD_DEVICE, defaultKeyOffsetMs, defaultOffsetMs, deviceKey, loadLatency } from '../lessons/calibration'

const STRUM_RATIO = 1.5 // a pick or strum attack, not a fret squeak
const STRUM_GAP_MS = 90 // one strum, not its echo

/** The latest value in a ref, so listeners subscribed once always see fresh props. */
export function useLatest<T>(v: T) {
  const r = useRef(v)
  useEffect(() => {
    r.current = v
  })
  return r
}

/** Seconds to subtract from a raw input time to get when it was really played (the Lessons calibration). */
export function inputOffsetSec(keyboard: boolean): number {
  if (keyboard) return (loadLatency(KEYBOARD_DEVICE)?.offsetMs ?? defaultKeyOffsetMs()) / 1000
  return (loadLatency(deviceKey())?.offsetMs ?? defaultOffsetMs()) / 1000
}

export interface GuitarHandlers {
  note?: (midi: number) => void // a new note's pitch
  strum?: (t: number) => void // raw audio time of a pick or strum attack
}

/** Listens to the guitar while `on`. */
export function useGuitar(on: boolean, h: GuitarHandlers) {
  const ref = useLatest(h)
  useEffect(() => {
    if (!on) return
    let last = -Infinity
    const offs = [
      engine.notes.on((m) => ref.current.note?.(m)),
      engine.onset.on((o) => {
        const ctx = engine.ctx
        if (!ctx || o.ratio < STRUM_RATIO) return
        const t = ctx.currentTime - o.ageSec
        if ((t - last) * 1000 < STRUM_GAP_MS) return
        last = t
        ref.current.strum?.(t)
      }),
    ]
    return () => offs.forEach((u) => u())
  }, [on, ref])
}

/** Keys while `on` (ignored while typing in a field). `t` is the raw audio time of the press. */
export function useKeys(on: boolean, fn: (key: string, t: number) => void) {
  const ref = useLatest(fn)
  useEffect(() => {
    if (!on) return
    const down = (ev: KeyboardEvent) => {
      if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return
      const el = ev.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      const k = ev.key.toLowerCase()
      if (k === ' ') ev.preventDefault()
      const ctx = engine.ctx
      const t = ctx ? ctx.currentTime - (performance.now() - ev.timeStamp) / 1000 : 0
      ref.current(k, t)
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [on, ref])
}

/** While a round runs: counts as lesson practice time and holds account reloads. */
export function useRoundActivity(running: boolean) {
  useEffect(() => {
    if (!running) return
    holdReload('skills', true)
    const stop = practice('lessons', true)
    return () => {
      holdReload('skills', false)
      stop?.()
    }
  }, [running])
}

/** Re-renders every `ms` while `on`. */
export function useTick(on: boolean, ms = 200) {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    if (!on) return
    const id = window.setInterval(force, ms)
    return () => window.clearInterval(id)
  }, [on, ms])
}
