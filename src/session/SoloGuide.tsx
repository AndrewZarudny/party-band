import { useEffect, useMemo, useRef, useState } from 'react'
import { Fretboard } from '../components/Fretboard'
import { PhraseBoard } from '../components/PhraseBoard'
import { jamMarkers } from '../music/jamMarkers'
import { boxNotes, makePhrase } from '../music/phrase'
import type { SavedPhrase } from '../music/pinned'
import { loadPinned, savePinned } from '../music/pinned'
import type { Chord } from '../music/theory'

const PHRASE_LEN = 7

/**
 * The same solo guide the host sees (Next / current / Earlier phrases, pinned set, fretboard),
 * for a bandmate's phone. Phones can't hear the player, so a new phrase comes with each chord
 * (prepared in advance as "Next"), or on "new phrase".
 */
export function SoloGuide({ chord, next, chordIdx, scalePcs, position, flats }: { chord: Chord; next: Chord | null; chordIdx: number; scalePcs: number[]; position: number; flats: boolean }) {
  const lo = position === 0 ? 0 : position - 1
  const make = (c: Chord): SavedPhrase => ({
    id: `ph${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    notes: makePhrase(boxNotes(scalePcs, c.tones, lo), scalePcs, c.tones, c.tones, PHRASE_LEN),
    chord: c.symbol,
  })
  const [current, setCurrent] = useState<SavedPhrase>(() => make(chord))
  const [upcoming, setUpcoming] = useState<SavedPhrase | null>(() => (next ? make(next) : null))
  const [history, setHistory] = useState<SavedPhrase[]>([])
  const [pinned, setPinnedState] = useState<SavedPhrase[]>(loadPinned)
  const [setMode, setSetMode] = useState(false)
  const [setIdx, setSetIdx] = useState(0)
  const first = useRef(true)

  const show = (p: SavedPhrase) => {
    setHistory((h) => [current, ...h.filter((x) => x.id !== current.id && x.id !== p.id)].slice(0, 12))
    setCurrent(p)
  }
  const setPinned = (p: SavedPhrase[]) => {
    setPinnedState(p)
    savePinned(p)
  }
  const playFromSet = (i: number) => {
    if (!pinned.length) return
    const k = ((i % pinned.length) + pinned.length) % pinned.length
    setSetIdx(k)
    show(pinned[k])
  }

  // Each chord change: play the phrase prepared for it, and prepare the one after.
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (setMode) return playFromSet(setIdx + 1)
    show(upcoming && upcoming.chord === chord.symbol ? upcoming : make(chord))
    setUpcoming(next ? make(next) : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chordIdx, chord.symbol])

  const markers = useMemo(
    () => jamMarkers({ scalePcs, chord, nextChord: next, lo, hi: lo + 4, phrase: current.notes, ptr: 0 }),
    [scalePcs, chord, next, lo, current],
  )

  return (
    <div className="solo-guide">
      <PhraseBoard
        upcoming={setMode ? (pinned.length > 1 ? pinned[(setIdx + 1) % pinned.length] : null) : upcoming}
        current={current}
        ptr={0}
        history={history}
        pinned={pinned}
        setMode={setMode}
        setIdx={setIdx}
        onNew={() => (setMode ? playFromSet(setIdx + 1) : show(make(chord)))}
        onPin={(p) => setPinned(pinned.some((x) => x.id === p.id) ? pinned.filter((x) => x.id !== p.id) : [...pinned, p])}
        onPlay={(p) => {
          const i = pinned.findIndex((x) => x.id === p.id)
          if (setMode && i >= 0) playFromSet(i)
          else show(p)
        }}
        onReorder={setPinned}
        onSetMode={(v) => {
          setSetMode(v)
          if (v) playFromSet(0)
        }}
      />
      <div className="fb-scroll">
        <Fretboard markers={markers} highlightFrom={lo} highlightTo={lo + 4} flats={flats} />
      </div>
    </div>
  )
}
