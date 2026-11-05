// Ear training: listen to a short phrase, play it back. Two right in a row makes the next one longer.
import { useEffect, useRef, useState } from 'react'
import { engine } from '../../audio/engine'
import { LeadVoice } from '../../lessons/synth'
import type { Marker } from '../../components/Fretboard'
import { Fretboard } from '../../components/Fretboard'
import type { FretPos } from '../../music/theory'
import { midiName, noteName } from '../../music/theory'
import type { Grade } from '../ear'
import { gradePhrase, makePhrase, nextLength, poolFor } from '../ear'
import { dailyBest } from '../data'
import { finishRound, loadStats, setLevels } from '../store'
import { useGuitar, useKeys, useRoundActivity } from '../hooks'
import type { RoundSummary } from './Common'
import { GameHead, RoundDone, TrendChart } from './Common'

const PHRASES = 8
const NOTE_GAP = 0.6 // seconds between phrase notes
const SETTLE_MS = 350 // after the phrase, before listening (the last note rings in a mic)
const ANSWER_MS = 8000 // waiting this long after the last note played ends the answer

type Phase = 'idle' | 'listen' | 'answer' | 'graded'

export function EarGame({ keyboard, onBack }: { keyboard: boolean; onBack: () => void }) {
  const [len, setLen] = useState(() => loadStats().levels.earLen)
  const [streak, setStreak] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [phrase, setPhrase] = useState<FretPos[]>([])
  const [played, setPlayed] = useState<number[]>([])
  const [grade, setGrade] = useState<Grade | null>(null)
  const [count, setCount] = useState(0)
  const [passes, setPasses] = useState(0)
  const [longest, setLongest] = useState(0)
  const [done, setDone] = useState<RoundSummary | null>(null)
  const [stats, setStats] = useState(loadStats)
  const voice = useRef<LeadVoice | null>(null)
  const listenFrom = useRef(0)
  const timers = useRef<number[]>([])

  const running = phase !== 'idle'
  useRoundActivity(running)

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }
  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
  }
  useEffect(
    () => () => {
      clearTimers()
      voice.current?.stopAll()
    },
    [],
  )

  const playPhrase = async (p: FretPos[]) => {
    const ctx = await engine.ensureContext()
    voice.current ??= new LeadVoice(ctx)
    const t0 = ctx.currentTime + 0.1
    p.forEach((n, i) => voice.current?.note(t0 + i * NOTE_GAP, n.midi, NOTE_GAP * 0.8))
    const ms = (0.1 + p.length * NOTE_GAP) * 1000
    setPhase('listen')
    listenFrom.current = performance.now() + ms + SETTLE_MS
    clearTimers()
    later(() => setPhase('answer'), ms)
  }

  // Start the answer over after hearing the phrase again.
  const replay = () => {
    setPlayed([])
    void playPhrase(phrase)
  }

  const newPhrase = (length: number) => {
    const p = makePhrase(length)
    setPhrase(p)
    setPlayed([])
    setGrade(null)
    void playPhrase(p)
  }

  const start = () => {
    setCount(0)
    setPasses(0)
    setLongest(0)
    setStreak(0)
    setDone(null)
    newPhrase(len)
  }

  const finish = (finalLen: number, totalPasses: number, best: number) => {
    setPhase('idle')
    setLevels({ earLen: finalLen })
    const r = finishRound('ear', best, Math.min(16, 2 * totalPasses))
    setStats(r.stats)
    setDone({
      headline: `${totalPasses} of ${PHRASES} played back right`,
      lines: [
        ['Longest right', best ? `${best} notes` : '–'],
        ['Next round starts at', `${finalLen} notes`],
      ],
      best: r.best && best > 0,
      xp: r.xp,
    })
  }

  const judge = (notes: number[]) => {
    clearTimers()
    const g = gradePhrase(
      phrase.map((p) => p.midi),
      notes,
    )
    setGrade(g)
    setPhase('graded')
    const n = nextLength(len, g.pass ? Math.max(0, streak) + 1 : Math.min(0, streak) - 1)
    const c = count + 1
    const ps = passes + (g.pass ? 1 : 0)
    const lg = g.pass ? Math.max(longest, phrase.length) : longest
    setCount(c)
    setPasses(ps)
    setLongest(lg)
    setStreak(n.streak)
    setLen(n.len)
    later(() => (c >= PHRASES ? finish(n.len, ps, lg) : newPhrase(n.len)), g.pass ? 1400 : 2600)
  }

  const add = (midi: number) => {
    if (phase !== 'answer' || performance.now() < listenFrom.current) return
    const next = [...played, midi]
    setPlayed(next)
    clearTimers()
    if (next.length >= phrase.length) judge(next)
    else later(() => judge(next), ANSWER_MS)
  }

  useGuitar(phase === 'answer' && !keyboard, { note: add })
  useKeys(running, (k) => {
    if (phase === 'answer' && (k === ' ' || k === 'j')) judge(phrase.map((p) => p.midi)) // test key: a perfect answer
    else if (phase === 'answer' && k === 'x') judge([])
    else if (k === 'r' && phase === 'answer') replay()
  })

  const pool = poolFor(phrase.length || len)
  const markers: Marker[] = []
  if (phase === 'graded' && grade)
    phrase.forEach((p, i) => markers.push({ ...p, kind: grade.marks[i] === 'ok' ? 'box' : 'upcoming', label: String(i + 1) }))
  else if (running) pool.forEach((p) => markers.push({ ...p, kind: 'scale' }))

  return (
    <section className="sk-game" aria-labelledby="sk-game-h">
      <GameHead title="Ear training" sub={`Listen, then play it back. ${PHRASES} phrases; they grow as you get them right.`} onBack={onBack} />
      {done ? (
        <RoundDone s={done} onAgain={start} onBack={onBack}>
          <TrendChart points={dailyBest(stats, 'ear')} unit="notes" label="Longest phrase per day" />
        </RoundDone>
      ) : (
        <>
          <div className="sk-prompt" aria-live="polite">
            {phase === 'idle' && <p>Phrases start on the open strings, then move to the A minor pentatonic box at the 5th fret.</p>}
            {phase === 'listen' && (
              <p>
                <b className="sk-big">Listen</b> · {phrase.length} notes
              </p>
            )}
            {phase === 'answer' && (
              <p>
                <b className="sk-big">Your turn</b> · {played.length} of {phrase.length}
              </p>
            )}
            {phase === 'graded' && grade && (
              <p>
                <b className="sk-big">{grade.pass ? 'Right' : grade.orderOnly ? 'Right notes, wrong order' : 'Not quite'}</b>
                {!grade.pass && <span className="ls-muted"> · it was {phrase.map((p) => midiName(p.midi)).join(' ')}</span>}
              </p>
            )}
            {running && (
              <p className="ls-muted ls-num">
                Phrase {Math.min(PHRASES, count + (phase === 'graded' ? 0 : 1))} of {PHRASES}
              </p>
            )}
          </div>
          {phase !== 'idle' && (
            <ol className="sk-slots" aria-label="Your notes">
              {phrase.map((_, i) => {
                const m = grade?.marks[i]
                return (
                  <li key={i} className={m ?? (i < played.length ? 'got' : '')}>
                    {played[i] !== undefined ? noteName(played[i]) : '·'}
                  </li>
                )
              })}
            </ol>
          )}
          <div className="sk-board">
            <Fretboard markers={markers} maxFret={8} />
          </div>
          {phase === 'answer' && keyboard && (
            <div className="sk-pad" role="group" aria-label="Notes to play">
              {pool.map((p) => (
                <button key={p.midi} className="ls-btn small" onClick={() => add(p.midi)}>
                  {midiName(p.midi)}
                </button>
              ))}
            </div>
          )}
          <div className="sk-actions">
            {phase === 'idle' ? (
              <button className="ls-btn primary big" onClick={start} autoFocus>
                Start
              </button>
            ) : (
              <button className="ls-btn ghost" onClick={replay} disabled={phase !== 'answer'}>
                Hear it again <kbd>R</kbd>
              </button>
            )}
          </div>
          <p className="ls-caption">
            {keyboard ? 'No guitar: click the notes in order. Space answers right, X wrong.' : 'Pick each note clearly; the exact octave counts.'}
          </p>
        </>
      )}
    </section>
  )
}
