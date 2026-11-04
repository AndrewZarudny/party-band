import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChartEvent, ChordEv, Cosmetic, DinoMood, Lesson, LessonResult, NoteEv, Prefs, RunState, Speed, Verdict } from '../types'
import { LessonRun, autoplayFromUrl } from '../run'
import { MIN_SPEED } from '../speed'
import { VERDICT_LABEL } from '../scoring'
import { chordPcs, scalePcsOf } from '../improv'
import { engine } from '../../audio/engine'
import { Fretboard } from '../../components/Fretboard'
import type { Marker } from '../../components/Fretboard'
import { ChordDiagram } from '../../components/PartViews'
import { boxNotes } from '../../music/phrase'
import { midiName, nearestPosition, noteName, pc } from '../../music/theory'
import { Dino } from './Dino'
import { Runway } from './Runway'
import { FretFx } from './FretFx'
import { fxBusFor } from '../fx/bus'
import { prefersStill } from '../runwayDraw'
import { holdReload, practice } from '../../account/activity'
import './play.css'

type Overlay = 'paused' | 'disconnected' | 'error' | 'listened' | null

interface Hud {
  points: number
  chain: number
  roar: boolean
  verdict: Verdict | null
  vKey: number
  milestone: string | null
  mKey: number
  next: ChartEvent | null
  lastMidi: number | null
  wrong: { heard: number | null; wanted: number } | null // the last wrong note, kept until the next one
}

const EMPTY_HUD: Hud = { points: 0, chain: 0, roar: false, verdict: null, vKey: 0, milestone: null, mKey: 0, next: null, lastMidi: null, wrong: null }
const ROAR_AT = 16
const MOOD_MS: Partial<Record<DinoMood, number>> = { happy: 450, oops: 380, sad: 2600 }
const END_SWEEP_MS = 900 // a good run's closing sweep on the runway, before the results

function setMoodClass(svg: Element, m: DinoMood) {
  for (const c of Array.from(svg.classList)) if (c.startsWith('mood-')) svg.classList.remove(c)
  svg.classList.add(`mood-${m}`)
}

function firstPlayable(events: ChartEvent[]): ChartEvent | null {
  for (const ev of events) if (ev.kind !== 'rest') return ev
  return null
}

