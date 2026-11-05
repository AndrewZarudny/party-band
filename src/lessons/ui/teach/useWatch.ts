// Watch: plays the lesson (band and lead) from a bar, for the overview's playhead and the hand demos.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Chart, Lesson, Prefs } from '../../types'
import { LessonRun } from '../../run'
import { loopLesson, sliceChart } from '../../loop'

export type WatchSpeed = 0.5 | 0.75 | 1

export interface Watch {
  /** The bar watching started from, or null when not watching. */
  from: number | null
  speed: WatchSpeed
  setSpeed: (s: WatchSpeed) => void
  /** Bpm of the running watch (for the demos' tweens). */
  bpm: number
  start: (fromBar: number) => void
  stop: () => void
  /** Full-chart beat now (negative offsets from `from` during the count-in), or null when not watching. */
  beatNow: () => number | null
  /** Count-in number (4, 3, 2, 1) or null once the music runs. */
  countIn: () => number | null
}

export function useWatch(lesson: Lesson, chart: Chart | null, prefs: Prefs): Watch {
  const [from, setFrom] = useState<number | null>(null)
  const [speed, setSpeedState] = useState<WatchSpeed>(0.75)
  const runRef = useRef<{ run: LessonRun; from: number } | null>(null)

  const stop = useCallback(() => {
    const cur = runRef.current
    runRef.current = null
    if (cur) {
      cur.run.onState = null
      cur.run.stop()
    }
    setFrom(null)
  }, [])

  const begin = useCallback(
    (bar: number, sp: WatchSpeed) => {
      if (!chart) return
      const old = runRef.current
      if (old) {
        old.run.onState = null
        old.run.stop()
      }
      const last = lesson.bars - 1
      const b = Math.max(0, Math.min(last, bar))
      let run: LessonRun
      try {
        run = new LessonRun({
          lesson: b > 0 ? loopLesson(lesson, b, last, 1) : lesson,
          chart: b > 0 ? sliceChart(chart, b, last, 1) : chart,
          speed: sp,
          easyTiming: false,
          backingOn: prefs.backingOn,
          keyboard: true,
          listen: true,
        })
      } catch {
        runRef.current = null
        setFrom(null)
        return
      }
      runRef.current = { run, from: b }
      run.onState = (s) => {
        if ((s === 'ended' || s === 'stopped') && runRef.current?.run === run) {
          runRef.current = null
          setFrom(null)
        }
      }
      setFrom(b)
      void run.start().catch(() => {
        if (runRef.current?.run === run) stop()
      })
    },
    [chart, lesson, prefs.backingOn, stop],
  )

  const start = useCallback((bar: number) => begin(bar, speed), [begin, speed])

  const setSpeed = useCallback(
    (s: WatchSpeed) => {
      setSpeedState(s)
      // a running watch restarts at the new speed from the bar it is in
      const cur = runRef.current
      if (cur) {
        const beat = cur.run.visualBeat(prefs.visualNudgeMs)
        begin(cur.from + Math.max(0, Math.floor(beat / 4)), s)
      }
    },
    [begin, prefs.visualNudgeMs],
  )

  const nudge = prefs.visualNudgeMs
  const beatNow = useCallback((): number | null => {
    const cur = runRef.current
    if (!cur) return null
    return cur.from * 4 + cur.run.visualBeat(nudge)
  }, [nudge])

  const countIn = useCallback((): number | null => {
    const cur = runRef.current
    if (!cur) return null
    const b = cur.run.visualBeat(nudge)
    return b < 0 ? Math.ceil(-b) : null
  }, [nudge])

  // Stop when the page hides, and on unmount.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') stop()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      const cur = runRef.current
      runRef.current = null
      if (cur) {
        cur.run.onState = null
        cur.run.stop()
      }
    }
  }, [stop])

  const bpm = Math.round(lesson.bpm * speed)
  return { from, speed, setSpeed, bpm, start, stop, beatNow, countIn }
}
