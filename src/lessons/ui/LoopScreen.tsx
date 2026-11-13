import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChartEvent, ChordEv, Cosmetic, DinoMood, LoopSpec, LoopSummary, NoteEv, Prefs } from '../types'
import { LoopSession } from '../loop'
import type { LoopView } from '../loop'
import type { LessonRun } from '../run'
import { autoplayFromUrl } from '../run'
import { VERDICT_LABEL } from '../scoring'
import { bpmAt } from '../speed'
import { RestTimer } from './RestTimer'
import { engine } from '../../audio/engine'
import { Fretboard } from '../../components/Fretboard'
import type { Marker } from '../../components/Fretboard'
import { ChordDiagram } from '../../components/PartViews'
import { Dino } from './Dino'
import { Runway } from './Runway'
import { fingeringFor, guidesOn } from '../fingering'
import { fxBusFor } from '../fx/bus'
import { holdReload, practice } from '../../account/activity'
import './play.css'
import './loop.css'
import './timing.css'

const DOTS = 8 // pass dots shown

function firstPlayable(events: ChartEvent[]): ChartEvent | null {
  for (const ev of events) if (ev.kind !== 'rest') return ev
  return null
}

/** The next event to play, or the first one before the judge exists. */
function pendingOf(r: LessonRun | null): ChartEvent | null {
  if (!r) return null
  try {
    return r.pendingEvent() ?? (r.state === 'idle' || r.state === 'countin' ? firstPlayable(r.chart.events) : null)
  } catch {
    return firstPlayable(r.chart.events)
  }
}

function chordFrom(events: ChartEvent[], fromBeat: number, notSymbol?: string): ChordEv | null {
  for (const ev of events) if (ev.kind === 'chord' && ev.beat >= fromBeat && ev.symbol !== notSymbol) return ev
  return null
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" />
      <rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" />
    </svg>
  )
}

