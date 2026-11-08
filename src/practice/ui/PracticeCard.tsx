import './practice.css'
import { reachedGoal, useDailyGoal } from '../goal'
import { fmtDay, fmtDuration, usePractice } from '../stats'

/**
 * The account menu's practice block: today against the daily goal, this week, total, and this week's days as small
 * bars with the goal as a faint line. Days that reached it are gold; days off are just empty, never "missed".
 */
export function PracticeCard({ onOpen }: { onOpen: () => void }) {
  const p = usePractice()
  const goal = useDailyGoal()
  const goalSec = goal * 60
  // Headroom above the goal line so a day that just reached it still reads as a bar touching it.
  const top = Math.max(1800, goalSec * 1.25, ...p.week7.map((d) => d.total))
  const todayKey = p.last30[p.last30.length - 1].key
  const metToday = reachedGoal(p.today, goal)
  return (
    <section className="prac-card" aria-labelledby="prac-card-h">
      <h3 id="prac-card-h">Practice time</h3>
      <dl className="prac-figs">
        <div>
          <dt>Today</dt>
          <dd>{fmtDuration(p.today)}</dd>
          <dd className={`prac-note${metToday ? ' prac-met' : ''}`}>{metToday ? 'Goal met' : `of ${goal} min`}</dd>
        </div>
        <div>
          <dt>This week</dt>
          <dd>{fmtDuration(p.week)}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{fmtDuration(p.total)}</dd>
        </div>
      </dl>
      <ol className="prac-week" aria-label={`This week by day, daily goal ${goal} min`}>
        {p.week7.map((d) => {
          const future = d.key > todayKey
          const met = !future && reachedGoal(d.total, goal)
          const name = d.date.toLocaleDateString(undefined, { weekday: 'short' })
          return (
            <li key={d.key} className={`${d.key === todayKey ? 'today' : ''}${future ? ' future' : ''}${met ? ' met' : ''}`}>
              <span className="prac-week-bar" aria-hidden="true">
                <i style={{ height: `${Math.min(100, (d.total / top) * 100)}%` }} />
                <b className="prac-week-goal" style={{ bottom: `${(goalSec / top) * 100}%` }} />
              </span>
              <span className="prac-week-day" aria-hidden="true">
                {name.slice(0, 1)}
              </span>
              <span className="prac-sr">
                {future ? `${name}: still to come` : `${fmtDay(d.date, true)}: ${fmtDuration(d.total)}${met ? ', goal met' : ''}`}
              </span>
            </li>
          )
        })}
      </ol>
      <button type="button" className="acct-link" onClick={onOpen}>
        See your practice
      </button>
    </section>
  )
}
