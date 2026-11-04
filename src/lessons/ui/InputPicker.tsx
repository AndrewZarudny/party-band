import { useEffect, useState } from 'react'
import { useEngineState, useLevel, usePitch } from '../../audio/hooks'
import { midiName } from '../../music/theory'
import type { InputSource, Prefs } from '../types'
import type { SourceDevice } from '../source'
import { connectSource, listSources, pickMic, sourceMatches } from '../source'

const ERRORS: Record<string, string> = {
  'no-interface': 'No audio interface found. Plug in the Scarlett, or pick Microphone.',
  'no-mic': 'No microphone found.',
}

/** "Listen to: Guitar cable | Microphone", the mic list, and what the app hears right now. */
export function InputPicker({ prefs, onPrefs }: { prefs: Prefs; onPrefs: (p: Prefs) => void }) {
  const e = useEngineState()
  const pitch = usePitch()
  const level = useLevel()
  const [mics, setMics] = useState<SourceDevice[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (prefs.input !== 'mic') return
    let live = true
    void listSources()
      .then((l) => live && setMics(l))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [prefs.input, e.running])

  // The choice is saved only once the input opens; on failure the old source is reopened.
  const connect = async (input: InputSource, micId: string | null) => {
    setBusy(true)
    setErr(null)
    try {
      await connectSource(input, micId)
      onPrefs({ ...prefs, input, micId, keyboard: false })
    } catch (x) {
      const code = x instanceof Error ? x.message : ''
      setErr(ERRORS[code] ?? "The browser couldn't open that input.")
      if (input !== prefs.input || micId !== prefs.micId) await connectSource(prefs.input, prefs.micId).catch(() => {})
    } finally {
      setBusy(false)
    }
  }

  const matches = sourceMatches(prefs.input)
  const mic = prefs.input === 'mic' ? pickMic(mics, prefs.micId) : null
  // Which mic is open, even when it's the only one (no list to show).
  const micLabel = prefs.input === 'mic' && e.running && matches ? e.info.label : null
  // 0.02 rms is a firm pluck on a cable; a mic reads lower, so the bar scales up.
  const fill = Math.min(1, level / (prefs.input === 'mic' ? 0.01 : 0.02))

  return (
    <div className="ls-input">
      <div className="ls-field">
        <span className="ls-field-label">Listen to</span>
        <div className="ls-seg" role="radiogroup" aria-label="Listen to">
          {(['cable', 'mic'] as const).map((s) => (
            <button key={s} role="radio" aria-checked={prefs.input === s} className={prefs.input === s ? 'on' : ''} disabled={busy} onClick={() => void connect(s, prefs.micId)}>
              {s === 'cable' ? 'Guitar cable' : 'Microphone'}
            </button>
          ))}
        </div>
      </div>
      {prefs.input === 'mic' && mics.length > 1 && (
        <select className="ls-select" aria-label="Microphone" value={mic?.id ?? ''} disabled={busy} onChange={(ev) => void connect('mic', ev.target.value)}>
          {mics.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label || 'Microphone'}
              {d.iface ? ' (input 1)' : ''}
            </option>
          ))}
        </select>
      )}
      <small className="ls-muted">
        {prefs.input === 'cable'
          ? 'Electric into the Scarlett, input 2 with INST on.'
          : 'An acoustic, or an amp in the room. Use headphones so the mic only hears your guitar. The amp sound is off.'}
        {micLabel && mics.length <= 1 && <> Using “{micLabel}”.</>}
      </small>
      {err && <p className="ls-warn">{err}</p>}
      {e.running && !matches && !err && (
        <p className="ls-note">
          Listening to “{e.info.label || 'another input'}”.{' '}
          <button className="ls-btn small" disabled={busy} onClick={() => void connect(prefs.input, prefs.micId)}>
            Switch
          </button>
        </p>
      )}
      {e.running && (
        <div className="ls-hear">
          <span className="ls-hear-meter" aria-hidden>
            <span style={{ transform: `scaleX(${fill})` }} />
          </span>
          <span>
            Hearing: <b className="ls-num">{pitch ? midiName(pitch.midi) : '—'}</b>
          </span>
          {!pitch && <small className="ls-muted">pluck a string to check</small>}
        </div>
      )}
    </div>
  )
}
