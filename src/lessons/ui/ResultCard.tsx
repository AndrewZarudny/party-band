import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ApplyOutcome, Cosmetic, FactLine, ImprovMetric, Lesson, LessonResult, Verdict } from '../types'
import { factById } from '../facts/pick'
import { VERDICT_LABEL } from '../scoring'
import { DINO_STAGES, levelFor } from '../progress'
import { ACHIEVEMENTS } from '../achievements'
import { STAGES, lessonById, weeksLabel } from '../data'
import { EARN_PASSES, MIN_SPEED, bpmAt, tempoStep } from '../speed'
import { buildChart } from '../charts'
import { hardRange } from '../loop'
import { retentionGap } from '../review'
import { BarStrip } from './BarStrip'
import { Dino } from './Dino'
import { STAR } from './LessonMap'
import { RestTimer } from './RestTimer'
import './timing.css'

const COUNT_ORDER: Verdict[] = ['perfect', 'good', 'early', 'late', 'miss', 'wrong', 'clean-stop', 'ringing']
const METRIC_NAME: Record<ImprovMetric, string> = {
  inScale: 'In the scale',
  phrases: 'Phrases',
  space: 'Space',
  endings: 'Endings',
  targets: 'Chord tones',
  motif: 'Repeats',
  answers: 'Answers',
  echo: 'Echo',
}
const PICK = 'M20 41C13 34 3 23 3 13.5 3 6 10.5 2.5 20 2.5S37 6 37 13.5C37 23 27 34 20 41Z'
const NOTE = 'M15 4v24a6 5 0 1 1-3-4.3V8l14-3v4z'

function reducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Number that counts up once, after `delay` ms. */
function useCountUp(to: number, delay: number, ms: number, skip: boolean) {
  const [v, setV] = useState(skip ? to : 0)
  useEffect(() => {
    if (skip) return
    let raf = 0
    let t0 = 0
    const timer = window.setTimeout(() => {
      const step = (now: number) => {
        if (!t0) t0 = now
        const k = Math.min(1, (now - t0) / ms)
        setV(Math.round(to * (1 - Math.pow(1 - k, 3))))
        if (k < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }, delay)
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(raf)
    }
  }, [to, delay, ms, skip])
  return v
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** One fun line, with its source behind a toggle. */
function PebbleLine({ line }: { line: FactLine }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const fact = line.factId ? factById(line.factId) : undefined
  const urls = fact ? fact.source_url.split(' ; ').filter((u) => /^https?:\/\//.test(u)) : []
  return (
    <li>
      <svg className="ls-pebble-pick" viewBox="0 0 40 44" aria-hidden>
        <path d={PICK} />
      </svg>
      <div>
        <p className="ls-pebble-text">{line.text}</p>
        {fact && (
          <>
            <button className="ls-pebble-src" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
              {open ? 'Hide source' : "Where's this from?"}
            </button>
            {open && (
              <div id={id} className="ls-pebble-ref">
                <p>{fact.source_title}</p>
                <p className="ls-pebble-links">
                  {urls.map((u) => (
                    <a key={u} href={u} target="_blank" rel="noopener noreferrer">
                      {hostOf(u)}
                    </a>
                  ))}
                </p>
                {fact.caveat && <p className="ls-pebble-caveat">{fact.caveat}</p>}
              </div>
            )}
          </>
        )}
      </div>
    </li>
  )
}

/** "Stomp & dust": the old dino stomps twice, dust hides the swap, the new one pops out. */
function GrowthScene({ from, to, name, cosmetics, still, onClose }: { from: number; to: number; name: string; cosmetics: Cosmetic[]; still: boolean; onClose: () => void }) {
  const [end, setEnd] = useState(still)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (end) {
      btn.current?.focus()
      return
    }
    const t = window.setTimeout(() => setEnd(true), 2600)
    return () => clearTimeout(t)
  }, [end])
  const stageName = DINO_STAGES[to]?.name ?? ''
  return (
    <div className={`ls-grow ${end ? 'end' : 'run'}`} role="dialog" aria-modal="true" aria-label={`${name} is a ${stageName} now`} onClick={() => setEnd(true)}>
      <div className="ls-grow-stage">
        <div className="ls-grow-shadow" />
        {!end && (
          <div className="ls-grow-old">
            <Dino stage={from} mood="focus" size={200} cosmetics={cosmetics} />
          </div>
        )}
        <div className="ls-grow-new">
          <Dino stage={to} mood="proud" size={200} cosmetics={cosmetics} />
        </div>
        {!end && (
          <div className="ls-grow-dust" aria-hidden>
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} style={{ '--i': i } as CSSProperties} />
            ))}
          </div>
        )}
        {!end && (
          <div className="ls-confetti" aria-hidden>
            {Array.from({ length: 16 }, (_, i) => {
              const a = (i / 16) * Math.PI * 2 + (i % 3) * 0.3
              const d = 90 + ((i * 37) % 60)
              const style = { '--dx': `${Math.cos(a) * d}px`, '--dy': `${Math.sin(a) * d - 40}px`, '--r': `${(i * 67) % 360}deg`, '--d': `${(i % 5) * 30}ms` } as CSSProperties
              return (
                <svg key={i} viewBox={i % 2 ? '0 0 40 44' : '0 0 32 32'} className={i % 4 < 2 ? 'acc' : 'grn'} style={style}>
                  <path d={i % 2 ? PICK : NOTE} />
                </svg>
              )
            })}
          </div>
        )}
      </div>
      <p className="ls-grow-caption">
        <b>{name}</b> is a <b>{stageName}</b> now!
      </p>
      <button
        ref={btn}
        className="ls-btn primary"
        onClick={(ev) => {
          ev.stopPropagation()
          onClose()
        }}
      >
        Nice!
      </button>
    </div>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "12 ms late on average, spread 20 ms": timing against the band. */
