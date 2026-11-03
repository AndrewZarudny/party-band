import { useEffect, useState } from 'react'
import type { T3kModel, T3kTone } from '../tone3000/client'
import { getClientId, getTone, isSignedIn, licenseLabel, listModels, redirectUri, setClientId, signOut } from '../tone3000/client'

/** One-time setup: the user's own TONE3000 publishable key. */
export function Tone3000Setup({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [key, setKey] = useState(getClientId() ?? '')
  return (
    <div className="panel-backdrop center" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Connect TONE3000</h2>
        <ol className="steps">
          <li>
            Sign in at{' '}
            <a href="https://www.tone3000.com/settings" target="_blank" rel="noreferrer">
              tone3000.com/settings
            </a>{' '}
            (free account) and open the API section.
          </li>
          <li>Create an app/key for personal use and copy the <b>publishable key</b> (not the secret key).</li>
          <li>
            Add this redirect URI: <code>{redirectUri()}</code>
          </li>
          <li>Paste the publishable key here.</li>
        </ol>
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Publishable key" autoFocus />
        <div className="row">
          <button
            className="btn primary"
            disabled={!key.trim()}
            onClick={() => {
              setClientId(key)
              onDone()
            }}
          >
            Save and continue
          </button>
          {isSignedIn() && (
            <button
              className="btn"
              onClick={() => {
                signOut()
                onClose()
              }}
            >
              Sign out
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
        <p className="hint">The key is stored only in this browser. Sign-in happens on tone3000.com; Fretwise never sees your password.</p>
      </div>
    </div>
  )
}

/** After picking a tone on TONE3000: choose which of its models (e.g. gain settings) to use. */
export function ModelPicker(props: { toneId: string; onUse: (tone: T3kTone, model: T3kModel) => Promise<void>; onClose: () => void }) {
  const [tone, setTone] = useState<T3kTone | null>(null)
  const [models, setModels] = useState<T3kModel[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState<number | null>(null)
  useEffect(() => {
    // Load the tone first: IR tones list their files without an architecture filter.
    getTone(props.toneId)
      .then(async (t) => [t, await listModels(props.toneId, t.format === 'ir')] as const)
      .then(([t, m]) => {
        setTone(t)
        setModels(m)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [props.toneId])
  return (
    <div className="panel-backdrop center" onClick={props.onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        {!tone && !error && <p className="hint">Loading tone from TONE3000…</p>}
        {error && <div className="error">{error}</div>}
        {tone && (
          <>
            <div className="t3k-tone">
              {tone.images?.[0] && <img src={tone.images[0]} alt="" />}
              <div>
                <h2>{tone.title}</h2>
                <p className="hint">
                  {tone.gear} · {tone.format.toUpperCase()} · by {tone.user.username} · {licenseLabel(tone.license)}
                </p>
              </div>
            </div>
            <p className="hint">{models.length > 1 ? 'This tone has several versions (e.g. gain settings). Pick one:' : 'Ready to use:'}</p>
            <ul className="model-list">
              {models.map((m) => (
                <li key={m.id}>
                  <span>
                    {m.name} {m.size && <small className="muted">({m.size})</small>}
                  </span>
                  <button
                    className="btn small primary"
                    disabled={loading !== null}
                    onClick={async () => {
                      setLoading(m.id)
                      try {
                        await props.onUse(tone, m)
                        props.onClose()
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e))
                        setLoading(null)
                      }
                    }}
                  >
                    {loading === m.id ? 'Loading…' : 'Use'}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="row spread">
          <a className="t3k-badge" href="https://www.tone3000.com" target="_blank" rel="noreferrer">
            Powered by TONE3000
          </a>
          <button className="btn" onClick={props.onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