/** pendingEvent() only makes sense once the run has its judge; be safe before that. */
function pendingOf(r: LessonRun): ChartEvent | null {
  try {
    return r.pendingEvent()
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

export function PlayScreen({
  lesson,
  prefs,
  speed,
  stage,
  cosmetics,
  onPrefs,
  onEnd,
  onQuit,
  onSlower,
  onConnect,
  listen = false,
}: {
  lesson: Lesson
  prefs: Prefs
  /** Share of the lesson tempo for this run (the speed trainer's pick). */
  speed: Speed
  stage: number
  cosmetics: Cosmetic[]
  onPrefs: (p: Prefs) => void
  onEnd: (r: LessonResult) => void
  onQuit: () => void
  onSlower: () => void
  onConnect: () => void
  /** Demo playback ("Listen first"): no judging, no result. */
  listen?: boolean
}) {
  const [attempt, setAttempt] = useState(0)
  // A lesson run (even paused) isn't reloaded away under the player.
  useEffect(() => {
    holdReload('lesson', true)
    return () => holdReload('lesson', false)
  }, [])
  const [run, setRun] = useState<LessonRun | null>(null)
  const [runState, setRunState] = useState<RunState>('idle')
  // Practice time counts while the run counts in or plays (not paused, not on the result card).
  useEffect(() => practice('lessons', runState === 'countin' || runState === 'playing'), [runState])
  const [hud, setHud] = useState<Hud>(EMPTY_HUD)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [keyboardMode, setKeyboardMode] = useState(false)
  const [roarTip, setRoarTip] = useState(false)
  const [sad, setSad] = useState(false)
  const [improv, setImprov] = useState<{ chord: string; chips: { beat: number; midi: number; kind: 'chord' | 'scale' | 'out' }[] }>({ chord: '', chips: [] })

  // Latest props for callbacks that live as long as a run.
  const live = useRef({ lesson, prefs, listen, onEnd, onPrefs, speed })
  useEffect(() => {
    live.current = { lesson, prefs, listen, onEnd, onPrefs, speed }
  })

  const dinoRef = useRef<HTMLDivElement>(null)
  const progressRef = useRef<HTMLElement>(null)
  const bendRef = useRef<HTMLDivElement>(null)
  const bendFillRef = useRef<HTMLElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const baseMoodRef = useRef<DinoMood>('idle')

  // One run per attempt. Created here (not during render) so StrictMode's double effect gets a fresh run each time.
  useEffect(() => {
    let moodTimer = 0
    let lastHappy = 0
    /** A momentary mood on the dino: swaps its mood-* class without a React render. */
    const flashMood = (m: DinoMood) => {
      const svg = dinoRef.current?.querySelector('svg.dino')
      if (!svg) return
      setMoodClass(svg, m)
      // restart the CSS animation even when the same mood fires twice in a row
      void svg.getBoundingClientRect()
      window.clearTimeout(moodTimer)
      moodTimer = window.setTimeout(() => setMoodClass(svg, baseMoodRef.current), MOOD_MS[m] ?? 500)
    }

    const p = live.current.prefs
    const isListen = live.current.listen
    const r = new LessonRun({
      lesson,
      speed: live.current.speed,
      easyTiming: p.easyTiming,
      backingOn: p.backingOn,
      keyboard: p.keyboard,
      mic: p.input === 'mic',
      listen: isListen,
      autoplay: autoplayFromUrl(),
    })
    let cancelled = false
    let misses = 0
    let roarSeen = false
    setRun(r)
    setRunState('idle')
    setHud({ ...EMPTY_HUD, next: firstPlayable(r.chart.events) })
    setOverlay(null)
    setSad(false)
    setKeyboardMode(p.keyboard || !engine.running)

    r.onState = (s) => {
      if (cancelled) return
      setRunState(s)
      if (s === 'countin' || s === 'playing') setHud((h) => (h.next ? h : { ...h, next: pendingOf(r) }))
      if (s === 'ended' && live.current.listen) setOverlay('listened')
    }
    r.onJudge = (res, milestone) => {
      if (cancelled) return
      const h = r.hud
      fxBusFor(r).push(res, milestone ? h.chain : 0, h.roar)
      const bad = res.verdict === 'miss' || res.verdict === 'wrong' || res.verdict === 'ringing'
      if (bad) {
        misses++
        if (misses === 4) {
          flashMood('sad')
          setSad(true)
          window.setTimeout(() => setSad(false), MOOD_MS.sad)
        } else if (misses < 4) flashMood('oops')
      } else if (res.grade !== 'miss') {
        misses = 0
        // a hop on milestones, and on perfect hits at most about once a second, so it stays a reward
        const now = performance.now()
        if (milestone || (res.verdict === 'perfect' && now - lastHappy > 1200)) {
          lastHappy = now
          flashMood('happy')
        }
      }
      if (h.roar && !roarSeen) {
        roarSeen = true
        if (!live.current.prefs.seenRoar) {
          setRoarTip(true)
          window.setTimeout(() => {
            setRoarTip(false)
            live.current.onPrefs({ ...live.current.prefs, seenRoar: true })
          }, 4000)
        }
      }
      const ev = res.verdict === 'wrong' ? r.chart.events.find((x) => x.id === res.eventId) : undefined
      const wrong = ev && ev.kind === 'note' ? { heard: res.played ?? null, wanted: ev.midi } : null
      setHud((prev) => ({
        wrong: wrong ?? prev.wrong,
        points: h.points,
        chain: h.chain,
        roar: h.roar,
        verdict: res.verdict,
        vKey: prev.vKey + 1,
        milestone: milestone ?? prev.milestone,
        mKey: milestone ? prev.mKey + 1 : prev.mKey,
        next: pendingOf(r),
        lastMidi: h.lastPlayed,
      }))
    }
    let endTimer = 0
    let endHeld: LessonResult | null = null
    r.onEnd = (result) => {
      if (cancelled) return
      if (live.current.listen) setOverlay('listened')
      else if (result.stars >= 2 && !prefersStill()) {
        // two stars or more: a short sweep along the strings, then the results
        fxBusFor(r).celebrate()
        endHeld = result
        endTimer = window.setTimeout(() => {
          endHeld = null
          if (!cancelled) live.current.onEnd(result)
        }, END_SWEEP_MS)
      } else live.current.onEnd(result)
    }
    r.start()
      .then(() => {
        if (cancelled) r.stop()
      })
      .catch((err: unknown) => {
        console.error('Lesson run failed to start', err)
        r.stop()
        if (!cancelled) setOverlay('error')
      })
    return () => {
      cancelled = true
      r.stop()
      window.clearTimeout(moodTimer)
      // leaving during the closing sweep still hands over the result
      window.clearTimeout(endTimer)
      if (endHeld) live.current.onEnd(endHeld)
    }
  }, [lesson, attempt])

  // Esc / P pause, and so does hiding the tab. A stopped run can't resume: the card offers a restart.
  useEffect(() => {
    if (!run) return
    const active = () => run.state === 'countin' || run.state === 'playing' || run.state === 'idle'
    const pause = () => {
      if (!active()) return
      run.stop()
      setOverlay('paused')
    }
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && t.closest('input, select, textarea')) return
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') pause()
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') pause()
    }
    // The guitar dropped mid-run (not in keyboard mode).
    const offState = engine.state.on(() => {
      if (keyboardMode || listen || engine.running || !active()) return
      run.stop()
      setOverlay('disconnected')
    })
    window.addEventListener('keydown', onKey)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('visibilitychange', onVis)
      offState()
    }
  }, [run, keyboardMode, listen])

  // DOM-only frame loop: progress bar, bend meter, improv chips (those at most ~5 times a second).
  useEffect(() => {
    if (!run) return
    const total = run.chart.totalBeats
    const isImprov = run.lesson.type === 'improv'
    let raf = 0
    let lastPoll = 0
    let lastChord = ''
    let lastCount = -1
    const tick = (now: number) => {
      if (run.state === 'countin' || run.state === 'playing') {
        const b = run.visualBeat(live.current.prefs.visualNudgeMs)
        if (progressRef.current) progressRef.current.style.transform = `scaleX(${Math.max(0, Math.min(1, b / total))})`
        const bend = run.hud.bend
        if (bendRef.current && bendFillRef.current) {
          bendRef.current.hidden = bend === null
          if (bend !== null) bendFillRef.current.style.transform = `scaleY(${Math.max(0, Math.min(1.25, bend)) / 1.25})`
        }
        if (isImprov && now - lastPoll > 200) {
          lastPoll = now
          const bar = Math.max(0, Math.floor(b / 4))
          const chord = run.chart.chordTimeline[bar]?.symbol ?? ''
          const count = run.played.length
          if (chord !== lastChord || count !== lastCount) {
            lastChord = chord
            lastCount = count
            setImprov({ chord, chips: run.played.slice(-12) })
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [run])

  // Focus the first button of a card when it opens, so Enter or Space works right away.
  useEffect(() => {
    if (overlay) cardRef.current?.querySelector('button')?.focus()
  }, [overlay])

  const restart = () => {
    setRoarTip(false)
    setAttempt((a) => a + 1)
  }

  const chart = run?.chart
  const bars = chart?.bars ?? lesson.bars

  // What sits under the runway: a fretboard, chord boxes or improv chips.
  const helper = useMemo(() => {
    if (!chart) return null
    if (lesson.type === 'improv' && lesson.improv) {
      const spec = lesson.improv
      const scale = scalePcsOf(spec)
      const tones = spec.chordTones ? chordPcs(improv.chord) : []
      const markers: Marker[] = boxNotes(scale, [], spec.boxFret).map((p) => ({
        string: p.string,
        fret: p.fret,
        kind: pc(p.midi) === spec.key ? 'root' : tones.indexOf(pc(p.midi)) >= 0 ? 'target' : 'box',
      }))
      return { kind: 'improv' as const, markers, maxFret: Math.max(12, spec.boxFret + 7), from: spec.boxFret, to: spec.boxFret + 4 }
    }
    if (lesson.type === 'chords' || lesson.type === 'rhythm') {
      const n = hud.next
      const cur = n && n.kind === 'chord' ? n : chordFrom(chart.events, n ? n.beat : 0)
      const after = cur ? chordFrom(chart.events, cur.beat, cur.symbol) : null
      return { kind: 'chords' as const, cur, after }
    }
    const notes = chart.events.filter((e): e is NoteEv => e.kind === 'note')
    const top = notes.reduce((m, e) => Math.max(m, e.fret), 0)
    const next = hud.next && hud.next.kind === 'note' ? hud.next : null
    const markers: Marker[] = []
    if (hud.lastMidi !== null) {
      const at = nearestPosition(hud.lastMidi, next ? next.fret : 5, undefined, Math.max(12, top + 3))
      if (at && !(next && at.string === next.string && at.fret === next.fret)) markers.push({ string: at.string, fret: at.fret, kind: 'played' })
    }
    if (next && !next.hidden) markers.push({ string: next.string, fret: next.fret, kind: 'next' })
    return { kind: 'notes' as const, markers, maxFret: Math.max(12, top + 3) }
  }, [chart, lesson, hud.next, hud.lastMidi, improv.chord])

  const playing = runState === 'countin' || runState === 'playing'
  const baseMood: DinoMood = runState === 'countin' ? 'focus' : hud.roar ? 'hyped' : 'idle'
  useEffect(() => {
    baseMoodRef.current = baseMood
  }, [baseMood])
  const roarFill = Math.min(1, hud.chain / ROAR_AT)
  const pauseNow = () => {
    if (!playing || !run) return
    run.stop()
    setOverlay('paused')
  }

  return (
    <div className={`lp-play${hud.roar ? ' is-roar' : ''}`}>
      <header className="lp-top">
        <button className="lp-pause" onClick={pauseNow} aria-label="Pause (Esc)" title="Pause (Esc)" disabled={!playing}>
          <PauseIcon />
        </button>
        <div className="lp-title">
          <h2>{lesson.title}</h2>
          <div className="lp-progress" style={{ ['--bars' as string]: bars }} aria-hidden="true">
            <i ref={progressRef} />
          </div>
        </div>
        {!listen && (
          <div className="lp-score" aria-live="off">
            <span>Score</span>
            <b>{hud.points.toLocaleString()}</b>
          </div>
        )}
        <div className="lp-dino" ref={dinoRef}>
          <Dino stage={stage} mood={baseMood} size={72} cosmetics={cosmetics} />
          {!listen && (
            <div className={`lp-roar${hud.roar ? ' on' : ''}`} title={`Roar at a chain of ${ROAR_AT}`}>
              <i style={{ transform: `scaleX(${roarFill})` }} />
            </div>
          )}
          {sad && <span className="lp-bubble">Slow it down?</span>}
        </div>
      </header>

      <div className="lp-stage">
        {run && <Runway run={run} zoom={prefs.zoom} nudgeMs={prefs.visualNudgeMs} />}
        {listen && playing && <span className="lp-listen-tag">Listen first: just watch and listen.</span>}
        {hud.verdict && (
          <span key={hud.vKey} className={`lp-verdict v-${hud.verdict}`}>
            {VERDICT_LABEL[hud.verdict]}
          </span>
        )}
        {hud.milestone && (
          <span key={`m${hud.mKey}`} className="lp-milestone">
            {hud.milestone}
          </span>
        )}
        <div className="lp-bend" ref={bendRef} hidden aria-hidden="true">
          <i ref={bendFillRef} />
          <b />
        </div>
        {roarTip && <p className="lp-roar-tip">Roar! 16 good hits in a row: points ×1.5 until you slip.</p>}
        {overlay && (
          <div className="lp-scrim">
            <div className="lp-card" ref={cardRef} role="dialog" aria-modal="true" aria-labelledby="lp-card-h">
              {overlay === 'paused' && (
                <>
                  <h3 id="lp-card-h">Paused</h3>
                  <p>Stopped. Start over, or try it slower.</p>
                  <div className="lp-card-btns">
                    <button className="ls-btn primary" onClick={restart}>
                      Restart
                    </button>
                    {speed > MIN_SPEED && (
                      <button className="ls-btn" onClick={onSlower}>
                        Slower
                      </button>
                    )}
                    <button className="ls-btn" onClick={onQuit}>
                      Quit
                    </button>
                  </div>
                </>
              )}
              {overlay === 'disconnected' && (
                <>
                  <h3 id="lp-card-h">Guitar disconnected</h3>
                  <p>Plug it back in and connect it, then start the lesson again.</p>
                  <div className="lp-card-btns">
                    <button className="ls-btn primary" onClick={onConnect}>
                      Connect
                    </button>
                    <button className="ls-btn" onClick={restart}>
                      Restart
                    </button>
                    <button className="ls-btn" onClick={onQuit}>
                      Quit
                    </button>
                  </div>
                </>
              )}
              {overlay === 'error' && (
                <>
                  <h3 id="lp-card-h">Couldn't start the sound</h3>
                  <p>Check your audio device, then try again.</p>
                  <div className="lp-card-btns">
                    <button className="ls-btn primary" onClick={restart}>
                      Try again
                    </button>
                    <button className="ls-btn" onClick={onQuit}>
                      Quit
                    </button>
                  </div>
                </>
              )}
              {overlay === 'listened' && (
                <>
                  <h3 id="lp-card-h">That's how it goes</h3>
                  <p>Now it's your turn.</p>
                  <div className="lp-card-btns">
                    <button className="ls-btn primary" onClick={onQuit}>
                      Back to the lesson
                    </button>
                    <button className="ls-btn" onClick={restart}>
                      Listen again
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {!listen && (
        <div className="lp-under">
          <div className={`lp-chain${hud.chain > 0 ? '' : ' zero'}`}>
            <span>Chain</span>
            <b key={hud.mKey} className={hud.mKey ? 'pop' : undefined}>
              {hud.chain}
            </b>
            {hud.roar && <em>Roar ×1.5</em>}
          </div>
          {hud.wrong && (
            <p className="lp-heard">
              Last wrong note: heard <b className="ls-num">{hud.wrong.heard !== null ? midiName(hud.wrong.heard) : 'no clear pitch'}</b>, wanted{' '}
              <b className="ls-num">{midiName(hud.wrong.wanted)}</b>
            </p>
          )}
        </div>
      )}

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

      {prefs.showFretboard && helper && helper.kind !== 'chords' && (
        <div className="lp-fretboard">
          <Fretboard markers={helper.markers} maxFret={helper.maxFret} highlightFrom={helper.kind === 'improv' ? helper.from : undefined} highlightTo={helper.kind === 'improv' ? helper.to : undefined} />
          {helper.kind === 'notes' && run && !listen && <FretFx run={run} next={hud.next} maxFret={helper.maxFret} nudgeMs={prefs.visualNudgeMs} />}
        </div>
      )}

      {lesson.type === 'improv' && improv.chips.length > 0 && (
        <ol className="lp-chips" aria-label="Notes you played">
          {improv.chips.map((n, i) => (
            <li key={`${n.beat}-${i}`} className={`k-${n.kind}`}>
              {noteName(n.midi)}
            </li>
          ))}
        </ol>
      )}

      {keyboardMode && !listen && (
        <p className="lp-keys">
          <kbd>Space</kbd> = play the note · <kbd>1</kbd>–<kbd>6</kbd> = string (1 = high e) · <kbd>X</kbd> = wrong note · <kbd>M</kbd> = mute · <kbd>Esc</kbd> = pause
        </p>
      )}
    </div>
  )
}