function timingLine(r: LessonResult): string | null {
  if (r.meanErrMs === null) return null
  const m = Math.round(r.meanErrMs)
  const where = m === 0 ? 'right on the beat on average' : `${Math.abs(m)} ms ${m > 0 ? 'late' : 'early'} on average`
  const spread = r.spreadMs !== null ? `, spread ${r.spreadMs} ms` : ''
  return `Timing vs the band: ${where}${spread}${r.swing ? ' (shuffle grid)' : ''}.`
}

/** The speed trainer's lines after a run: earned, in a trial, or a first try that wasn't clean. */
function speedLines(lesson: Lesson, o: NonNullable<ApplyOutcome['speed']>, pick: number | null): string[] {
  const bpm = bpmAt(lesson, o.played)
  const next = bpmAt(lesson, o.next)
  const out: string[] = []
  if (lesson.type === 'improv') out.push(`Played at ${bpm} BPM. Next time: ${next} BPM.`)
  else if (o.earned) out.push(`${bpm} BPM earned. Next time: ${next} BPM.`)
  else if (o.trial) {
    const left = EARN_PASSES - o.trial.clean
    out.push(`At ${bpm} BPM: ${o.trial.clean} of ${EARN_PASSES} clean runs. ${left === 1 ? 'One more clean run' : `${left} more clean runs`} and it's yours.`)
  } else if (o.next < o.played - 1.5 * tempoStep(lesson)) out.push(`Next time: ${next} BPM, a little slower. Get it clean there, then speed up.`)
  else if (o.next < o.played) out.push(`Your first try at ${bpm} BPM wasn't clean. Next time: ${next} BPM. Get the first try right, then speed up.`)
  else out.push(`Played at ${bpm} BPM. Next time: ${next} BPM.`)
  if (pick !== null) out.push(`Next time: ${bpmAt(lesson, pick)} BPM (your pick). Auto would play ${next} BPM.`)
  return out
}

