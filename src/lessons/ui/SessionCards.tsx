// Session pieces around the plan: week dots, the weekly note, the pain check-in, the Cold start card,
// the pocket session card and the mental rehearsal card.
import { useEffect, useMemo, useState } from 'react'
import type { NoteEv, PainLevel, Progress } from '../types'
import type { SkillStart } from '../../skills/data'
import { lessonById } from '../data'
import { buildChart } from '../charts'
import { dayKey, isPassed } from '../progress'
import { weekKey, weekStatus } from '../review'
import { useStill } from './teach/useFrame'
import { FootGlyph } from './LessonMap'
import './schedule.css'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** This week as 7 dots (filled = a session, ring = pocket only), the goal line and the week streak. */
export function WeekDots({ progress, now }: { progress: Progress; now: Date }) {
  const ws = weekStatus(progress, now)
  const monday = new Date(weekKey(dayKey(now)) + 'T12:00:00')
  const log = progress.sessions?.log ?? []
  const today = dayKey(now)
  const days = DAY_NAMES.map((name, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const e = log.find((x) => x.day === key)
    return { name, key, state: e?.counted ? 'done' : e?.pocket ? 'pocket' : 'none', today: key === today }
  })
  return (
    <div className="sc-week">
      <ol className="sc-dots" aria-label={`This week: ${ws.done} of ${ws.goal} sessions`}>
        {days.map((d) => (
          <li key={d.key} className={`sc-dot ${d.state} ${d.today ? 'today' : ''}`}>
            <span aria-hidden className="sc-dot-mark" />
            <span className="sc-dot-name" aria-hidden>
              {d.name[0]}
            </span>
            <span className="ls-sr">
              {d.name}: {d.state === 'done' ? 'session' : d.state === 'pocket' ? 'pocket session' : 'no session'}
            </span>
          </li>
        ))}
      </ol>
      <p className="sc-week-text">
        This week: <b className="ls-num">{ws.done}</b> of <b className="ls-num">{ws.goal}</b> sessions
      </p>
      {ws.streak >= 1 && (
        <p className="sc-week-streak">
          <FootGlyph /> {ws.streak} week{ws.streak === 1 ? '' : 's'} in a row
        </p>
      )}
    </div>
  )
}

/** One time: Fretwise counts weeks now. */
export function WeeklyNote({ goal, onDone }: { goal: number; onDone: () => void }) {
  return (
    <div className="sc-note" role="status">
      <p>Fretwise now counts weeks, not days. Your goal is {goal} sessions a week, and days off are part of the plan.</p>
      <button className="ls-btn small" onClick={onDone}>
        Got it
      </button>
    </div>
  )
}

const PAIN_REPLY: Record<PainLevel, string> = {
  none: 'Good. Keep the grip light and the thumb relaxed.',
  mild: "Ease off: lighter grip, shorter blocks, a short break between reps. If it's still there next session, take a day off.",
  sharp: 'Stop for today. Sharp, lingering or tingling pain, or numbness that lasts, is a stop sign. If it lasts more than a few days, see a physiotherapist.',
}

