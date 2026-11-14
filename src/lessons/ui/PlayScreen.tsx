import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChartEvent, ChordEv, Cosmetic, DinoMood, Lesson, LessonResult, NoteEv, Prefs, RunState, Speed, TabLevel, Verdict } from '../types'
import { LessonRun, autoplayFromUrl } from '../run'
import { jamChart } from '../charts'
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
import { FINGER_NAME, fingeringFor, guidesOn } from '../fingering'
import { guideMarkers, nextAtBeat } from '../guides'
import { holdReload, practice } from '../../account/activity'
import { QUIET_BAND } from '../listen'
import type { Idea } from '../ideas'
import { ideaSegments, ideasFor, makeIdea, segmentAt } from '../ideas'
import { JamIdeas } from './JamIdeas'
import { GENRES, tracksFor, withTrack } from '../tracks'
import './play.css'
import './listen.css'

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
const PEEK_MS = 3000 // Peek shows the full tab this long

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

/** A fingertip over a string, for the guides toggle. */
function FingerIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M1.5 12.5h13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <path d="M6 2.5v6.2a2 2 0 0 0 4 0V2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <circle cx="8" cy="11" r="1.4" fill="currentColor" />
    </svg>
  )
}

export function PlayScreen({
  lesson: given,
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
  tab = 'full',
  quiet = false,
  shuffle = false,
  cold = false,
  passes = 1,
  timingCue = null,
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
  /** How much tab shows: full, faded (dim numbers) or hidden (timing only). */
  tab?: TabLevel
  /** Listen mode: band louder, no live verdicts, chain or score; the summary comes at the end. */
  quiet?: boolean
  /** Shuffle mode: a straight lesson played swung, practice only. */
  shuffle?: boolean
  /** A cold-start test: first try, no warm-up. */
  cold?: boolean
  /** A jam block of today's session: the jam plays this many times through in one run. */
  passes?: number
  /** The lesson's timing habit as a cue ("you tend to rush this one…"), shown while the run starts. */
  timingCue?: string | null
}) {
  // The cue shows for the count-in and the first bars, then gets out of the way.
  const [cueOn, setCueOn] = useState(!!timingCue)
  useEffect(() => {
    if (!timingCue) return
    const t = window.setTimeout(() => setCueOn(false), 9000)
    return () => window.clearTimeout(t)
  }, [timingCue])
  // A jam plays over the backing track picked for it; everything else about the lesson stays.
  const trackId = prefs.jamTracks[given.id]
  const lesson = useMemo(() => withTrack(given, trackId), [given, trackId])
  const [peek, setPeek] = useState(false)
  const peekedRef = useRef(false)
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
  // Jam ideas: a phrase to try over the chord, a new one every few bars (made in the frame loop, kept here for "New idea").
  const [ideas, setIdeas] = useState<{ cur: Idea | null; next: Idea | null; dim: boolean }>({ cur: null, next: null, dim: false })
  const live = useRef({ lesson, prefs, listen, onEnd, onPrefs, speed, tab, quiet, shuffle, passes })
  useEffect(() => {
    live.current = { lesson, prefs, listen, onEnd, onPrefs, speed, tab, quiet, shuffle, passes }
  })

  const dinoRef = useRef<HTMLDivElement>(null)
  const progressRef = useRef<HTMLElement>(null)
  const riderRef = useRef<HTMLSpanElement>(null)
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
      if (live.current.quiet) return // listen mode: no live verdicts, the dino included
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
      shuffle: live.current.shuffle,
      bandLevel: (live.current.quiet ? QUIET_BAND : 1) * (lesson.type === 'improv' ? p.jamBandVol : 1),
      // A session's jam block: several times through in one run (never the demo playback).
      chart: !isListen && live.current.passes > 1 ? jamChart(lesson, live.current.passes) : undefined,
    })
    let cancelled = false
    let misses = 0
    let roarSeen = false
    peekedRef.current = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new run (built in this effect) resets the screen's state with it
    setPeek(false)
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
        // listen mode: no "slow it down" nudge mid-run
        if (misses === 4 && !live.current.quiet) {
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
      if (h.roar && !roarSeen && !live.current.quiet) {
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
    r.onEnd = (raw) => {
      if (cancelled) return
      // how much tab was shown: a peek counts as the full tab
      const peeked = peekedRef.current
      const result: LessonResult = { ...raw, tab: peeked ? 'full' : live.current.tab, quiet: live.current.quiet, peeked }
      if (live.current.listen) setOverlay('listened')
      else if (result.stars >= 2 && !prefersStill() && !live.current.quiet) {
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
      // A long jam with one time through behind it ends with its result, instead of throwing minutes of playing away.
      if (run.chart.bars > run.lesson.bars && run.endNow(run.lesson.bars * 4)) return
      run.stop()
      setOverlay('paused')
    }
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && t.closest('input, select, textarea')) return
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') pause()
      else if ((e.key === 'g' || e.key === 'G') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // G flips the finger guides and remembers the choice
        const { prefs: pr, lesson: ls, onPrefs: set } = live.current
        set({ ...pr, guides: guidesOn(pr, ls) ? 'off' : 'on' })
      }
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
    let lastNext: ChartEvent | null | undefined
    const ideaSpec = ideasFor(run.lesson)
    const segs = ideaSpec ? ideaSegments(run.chart) : []
    // answer jams: the idea is for reading while the band plays its call, and steps back on the player's turn
    const calls = new Set(run.chart.listenBars)
    let lastSeg = -1
    let lastDim = false
    let ahead: Idea | null = null
    const tick = (now: number) => {
      if (run.state === 'countin' || run.state === 'playing') {
        const b = run.visualBeat(live.current.prefs.visualNudgeMs)
        const share = Math.max(0, Math.min(1, b / total))
        if (progressRef.current) progressRef.current.style.transform = `scaleX(${share})`
        // the pick rides the route to the flag at the end
        if (riderRef.current) riderRef.current.style.left = `${share * 100}%`
        // listen mode has no judge to move "next" along: follow the clock (one render per note)
        if (live.current.listen && Number.isFinite(b)) {
          const n = nextAtBeat(run.chart, b)
          if (n !== lastNext) {
            lastNext = n
            setHud((h) => ({ ...h, next: n }))
          }
        }
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
          if (ideaSpec && segs.length) {
            const seg = segmentAt(segs, bar)
            const dim = calls.size > 0 && !calls.has(bar)
            if (seg !== lastSeg) {
              // the idea shown as "Next" becomes the one to try, so what was read ahead is what arrives
              const cur = seg === lastSeg + 1 && ahead ? ahead : makeIdea(ideaSpec, segs[seg].chord)
              ahead = seg + 1 < segs.length ? makeIdea(ideaSpec, segs[seg + 1].chord) : null
              lastSeg = seg
              lastDim = dim
              setIdeas({ cur, next: ahead, dim })
            } else if (dim !== lastDim) {
              lastDim = dim
              setIdeas((s) => ({ ...s, dim }))
            }
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

  // Peek: the full tab for a few seconds; the run then counts as played with the full tab
  const peekNow = () => {
    peekedRef.current = true
    setPeek(true)
  }
  useEffect(() => {
    if (!peek) return
    const id = window.setTimeout(() => setPeek(false), PEEK_MS)
    return () => window.clearTimeout(id)
  }, [peek])
  const shownTab: TabLevel = peek ? 'full' : tab

  const chart = run?.chart
  const bars = chart?.bars ?? lesson.bars
  // A long jam: how many times through, and about how long (the progress bar then has one notch per time through).
  const times = chart && chart.bars > lesson.bars ? Math.round(chart.bars / lesson.bars) : 1
  const jamMin = run && times > 1 ? Math.max(1, Math.round((chart?.totalBeats ?? 0) / run.bpm)) : 0

  // Finger and pick guides: worked out once per run, shown by the pref (Auto = early worlds)
  const fingering = useMemo(() => (run ? fingeringFor(run.lesson, run.chart) : null), [run])
  const guidesShown = guidesOn(prefs, lesson)
  const guides = guidesShown ? fingering : null
  const canGuide = lesson.type !== 'improv' && lesson.type !== 'sync'
  const toggleGuides = () => onPrefs({ ...prefs, guides: guidesShown ? 'off' : 'on' })

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
    let played: Marker | null = null
    if (hud.lastMidi !== null) {
      const at = nearestPosition(hud.lastMidi, next ? next.fret : 5, undefined, Math.max(12, top + 3))
      if (at && !(next && at.string === next.string && at.fret === next.fret)) played = { string: at.string, fret: at.fret, kind: 'played' }
    }
    if (guides) {
      // the next note with its finger, faint notes after it, resting fingers, the hand's window; "played" stays on top
      const gv = guideMarkers(chart, guides, hud.next ? hud.next.id : null)
      // finger colours reuse the played hue, so here it is a small bone dot instead
      if (played) gv.markers.push({ ...played, kind: 'heard' })
      return { kind: 'notes' as const, markers: gv.markers, maxFret: Math.max(12, top + 3), from: gv.window?.from, to: gv.window?.to, arrow: gv.arrow ?? undefined }
    }
    if (played) markers.push(played)
    if (next && !next.hidden) markers.push({ string: next.string, fret: next.fret, kind: 'next' })
    return { kind: 'notes' as const, markers, maxFret: Math.max(12, top + 3), from: undefined, to: undefined, arrow: undefined }
  }, [chart, lesson, hud.next, hud.lastMidi, improv.chord, guides])

  // Jams: what the chord on the runway means for the player. The notes of the chord that are in the box, each with
  // one place to find it, so "Am" becomes "land on A, C or E" instead of a name to decode.
  const chordHint = useMemo(() => {
    const spec = lesson.type === 'improv' ? lesson.improv : undefined
    if (!spec || !improv.chord) return null
    const box = boxNotes(scalePcsOf(spec), [], spec.boxFret)
    const tones = chordPcs(improv.chord)
    const STRINGS = ['low E', 'A', 'D', 'G', 'B', 'high e']
    const spots: { name: string; where: string }[] = []
    for (const t of tones) {
      // one spot per chord note, from the middle strings when the box has it there
      const at = box.filter((n) => pc(n.midi) === t).sort((a, b) => Math.abs(a.string - 2.5) - Math.abs(b.string - 2.5))[0]
      if (at) spots.push({ name: noteName(at.midi), where: `${STRINGS[at.string]} string, fret ${at.fret}` })
    }
    return { chord: improv.chord, spots }
  }, [lesson, improv.chord])

  // Jams: the band's volume follows the slider while the run plays.
  const jamVol = lesson.type === 'improv' && !!lesson.backing && prefs.backingOn
  const bandLevel = (quiet ? QUIET_BAND : 1) * (lesson.type === 'improv' ? prefs.jamBandVol : 1)
  useEffect(() => {
    run?.setBandLevel(bandLevel)
  }, [run, bandLevel])

  const jamTracks = useMemo(() => tracksFor(given), [given])
  const pickTrack = (id: string | null) => {
    const rest = Object.fromEntries(Object.entries(prefs.jamTracks).filter(([k]) => k !== given.id))
    onPrefs({ ...prefs, jamTracks: id ? { ...rest, [given.id]: id } : rest })
  }

  const ideaSpec = ideasFor(lesson)
  const newIdea = () => {
    if (ideaSpec && ideas.cur) setIdeas({ ...ideas, cur: makeIdea(ideaSpec, ideas.cur.chord) })
  }

  /** Finger numbers for a chord box, when the guides are on. */
  const chordFingers = (ev: ChordEv) => {
    const ef = guides?.events[ev.id]
    return ef && ef.kind === 'chord' ? ef.fingering.fingers : undefined
  }

  const playing = runState === 'countin' || runState === 'playing'
  const baseMood: DinoMood = runState === 'countin' ? 'focus' : hud.roar ? 'hyped' : 'idle'
  useEffect(() => {
    baseMoodRef.current = baseMood
  }, [baseMood])
  const roarFill = Math.min(1, hud.chain / ROAR_AT)
  const pauseNow = () => {
    if (!playing || !run) return
    if (run.chart.bars > run.lesson.bars && run.endNow(run.lesson.bars * 4)) return
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
          <div className="lp-progress" style={{ ['--bars' as string]: times > 1 ? times : bars }} aria-hidden="true">
            <i ref={progressRef} />
            <span className="lp-rider" ref={riderRef}>
              <svg viewBox="0 0 40 44">
                <path d="M20 41C13 34 3 23 3 13.5 3 6 10.5 2.5 20 2.5S37 6 37 13.5C37 23 27 34 20 41Z" />
              </svg>
            </span>
            <svg className="lp-flag" viewBox="0 0 16 16">
              <path d="M4 15V1" />
              <path d="M4 2h9l-2.5 3L13 8H4Z" />
            </svg>
          </div>
        </div>
        {!listen && !quiet && (
          <div className="lp-score" aria-live="off">
            <span>Score</span>
            <b>{hud.points.toLocaleString()}</b>
          </div>
        )}
        <div className="lp-dino" ref={dinoRef}>
          <Dino stage={stage} mood={baseMood} size={72} cosmetics={cosmetics} />
          {!listen && !quiet && (
            <div className={`lp-roar${hud.roar ? ' on' : ''}`} title={`Roar at a chain of ${ROAR_AT}`}>
              <i style={{ transform: `scaleX(${roarFill})` }} />
            </div>
          )}
          {sad && <span className="lp-bubble">Slow it down?</span>}
        </div>
      </header>

      <div className="lp-stage">
        {run && <Runway run={run} zoom={prefs.zoom} nudgeMs={prefs.visualNudgeMs} guides={guides} tab={shownTab} quiet={quiet && !listen} />}
        {listen && playing && <span className="lp-listen-tag">{guides ? 'Just watch: the numbers show which finger.' : 'Just watch and listen.'}</span>}
        {!listen && (quiet || cold || shuffle || times > 1 || (cueOn && !!timingCue)) && (
          <div className="lp-mode-tags">
            {cueOn && timingCue && <span className="lp-mode-tag cue">{timingCue}</span>}
            {times > 1 && (
              <span className="lp-mode-tag ls-num">
                {times} times through, about {jamMin} min
              </span>
            )}
            {cold && playing && <span className="lp-mode-tag cold">Cold start: first try, no warm-up.</span>}
            {quiet && <span className="lp-mode-tag">Listen mode: play by ear, the summary comes at the end.</span>}
            {shuffle && <span className="lp-mode-tag">Shuffle: practice only.</span>}
          </div>
        )}
        {hud.verdict && !quiet && (
          <span key={hud.vKey} className={`lp-verdict v-${hud.verdict}`}>
            {VERDICT_LABEL[hud.verdict]}
          </span>
        )}
        {hud.milestone && !quiet && (
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

      {!listen && tab !== 'full' && (
        <div className="lp-tabbar">
          <button type="button" className={`lp-peek${peek ? ' on' : ''}`} onClick={peekNow} disabled={peek || !playing} aria-pressed={peek} data-pedal="next" title="Next pedal">
            Peek (3 s)
          </button>
          <span className="lp-tabbar-note">{tab === 'hidden' ? 'Tab hidden: play it from memory.' : 'Tab faded: lean on your memory.'}</span>
        </div>
      )}

      {!listen && jamVol && (
        <div className="lp-band">
          {jamTracks.length > 0 && (
            <label className="lp-track">
              <span>Backing track</span>
              {/* Picking another track starts the jam again from the top, with the new band. */}
              <select value={trackId && jamTracks.some((t) => t.id === trackId) ? trackId : ''} onChange={(e) => pickTrack(e.target.value || null)}>
                <option value="">Lesson's own</option>
                {GENRES.map((g) => {
                  const list = jamTracks.filter((t) => t.genre === g.id)
                  return list.length ? (
                    <optgroup key={g.id} label={g.label}>
                      {list.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null
                })}
              </select>
            </label>
          )}
          <label className="lp-vol">
            <span>Band volume</span>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={Math.round(prefs.jamBandVol * 100)}
              onChange={(e) => onPrefs({ ...prefs, jamBandVol: Number(e.target.value) / 100 })}
              aria-valuetext={`${Math.round(prefs.jamBandVol * 100)} percent`}
            />
            <b className="ls-num">{Math.round(prefs.jamBandVol * 100)}%</b>
          </label>
        </div>
      )}

      {!listen && chordHint && (
        <p className="lp-chord-hint" aria-live="off">
          {chordHint.spots.length ? (
            <>
              The band is on <b>{chordHint.chord}</b>. Land on{' '}
              {chordHint.spots.map((s, i) => (
                <span key={s.name}>
                  {i > 0 && (i === chordHint.spots.length - 1 ? ' or ' : ', ')}
                  <b>{s.name}</b> <small>({s.where})</small>
                </span>
              ))}
              . Any note of the box fits in between; these sound most at home.
            </>
          ) : (
            <>
              The band is on <b>{chordHint.chord}</b>. None of its notes are in your notes for this jam, so play the ones you have and listen for what fits.
            </>
          )}
        </p>
      )}

      {!listen && ideaSpec && ideas.cur && (
        prefs.jamIdeas ? (
          <JamIdeas cur={ideas.cur} next={ideas.next} dim={ideas.dim} onNew={newIdea} onHide={() => onPrefs({ ...prefs, jamIdeas: false })} />
        ) : (
          <div className="lp-tabbar">
            <button type="button" className="lp-peek" onClick={() => onPrefs({ ...prefs, jamIdeas: true })}>
              Show ideas
            </button>
            <span className="lp-tabbar-note">Ideas hidden: this jam is from your own head.</span>
          </div>
        )
      )}

      {!listen && !quiet && (
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

      {helper?.kind === 'chords' && shownTab !== 'hidden' && (helper.cur || helper.after) && (
        <div className="lp-chords">
          {helper.cur && (
            <figure className="lp-chord now">
              <ChordDiagram shape={{ frets: helper.cur.frets }} name={helper.cur.symbol} size={1} fingers={chordFingers(helper.cur)} />
              <figcaption>Now</figcaption>
            </figure>
          )}
          {helper.after && (
            <figure className="lp-chord">
              <ChordDiagram shape={{ frets: helper.after.frets }} name={helper.after.symbol} size={1} fingers={chordFingers(helper.after)} />
              <figcaption>Next</figcaption>
            </figure>
          )}
        </div>
      )}

      {/* A jam keeps its box on the fretboard even in listen mode: the notes to pick from, not a verdict. */}
      {prefs.showFretboard && helper && helper.kind !== 'chords' && (!quiet || helper.kind === 'improv') && !(helper.kind === 'notes' && shownTab !== 'full') && (
        <div className="lp-fretboard">
          <Fretboard
            markers={helper.markers}
            maxFret={helper.maxFret}
            highlightFrom={helper.from}
            highlightTo={helper.to}
            arrow={helper.kind === 'notes' ? helper.arrow : undefined}
          />
          {helper.kind === 'notes' && run && !listen && <FretFx run={run} next={hud.next} maxFret={helper.maxFret} nudgeMs={prefs.visualNudgeMs} />}
        </div>
      )}

      {canGuide && (
        <div className="lp-guides">
          <button type="button" className={`lp-guides-chip${guidesShown ? ' on' : ''}`} aria-pressed={guidesShown} onClick={toggleGuides} title="Finger guides (G)">
            <FingerIcon />
            Finger guides
            <kbd aria-hidden="true">G</kbd>
          </button>
          {guidesShown && (
            <span className="lp-guides-key" aria-hidden="true">
              {([1, 2, 3, 4] as const).map((f) => (
                <span key={f} className={`lp-gk lp-gk-${f}`}>
                  <b>{f}</b>
                  {FINGER_NAME[f]}
                </span>
              ))}
            </span>
          )}
        </div>
      )}

      {lesson.type === 'improv' && !quiet && improv.chips.length > 0 && (
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
          {canGuide && (
            <>
              {' '}
              · <kbd>G</kbd> = finger guides
            </>
          )}
        </p>
      )}
    </div>
  )
}
