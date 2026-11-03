import { useEffect, useReducer, useState } from 'react'
import { engine } from './engine'
import type { PitchFrame } from './engine'

/** Re-renders when engine settings change. */
export function useEngineState() {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => engine.state.on(force), [])
  return engine
}

/** Latest pitch frame, held briefly so the display doesn't flicker. */
export function usePitch() {
  const [frame, setFrame] = useState<PitchFrame | null>(null)
  useEffect(() => {
    let last = 0
    return engine.pitch.on((f) => {
      const now = performance.now()
      if (f) {
        last = now
        setFrame(f)
      } else if (now - last > 250) setFrame(null)
    })
  }, [])
  return frame
}

export function useLevel() {
  const [level, setLevel] = useState(0)
  useEffect(() => {
    let n = 0
    return engine.level.on((rms) => {
      if (n++ % 3 === 0) setLevel(rms)
    })
  }, [])
  return level
}

/** Calls `fn` for each detected note onset (MIDI number). */
export function useNoteOn(fn: (midi: number) => void) {
  useEffect(() => engine.notes.on(fn), [fn])
}
