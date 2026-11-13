// "12-week plan": what each fortnight is for, its checkpoint, and where you are now (research section 5).
import { useMemo } from 'react'
import type { Progress } from '../types'
import { lessonById } from '../data'
import { loadStats } from '../../skills/store'
import type { CheckState } from '../weeks'
import { PLAN_WEEKS, pace, planWeek } from '../weeks'
import './metrics.css'

const CHIP: Record<CheckState, string> = { met: 'Met', partial: 'Getting there', open: 'Not yet' }

export function PlanWeeks({ progress: p, onBack, onOpen }: { progress: Progress; onBack: () => void; onOpen: (lessonId: string) => void }) {
  const stats = useMemo(() => loadStats(), [])
  const week = planWeek(p, new Date())
  const pc = pace(p, stats, new Date())

  return (
    <section className="ls-panel mt-screen" aria-labelledby="mt-weeks-h">
      <header className="ls-panel-head">
        <button className="ls-btn ghost small" onClick={onBack}>
          Back
        </button>
        <div>
          <h2 id="mt-weeks-h" className="ls-display">
            12-week plan
          </h2>
          <p className="ls-muted">
            {week > 12 ? 'Past week 12: keep jamming, and pick a goal: a jam with a friend or an open-mic night.' : `You are in week ${week}.`}
          </p>
        </div>
      </header>

      <section className={`mt-pace ${pc.state}`} aria-labelledby="mt-pace-h">
        <h3 id="mt-pace-h">{pc.headline}</h3>
        <ul>
          {pc.advice.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </section>

      <ol className="mt-weeks">
        {PLAN_WEEKS.map((w) => {
          const now = week >= w.from && week <= w.to
          const state = w.check(p, stats)
          return (
            <li key={w.from} className={`mt-week${now ? ' now' : ''}`} aria-current={now ? 'step' : undefined}>
              <div className="mt-week-head">
                <b className="ls-num">
                  Weeks {w.from}–{w.to}
                </b>
                {now && <span className="mt-chip now">Now</span>}
              </div>
              <p>{w.focus}</p>
              <ul className="mt-links">
                {w.lessons.map((id) => {
                  const l = lessonById(id)
                  if (!l) return null
                  const done = p.lessons[id]?.passedAt !== undefined
                  return (
                    <li key={id}>
                      <button className="ls-link" onClick={() => onOpen(id)}>
                        {l.title}
                      </button>
                      {done && <span className="ls-muted"> · passed</span>}
                    </li>
                  )
                })}
              </ul>
              <div className="mt-check">
                <span>Checkpoint: {w.checkpoint}</span>
                <span className={`mt-chip ${state === 'met' ? 'good' : state === 'partial' ? 'mid' : ''}`}>{CHIP[state]}</span>
              </div>
            </li>
          )
        })}
      </ol>

      <p className="ls-caption">Targets are heuristics, except 60 one-minute changes. Adjust them to your own data.</p>
      <p className="ls-caption">
        At 3–4 sessions a week, week 12 looks roughly like week 8–9 of a 5-day plan. That is still enough for a relaxed 12-bar jam.
      </p>
    </section>
  )
}