export function ResultCard({
  lesson,
  result,
  outcome,
  pick,
  rest,
  onNext,
  onAgain,
  onSlower,
  onHome,
  onResync,
  onLoop,
}: {
  lesson: Lesson
  result: LessonResult
  outcome: ApplyOutcome
  /** This lesson's manual speed, null on Auto. */
  pick: number | null
  /** Seconds to rest before the next rep; null = no rest prompt. */
  rest: number | null
  onNext: (() => void) | null
  onAgain: () => void
  onSlower: () => void
  onHome: () => void
  onResync: () => void
  /** Loop some bars of this lesson; null when the lesson can't loop (sync, improv). */
  onLoop: ((from: number, to: number) => void) | null
}) {
  const [still] = useState(reducedMotion)
  const grew = outcome.stageAfter > outcome.stageBefore
  const [growOpen, setGrowOpen] = useState(false)
  const [grown, setGrown] = useState(false)
  const [tallied, setTallied] = useState(still)
  const [resting, setResting] = useState(rest !== null)
  const primary = useRef<HTMLButtonElement>(null)
  const p = outcome.progress

  const linesMs = 250 * 3 + 150
  const tallyDelay = linesMs + outcome.lines.length * 120
  const shownXp = useCountUp(outcome.xp, tallyDelay, 700, still)

  useEffect(() => {
    if (still) {
      if (grew) setGrowOpen(true)
      return
    }
    const t1 = window.setTimeout(() => setTallied(true), tallyDelay + 300)
    const t2 = grew ? window.setTimeout(() => setGrowOpen(true), tallyDelay + 1300) : 0
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [still, grew, tallyDelay])

  useEffect(() => {
    if (!growOpen) primary.current?.focus()
  }, [growOpen])

  const before = levelFor(p.xp - outcome.xp)
  const after = levelFor(p.xp)
  const levelUp = outcome.levelAfter > outcome.levelBefore
  const barShare = tallied ? (after.need ? after.into / after.need : 0) : before.need ? before.into / before.need : 0

  const counts = COUNT_ORDER.filter((v) => result.counts[v] > 0)
  const graded = result.counts.perfect + result.counts.good + result.counts.early + result.counts.late
  const timing = timingLine(result)
  const competence = outcome.competence
  const cold = outcome.cold
  const coldGap = cold && outcome.review ? outcome.review.due - cold.s : null
  // the newest clean cold attempt is this one only when this run was clean from cold
  const gapInfo = cold && cold.clean ? retentionGap(p.lessons[lesson.id]) : null
  const chords = result.chordStats
  const showResync = result.meanErrMs !== null && Math.abs(result.meanErrMs) > 40 && graded >= 12
  const mood = result.stars >= 2 ? 'proud' : result.passed ? 'happy' : 'idle'
  const short = Math.max(0, lesson.pass - result.score)
  const totalLine = outcome.lines.find((l) => l.label === 'Total')
  const lines = outcome.lines.filter((l) => l.label !== 'Total')
  const world = outcome.stageOpened ? STAGES.find((s) => s.id === outcome.stageOpened) : undefined
  // Picked once in applyResult and saved with progress, so a re-render shows the same lines.
  const factLines = outcome.factLines ?? []
  const chart = useMemo(() => buildChart(lesson), [lesson])
  const hard = useMemo(() => (result.barAcc ? hardRange(chart, result.barAcc) : null), [chart, result.barAcc])
  const strip = !!onLoop && !!result.barAcc && result.barAcc.some((a) => a !== null)

  return (
    <div className={`ls-result ${still ? 'still' : ''} ${result.passed ? 'passed' : 'failed'}`}>
      <header className="ls-result-head">
        <div className="ls-result-dino">
          <Dino stage={grew && !grown ? outcome.stageBefore : outcome.stageAfter} mood={mood} size={120} cosmetics={p.cosmetics} />
        </div>
        <div className="ls-result-score">
          <p className="ls-muted">{lesson.title}</p>
          <div className="ls-stars" role="img" aria-label={`${result.stars} of 3 stars`}>
            {[0, 1, 2].map((i) => (
              <svg key={i} viewBox="0 0 24 24" className={i < result.stars ? 'got' : ''} style={{ '--i': i } as CSSProperties} aria-hidden>
                <path d={STAR} />
              </svg>
            ))}
          </div>
          <p className="ls-score ls-num">{result.score}%</p>
          {!result.passed && short > 0 && <p className="ls-almost">Almost! {short} more points for a star.</p>}
        </div>
        {factLines.length > 0 && (
          <section className="ls-pebble" aria-label={`${p.dinoName} says`}>
            <p className="ls-pebble-who">{p.dinoName} says</p>
            <ul>
              {factLines.map((l) => (
                <PebbleLine key={l.factId ?? l.text} line={l} />
              ))}
            </ul>
          </section>
        )}
      </header>

      <div className="ls-result-body">
        <div className="ls-result-col">
          {counts.length > 0 && (
            <ul className="ls-counts">
              {counts.map((v) => (
                <li key={v} className={`v-${v}`}>
                  <b className="ls-num">{result.counts[v]}</b>
                  <span>{VERDICT_LABEL[v]}</span>
                </li>
              ))}
            </ul>
          )}
          {timing && <p className="ls-lean">{timing}</p>}
          {chords && (
            <ul className="tm-lines">
              <li>
                Chords: {chords.ok} rang true, {chords.wrong} sounded off{chords.unsure ? `, ${chords.unsure} I couldn't tell` : ''}.
                {chords.conf !== null && <span className="ls-muted"> How sure: {Math.round(chords.conf * 100)}%</span>}
              </li>
              {chords.unsure > 0 && <li className="ls-muted">When the sound isn't clear, Fretwise doesn't mark the chord wrong.</li>}
            </ul>
          )}
          {result.bendCents !== undefined && result.bendCents !== null && (
            <p className="ls-muted">Bends: {result.bendCents} cents off on average (100 cents is one fret).</p>
          )}
          {result.improv && (
            <div className="ls-metrics">
              {(Object.keys(result.improv.metrics) as ImprovMetric[]).map((m) => {
                const v = Math.round(result.improv?.metrics[m] ?? 0)
                return (
                  <div key={m} className="ls-metric">
                    <span>{METRIC_NAME[m]}</span>
                    <div className="ls-bar thin">
                      <span style={{ transform: `scaleX(${v / 100})` }} />
                    </div>
                    <b className="ls-num">{v}</b>
                  </div>
                )
              })}
              {result.improv.techniqueBonus > 0 && (
                <p className="ls-muted">
                  Technique bonus <b className="ls-num">+{result.improv.techniqueBonus}</b>
                </p>
              )}
              {result.improv.tips.length > 0 && (
                <ul className="ls-tips">
                  {result.improv.tips.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="ls-coach">{result.coachTip}</p>
          {outcome.speed && (
            <ul className="tm-lines ls-muted">
              {speedLines(lesson, outcome.speed, pick).map((l) => (
                <li key={l}>{l}</li>
              ))}
              {result.passed && outcome.speed.played < 1 && <li>Pass at full tempo for the 3rd star.</li>}
            </ul>
          )}
          {cold && (
            <p className="ls-muted">
              {cold.clean
                ? `Cold start at ${cold.bpm} BPM: clean.${coldGap !== null && coldGap > 0 ? ` Next check in ${plural(coldGap, 'session')}.` : ''}`
                : `Cold start at ${cold.bpm} BPM: not clean yet. You'll see it again next session, a little slower.`}
            </p>
          )}
          {gapInfo && gapInfo.gap !== null && gapInfo.best !== null && gapInfo.cold !== null && (
            <p className="ls-muted">
              Retention gap: best last session {gapInfo.best} BPM, cold today {gapInfo.cold} BPM, a {gapInfo.gap} BPM gap.
              {gapInfo.gap > 10 && ' A big gap usually means the tempo went up too early. Slow down; it will stick better.'}
            </p>
          )}
          {showResync && (
            <button className="ls-btn small" onClick={onResync}>
              Re-sync
            </button>
          )}
          {strip && result.barAcc ? (
            <BarStrip acc={result.barAcc} listen={chart.listenBars} hard={hard} onLoop={onLoop} />
          ) : (
            result.hardestBar !== null && <p className="ls-muted">Hardest bar: {result.hardestBar + 1}</p>
          )}
        </div>

        <div className="ls-result-col">
          {competence.length > 0 && (
            <section className="tm-better" aria-labelledby="tm-better-h">
              <h3 id="tm-better-h">What got better</h3>
              <ul>
                {competence.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
          )}
          <ol className="ls-xp">
            {lines.map((l, i) => (
              <li key={l.label} style={{ '--i': i } as CSSProperties}>
                <span>{l.label}</span>
                <b className="ls-num">{l.value}</b>
              </li>
            ))}
            <li className="total">
              <span>Total</span>
              <b className="ls-num">+{shownXp} XP</b>
              {totalLine && <span className="ls-sr">{totalLine.value}</span>}
            </li>
          </ol>
          <div className="ls-level">
            <span className="ls-level-n ls-num">Lv {tallied ? after.level : before.level}</span>
            <div className="ls-bar" role="progressbar" aria-valuemin={0} aria-valuemax={after.need} aria-valuenow={after.into} aria-label="XP to next level">
              <span style={{ transform: `scaleX(${barShare})` }} />
            </div>
          </div>
          {outcome.xp === 0 && <p className="ls-muted">No XP this run. XP comes from real gains: clean tempos, cold starts, learned items, week goals.</p>}
          {levelUp && tallied && <p className="ls-levelup ls-display">Level {outcome.levelAfter}!</p>}

          {(outcome.unlocked.length > 0 || world || outcome.newAchievements.length > 0) && (
            <ul className="ls-unlocks">
              {world && (
                <li className="world">
                  New stage open: {weeksLabel(world)} · {world.title}
                </li>
              )}
              {outcome.unlocked.map((id) => (
                <li key={id}>New lesson: {lessonById(id)?.title ?? id}</li>
              ))}
              {outcome.newAchievements.map((id) => (
                <li key={id} className="badge">
                  Badge: {ACHIEVEMENTS.find((a) => a.id === id)?.name ?? id}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {rest !== null && resting && (
        <div className="tm-rest-box">
          <p>Rest 20–30 s between runs. It helps your hands, and your next run.</p>
          <RestTimer sec={rest} onDone={() => setResting(false)} />
        </div>
      )}

      <div className="ls-actions">
        {onNext && (
          <button ref={primary} className="ls-btn primary" onClick={onNext}>
            Next lesson
          </button>
        )}
        <button ref={onNext ? undefined : primary} className={`ls-btn ${onNext ? '' : 'primary'}`} onClick={onAgain}>
          Again
        </button>
        {lesson.type !== 'sync' && result.speed > MIN_SPEED && (
          <button className="ls-btn" onClick={onSlower}>
            Slower practice
          </button>
        )}
        <button className="ls-btn ghost" onClick={onHome}>
          Home
        </button>
      </div>

      {growOpen && (
        <GrowthScene
          from={outcome.stageBefore}
          to={outcome.stageAfter}
          name={p.dinoName}
          cosmetics={p.cosmetics}
          still={still}
          onClose={() => {
            setGrowOpen(false)
            setGrown(true)
          }}
        />
      )}
    </div>
  )
}
