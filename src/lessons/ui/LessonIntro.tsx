import { useEffect, useMemo, useRef, useState } from 'react'
import { engine } from '../../audio/engine'
import { useEngineState } from '../../audio/hooks'
import { applyTone } from '../../audio/presets'
import { presetByName } from '../../audio/tone'
import { Fretboard } from '../../components/Fretboard'
import type { Marker } from '../../components/Fretboard'
import { ChordDiagram } from '../../components/PartViews'
import { boxNotes } from '../../music/phrase'
import { noteName, pc } from '../../music/theory'
import type { Lesson, Prefs, Progress, Speed } from '../types'
import { LessonRun } from '../run'
import { drawRunway, prefersStill, readColors } from '../runwayDraw'
import { onThemeChange } from '../../theme'
import { scalePcsOf } from '../improv'
import { KEYBOARD_DEVICE, deviceKey, loadLatency, micWarning } from '../calibration'
import { clicksMuted } from '../clock'
import { DINO_STAGES, dinoStageFor } from '../progress'
import { connectSource } from '../source'
import { Dino } from './Dino'
import { InputPicker } from './InputPicker'
import { StarGlyph, StarPips } from './LessonMap'

const SPEEDS: { v: Speed; label: string }[] = [
  { v: 0.7, label: '70%' },
  { v: 0.85, label: '85%' },
  { v: 1, label: '100%' },
]

function NotesPreview({ run, zoom }: { run: LessonRun; zoom: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const draw = () => {
      const w = cv.clientWidth
      const h = cv.clientHeight
      const dpr = window.devicePixelRatio || 1
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      const g = cv.getContext('2d')
      if (!g || !w) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawRunway(g, w, h, run, -1, readColors(cv), zoom, prefersStill(), false)
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(cv)
    const offTheme = onThemeChange(draw) // draw() re-reads the colour tokens
    return () => {
      ro.disconnect()
      offTheme()
    }
  }, [run, zoom])
  return <canvas ref={ref} className="ls-preview-canvas" aria-label="The first bars of this lesson" />
}

