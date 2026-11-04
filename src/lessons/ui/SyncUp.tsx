import { useCallback, useEffect, useRef, useState } from 'react'
import { engine } from '../../audio/engine'
import type { SyncOutcome } from '../types'
import type { SyncState } from '../calibration'
import { SyncSession, micWarning, saveLatency } from '../calibration'
import { clicksMuted } from '../clock'
import { StarPips } from './LessonMap'

const CLICKS = 8

export function SyncUp({ lessonMode, keyboard, onDone }: { lessonMode: boolean; keyboard: boolean; onDone: (o: SyncOutcome | null, skipped: boolean) => void }) {
  const [state, setState] = useState<SyncState | null>(null)
  const [failed, setFailed] = useState(false)
  const [, bump] = useState(0)
  const session = useRef<SyncSession | null>(null)
  const primary = useRef<HTMLButtonElement>(null)

  const begin = useCallback(() => {
    session.current?.stop()
    setFailed(false)
    setState(null)
    const s = new SyncSession(setState, keyboard)
    session.current = s
    s.start().catch(() => setFailed(true))
  }, [keyboard])

  // Starts right away: the click that opened this screen lets the audio start.
  useEffect(() => {
    begin()
    return () => session.current?.stop()
  }, [begin])

  const outcome = state?.phase === 'done' ? state.outcome : null
  useEffect(() => {
    if (outcome) primary.current?.focus()
  }, [outcome])

  const save = () => {
    const s = session.current
    if (!outcome || !s) return
    if (outcome.ok) saveLatency({ v: 1, offsetMs: outcome.offsetMs, pitchLagMs: outcome.pitchLagMs, spreadMs: outcome.madMs, device: s.device, at: Date.now() })
    onDone(outcome, false)
  }

  const mic = keyboard ? null : micWarning()
  const muted = clicksMuted()
  const errs = state?.errs ?? []
  const idx = state?.phase === 'listening' ? state.clickIdx : -1

  return (
    <section className="ls-sync">
      <header>
        <h2 className="ls-display">{lessonMode ? 'Tap In' : 'Sync'}</h2>
        <p className="ls-goal">{keyboard ? 'Press Space on each click.' : 'Pluck the open A string on each click.'}</p>
      </header>

      {mic && <p className="ls-warn">{mic}</p>}
      {muted && (
        <p className="ls-warn">
          Your metronome volume is off.{' '}
          <button
            className="ls-link"
            onClick={() => {
              engine.setMetronomeLevel(1)
              bump((n) => n + 1)
              begin()
            }}
          >
            Turn it on
          </button>
        </p>
      )}

      <ol className="ls-sync-row" aria-label="Clicks">
        {Array.from({ length: CLICKS }, (_, i) => {
          const err = errs[i]
          const got = typeof err === 'number'
          const missed = err === null && (state?.phase === 'done' || i < idx)
          return (
            <li key={i} className={`ls-sync-dot ${got ? 'got' : ''} ${missed ? 'miss' : ''} ${i === idx ? 'now' : ''}`}>
              <svg viewBox="0 0 40 44" aria-hidden>
                <path d="M20 41C13 34 3 23 3 13.5 3 6 10.5 2.5 20 2.5S37 6 37 13.5C37 23 27 34 20 41Z" />
              </svg>
              <span className="ls-num">{got ? `${err > 0 ? '+' : ''}${Math.round(err)}` : missed ? '–' : ''}</span>
            </li>
          )
        })}
      </ol>
      <p className="ls-caption ls-sync-unit">ms early (−) or late (+) on each click</p>
      <p className="ls-muted ls-sync-phase" aria-live="polite">
        {failed ? "The audio didn't start." : !state ? 'Starting…' : state.phase === 'countin' ? 'Get ready: four clicks in.' : state.phase === 'listening' ? 'Now play with the click.' : ''}
      </p>

      {failed && (
        <div className="ls-actions">
          <button ref={primary} className="ls-btn primary" onClick={begin}>
            Start
          </button>
          <button className="ls-btn ghost" onClick={() => onDone(null, false)}>
            Back
          </button>
        </div>
      )}

      {outcome && (
        <div className="ls-sync-result">
          <StarPips stars={outcome.stars} />
          <p className="ls-sync-msg" aria-live="polite">{outcome.message}</p>
          <div className="ls-actions">
            {outcome.ok ? (
              <button ref={primary} className="ls-btn primary" onClick={save}>
                Save
              </button>
            ) : (
              <>
                <button ref={primary} className="ls-btn primary" onClick={begin}>
                  Try again
                </button>
                {lessonMode && outcome.captured >= 4 && (
                  <button className="ls-btn" onClick={() => onDone(outcome, false)}>
                    Continue
                  </button>
                )}
                <button className="ls-btn ghost" onClick={() => onDone(null, true)}>
                  Skip for now
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {!outcome && !failed && (
        <div className="ls-actions">
          <button className="ls-btn ghost" onClick={() => onDone(null, lessonMode)}>
            {lessonMode ? 'Skip for now' : 'Cancel'}
          </button>
        </div>
      )}
    </section>
  )
}