/** Loop the hard part (or a drill): fast passes, slow relaxed passes, a rest, again. A tempo is earned by 3 clean passes. No XP, no stars. */
export function LoopScreen({
  spec,
  prefs,
  stage,
  cosmetics,
  onExit,
  onConnect,
}: {
  spec: LoopSpec
  prefs: Prefs
  stage: number
  cosmetics: Cosmetic[]
  onExit: (s: LoopSummary | null, next: 'full' | 'back') => void
  onConnect: () => void
}) {
  const [session, setSession] = useState<LoopSession | null>(null)
  const [view, setView] = useState<LoopView | null>(null)
  const [run, setRun] = useState<LessonRun | null>(null)
  const [segKey, setSegKey] = useState(0)
  const [next, setNext] = useState<ChartEvent | null>(null)
  const [disc, setDisc] = useState(false)
  const [keyboardMode] = useState(() => prefs.keyboard || !engine.running)
  const cardRef = useRef<HTMLDivElement>(null)
  const exited = useRef(false)
  const live = useRef({ prefs })
  useEffect(() => {
    live.current = { prefs }
  })

  // A loop (even paused) isn't reloaded away under the player.
  useEffect(() => {
    holdReload('loop', true)
    return () => holdReload('loop', false)
  }, [])

  // One session per effect run, so StrictMode's double effect gets a fresh one.
  useEffect(() => {
    const p = live.current.prefs
    const s = new LoopSession(spec, {
      easyTiming: p.easyTiming,
      backingOn: p.backingOn,
      keyboard: p.keyboard,
      mic: p.input === 'mic',
      autoplay: autoplayFromUrl(),
    })
    let cancelled = false
    s.onChange = (v) => {
      if (cancelled) return
      setView(v)
      setNext(pendingOf(s.run))
    }
    s.onRun = (r) => {
      if (cancelled) return
      setRun(r)
      setSegKey((k) => k + 1)
    }
    s.onJudge = (r, rn) => {
      if (!cancelled) fxBusFor(rn).push(r, 0, rn.hud.roar)
    }
    setSession(s)
    setView(s.view)
    s.start()
    return () => {
      cancelled = true
      s.stop()
    }
  }, [spec])

  const phase = view?.phase ?? 'idle'
  const playing = phase === 'countin' || phase === 'playing'
  // Practice time counts while a segment counts in or plays.
  useEffect(() => practice('lessons', playing), [playing])

  // Esc / P pause, and so does hiding the tab; the guitar dropping out pauses with its own card.
  useEffect(() => {
    if (!session) return
    const active = () => {
      const ph = session.view.phase
      return ph === 'idle' || ph === 'countin' || ph === 'playing' || ph === 'change' || ph === 'rest'
    }
    const pause = () => {
      if (active()) session.pause()
    }
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && t.closest('input, select, textarea')) return
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') pause()
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') pause()
    }
    const offState = engine.state.on(() => {
      if (keyboardMode || engine.running || !active()) return
      setDisc(true)
      session.pause()
    })
    window.addEventListener('keydown', onKey)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('visibilitychange', onVis)
      offState()
    }
  }, [session, keyboardMode])

  const card = phase === 'paused' ? (disc ? 'disconnected' : 'paused') : phase === 'error' || phase === 'done' ? phase : null
  // Focus the first button of a card when it opens, so Enter or Space works right away.
  useEffect(() => {
    if (card) cardRef.current?.querySelector('button')?.focus()
  }, [card])

  const exit = (to: 'full' | 'back') => {
    if (exited.current || !session) return
    exited.current = true
    session.stop()
    onExit(session.summary(), to)
  }
  const resume = () => {
    setDisc(false)
    session?.resume()
  }
  const again = () => session?.start(spec.startSpeed)

  const lesson = spec.lesson
  const chart = session?.chart ?? null
  // finger hints travel on the sliced notes, so the loop's own chart gets the same fingers
  const fingering = useMemo(() => (run ? fingeringFor(run.lesson, run.chart) : null), [run])
  const guides = guidesOn(prefs, lesson) ? fingering : null
  const helper = useMemo(() => {
    if (!chart) return null
    if (lesson.type === 'chords' || lesson.type === 'rhythm') {
      const cur = next && next.kind === 'chord' ? next : chordFrom(chart.events, next ? next.beat : 0)
      const after = cur ? chordFrom(chart.events, cur.beat, cur.symbol) : null
      return { kind: 'chords' as const, cur, after }
    }
    const notes = chart.events.filter((e): e is NoteEv => e.kind === 'note')
    const top = notes.reduce((m, e) => Math.max(m, e.fret), 0)
    const n = next && next.kind === 'note' && !next.hidden ? next : null
    const markers: Marker[] = n ? [{ string: n.string, fret: n.fret, kind: 'next' }] : []
    return { kind: 'notes' as const, markers, maxFret: Math.max(12, top + 3) }
  }, [chart, lesson.type, next])

  const v = view
  const passes = v?.passes ?? []
  const dots = passes.slice(-DOTS)
  const dotsClean = dots.filter((x) => x.clean).length
  const live2 = v?.live ?? { good: 0, judged: 0, total: 0 }
  const fill = live2.good / Math.max(1, live2.total)
  const target = spec.targetSpeed
  const drill = spec.kind === 'drill'
  const bpm = (s: number) => bpmAt(lesson, s)
  const seg = v?.seg ?? 'fast'
  const banner = phase === 'countin' && passes.length === 0 ? 'One bar to count in.' : (v?.note ?? null)
  const mood: DinoMood = phase === 'done' ? 'proud' : phase === 'countin' ? 'focus' : 'idle'

  return (
    <div className="lp-play lo-play">
      <header className="lp-top">
        <button className="lp-pause" onClick={() => session?.pause()} aria-label="Pause (Esc)" title="Pause (Esc)" disabled={!playing && phase !== 'change' && phase !== 'rest'}>
          <PauseIcon />
        </button>
        <div className="lp-title">
          <h2>{spec.title}</h2>
          <p className="ls-muted lo-sub" title={drill ? lesson.goal : lesson.title}>
            {drill ? lesson.goal : lesson.title}
          </p>
        </div>
        <div className="lp-dino">
          <Dino stage={stage} mood={mood} size={56} cosmetics={cosmetics} />
        </div>
      </header>

      <div className="lo-stats">
        <div className="lo-stat lo-speed">
          <span>
            BPM <i className={`tm-seg ${seg}`}>{seg === 'fast' ? 'Fast' : 'Slow, relaxed'}</i>
          </span>
          <b className="ls-num">{bpm(v?.speed ?? spec.startSpeed)}</b>
          <em className="ls-muted">
            to <span className="ls-num">{bpm(target)}</span>
          </em>
        </div>
        <div className="lo-stat">
          <span>Passes</span>
          <b className="ls-num">{passes.length}</b>
        </div>
        <div className="lo-stat">
          <span>Clean</span>
          <b className="ls-num">{v?.clean ?? 0}</b>
        </div>
        <ol className="lo-dots" aria-label={`Last passes: ${dotsClean} clean of ${dots.length}`}>
          {Array.from({ length: DOTS }, (_, i) => {
            const d = dots[i]
            const cls = d ? `${d.clean ? 'clean' : 'miss'}${d.slow ? ' slow' : ''}` : 'todo'
            return <li key={i} className={cls} />
          })}
        </ol>
      </div>

      <div className="lo-meter" aria-hidden="true">
        <span>This pass</span>
        <div className="lo-meter-bar">
          <i style={{ transform: `scaleX(${Math.min(1, fill)})` }} />
          <b />
        </div>
      </div>

      <div className="lp-stage">
        {run && <Runway key={segKey} run={run} zoom={prefs.zoom} nudgeMs={prefs.visualNudgeMs} guides={guides} />}
        {v?.last && (
          <span key={v.vKey} className={`lp-verdict v-${v.last}`}>
            {VERDICT_LABEL[v.last]}
          </span>
        )}
        {phase === 'rest' && session && v ? (
          <div className="tm-rest-stage">
            <p>Rest {v.restLeft} s. Shake out your hands.</p>
            <RestTimer sec={v.restLeft} onDone={() => session.skipRest()} />
            <p className="ls-muted">
              Next: <span className="ls-num">{bpm(v.work)}</span> BPM.
            </p>
          </div>
        ) : (
          <p className="lo-banner" aria-live="polite">
            {banner && <span key={banner}>{banner}</span>}
          </p>
        )}
        {card && (
          <div className="lp-scrim">
            <div className="lp-card" ref={cardRef} role="dialog" aria-modal="true" aria-labelledby="lo-card-h">
              {card === 'paused' && (
                <>
                  <h3 id="lo-card-h">Paused</h3>
                  <p>Your clean passes so far are kept.</p>
                  <div className="lp-card-btns">
                    <button className="ls-btn primary" onClick={resume} data-pedal="go">
                      Resume
                    </button>
                    {!drill && (
                      <button className="ls-btn" onClick={() => exit('full')}>
                        Back to the full lesson
                      </button>
                    )}
                    <button className="ls-btn" onClick={() => exit('back')}>
                      Done
                    </button>
                  </div>
                </>
              )}
              {card === 'disconnected' && (
                <>
                  <h3 id="lo-card-h">Guitar disconnected</h3>
                  <p>Plug it back in and connect it, then resume the loop.</p>
                  <div className="lp-card-btns">
                    <button className="ls-btn primary" onClick={onConnect}>
                      Connect
                    </button>
                    <button className="ls-btn" onClick={resume}>
                      Resume
                    </button>
                    <button className="ls-btn" onClick={() => exit('back')}>
                      Done
                    </button>
                  </div>
                </>
              )}
              {card === 'error' && (
                <>
                  <h3 id="lo-card-h">Couldn't start the sound</h3>
                  <p>Check your audio device, then try again.</p>
                  <div className="lp-card-btns">
                    <button className="ls-btn primary" onClick={resume} data-pedal="go">
                      Try again
                    </button>
                    <button className="ls-btn" onClick={() => exit('back')}>
                      Done
                    </button>
                  </div>
                </>
              )}
              {card === 'done' && (
                <>
                  <h3 id="lo-card-h">{drill ? 'Drill done' : 'Loop locked in'}</h3>
                  <p>
                    Clean three times at <b className="ls-num">{bpm(target)}</b> BPM, after <b className="ls-num">{passes.length}</b> passes.
                  </p>
                  <div className="lp-card-btns">
                    {drill ? (
                      <>
                        <button className="ls-btn primary" onClick={() => exit('back')} data-pedal="go">
                          Done
                        </button>
                        <button className="ls-btn" onClick={again}>
                          Drill again
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="ls-btn primary" onClick={() => exit('full')} data-pedal="go">
                          Back to the full lesson
                        </button>
                        <button className="ls-btn" onClick={again}>
                          Loop again
                        </button>
                        <button className="ls-btn" onClick={() => exit('back')}>
                          Done
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {helper?.kind === 'chords' && (helper.cur || helper.after) && (
        <div className="lp-chords">
          {helper.cur && (
            <figure className="lp-chord now">
              <ChordDiagram shape={{ frets: helper.cur.frets }} name={helper.cur.symbol} size={1} />
              <figcaption>Now</figcaption>
            </figure>
          )}
          {helper.after && (
            <figure className="lp-chord">
              <ChordDiagram shape={{ frets: helper.after.frets }} name={helper.after.symbol} size={1} />
              <figcaption>Next</figcaption>
            </figure>
          )}
        </div>
      )}

      {prefs.showFretboard && helper?.kind === 'notes' && (
        <div className="lp-fretboard">
          <Fretboard markers={helper.markers} maxFret={helper.maxFret} />
        </div>
      )}

      {keyboardMode && (
        <p className="lp-keys">
          <kbd>Space</kbd> = play the note · <kbd>1</kbd>–<kbd>6</kbd> = string (1 = high e) · <kbd>X</kbd> = wrong note · <kbd>M</kbd> = mute · <kbd>Esc</kbd> = pause
        </p>
      )}
    </div>
  )
}