function Preview({ lesson, run, zoom }: { lesson: Lesson; run: LessonRun | null; zoom: number }) {
  if (lesson.type === 'improv' && lesson.improv) {
    const spec = lesson.improv
    const markers: Marker[] = boxNotes(scalePcsOf(spec), [], spec.boxFret).map((p) => ({
      string: p.string,
      fret: p.fret,
      kind: pc(p.midi) === spec.key ? 'root' : 'box',
    }))
    return (
      <div className="ls-preview board">
        <Fretboard markers={markers} maxFret={Math.min(22, spec.boxFret + 8)} highlightFrom={spec.boxFret} highlightTo={spec.boxFret + 3} />
        <p className="ls-caption">The red dots are {noteName(spec.key)}, home. Every dot fits.</p>
      </div>
    )
  }
  if (!run) return null
  if (lesson.type === 'chords' || lesson.type === 'rhythm') {
    const shapes = new Map<string, number[]>()
    for (const ev of run.chart.events) if (ev.kind === 'chord' && !shapes.has(ev.symbol)) shapes.set(ev.symbol, ev.frets)
    if (!shapes.size) return null
    return (
      <div className="ls-preview chords">
        {[...shapes].map(([name, frets]) => (
          <div key={name} className="ls-chord">
            <ChordDiagram shape={{ frets }} name={name} size={1} />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="ls-preview tab">
      <NotesPreview run={run} zoom={zoom} />
    </div>
  )
}

function Seg<T extends string | number>({ value, options, onPick, label }: { value: T; options: { v: T; label: string }[]; onPick: (v: T) => void; label: string }) {
  return (
    <div className="ls-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.v)} role="radio" aria-checked={o.v === value} className={o.v === value ? 'on' : ''} onClick={() => onPick(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Switch({ on, set, label, note }: { on: boolean; set: (v: boolean) => void; label: string; note?: string }) {
  return (
    <button className={`ls-switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={() => set(!on)}>
      <span className="ls-switch-track" aria-hidden>
        <span />
      </span>
      <span>
        {label}
        {note && <small>{note}</small>}
      </span>
    </button>
  )
}

export function LessonIntro({
  lesson,
  progress,
  prefs,
  onPrefs,
  onStart,
  onListen,
  onSync,
  onBack,
  onConnect,
}: {
  lesson: Lesson
  progress: Progress
  prefs: Prefs
  onPrefs: (p: Prefs) => void
  onStart: () => void
  onListen: () => void
  onSync: () => void
  onBack: () => void
  onConnect: () => void
}) {
  const e = useEngineState()
  const [toneSet, setToneSet] = useState(false)
  const [, bump] = useState(0)
  const startRef = useRef<HTMLButtonElement>(null)

  // The constructor is pure: safe to build one just for the preview.
  const preview = useMemo(() => {
    try {
      return new LessonRun({ lesson, speed: prefs.speed, easyTiming: prefs.easyTiming, backingOn: prefs.backingOn, keyboard: prefs.keyboard })
    } catch {
      return null
    }
  }, [lesson, prefs.speed, prefs.easyTiming, prefs.backingOn, prefs.keyboard])

  useEffect(() => {
    startRef.current?.focus()
  }, [])

  // Esc goes back.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null
      if (t && t.closest('input, select, textarea')) return
      if (ev.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  const keyboardMode = prefs.keyboard || !e.running
  const calibrated = !!loadLatency(keyboardMode ? KEYBOARD_DEVICE : deviceKey())
  // The picker already asks mic users for headphones.
  const mic = e.running && prefs.input === 'cable' ? micWarning() : null
  const connect = () => {
    connectSource(prefs.input, prefs.micId).catch(() => onConnect())
  }
  const muted = clicksMuted()
  const rec = progress.lessons[lesson.id]
  const stage = dinoStageFor(progress)
  const showSpeedNote = prefs.speed < 1

  return (
    <div className="ls-intro">
      <button className="ls-back" onClick={onBack} aria-label="Back to the map">
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="M10 3 5 8l5 5" />
        </svg>
        Back
      </button>

      <header className="ls-intro-head">
        <div className="ls-intro-title">
          <p className="ls-intro-where ls-num">
            {lesson.boss ? `World ${lesson.world} boss` : `World ${lesson.world}, lesson ${lesson.order}`}
          </p>
          <h2 className="ls-display">{lesson.title}</h2>
          <p className="ls-goal">{lesson.goal}</p>
          {rec && rec.plays > 0 && (
            <p className="ls-best">
              <StarPips stars={rec.stars} /> <span className="ls-num">{rec.best}%</span> · best chain <span className="ls-num">{rec.bestChain}</span>
            </p>
          )}
        </div>
        <div className="ls-intro-dino">
          {lesson.tips[0] && <p className="ls-bubble">{lesson.tips[0]}</p>}
          <Dino stage={stage} mood="idle" size={110} cosmetics={progress.cosmetics} />
          <span className="ls-sr">{DINO_STAGES[stage]?.name}</span>
        </div>
      </header>

      <Preview lesson={lesson} run={preview} zoom={prefs.zoom} />

      {lesson.tips.length > 1 && (
        <ul className="ls-tips">
          {lesson.tips.slice(1).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}

      <div className="ls-intro-grid">
        <div className="ls-controls">
          <div className="ls-field">
            <span className="ls-field-label">Speed</span>
            <Seg label="Speed" value={prefs.speed} options={SPEEDS} onPick={(v) => onPrefs({ ...prefs, speed: v })} />
            {showSpeedNote && <small className="ls-muted">Practice: 75% XP, up to 2 <StarGlyph />
                <span className="ls-sr">stars</span>
              </small>}
          </div>
          <Switch on={prefs.easyTiming} set={(v) => onPrefs({ ...prefs, easyTiming: v })} label="Easy timing" note="wider windows, 80% XP" />
          {lesson.backing && <Switch on={prefs.backingOn} set={(v) => onPrefs({ ...prefs, backingOn: v })} label="Band" />}
          <div className="ls-tone">
            <span>
              Suggested tone: <b>{lesson.tone}</b>
            </span>
            <button
              className="ls-btn small"
              disabled={toneSet}
              onClick={() => {
                void applyTone({ id: 'builtin:' + lesson.tone, name: lesson.tone, settings: presetByName(lesson.tone) }).then(() => setToneSet(true))
              }}
            >
              {toneSet ? 'In use' : 'Use it'}
            </button>
          </div>
        </div>

        <div className="ls-start">
          <InputPicker prefs={prefs} onPrefs={onPrefs} />
          {mic && <p className="ls-warn">{mic}</p>}
          {muted && (
            <p className="ls-warn">
              Your metronome volume is off.{' '}
              <button
                className="ls-link"
                onClick={() => {
                  engine.setMetronomeLevel(1)
                  bump((n) => n + 1)
                }}
              >
                Turn it on
              </button>
            </p>
          )}
          {!calibrated && (
            <p className="ls-note">
              New setup: sync first (20 s){' '}
              <button className="ls-btn small" onClick={onSync}>
                Sync
              </button>
            </p>
          )}
          {e.running ? (
            <button ref={startRef} className="ls-btn primary big" onClick={onStart}>
              Start
            </button>
          ) : (
            <div className="ls-connect">
              <button ref={startRef} className="ls-btn primary big" onClick={connect}>
                {prefs.input === 'mic' ? 'Connect microphone' : 'Connect guitar'}
              </button>
              <button className="ls-btn" onClick={onStart}>
                Try with the keyboard
              </button>
            </div>
          )}
          <div className="ls-start-row">
            <button className="ls-btn" onClick={onListen}>
              Listen first
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
