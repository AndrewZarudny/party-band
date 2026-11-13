// Inner clock: the click drops out for a few bars while you keep strumming; how far you drifted shows when it returns.
import { useEffect, useRef, useState } from 'react'
import { engine } from '../../audio/engine'
import type { CycleResult } from '../clock'
import { CYCLES, ClockRun, STEADY_MS } from '../clock'
import { clicksMuted } from '../../lessons/clock'
import { dailyBest } from '../data'
import { finishRound, loadStats, setLevels } from '../store'
import { inputOffsetSec, useGuitar, useKeys, useRoundActivity, useTick } from '../hooks'
import type { RoundSummary } from './Common'
import { GameHead, RoundDone, TrendChart } from './Common'

const TEMPOS = [60, 70, 80, 90, 100, 110, 120]

const bars = (n: number) => `${n} ${n === 1 ? 'bar' : 'bars'}`
const fmtMs = (d: number | null) => (d === null ? 'not heard' : d === 0 ? 'on time' : `${Math.abs(d)} ms ${d > 0 ? 'late' : 'early'}`)

export function InnerClock({ keyboard, onBack }: { keyboard: boolean; onBack: () => void }) {
  const [bpm, setBpm] = useState(80)
  const [running, setRunning] = useState(false)
  const [cycles, setCycles] = useState<CycleResult[]>([])
  const [gap, setGap] = useState(() => loadStats().levels.clockGap)
  const [done, setDone] = useState<RoundSummary | null>(null)
  const [stats, setStats] = useState(loadStats)
  const [hits, setHits] = useState(0)
  const run = useRef<ClockRun | null>(null)
  const offset = useRef(0)
  const results = useRef<CycleResult[]>([])
  const gapRef = useRef(gap)

  useRoundActivity(running)
  useTick(running, 100)

  useEffect(() => () => run.current?.stop(), [])

  const finish = () => {
    setRunning(false)
    run.current = null
    const rs = results.current
    const lastDrifts = rs.map((r) => r.drifts[r.drifts.length - 1]).filter((d): d is number => d !== null && d !== undefined)
    const steady = rs.filter((r) => r.ok).length
    setLevels({ clockGap: gapRef.current })
    // Drift of each cycle's last quiet bar as % of a beat, by quiet bars, for the progress screen (no XP).
    const beatMs = 60000 / bpm
    for (const c of rs) {
      const d = c.drifts[c.drifts.length - 1]
      if (d !== null && d !== undefined) finishRound('drift', Math.round((100 * Math.abs(d)) / beatMs), String(c.gap))
    }
    if (!lastDrifts.length) {
      setDone({ headline: 'No strums heard in the quiet bars', lines: [], best: false, xp: 0, note: 'Keep strumming on every beat while the click is off.' })
      return
    }
    const avg = Math.round(lastDrifts.reduce((s, d) => s + Math.abs(d), 0) / lastDrifts.length)
    const r = finishRound('clock', avg)
    setStats(r.stats)
    setDone({
      headline: `${avg} ms off on average`,
      lines: [
        ['Steady cycles', `${steady} of ${rs.length}`],
        ['Longest quiet', bars(Math.max(...rs.map((x) => x.gap)))],
        ['Tempo', `${bpm} BPM`],
      ],
      best: r.best,
      xp: r.xp,
      note: avg <= STEADY_MS ? 'Steady. The quiet stretch grows as you stay on time.' : 'Count out loud in the quiet bars: "1, 2, 3, 4".',
    })
  }

  const start = async () => {
    if (clicksMuted()) return
    const ctx = await engine.ensureContext()
    offset.current = inputOffsetSec(keyboard)
    results.current = []
    setCycles([])
    setHits(0)
    setDone(null)
    gapRef.current = gap
    const r = new ClockRun(ctx, bpm, gap, {
      onCycle: (res, next) => {
        results.current = [...results.current, res]
        gapRef.current = next
        setCycles(results.current)
        setGap(next)
      },
      onEnd: finish,
    })
    run.current = r
    r.start()
    setRunning(true)
  }

  const stop = () => {
    run.current?.stop()
    run.current = null
    setRunning(false)
  }

  const strum = (raw: number) => {
    run.current?.strum(raw - offset.current)
    setHits((n) => n + 1)
  }
  useGuitar(running && !keyboard, { strum })
  // Keys stand in for strums only without a guitar.
  useKeys(running && keyboard, (k, t) => {
    if (k === ' ' || k === 'j') strum(t)
  })

  // The click bars are the tempo to hold: with the metronome at 0 there is nothing to hear.
  const [, bump] = useState(0)
  const muted = clicksMuted()

  const ctx = engine.ctx
  // eslint-disable-next-line react-hooks/refs -- the bar playing now on the audio clock; useTick re-renders while the round runs
  const bar = running && ctx && run.current ? run.current.barAt(ctx.currentTime) : null
  const lastCycle = cycles[cycles.length - 1]

  return (
    <section className="sk-game" aria-labelledby="sk-game-h">
      <GameHead title="Inner clock" sub={`Strum on every beat. The click stops for a few bars; keep going until it comes back.`} onBack={onBack} />
      {done ? (
        <RoundDone s={done} onAgain={start} onBack={onBack}>
          <CycleList cycles={cycles} />
          <TrendChart points={dailyBest(stats, 'clock')} unit="ms" label="Average drift per day (lower is better)" lowerBetter />
        </RoundDone>
      ) : (
        <>
          {!running && (
            <div className="sk-pick-row">
              <div className="ls-field sk-field">
                <span className="ls-field-label">Tempo</span>
                <div className="ls-seg" role="group" aria-label="Tempo">
                  {TEMPOS.map((t) => (
                    <button key={t} className={t === bpm ? 'on' : ''} onClick={() => setBpm(t)} aria-pressed={t === bpm}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <p className="ls-muted">
                Quiet stretch: {bars(gap)}. {CYCLES} rounds.
              </p>
            </div>
          )}
          <div className={`sk-pulse ${bar ? (bar.click ? 'click' : 'quiet') : ''}`} aria-live="polite">
            {!running ? (
              <p>Two bars of click, then quiet. Strum or pick on each beat.</p>
            ) : bar?.click ? (
              <p>
                <b className="sk-big">Click</b> · round {Math.min(CYCLES, bar.cycle + 1)} of {CYCLES}
              </p>
            ) : bar ? (
              <p>
                <b className="sk-big">Keep going</b> · quiet bar {bar.gapIdx + 1}
              </p>
            ) : (
              <p>Get ready</p>
            )}
            {running && lastCycle && <p className="ls-muted">Last quiet bar: {fmtMs(lastCycle.drifts[lastCycle.drifts.length - 1] ?? null)}</p>}
          </div>
          {!running && muted && (
            <p className="ls-warn">
              Your metronome volume is off, so the click bars would be silent.{' '}
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
          <div className="sk-actions">
            {!running ? (
              <button className="ls-btn primary big" onClick={() => void start()} disabled={muted} autoFocus>
                Start
              </button>
            ) : (
              <button className="ls-btn ghost" onClick={stop}>
                Stop
              </button>
            )}
          </div>
          {cycles.length > 0 && <CycleList cycles={cycles} />}
          <p className="ls-caption">
            {keyboard ? 'No guitar: tap Space on each beat.' : 'Single strums or picked notes both work.'} Heard <span className="ls-num">{hits}</span>.
          </p>
        </>
      )}
    </section>
  )
}

function CycleList({ cycles }: { cycles: CycleResult[] }) {
  return (
    <ol className="sk-cycles">
      {cycles.map((c, i) => (
        <li key={i} className={c.ok ? 'ok' : ''}>
          <span>{bars(c.gap)} quiet</span>
          <span className="ls-num">{c.drifts.map(fmtMs).join(' · ')}</span>
        </li>
      ))}
    </ol>
  )
}
