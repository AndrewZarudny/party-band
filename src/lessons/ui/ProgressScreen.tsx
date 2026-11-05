// "Your progress": what is sticking, measured cold at the start of a session (research section 7).
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { Progress } from '../types'
import { loadStats } from '../../skills/store'
import { RETIRE_AT } from '../../skills/chords'
import {
  DRIFT_GAP,
  DRIFT_TARGET,
  FRET_TARGET_SEC,
  bendSeries,
  changesByPair,
  coldPassRate,
  coldSeries,
  driftSeries,
  earFirstSeries,
  fretTimes,
  gapList,
  jamQuality,
  minutesVsPlan,
  painFlags,
  timingTrend,
  weeksVsGoal,
} from '../metrics'
import { sessionNow, weekKey } from '../review'
import { BandLine, Bars, Sparkline } from './MiniCharts'
import './metrics.css'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const ms = (v: number) => {
  const r = Math.round(v)
  return r === 0 ? 'right on the beat' : `${Math.abs(r)} ms ${r > 0 ? 'late' : 'early'}`
}
const pct = (v: number) => `${Math.round(v * 100)}%`

function Section({ title, why, rule, children }: { title: string; why: string; rule: string; children: ReactNode }) {
  return (
    <section className="mt-section">
      <h3 className="mt-h">{title}</h3>
      <p className="ls-muted mt-why">{why}</p>
      <p className="mt-rule">{rule}</p>
      {children}
    </section>
  )
}

function Empty({ hint }: { hint: string }) {
  return (
    <p className="ls-muted mt-empty">
      No data yet. {hint}
    </p>
  )
}

