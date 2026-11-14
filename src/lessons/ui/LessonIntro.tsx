import { useEffect, useMemo, useRef, useState } from 'react'
import { engine } from '../../audio/engine'
import { useEngineState } from '../../audio/hooks'
import { applyTone } from '../../audio/presets'
import { presetByName } from '../../audio/tone'
import { Fretboard } from '../../components/Fretboard'
import type { Marker } from '../../components/Fretboard'
import { boxNotes } from '../../music/phrase'
import { noteName, pc } from '../../music/theory'
import type { Lesson, Prefs, Progress, Speed } from '../types'
import { buildChart } from '../charts'
import { fingeringFor } from '../fingering'
import { scalePcsOf } from '../improv'
import { FEELS } from '../../music/parts'
import { KEYBOARD_DEVICE, deviceKey, latencyAdvice, loadLatency, micWarning } from '../calibration'
import { clicksMuted } from '../clock'
import { DINO_STAGES, dinoStageFor, stuckAdvice, thirdStar, timingHabit } from '../progress'
import { LEARN_SESSIONS, fullColds, isReviewItem, standingLabel, standingOf } from '../review'
import { whereLabel } from '../data'
import { connectSource } from '../source'
import { EARN_PASSES, MANUAL_SPEEDS, autoSpeed, bpmAt, bpmPct, pickFor, speedCap } from '../speed'
import { Dino } from './Dino'
import { InputPicker } from './InputPicker'
import { LatencyNote } from './LatencyNote'
import { StarGlyph, StarPips } from './LessonMap'
import { LessonOverview } from './teach/LessonOverview'
import { TeachPanel } from './teach/TeachPanel'
import { useWatch } from './teach/useWatch'
import type { WatchSpeed } from './teach/useWatch'
import { GENRES, tracksFor, trackChords, withTrack } from '../tracks'
import type { GenreId } from '../tracks'
import './timing.css'
import { describeTuning, setSongTuning, tuningLabel } from '../../music/tunings'