/** Hand health: asked once a session. */
export function PainCheck({ answer, onPain, onPressure }: { answer: PainLevel | null; onPain: (p: PainLevel | null) => void; onPressure: () => void }) {
  if (answer) {
    return (
      <div className={`sc-pain ${answer}`} role="status">
        <p>{PAIN_REPLY[answer]}</p>
        {answer !== 'none' && (
          <button className="ls-link" onClick={onPressure}>
            Minimum pressure drill
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="sc-pain">
      <p id="sc-pain-q">Any hand or wrist pain today?</p>
      <div className="sc-pain-acts" role="group" aria-labelledby="sc-pain-q">
        <button className="ls-btn small" onClick={() => onPain('none')}>
          No pain
        </button>
        <button className="ls-btn small" onClick={() => onPain('mild')}>
          Mild
        </button>
        <button className="ls-btn small" onClick={() => onPain('sharp')}>
          Sharp
        </button>
        <button className="ls-link" onClick={() => onPain(null)}>
          Skip
        </button>
      </div>
    </div>
  )
}

/** The plan head's note after a session with pain. */
export function PainNote({ pain }: { pain: PainLevel | null }) {
  if (pain !== 'sharp' && pain !== 'mild') return null
  return (
    <p className={`sc-pain-note ${pain}`}>
      {pain === 'sharp' ? 'Last time you flagged sharp pain. Go gently, and stop if it comes back.' : 'Last time you flagged mild pain. Keep the grip light today.'}
    </p>
  )
}

/** Before a cold-start test: what it is and why there's no warm-up or tab. */
export function ColdStart({
  title,
  goal,
  bpm,
  speed,
  last,
  onStart,
  onBack,
}: {
  title: string
  goal?: string
  bpm: number
  speed?: number
  /** The last first try and the best ever, for a target and some perspective. */
  last?: { day: string; score: number; best: number } | null
  onStart: () => void
  onBack: () => void
}) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])
  return (
    <section className="sc-card sc-cold" aria-labelledby="sc-cold-h">
      <h2 id="sc-cold-h" className="ls-display">
        Cold start: {title}
      </h2>
      {/* What the lesson asks, so a first try after a few days doesn't start blind; the notes stay hidden. */}
      {goal && (
        <p className="sc-cold-goal">
          <span className="ls-field-label">The lesson</span> {goal}
        </p>
      )}
      <p>First try, no warm-up, no tab. This shows what stuck since last time, not what you can do after practising.</p>
      {last && (
        <p className="sc-facts ls-num">
          Last first try ({new Date(last.day + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}): {last.score}% · your best: {last.best}%
        </p>
      )}
      <p className="sc-facts ls-num">
        {bpm} BPM{speed !== undefined && speed < 1 ? ` (${Math.round(speed * 100)}%)` : ''} · no tab
      </p>
      {speed !== undefined && speed < 1 && <p className="ls-muted">Clean at full tempo is what counts toward learned. Each clean cold start brings the next one a little closer.</p>}
      <p className="ls-muted">Stuck? Peek shows the tab for 3 seconds: the button under the runway, or the next foot pedal.</p>
      <div className="sc-acts">
        <button className="ls-btn primary" onClick={onStart} autoFocus data-pedal="go">
          Start
        </button>
        <button className="ls-btn ghost" onClick={onBack}>
          Not now
        </button>
      </div>
    </section>
  )
}

/** The optional 5-minute pocket session: it never counts, so there's nothing to lose. */
export function PocketCard({ open, pair, onPick }: { open: boolean; pair: string | null; onPick: (s: SkillStart) => void }) {
  const [shown, setShown] = useState(open)
  if (!shown) {
    return (
      <p className="sc-pocket-link">
        <button className="ls-link" onClick={() => setShown(true)}>
          Short on time? A 5-minute pocket session.
        </button>
      </p>
    )
  }
  return (
    <section className="sc-card sc-pocket" aria-labelledby="sc-pocket-h">
      <h3 id="sc-pocket-h">Pocket session · 5 min, optional</h3>
      <p className="ls-muted">It doesn't count toward anything, so there's nothing to lose.</p>
      <div className="sc-acts">
        {pair && (
          <button className="ls-btn small" onClick={() => onPick({ game: 'changes', pair })}>
            One-minute changes: {pair}
          </button>
        )}
        <button className="ls-btn small" onClick={() => onPick({ game: 'find' })}>
          Fretboard notes
        </button>
        <button className="ls-btn small" onClick={() => onPick({ game: 'mental' })}>
          Lick in your head
        </button>
      </div>
    </section>
  )
}

const MENTAL_SEC = 60

/** A lick drawn as plain tab: six lines, fret numbers in order (no timing). */
function StaticTab({ notes }: { notes: NoteEv[] }) {
  const w = Math.max(160, 24 + notes.length * 26)
  const y = (s: number) => 12 + (5 - s) * 14
  return (
    <svg className="sc-tab" viewBox={`0 0 ${w} 94`} role="img" aria-label={`Tab: ${notes.map((n) => `string ${6 - n.string} fret ${n.fret}`).join(', ')}`}>
      {[0, 1, 2, 3, 4, 5].map((s) => (
        <line key={s} x1={4} x2={w - 4} y1={y(s)} y2={y(s)} className="sc-tab-line" />
      ))}
      {notes.map((n, i) => (
        <g key={n.id}>
          <rect x={18 + i * 26} y={y(n.string) - 7} width={16} height={14} className="sc-tab-bg" />
          <text x={26 + i * 26} y={y(n.string) + 4} textAnchor="middle" className="sc-tab-fret">
            {n.fret}
          </text>
        </g>
      ))}
    </svg>
  )
}

/** Lick in your head: mental rehearsal with the tab of a lick you know and a one-minute timer. */
export function MentalCard({ progress, onBack }: { progress: Progress; onBack: () => void }) {
  const still = useStill()
  const id = isPassed(progress, 'w5-07') || progress.lessons['w5-07']?.review?.learned ? 'w5-07' : 'w5-04'
  const lesson = lessonById(id)
  const notes = useMemo(() => {
    if (!lesson) return []
    const evs = buildChart(lesson).events.filter((e): e is NoteEv => e.kind === 'note')
    return evs.filter((e) => e.beat < 4).slice(0, 10)
  }, [lesson])
  const [left, setLeft] = useState(MENTAL_SEC)
  const [running, setRunning] = useState(false)
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(t)
  }, [running])
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])
  const share = left / MENTAL_SEC
  return (
    <section className="sc-card sc-mental" aria-labelledby="sc-mental-h">
      <h2 id="sc-mental-h" className="ls-display">
        Lick in your head
      </h2>
      <p>Picture a lick you know, finger by finger, at a slow tempo. Hear each note. Go through it three times.</p>
      {lesson && notes.length > 0 && (
        <figure className="sc-mental-tab">
          <StaticTab notes={notes} />
          <figcaption className="ls-muted">{lesson.title}</figcaption>
        </figure>
      )}
      <div className="sc-timer">
        <svg viewBox="0 0 48 48" aria-hidden className={still ? 'still' : ''}>
          <circle cx="24" cy="24" r="20" className="sc-timer-track" />
          <circle cx="24" cy="24" r="20" className="sc-timer-fill" strokeDasharray={`${2 * Math.PI * 20 * share} ${2 * Math.PI * 20}`} transform="rotate(-90 24 24)" />
        </svg>
        <span className="ls-num" aria-live={left % 15 === 0 ? 'polite' : 'off'}>
          {left} s
        </span>
        {!running && left > 0 && (
          <button className="ls-btn small" onClick={() => setRunning(true)}>
            Start the minute
          </button>
        )}
        {left === 0 && <span>Done. Nice work.</span>}
      </div>
      <p className="ls-muted">Mental practice helps as an add-on to playing, never instead of it.</p>
      <div className="sc-acts">
        <button className="ls-btn ghost" onClick={onBack}>
          Back
        </button>
      </div>
    </section>
  )
}
