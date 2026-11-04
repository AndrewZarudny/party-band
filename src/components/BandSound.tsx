// The backing band's sound choice (recorded instruments or synth) and the samples' credits.
import { useEffect, useState } from 'react'
import { useBandSound } from '../audio/sampler/hooks'
import { bandCredits, retrySamples } from '../audio/sampler/bank'
import type { Credit } from '../audio/sampler/types'

/** "Real band / Synth" switch with a loading hint; the choice is app-wide (jams and lessons). */
export function BandSoundSwitch() {
  const { sound, setSound, status } = useBandSound()
  const loading = sound === 'real' && status.state === 'loading'
  const failed = sound === 'real' && status.state === 'error'
  const lost = (['drums', 'bass', 'keys'] as const).filter((p) => status.parts[p] === 'error')
  return (
    <span className="band-sound" title="Sound of the backing band: recorded instruments or the built-in synth">
      <button
        className={`seg ${sound === 'real' ? 'on' : ''}`}
        onClick={() => {
          setSound('real')
          // after an error, a click loads the missing samples again
          if (failed) retrySamples()
        }}
      >
        Real band
      </button>
      <button className={`seg ${sound === 'synth' ? 'on' : ''}`} onClick={() => setSound('synth')}>
        Synth
      </button>
      {loading && (
        <small className="hint">
          loading {status.loaded}/{status.total || '…'}
        </small>
      )}
      {failed && (
        <small className="hint warn" title="Click Real band to try again">
          {lost.length === 3 || !lost.length ? 'samples unavailable, using synth' : `${lost.join(' and ')} samples unavailable, synth for ${lost.length > 1 ? 'those' : 'that part'}`}
        </small>
      )}
    </span>
  )
}

/** Backing band settings for the audio panel: sound choice and the licence credits. */
export function BandSoundSection() {
  const [credits, setCredits] = useState<Credit[] | null>(null)
  useEffect(() => {
    let live = true
    bandCredits().then((c) => {
      if (live) setCredits(c)
    })
    return () => {
      live = false
    }
  }, [])
  return (
    <section>
      <h3>Backing band</h3>
      <div className="row">
        <span className="label">Sound</span>
        <BandSoundSwitch />
      </div>
      <details className="credits">
        <summary>Credits</summary>
        <p className="hint">The backing band plays recorded samples and real drummers' timing from these sources. Thank you!</p>
        {credits === null ? (
          <p className="hint">Loading…</p>
        ) : credits.length === 0 ? (
          <p className="hint">Credits are listed in CREDITS.md.</p>
        ) : (
          <ul>
            {credits.map((c) => (
              <li key={c.name}>
                <a href={c.url} target="_blank" rel="noreferrer">
                  {c.name}
                </a>{' '}
                by {c.author}. Licence:{' '}
                <a href={c.licenceUrl} target="_blank" rel="noreferrer">
                  {c.licence}
                </a>
                . <small>Changes: {c.changes}</small>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  )
}
