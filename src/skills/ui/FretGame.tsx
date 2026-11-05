// Fretboard notes: "Find every A" (each spot of a note, string by string) and "Name that note" (play the marked spot).
import { useEffect, useRef, useState } from 'react'
import type { Marker } from '../../components/Fretboard'
import { Fretboard } from '../../components/Fretboard'
import type { FretPos } from '../../music/theory'
import { midiName, noteName, pc } from '../../music/theory'
import { STRING_NAMES, findOrder, randomSpot, spotsOf, widenAfter } from '../fret'
import { fretTimeRows } from '../data'
import { finishRound, loadStats, setLevels } from '../store'
import { useGuitar, useKeys, useRoundActivity, useTick } from '../hooks'
import type { RoundSummary } from './Common'
import { GameHead, RoundDone, Timer } from './Common'

const FIND_SEC = 90
const NAME_SEC = 60
const HINT_SEC = 10 // a faint hint appears after this long on one spot
const SETTLE_MS = 300 // notes this soon after a new spot are the last one ringing

type Mode = 'find' | 'name'

interface Found {
  pos: FretPos
  ok: boolean
}

export function FretGame({ mode, keyboard, onBack }: { mode: Mode; keyboard: boolean; onBack: () => void }) {
  const [fretMax, setFretMax] = useState(() => loadStats().levels.fretMax)
  const [running, setRunning] = useState(false)
  const [endAt, setEndAt] = useState(0)
  const [done, setDone] = useState<RoundSummary | null>(null)
  // Find
  const [order, setOrder] = useState<number[]>(() => findOrder())
  const [noteIdx, setNoteIdx] = useState(0)
  const [spotIdx, setSpotIdx] = useState(0)
  // Name
  const [spot, setSpot] = useState<FretPos>(() => randomSpot(fretMax, null))
  const [missed, setMissed] = useState(false)
  // Both
  const [found, setFound] = useState<Found[]>([])
  const [right, setRight] = useState(0)
  const [tries, setTries] = useState(0)
  const [heard, setHeard] = useState<string | null>(null)
  const since = useRef(0)
  const times = useRef<{ string: number; ms: number }[]>([]) // prompt to right answer, per spot

  useRoundActivity(running)
  useTick(running, 200)
  const now = performance.now()
  const left = running ? (endAt - now) / 1000 : mode === 'find' ? FIND_SEC : NAME_SEC

  const notePc = order[noteIdx % order.length]
  const spots = mode === 'find' ? spotsOf(notePc, fretMax) : []
  const target: FretPos | null = mode === 'find' ? (spots[spotIdx] ?? null) : spot
  // From 12 frets a note sits twice on some strings (open and 12th): say which one.
  const sameString = mode === 'find' && target ? spots.filter((s) => s.string === target.string) : []
  const twin = sameString.length > 1 && target ? (sameString[0].fret === target.fret ? 'lower' : 'higher') : null

  const start = () => {
    setOrder(findOrder())
    setNoteIdx(0)
    setSpotIdx(0)
    setSpot(randomSpot(fretMax, null))
    setMissed(false)
    setFound([])
    setRight(0)
    setTries(0)
    setHeard(null)
    setDone(null)
    times.current = []
    since.current = performance.now()
    setEndAt(performance.now() + (mode === 'find' ? FIND_SEC : NAME_SEC) * 1000)
    setRunning(true)
  }

  const nextFind = () => {
    since.current = performance.now()
    setMissed(false)
    if (spotIdx + 1 < spots.length) setSpotIdx(spotIdx + 1)
    else {
      // Every spot of this note: on to the next note, a clean board.
      setNoteIdx(noteIdx + 1)
      setSpotIdx(0)
      setFound([])
    }
  }

  const nextName = () => {
    since.current = performance.now()
    setMissed(false)
    setSpot(randomSpot(fretMax, spot))
  }

  const hit = () => {
    if (!running || !target) return
    times.current.push({ string: target.string, ms: performance.now() - since.current })
    if (mode === 'find') {
      setRight((n) => n + 1)
      setFound((f) => [...f, { pos: target, ok: true }])
      nextFind()
    } else {
      setTries((n) => n + 1)
      if (!missed) setRight((n) => n + 1)
      setFound([{ pos: target, ok: !missed }])
      nextName()
    }
  }

  const miss = () => {
    if (!running || !target) return
    if (!missed) setMissed(true)
  }

  const skip = () => {
    if (!running) return
    if (mode === 'find') nextFind()
    else {
      setTries((n) => n + 1)
      setFound([{ pos: spot, ok: false }])
      nextName()
    }
  }

  // Guitar: the exact pitch (octave too) of the spot counts.
  const onMidi = (m: number) => {
    if (!running || !target || performance.now() - since.current < SETTLE_MS) return
    setHeard(midiName(m))
    if (m === target.midi) hit()
    else miss()
  }
  useGuitar(running && !keyboard, { note: onMidi })
  // With a guitar, only the guitar says right or wrong; S skips either way.
  useKeys(running, (k) => {
    if (keyboard && (k === ' ' || k === 'j')) hit()
    else if (keyboard && k === 'x') miss()
    else if (k === 's') skip()
  })

  // Time up: save the round.
  useEffect(() => {
    if (!running || left > 0) return
    setRunning(false)
    // Response time per string, for the progress screen (no XP).
    for (const row of fretTimeRows(times.current)) finishRound('fretTime', row.ms, String(row.string))
    if (mode === 'find') {
      const r = finishRound('find', right)
      setDone({
        headline: `${right} spots found`,
        lines: [['Notes finished', String(noteIdx)], ['Frets', `0–${fretMax}`]],
        best: r.best,
        xp: r.xp,
      })
    } else {
      const wider = widenAfter(fretMax, right, tries)
      if (wider !== fretMax) {
        setLevels({ fretMax: wider })
        setFretMax(wider) // Again plays on the wider board
      }
      const acc = tries ? Math.round((100 * right) / tries) : 0
      const r = finishRound('name', right)
      setDone({
        headline: `${right} of ${tries} right first time`,
        lines: [['Accuracy', `${acc}%`], ['Frets', `0–${fretMax}`]],
        best: r.best,
        xp: r.xp,
        note: wider !== fretMax ? `Nice. Next time the board opens up to fret ${wider}.` : tries >= 10 ? 'Get 85% right to open up more frets.' : 'Name 10 or more spots to open up more frets.',
      })
    }
  }, [running, left, mode, right, tries, noteIdx, fretMax])

  // Spots found (or the last answer): labelled, so the name sticks.
  const markers: Marker[] = found.map((f) => ({ ...f.pos, kind: f.ok ? 'box' : 'upcoming' }))
  if (running && target) {
    if (mode === 'name') markers.push({ ...target, kind: 'target' })
    else if ((now - since.current) / 1000 > HINT_SEC) markers.push({ ...target, kind: 'next', opacity: 0.4 })
  }

  const title = mode === 'find' ? 'Find every note' : 'Name that note'
  const sub =
    mode === 'find'
      ? `Play each spot of the note, string by string, frets 0–${fretMax}. ${FIND_SEC} seconds.`
      : `Play the marked spot. ${NAME_SEC} seconds, frets 0–${fretMax}.`

  return (
    <section className="sk-game" aria-labelledby="sk-game-h">
      <GameHead title={title} sub={sub} onBack={onBack} right={<Timer left={left} total={mode === 'find' ? FIND_SEC : NAME_SEC} />} />
      {done ? (
        <RoundDone s={done} onAgain={start} onBack={onBack} />
      ) : (
        <>
          <div className="sk-prompt" aria-live="polite">
            {!running ? (
              <p>{mode === 'find' ? 'You get one note at a time. Find it on each string.' : 'A spot lights up. Play it.'}</p>
            ) : mode === 'find' && target ? (
              <>
                <p>
                  Find <b className="sk-big">{noteName(notePc)}</b> on the <b>{STRING_NAMES[target.string]}</b> string
                  {twin && <>, the {twin} one</>}
                </p>
                {missed && <p className="ls-muted">Not that one. Stay on the {STRING_NAMES[target.string]} string{twin ? `, the ${twin} ${noteName(notePc)}` : ''}.</p>}
              </>
            ) : mode === 'name' ? (
              <p>{missed ? 'Not quite. Try again or skip.' : 'Play the marked spot.'}</p>
            ) : null}
            {running && heard && !keyboard && <p className="ls-muted">Heard {heard}</p>}
          </div>
          <div className="sk-board">
            <Fretboard markers={markers} maxFret={Math.max(5, fretMax)} />
          </div>
          {running && keyboard && mode === 'name' && <NamePad onPick={(p) => (p === pc(spot.midi) ? hit() : miss())} />}
          <div className="sk-actions">
            {!running ? (
              <button className="ls-btn primary big" onClick={start} autoFocus>
                Start
              </button>
            ) : (
              <button className="ls-btn ghost" onClick={skip}>
                Skip <kbd>S</kbd>
              </button>
            )}
          </div>
          <p className="ls-caption">
            {keyboard
              ? mode === 'name'
                ? 'No guitar: click the note name, or press Space for right and X for wrong.'
                : 'No guitar: press Space when you would have played the spot.'
              : 'The app hears the pitch, not the string, so stay on the string it asks for.'}{' '}
            Score: <span className="ls-num">{right}</span>
          </p>
        </>
      )}
    </section>
  )
}

function NamePad({ onPick }: { onPick: (pc: number) => void }) {
  return (
    <div className="sk-pad" role="group" aria-label="Note names">
      {Array.from({ length: 12 }, (_, i) => (
        <button key={i} className="ls-btn small" onClick={() => onPick(i)}>
          {noteName(i)}
        </button>
      ))}
    </div>
  )
}