export function ProgressScreen({ progress: p, onBack, onOpen }: { progress: Progress; onBack: () => void; onOpen: (lessonId: string) => void }) {
  const stats = useMemo(loadStats, [])
  const now = new Date()
  const s = sessionNow(p, now)

  const weeks = weeksVsGoal(p, now)
  const pain = painFlags(p, now)
  const painWeeks = weeks.weeks.map((w) => pain.some((f) => weekKey(f.day) === w.week))
  const sharp = pain.filter((f) => f.pain === 'sharp').length
  const minutes = minutesVsPlan(p)
    .filter((m) => m.plan !== null)
    .slice(-8)

  const cold = coldSeries(p)
  const rate = coldPassRate(p)
  const gaps = gapList(p)
  const straight = timingTrend(p, false)
  const swung = timingTrend(p, true)
  const drift = driftSeries(stats)
  const pairs = changesByPair(stats)
  const frets = fretTimes(stats)
  const ear = earFirstSeries(stats)
  const jam = jamQuality(p, stats)
  const bends = bendSeries(p)

  return (
    <section className="ls-panel mt-screen" aria-labelledby="mt-h">
      <header className="ls-panel-head">
        <button className="ls-btn ghost small" onClick={onBack}>
          Back
        </button>
        <div>
          <h2 id="mt-h" className="ls-display">
            Your progress
          </h2>
          <p className="ls-muted">Measured cold, at the start of a session, where it counts.</p>
        </div>
      </header>

      <Section title="Sessions per week" why="A few sessions spread over the week tend to stick better than one long one (moderate evidence)." rule={`Goal: ${plural(weeks.goal, 'session')} a week. Any sharp, lingering or tingling pain: stop.`}>
        <Bars
          values={weeks.weeks.map((w) => w.count)}
          soft={weeks.weeks.map((w) => w.pocket)}
          flags={painWeeks}
          goal={weeks.goal}
          met={weeks.weeks.map((w) => w.met)}
          current={weeks.weeks.length - 1}
          label={`Sessions in the last 12 weeks, oldest first: ${weeks.weeks.map((w) => w.count).join(', ')}. Goal ${weeks.goal}.`}
        />
        <p className="mt-line-text">
          This week: {weeks.done} of {weeks.goal}.{weeks.streak >= 1 ? ` ${plural(weeks.streak, 'week')} in a row.` : ''}
          {weeks.weeks.some((w) => w.pocket) ? ' Light bars are pocket sessions.' : ''}
        </p>
        {pain.length > 0 && (
          <p className={sharp ? 'ls-warn' : 'mt-line-text'}>
            Pain flagged on {plural(pain.length, 'day')}
            {sharp ? `, sharp on ${sharp}` : ''}. Marked with a dot under the week.
            {sharp ? ' If it lasts more than a few days, see a physiotherapist.' : ''}
          </p>
        )}
        {minutes.length > 0 && (
          <p className="mt-line-text">
            Minutes vs plan, last {plural(minutes.length, 'session')}: {Math.round(minutes.reduce((a, m) => a + m.min, 0) / minutes.length)} of{' '}
            {Math.round(minutes.reduce((a, m) => a + (m.plan ?? 0), 0) / minutes.length)} min on average.
          </p>
        )}
      </Section>

      <Section
        title="Cold-start tempo"
        why="Your first try at an item, before any warm-up. This is what really stuck."
        rule="Move on when you hit the target in 2 separate sessions. Back to review when cold is more than 10 BPM under your last session's best (a rule of thumb)."
      >
        {cold.length ? (
          <>
            {rate.total > 0 && (
              <p className="mt-line-text">
                Clean at the first try: {rate.clean} of {rate.total} cold starts.
              </p>
            )}
            <ul className="mt-rows">
              {cold.map((c) => {
                const n = c.due - s
                const last = c.points[c.points.length - 1]
                return (
                  <li key={c.id} className="mt-row">
                    <button className="ls-link mt-row-title" onClick={() => onOpen(c.id)}>
                      {c.title}
                    </button>
                    {c.points.length ? (
                      <Sparkline
                        points={c.points.map((pt) => ({ v: pt.bpm, hollow: !pt.clean, title: `Session ${pt.s}: ${pt.bpm} BPM${pt.clean ? ', clean' : ', not clean'}` }))}
                        target={c.target}
                        label={`${c.title}: cold tempo ${c.points.map((pt) => pt.bpm).join(', ')} BPM, target ${c.target}`}
                      />
                    ) : (
                      <span className="ls-muted mt-small">No cold start yet</span>
                    )}
                    <span className="mt-status ls-num">
                      {last ? `${last.bpm} of ${c.target} BPM · ` : ''}
                      {c.learned ? 'Learned' : n <= 0 ? 'Due now' : `Next check in ${plural(n, 'session')}`}
                    </span>
                  </li>
                )
              })}
            </ul>
            <p className="ls-caption">Filled dots: clean. Hollow: not clean yet. The dashed line is the lesson's tempo.</p>
          </>
        ) : (
          <Empty hint="Pass a lesson, then play a cold-start test in your next session." />
        )}
      </Section>

      <Section title="Retention gap" why="Your best last session minus your cold tempo today." rule="It should shrink over time. A big gap that stays big means the tempo went up too early: slow down.">
        {gaps.length ? (
          <ul className="mt-rows">
            {gaps.map((g) => (
              <li key={g.id} className="mt-row">
                <button className="ls-link mt-row-title" onClick={() => onOpen(g.id)}>
                  {g.title}
                </button>
                <span className="ls-num">
                  {g.best} → {g.cold} BPM: a {g.gap} BPM gap
                  {g.prevGap !== null ? ` (was ${g.prevGap})` : ''}
                </span>
                {g.trend && <span className={`mt-chip ${g.trend === 'shrinking' ? 'good' : ''}`}>{g.trend === 'shrinking' ? 'Shrinking' : g.trend === 'growing' ? 'Growing' : 'Same'}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <Empty hint="It shows after a clean cold start that follows a session with a clean run." />
        )}
      </Section>

      <Section title="Timing vs the band" why="How early or late you play on average, and how much it varies. Shuffles are judged on the swung grid." rule="The trend matters more than any one number.">
        {straight.length || swung.length ? (
          <div className="mt-two">
            <TimingChart title="Straight" pts={straight} />
            <TimingChart title="Shuffle" pts={swung} />
          </div>
        ) : (
          <Empty hint="Play any lesson with at least 8 notes or chords." />
        )}
      </Section>

      <Section title="Inner clock" why="How far you drift when the click goes quiet, as a share of a beat." rule={`Target (a rule of thumb): under ${DRIFT_TARGET}% of a beat after ${DRIFT_GAP} silent bars.`}>
        {drift.length ? (
          <ul className="mt-rows">
            {drift.map((d) => (
              <li key={d.gap} className="mt-row">
                <span className="mt-row-title">{plural(d.gap, 'silent bar')}</span>
                <Sparkline
                  points={d.points.map((pt) => ({ v: pt.pct }))}
                  target={d.gap === DRIFT_GAP ? DRIFT_TARGET : undefined}
                  lowerBetter
                  label={`Drift after ${plural(d.gap, 'silent bar')}: ${d.points.map((pt) => pt.pct).join(', ')}% of a beat`}
                />
                <span className="mt-status ls-num">
                  {d.last !== null ? `${d.last}% of a beat` : ''}
                  {d.met === true ? ' · on target' : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty hint="Play a round of Inner clock in Skills." />
        )}
      </Section>

      <Section title="One-minute changes" why="Clean switches between two chords in 60 seconds." rule={`Retire a pair at ${RETIRE_AT} a minute (JustinGuitar).`}>
        {pairs.length ? (
          <ul className="mt-rows">
            {pairs.map((r) => (
              <li key={r.pair} className="mt-row">
                <span className="mt-row-title">{r.pair.replace('-', ' and ')}</span>
                {r.last.length ? <Sparkline points={r.last.map((v) => ({ v }))} target={RETIRE_AT} label={`${r.pair}: last rounds ${r.last.join(', ')}`} /> : <span />}
                <span className="mt-status ls-num">
                  Best {r.best}
                  {r.retired ? ' · retired' : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty hint="Play a round of One-minute changes. The first one is your baseline." />
        )}
      </Section>

      <Section title="Fretboard notes" why="How long you take to find a note, per string (the middle of your last 5 rounds)." rule={`Target (a rule of thumb): under ${FRET_TARGET_SEC} s a note on the low E and A strings.`}>
        {frets.some((f) => f.sec !== null) ? (
          <ul className="mt-rows mt-frets">
            {frets
              .filter((f) => f.sec !== null || f.target)
              .map((f) => (
                <li key={f.string} className="mt-row">
                  <span className="mt-row-title">{f.label}</span>
                  <span className="ls-num">{f.sec !== null ? `${f.sec} s` : '–'}</span>
                  {f.met !== null && <span className={`mt-chip ${f.met ? 'good' : ''}`}>{f.met ? 'Under 3 s' : 'Not yet'}</span>}
                </li>
              ))}
          </ul>
        ) : (
          <Empty hint="Play Find every note or Name that note in Skills." />
        )}
      </Section>

      <Section title="Ear" why="Share of phrases you echoed right at the first try." rule="Look for a rising trend.">
        {ear.length ? (
          <>
            <Sparkline points={ear.map((e) => ({ v: e.score }))} label={`Echoed right at the first try: ${ear.map((e) => e.score).join(', ')}%`} />
            <p className="mt-line-text ls-num">Last round: {ear[ear.length - 1].score}%</p>
          </>
        ) : (
          <Empty hint="Play a round of Ear training in Skills." />
        )}
      </Section>

      <Section title="Jam quality" why="In jams: notes on beats 1 and 3 that are chord tones, rests between phrases, and how your takes sounded to you." rule="Look for rising trends.">
        {jam.strong.length || jam.rest.length || jam.ratings.length ? (
          <div className="mt-two">
            {jam.strong.length > 0 && (
              <div>
                <p className="mt-sub">Strong beats on chord tones</p>
                <Sparkline points={jam.strong.map((j) => ({ v: j.share * 100 }))} label={`Strong-beat chord tones: ${jam.strong.map((j) => pct(j.share)).join(', ')}`} />
                <p className="mt-line-text ls-num">Last jam: {pct(jam.strong[jam.strong.length - 1].share)}</p>
              </div>
            )}
            {jam.rest.length > 0 && (
              <div>
                <p className="mt-sub">Rest between phrases</p>
                <Sparkline points={jam.rest.map((j) => ({ v: j.beats }))} label={`Rest between phrases: ${jam.rest.map((j) => j.beats.toFixed(1)).join(', ')} beats`} />
                <p className="mt-line-text ls-num">Last jam: {jam.rest[jam.rest.length - 1].beats.toFixed(1)} beats</p>
              </div>
            )}
            {jam.ratings.length > 0 && (
              <div>
                <p className="mt-sub">Your listen-back ratings</p>
                <Sparkline points={jam.ratings.map((j) => ({ v: j.score }))} label={`Ratings: ${jam.ratings.map((j) => j.score).join(', ')} of 5`} />
                <p className="mt-line-text ls-num">Last take: {jam.ratings[jam.ratings.length - 1].score} of 5</p>
              </div>
            )}
          </div>
        ) : (
          <Empty hint="Play a jam, and record and rate a take in Skills." />
        )}
      </Section>

      <Section title="Bends" why="How far your bends land from the target note, in cents (100 cents is one fret)." rule="Look for a trend toward 0.">
        {bends.length ? (
          <>
            <Sparkline points={bends.map((b) => ({ v: b.cents }))} lowerBetter label={`Bend error: ${bends.map((b) => b.cents).join(', ')} cents`} />
            <p className="mt-line-text ls-num">Last run: {bends[bends.length - 1].cents} cents off</p>
          </>
        ) : (
          <Empty hint="Play a lesson with bends, like the ones in Expression." />
        )}
      </Section>
    </section>
  )
}

function TimingChart({ title, pts }: { title: string; pts: { mean: number; spread: number }[] }) {
  const last = pts[pts.length - 1]
  return (
    <div>
      <p className="mt-sub">{title}</p>
      {last ? (
        <>
          <BandLine points={pts} label={`${title}: average offset ${pts.map((p) => Math.round(p.mean)).join(', ')} ms`} />
          <p className="mt-line-text ls-num">
            Last run: {ms(last.mean)}, spread {Math.round(last.spread)} ms
          </p>
        </>
      ) : (
        <p className="ls-muted mt-small">No runs yet.</p>
      )}
    </div>
  )
}
