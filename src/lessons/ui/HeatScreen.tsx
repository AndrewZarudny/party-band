// Trouble spots: where the player slips most over the last 60 days, on a fretboard and as a short list with drills.
import { useEffect, useRef, useState } from 'react'
import type { Progress } from '../types'
import { lessonById } from '../data'
import { READY_EVENTS, chordRows, decayed, heatBucket, heatEvents, heatReady, noteCells, noteNameRows, spotLabel, timingRows, topSpots } from '../heat'
import { FB_H, FB_W, fbNoteX, fbStringY } from '../fx/fretGeom'
import { Fretboard } from '../../components/Fretboard'
import './heat.css'

const TYPE_NAME = { notes: 'Notes', chords: 'Chords', rhythm: 'Rhythm' } as const

function leanText(ms: number | null): string {
  if (ms === null) return 'not enough yet'
  if (Math.abs(ms) < 10) return 'on time'
  return `${Math.round(Math.abs(ms))} ms ${ms < 0 ? 'early' : 'late'}`
}

export function HeatScreen({ progress, onDrill, onBack }: { progress: Progress; onDrill: (key: string) => void; onBack: () => void }) {
  const [now] = useState(() => new Date())
  const firstDrill = useRef<HTMLButtonElement>(null)
  const back = useRef<HTMLButtonElement>(null)
  const ready = heatReady(progress.heat, now)

  useEffect(() => {
    // Focus the first drill when there is one, else Back.
    const target = firstDrill.current ?? back.current
    target?.focus()
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  const cells = decayed(progress.heat, now)
  const spots = ready ? topSpots(progress.heat, now) : []
  const dots = noteCells(cells)
  const maxFret = Math.min(22, Math.max(12, ...dots.map((d) => d.fret + 2)))
  const names = noteNameRows(cells)
  const chords = chordRows(cells)
  const timing = timingRows(cells)

  return (
    <div className="hm">
      <button ref={back} className="ls-back" onClick={onBack} aria-label="Back to the map">
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="M10 3 5 8l5 5" />
        </svg>
        Back
      </button>
      <header className="hm-head">
        <h2 className="ls-display">Trouble spots</h2>
        <p className="ls-muted">From your last 60 days of lessons. Brighter means more slips.</p>
      </header>

      {!ready ? (
        <div className="hm-empty">
          <p>Play a few more lessons and your trouble spots show up here.</p>
          <p className="ls-muted">
            <span className="ls-num">{Math.min(READY_EVENTS, Math.floor(heatEvents(progress.heat, now)))}</span> of {READY_EVENTS} notes and chords so far.
          </p>
        </div>
      ) : (
        <>
          <section className="hm-map" aria-label="Fretboard heat map">
            <div className="hm-board">
              <div className="hm-board-in">
                <Fretboard markers={[]} maxFret={maxFret} />
                <svg className="hm-overlay" viewBox={`0 0 ${FB_W} ${FB_H}`} aria-hidden>
                  {dots.map((d) => (
                    <circle
                      key={`${d.string}.${d.fret}`}
                      className={`hm-dot h${heatBucket(d.heat)}`}
                      cx={fbNoteX(d.fret, maxFret)}
                      cy={fbStringY(d.string)}
                      r={7 + 7 * Math.min(1, d.n / 20)}
                      opacity={0.45 + 0.5 * Math.min(1, d.n / 12)}
                    />
                  ))}
                </svg>
              </div>
            </div>
            <p className="hm-legend ls-muted">
              <span className="hm-sw h0" aria-hidden /> Clean <span className="hm-sw h2" aria-hidden /> Some slips <span className="hm-sw h3" aria-hidden /> Many slips
            </p>
          </section>

          <section className="hm-spots" aria-labelledby="hm-spots-h">
            <h3 id="hm-spots-h" className="hm-h">
              Top trouble spots
            </h3>
            {spots.length ? (
              <ol className="hm-list">
                {spots.map((s, i) => {
                  const title = lessonById(s.lessonId)?.title ?? s.lessonId
                  const meta = s.kind === 'timing' ? `${s.n} timed hits · last in ${title}` : `${Math.round(s.rate * 100)}% of ${s.n} tries · last in ${title}`
                  return (
                    <li key={s.key} className="hm-spot">
                      <span className="hm-rank ls-num" aria-hidden>
                        {i + 1}
                      </span>
                      <div className="hm-spot-main">
                        <p className="hm-spot-text">
                          <strong>{s.text}</strong>
                        </p>
                        <p className="ls-muted">{s.advice}</p>
                        <p className="hm-meta ls-num">{meta}</p>
                      </div>
                      <button ref={i === 0 ? firstDrill : undefined} className="ls-btn small hm-drill" onClick={() => onDrill(s.key)} aria-label={`Drill: ${spotLabel(s.key)}`}>
                        Drill
                      </button>
                    </li>
                  )
                })}
              </ol>
            ) : (
              <p className="ls-muted">No clear trouble spots. Nice and even.</p>
            )}
          </section>

          <section className="hm-rows" aria-labelledby="hm-notes-h">
            <h3 id="hm-notes-h" className="hm-h">
              Notes
            </h3>
            <ul className="hm-chips">
              {names.map((r) => {
                const thin = r.n < 4
                return (
                  <li key={r.pc} className={`hm-chip ${thin ? 'thin' : `h${heatBucket(r.rate)}`}`} aria-label={thin ? `${r.name}: not enough yet` : `${r.name}: ${Math.round(r.rate * 100)}% slips`}>
                    <b>{r.name}</b> <span className="ls-num">{thin ? '–' : `${Math.round(r.rate * 100)}%`}</span>
                  </li>
                )
              })}
            </ul>
          </section>

          {chords.length > 0 && (
            <section className="hm-rows" aria-labelledby="hm-chords-h">
              <h3 id="hm-chords-h" className="hm-h">
                Chords
              </h3>
              <ul className="hm-chips">
                {chords.map((r) => (
                  <li key={r.symbol} className={`hm-chip h${heatBucket(r.rate)}`} aria-label={`${r.symbol}: ${Math.round(r.rate * 100)}% slips`}>
                    <b>{r.symbol}</b> <span className="ls-num">{Math.round(r.rate * 100)}%</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="hm-rows" aria-labelledby="hm-timing-h">
            <h3 id="hm-timing-h" className="hm-h">
              Timing
            </h3>
            <p className="hm-timing">
              {timing.map((t, i) => (
                <span key={t.type}>
                  {i > 0 && ' · '}
                  {TYPE_NAME[t.type]}: <span className="ls-num">{leanText(t.meanMs)}</span>
                </span>
              ))}
            </p>
          </section>
        </>
      )}
    </div>
  )
}