/** Improv lessons: the box on the fretboard, home notes marked. */
function BoxPreview({ lesson }: { lesson: Lesson }) {
  if (lesson.type !== 'improv' || !lesson.improv) return null
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

/** Jams: the band's own track for this lesson, or one of three genres of three. */
function TrackPicker({ lesson, prefs, onPrefs }: { lesson: Lesson; prefs: Prefs; onPrefs: (p: Prefs) => void }) {
  const tracks = tracksFor(lesson)
  const picked = tracks.find((t) => t.id === prefs.jamTracks[lesson.id]) ?? null
  const [genre, setGenre] = useState<GenreId | 'own'>(picked?.genre ?? 'own')
  if (!tracks.length || !lesson.backing) return null
  const genres = GENRES.filter((g) => tracks.some((t) => t.genre === g.id))
  const inGenre = tracks.filter((t) => t.genre === genre)
  const pick = (id: string | null) => {
    const rest = Object.fromEntries(Object.entries(prefs.jamTracks).filter(([k]) => k !== lesson.id))
    onPrefs({ ...prefs, jamTracks: id ? { ...rest, [lesson.id]: id } : rest })
  }
  const ownChords = [...new Set(lesson.backing.chords)].join(' · ')
  return (
    <div className="ls-field ls-tracks">
      <span className="ls-field-label">Backing track</span>
      <Seg
        label="Backing track: genre"
        value={genre}
        options={[{ v: 'own' as const, label: "Lesson's own" }, ...genres.map((g) => ({ v: g.id, label: g.label }))]}
        onPick={(v) => {
          setGenre(v)
          // a genre opens on its first track, so one click is enough to change the band
          pick(v === 'own' ? null : (tracks.find((t) => t.genre === v)?.id ?? null))
        }}
      />
      {genre !== 'own' && <Seg label="Backing track" value={picked?.id ?? ''} options={inGenre.map((t) => ({ v: t.id, label: t.name }))} onPick={(v) => pick(v)} />}
      <small className="ls-muted">
        {picked ? (
          <>
            {picked.about} Chords: <span className="ls-num">{trackChords(lesson, picked)}</span>. Same notes, tempo and scoring as the lesson.
          </>
        ) : (
          <>
            {FEELS[lesson.backing.feel]?.label ?? 'Band'}. Chords: <span className="ls-num">{ownChords}</span>.
          </>
        )}
      </small>
    </div>
  )
}

const WATCH_SPEEDS: { v: WatchSpeed; label: string }[] = [
  { v: 0.5, label: '50%' },
  { v: 0.75, label: '75%' },
  { v: 1, label: '100%' },
]

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
  lesson: given,
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
  onStart: (o?: { shuffle?: boolean; quiet?: boolean }) => void
  onListen: () => void
  onSync: () => void
  onBack: () => void
  onConnect: () => void
}) {
  // A jam shows the chords of the backing track picked for it (the preview, the band); the lesson is otherwise the same.
  const pickedTrack = prefs.jamTracks[given.id]
  const lesson = useMemo(() => withTrack(given, pickedTrack), [given, pickedTrack])
  const e = useEngineState()
  const [toneSet, setToneSet] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [quiet, setQuiet] = useState(false)
  const [, bump] = useState(0)
  const startRef = useRef<HTMLButtonElement>(null)

  // Speed trainer: Auto unless the player picked a speed for this lesson.
  const rec = progress.lessons[lesson.id]
  const stuck = stuckAdvice(rec)
  const star3 = thirdStar(lesson, rec)
  const habit = timingHabit(progress.runs, lesson.id)
  const auto = autoSpeed(lesson, rec)
  const autoHint =
    lesson.type === 'improv'
      ? 'Jams play at full speed. Auto slows the band only far under the pass mark, and goes back up after a pass.'
      : `Auto: ${bpmAt(lesson, auto)} BPM. A tempo counts after a clean first try and two more clean runs. Then it goes up about 3 BPM.`
  const trial = rec?.trial
  // Passed vs learned (plan section 4): a review item is learned once it's clean from cold at full tempo in 2 sessions.
  const standing = standingLabel(rec)
  const learnNote =
    standingOf(rec) === 'passed' && isReviewItem(lesson)
      ? `Learned once it's clean from cold at full tempo in ${LEARN_SESSIONS} separate sessions (${fullColds(rec)} of ${LEARN_SESSIONS} so far). The cold starts in your session step up to it.`
      : null
  const pick = pickFor(prefs, lesson.id)
  const speed = pick ?? auto
  const speedOptions: { v: 'auto' | Speed; label: string }[] = [
    { v: 'auto', label: `Auto (${bpmPct(lesson, auto)})` },
    ...MANUAL_SPEEDS.filter((s) => s <= speedCap(rec)).map((s) => ({ v: s, label: bpmPct(lesson, s) })),
  ]
  // Shuffle mode: a straight chords or rhythm part, swung. Practice only.
  const ownSwing = !!lesson.backing && !!FEELS[lesson.backing.feel]?.swing
  const canShuffle = (lesson.type === 'chords' || lesson.type === 'rhythm') && !ownSwing
  const start = () => onStart({ shuffle: canShuffle && shuffle, quiet })

  // The whole chart and its fingering: the demos, the overview and Watch all use these.
  const chart = useMemo(() => {
    try {
      return lesson.type === 'sync' ? null : buildChart(lesson)
    } catch {
      return null
    }
  }, [lesson])
  const fingering = useMemo(() => {
    try {
      return chart ? fingeringFor(lesson, chart) : null
    } catch {
      return null
    }
  }, [lesson, chart])
  const watch = useWatch(lesson, chart, prefs)
  const { from: watchFrom, beatNow: watchBeat, bpm: watchBpm, stop: stopWatch } = watch
  const follow = useMemo(() => (watchFrom !== null ? { beatNow: watchBeat, bpm: watchBpm } : null), [watchFrom, watchBeat, watchBpm])
  const leave = (go: () => void) => () => {
    stopWatch()
    go()
  }

  useEffect(() => {
    startRef.current?.focus()
  }, [])

  // A song lesson in another tuning: the Tuner tab offers it as the song's tuning.
  useEffect(() => {
    if (lesson.tuning) setSongTuning({ song: lesson.title, notes: lesson.tuning })
  }, [lesson])

  // Esc goes back (a dialog on top handles its own Esc).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null
      if (t && t.closest('input, select, textarea, [role="dialog"]')) return
      if (ev.key === 'Escape') {
        stopWatch()
        onBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack, stopWatch])

  const keyboardMode = prefs.keyboard || !e.running
  const cal = loadLatency(keyboardMode ? KEYBOARD_DEVICE : deviceKey())
  const calibrated = !!cal
  // only a live guitar or mic hears the delay; the keyboard has no sound to lag behind
  const latency = latencyAdvice(e.running && !keyboardMode ? engine.latencyMs : 0, keyboardMode ? null : cal)
  // The picker already asks mic users for headphones.
  const mic = e.running && prefs.input === 'cable' ? micWarning() : null
  const connect = () => {
    connectSource(prefs.input, prefs.micId).catch(() => onConnect())
  }
  const muted = clicksMuted()
  const stage = dinoStageFor(progress)

  return (
    <div className="ls-intro">
      <button className="ls-back" onClick={leave(onBack)} aria-label="Back to the map">
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="M10 3 5 8l5 5" />
        </svg>
        Back
      </button>

      <header className="ls-intro-head">
        <div className="ls-intro-title">
          <p className="ls-intro-where ls-num">
            {whereLabel(lesson.id)}
          </p>
          <h2 className="ls-display">{lesson.title}</h2>
          <p className="ls-goal">{lesson.goal}</p>
          {rec && rec.plays > 0 && (
            <p className="ls-best">
              <StarPips stars={rec.stars} /> <span className="ls-num">{rec.best}%</span> · best chain <span className="ls-num">{rec.bestChain}</span>
              {standing && (
                <>
                  {' '}
                  · <span className={`ls-standing ${standingOf(rec)}`}>{standing}</span>
                </>
              )}
            </p>
          )}
          {learnNote && <p className="ls-muted ls-learn-note">{learnNote}</p>}
          {stuck && <p className="ls-note ls-stuck">{stuck}</p>}
          {star3 && !stuck && <p className="ls-muted ls-star3">{star3.text}</p>}
          {habit && <p className="ls-note ls-habit">{habit.text}</p>}
        </div>
        <div className="ls-intro-dino">
          {lesson.tips[0] && <p className="ls-bubble">{lesson.tips[0]}</p>}
          <Dino stage={stage} mood="idle" size={110} cosmetics={progress.cosmetics} />
          <span className="ls-sr">{DINO_STAGES[stage]?.name}</span>
        </div>
      </header>

      <div className="ls-intro-grid">
        <div className="ls-controls">
          <div className="ls-field tm-speeds">
            <span className="ls-field-label">Speed</span>
            <Seg
              label="Speed"
              value={pick ?? 'auto'}
              options={speedOptions}
              onPick={(v) => onPrefs({ ...prefs, speedPick: v === 'auto' ? null : { lessonId: lesson.id, speed: v } })}
            />
            {pick === null && <small className="ls-muted">{autoHint}</small>}
            {lesson.type !== 'improv' && trial && trial.first && (
              <small className="ls-muted">
                At <span className="ls-num">{bpmAt(lesson, trial.speed)}</span> BPM: <span className="ls-num">{trial.clean}</span> of {EARN_PASSES} clean.
              </small>
            )}
            {speed < 1 && (
              <small className="ls-muted">
                Practice speed: up to 2 <StarGlyph />
                <span className="ls-sr">stars</span>. Pass at full tempo for all 3.
              </small>
            )}
          </div>
          {canShuffle && (
            <div className="ls-field">
              <span className="ls-field-label">Feel</span>
              <Seg
                label="Feel"
                value={shuffle ? 'shuffle' : 'straight'}
                options={[
                  { v: 'straight', label: 'Straight' },
                  { v: 'shuffle', label: 'Shuffle' },
                ]}
                onPick={(v) => setShuffle(v === 'shuffle')}
              />
              {shuffle && (
                <small className="ls-muted">Shuffle: the same part, swung long-short and judged on the swung grid. Practice only: it never changes your straight record.</small>
              )}
            </div>
          )}
          {lesson.type !== 'sync' && (
            <Switch on={quiet} set={setQuiet} label="Listen mode" note="band louder, no tab, the summary at the end" />
          )}
          <Switch on={prefs.easyTiming} set={(v) => onPrefs({ ...prefs, easyTiming: v })} label="Easy timing" note="wider windows" />
          {prefs.backingOn && <TrackPicker lesson={given} prefs={prefs} onPrefs={onPrefs} />}
          {lesson.backing && (
            <Switch on={prefs.backingOn} set={(v) => onPrefs({ ...prefs, backingOn: v })} label="Band" note={prefs.input === 'mic' ? 'Use headphones' : 'Off: click only'} />
          )}
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
          {lesson.tuning && (
            <p className="ls-warn">
              Tune to <b>{describeTuning(lesson.tuning)}</b> ({tuningLabel(lesson.tuning)}) first.{' '}
              <button className="ls-btn small" onClick={() => window.dispatchEvent(new Event('fretwise-open-tuner'))}>
                Open the Tuner
              </button>
            </p>
          )}
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
          {latency.warn && <LatencyNote advice={latency} />}
          {e.running ? (
            <button ref={startRef} className="ls-btn primary big" onClick={leave(start)} data-pedal="go">
              Start
            </button>
          ) : (
            <div className="ls-connect">
              <button ref={startRef} className="ls-btn primary big" onClick={connect} data-pedal="go">
                {prefs.input === 'mic' ? 'Connect microphone' : 'Connect guitar'}
              </button>
              <button className="ls-btn" onClick={leave(start)}>
                Try with the keyboard
              </button>
            </div>
          )}
        </div>
      </div>

      <BoxPreview lesson={lesson} />

      {chart && fingering && <TeachPanel lesson={lesson} chart={chart} fingering={fingering} prefs={prefs} onPrefs={onPrefs} follow={follow} />}

      {chart && fingering && (
        <section className="tc-ov-box" aria-labelledby="tc-ov-title">
          <div className="tc-ov-top">
            <h3 id="tc-ov-title" className="tc-ov-title">
              The whole lesson
            </h3>
            <div className="tc-ov-ctl">
              <button className={`ls-btn small ${watchFrom !== null ? 'on' : ''}`} onClick={() => (watchFrom !== null ? stopWatch() : watch.start(0))}>
                <svg className="tc-glyph" viewBox="0 0 12 12" aria-hidden>
                  {watchFrom !== null ? <rect x={2} y={2} width={8} height={8} rx={1.5} /> : <path d="M3 1.8 10.2 6 3 10.2Z" />}
                </svg>
                {watchFrom !== null ? 'Stop' : 'Watch'}
              </button>
              <Seg label="Watch speed" value={watch.speed} options={WATCH_SPEEDS} onPick={watch.setSpeed} />
              <button className="ls-link tc-ov-runway" onClick={leave(onListen)}>
                or watch it on the runway
              </button>
            </div>
          </div>
          <p className="tc-ov-hint">Tap a bar to watch from there.</p>
          <LessonOverview
            lesson={lesson}
            chart={chart}
            fingering={fingering}
            beatNow={watchBeat}
            countIn={watch.countIn}
            parkBar={watchFrom}
            onBar={watch.start}
          />
        </section>
      )}

      {lesson.tips.length > 1 && (
        <ul className="ls-tips">
          {lesson.tips.slice(1).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}

    </div>
  )
}
