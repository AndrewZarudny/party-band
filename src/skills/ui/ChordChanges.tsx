// One-minute chord changes: strum one chord, switch, strum the other. Each clean switch counts.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChordDiagram } from '../../components/PartViews'
import { guitarShape } from '../../music/parts'
import { parseChord } from '../../music/theory'
import { CHANGE_CHORDS, RETIRE_AT, countStrum, emptyCount, judgeStrum, pairKey } from '../chords'
import { bestKey, dailyBest } from '../data'
import { finishRound, loadStats } from '../store'
import { useGuitar, useKeys, useRoundActivity, useTick } from '../hooks'
import type { RoundSummary } from './Common'
import { GameHead, RoundDone, Timer, TrendChart } from './Common'

const ROUND_SEC = 60

function Shape({ name, on }: { name: string; on: boolean }) {
  const chord = parseChord(name)
  if (!chord) return null
  return (
    <div className={`sk-chord ${on ? 'on' : ''}`}>
      <ChordDiagram shape={guitarShape(chord)} name={name} size={0.9} />
    </div>
  )
}

/** The two chords of a pair key like 'A-E', when both are on offer. */
function splitPair(pair: string | undefined): [string, string] | null {
  const [a, b] = pair?.split('-') ?? []
  return a && b && CHANGE_CHORDS.includes(a) && CHANGE_CHORDS.includes(b) && a !== b ? [a, b] : null
}

export function ChordChanges({ keyboard, onBack, pair: startPair }: { keyboard: boolean; onBack: () => void; pair?: string }) {
  const [a, setA] = useState(() => splitPair(startPair)?.[0] ?? 'E')
  const [b, setB] = useState(() => splitPair(startPair)?.[1] ?? 'A')
  const [running, setRunning] = useState(false)
  const [endAt, setEndAt] = useState(0)
  const [count, setCount] = useState(emptyCount)
  const [last, setLast] = useState<'clean' | 'muddy' | null>(null)
  const [done, setDone] = useState<RoundSummary | null>(null)
  const [stats, setStats] = useState(loadStats)
  const pending = useRef<(() => void)[]>([])

  useRoundActivity(running)
  useTick(running, 250)
  const left = running ? (endAt - performance.now()) / 1000 : ROUND_SEC
  const pair = pairKey(a, b)

  const start = () => {
    setCount(emptyCount())
    setLast(null)
    setDone(null)
    setEndAt(performance.now() + ROUND_SEC * 1000)
    setRunning(true)
  }

  const add = (chord: string | null) => {
    setLast(chord ? 'clean' : 'muddy')
    setCount((c) => countStrum(c, chord))
  }

  useGuitar(running && !keyboard, {
    strum: () => {
      pending.current.push(judgeStrum(a, b, add))
    },
  })
  // Keys only without a guitar: then the guitar is the only judge.
  useKeys(running && keyboard, (k) => {
    // Space: a clean strum of the other chord (a change); X: a muddy strum.
    if (k === ' ' || k === 'j') setCount((c) => countStrum(c, c.on === a ? b : a))
    else if (k === 'x') add(null)
  })

  useEffect(
    () => () => {
      pending.current.forEach((c) => c())
    },
    [],
  )

  useEffect(() => {
    if (!running || left > 0) return
    setRunning(false)
    pending.current.forEach((c) => c())
    pending.current = []
    const r = finishRound('changes', count.changes, pair)
    setStats(r.stats)
    const tried = count.strums + count.muddy
    setDone({
      headline: `${count.changes} clean changes`,
      lines: [
        ['Chords', `${a} and ${b}`],
        ['Clean strums', tried ? `${Math.round((100 * count.strums) / tried)}%` : '–'],
      ],
      best: r.best,
      xp: r.xp,
      note:
        count.changes >= RETIRE_AT
          ? 'That pair is retired: 60 a minute. Pick another pair.'
          : count.changes < 20
            ? 'Switch slowly and land every finger together. Speed comes on its own.'
            : undefined,
    })
  }, [running, left, count, pair, a, b])

  const trend = useMemo(() => dailyBest(stats, 'changes', pair), [stats, pair])
  const best = stats.best[bestKey('changes', pair)]

  return (
    <section className="sk-game" aria-labelledby="sk-game-h">
      <GameHead title="One-minute changes" sub="Strum, switch, strum. Count the clean changes in 60 seconds." onBack={onBack} right={<Timer left={left} total={ROUND_SEC} />} />
      {done ? (
        <RoundDone
          s={done}
          onAgain={start}
          onBack={onBack}
          actions={
            <button className="ls-btn ghost" onClick={() => setDone(null)}>
              Change chords
            </button>
          }
        >
          <TrendChart points={trend} unit="changes" label={`Best per day, ${a} and ${b}`} />
        </RoundDone>
      ) : (
        <>
          {!running && (
            <div className="sk-pick-row">
              <ChordPick label="First chord" value={a} other={b} onPick={setA} best={stats.best} />
              <ChordPick label="Second chord" value={b} other={a} onPick={setB} best={stats.best} />
            </div>
          )}
          <div className="sk-chords">
            <Shape name={a} on={running && count.on === a} />
            <Shape name={b} on={running && count.on === b} />
          </div>
          <div className="sk-prompt" aria-live="polite">
            {running ? (
              <p>
                <b className="sk-big ls-num">{count.changes}</b> changes
                {last && <span className={`sk-flash ${last}`}>{last === 'clean' ? 'Clean' : 'Muddy'}</span>}
              </p>
            ) : (
              <p className="ls-muted">
                {best === undefined
                  ? 'Start slow: one strum on each chord. Your first round is your baseline.'
                  : best >= RETIRE_AT
                    ? 'Retired: 60 a minute. Pick another pair.'
                    : `Your best for this pair: ${best}. Retire it at ${RETIRE_AT}.`}
              </p>
            )}
          </div>
          <div className="sk-actions">
            {!running && (
              <button className="ls-btn primary big" onClick={start} autoFocus>
                Start
              </button>
            )}
          </div>
          {!running && <TrendChart points={trend} unit="changes" label={`Best per day, ${a} and ${b}`} />}
          <p className="ls-caption">
            {keyboard ? 'No guitar: Space is a clean change, X a muddy strum.' : 'Each strum is checked against both chords. One strum per chord is enough.'}
          </p>
        </>
      )}
    </section>
  )
}

function ChordPick({ label, value, other, onPick, best }: { label: string; value: string; other: string; onPick: (c: string) => void; best: Record<string, number> }) {
  return (
    <label className="ls-field sk-field">
      <span className="ls-field-label">{label}</span>
      <select className="ls-select" value={value} onChange={(ev) => onPick(ev.target.value)}>
        {CHANGE_CHORDS.filter((c) => c !== other).map((c) => (
          <option key={c} value={c}>
            {`${c}${(best[bestKey('changes', pairKey(c, other))] ?? 0) >= RETIRE_AT ? ' · retired' : ''}`}
          </option>
        ))}
      </select>
    </label>
  )
}
