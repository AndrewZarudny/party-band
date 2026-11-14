// A session block: record two bars of chords on the looper, then solo over your own loop in the jam's box.
import { useEffect } from 'react'
import { GameHead } from './Common'
import { LooperPanel } from '../../components/LooperPanel'
import { setLooper, useLooper } from '../../audio/looper'
import { useRoundActivity } from '../hooks'

export function LoopJam({ chords, bpm, keyName, boxFret, onBack }: { chords: string[]; bpm: number; keyName?: string; boxFret?: number; onBack: () => void }) {
  const lp = useLooper()
  // Practice time counts for the block while the looper is going.
  useRoundActivity(lp.state !== 'idle' && lp.state !== 'stopped')
  // Set up for the block: two bars at the jam's tempo, with the click (only when nothing is recorded yet).
  useEffect(() => {
    if (lp.state === 'idle') setLooper({ mode: 'bars', bars: 2, bpm, click: true })
    // On opening only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [a, b] = chords
  return (
    <section className="sk-game sk-loopjam" aria-labelledby="sk-game-h">
      <GameHead title="Jam over your own loop" sub="Rhythm and lead together, like a band of one." onBack={onBack} />
      <ol className="sk-loop-steps">
        <li>
          Press <b>Record</b> (or the main pedal). After the count-in, strum <b>{a}</b> for one bar, then <b>{b}</b> for the next. It loops by itself.
        </li>
        <li>
          {keyName ? (
            <>
              Solo over it in the <b>{keyName} minor pentatonic</b>
              {boxFret !== undefined ? (
                <>
                  {' '}
                  box at fret <b>{boxFret}</b>
                </>
              ) : null}
              . Short phrases, room between them, end on {keyName}.
            </>
          ) : (
            <>Solo over it with the notes you know. Short phrases, room between them.</>
          )}
        </li>
        <li>Want more band? Press Overdub and add a bass line on the low strings, or a second rhythm. Undo takes it off.</li>
      </ol>
      <LooperPanel jamBpm={bpm} startOpen />
    </section>
  )
}
