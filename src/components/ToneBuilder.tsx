import { useEffect, useReducer, useState } from 'react'
import { engine } from '../audio/engine'
import { useEngineState } from '../audio/hooks'
import type { GearRef, TonePreset } from '../audio/presets'
import { BUILT_IN, addGear, applyTone, currentSetup, deletePreset, importGearFile, loadPresets, onSetup, savePreset, setGear } from '../audio/presets'
import type { AmpModel, Tone } from '../audio/tone'
import { AMP_MODELS, modelOf } from '../audio/tone'
import type { SelectResult, T3kModel, T3kTone } from '../tone3000/client'
import { captureKindFor, downloadModel, getClientId, licenseLabel, startSelect } from '../tone3000/client'
import { ModelPicker, Tone3000Setup } from './ToneGear'
import { OriginalTone } from './OriginalTone'

function Credit({ g }: { g: GearRef }) {
  return (
    <span className="gear-credit">
      {g.url ? (
        <a href={g.url} target="_blank" rel="noreferrer">
          {g.name}
        </a>
      ) : (
        g.name
      )}
      {g.creator && <> by {g.creator}</>}
      {g.license && <small> · {licenseLabel(g.license)}</small>}
    </span>
  )
}

/** Build a tone (amp or capture, cab or IR, knobs) and keep it as a named preset. */
export function ToneBuilder({ t3kResult, onT3kDone }: { t3kResult: SelectResult | null; onT3kDone: () => void }) {
  const e = useEngineState()
  const [, refresh] = useReducer((x: number) => x + 1, 0)
  useEffect(() => onSetup(refresh), [])
  const setup = currentSetup()
  const presets = loadPresets()
  const editing = presets.find((p) => p.id === setup.presetId)
  const [name, setName] = useState(editing?.name ?? '')
  useEffect(() => setName(editing?.name ?? ''), [editing?.id, editing?.name])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [setupFor, setSetupFor] = useState<'capture' | 'ir' | null>(null)
  const [picker, setPicker] = useState<string | null>(null)

  // Back from TONE3000's picker: choose a version of the tone.
  useEffect(() => {
    // "Get original tone" handles its own round trips.
    if (!t3kResult || t3kResult.context?.plan) return
    if ('toneId' in t3kResult) setPicker(t3kResult.toneId)
    else if ('error' in t3kResult) setError(t3kResult.error)
    onT3kDone()
  }, [t3kResult, onT3kDone])

  const setTone = (patch: Partial<Tone>) => engine.setTone({ ...e.tone, ...patch })
  const captureOn = !!setup.capture

  const goTone3000 = (slot: 'capture' | 'ir') => {
    if (!getClientId()) return setSetupFor(slot)
    setBusy('Opening TONE3000…')
    startSelect(slot, { songId: '', track: '', variant: '', slot }).catch((err) => {
      setBusy('')
      setError(String(err))
    })
  }

  const useModel = async (tone: T3kTone, model: T3kModel) => {
    const isIr = tone.format === 'ir'
    await addGear({
      id: `t3k-${tone.id}-${model.id}`,
      kind: isIr ? 'ir' : 'nam',
      name: model.name && model.name !== tone.title ? `${tone.title} · ${model.name}` : tone.title,
      gear: isIr ? undefined : captureKindFor(tone),
      creator: tone.user?.username,
      license: tone.license,
      url: tone.url ?? `https://www.tone3000.com/tones/${tone.id}`,
      addedAt: Date.now(),
      data: await downloadModel(model),
    })
  }

  const pickPreset = (p: TonePreset) => void applyTone(p).catch((err) => setError(String(err)))

  return (
    <section className="tone-builder">
      <div className="row spread">
        <h3>Tone</h3>
        <label className="toggle-inline">
          <input type="checkbox" checked={e.ampOn} onChange={(ev) => engine.setAmpOn(ev.target.checked)} /> Hear amp
        </label>
      </div>

      <OriginalTone onReady={setName} needKey={() => setSetupFor('capture')} />

      {presets.length > 0 && (
        <div className="preset-group">
          <span className="label">My tones</span>
          <div className="presets">
            {presets.map((p) => (
              <span key={p.id} className={`preset-chip ${p.id === setup.presetId ? 'on' : ''}`}>
                <button onClick={() => pickPreset(p)}>
                  {p.name}
                  {p.capture ? ' ●' : ''}
                </button>
                <button className="x" title="Delete preset" onClick={() => deletePreset(p.id)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="preset-group">
        <span className="label">Starting points</span>
        <div className="presets">
          {BUILT_IN.map((p) => (
            <button key={p.id} className={`seg ${p.id === setup.presetId ? 'on' : ''}`} onClick={() => pickPreset(p)}>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="save-row">
        <input value={name} onChange={(ev) => setName(ev.target.value)} placeholder="Name this tone, e.g. Livin' It Up" />
        {editing && (
          <button className="btn small primary" onClick={() => savePreset(name || editing.name, editing.id)}>
            Update “{editing.name}”
          </button>
        )}
        <button className={`btn small ${editing ? '' : 'primary'}`} disabled={!name.trim()} onClick={() => savePreset(name)}>
          Save as new
        </button>
      </div>

      <div className="gear-box">
        <div className="gear-line">
          <span className="label">Amp</span>
          {captureOn ? (
            <Credit g={setup.capture!} />
          ) : (
            <select value={modelOf(e.tone)} onChange={(ev) => setTone({ model: ev.target.value as AmpModel })}>
              {Object.entries(AMP_MODELS).map(([id, m]) => (
                <option key={id} value={id}>
                  Built-in: {m.label}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="gear-actions">
          <button className="btn small" disabled={!!busy} onClick={() => goTone3000('capture')}>
            {captureOn ? 'Change on TONE3000' : 'Find amp on TONE3000'}
          </button>
          <label className="btn small">
            Import .nam
            <input type="file" accept=".nam" hidden onChange={(ev) => ev.target.files?.[0] && void importGearFile(ev.target.files[0]).catch((x) => setError(String(x)))} />
          </label>
          {captureOn && (
            <button className="link" onClick={() => void setGear('capture', undefined)}>
              use built-in amp
            </button>
          )}
        </div>
        <div className="gear-line">
          <span className="label">Cab</span>
          {setup.ir ? <Credit g={setup.ir} /> : <span className="muted">{setup.capture?.gear === 'amp-cab' ? 'Included in the capture' : 'Built-in cabinet'}</span>}
        </div>
        <div className="gear-actions">
          <button className="btn small" disabled={!!busy} onClick={() => goTone3000('ir')}>
            {setup.ir ? 'Change IR on TONE3000' : 'Find cab IR on TONE3000'}
          </button>
          <label className="btn small">
            Import .wav
            <input type="file" accept=".wav" hidden onChange={(ev) => ev.target.files?.[0] && void importGearFile(ev.target.files[0]).catch((x) => setError(String(x)))} />
          </label>
          {setup.ir && (
            <button className="link" onClick={() => void setGear('ir', undefined)}>
              remove IR
            </button>
          )}
        </div>
        {busy && <p className="hint">{busy}</p>}
        {error && <div className="error">{error}</div>}
      </div>

      <div className="knobs">
        <Knob label="Gain" v={e.tone.gain} min={0} max={10} step={0.1} set={(gain) => setTone({ gain })} disabled={captureOn && setup.capture?.gear !== 'pedal'} />
        <Knob label="Bass" v={e.tone.bass} min={-12} max={12} set={(bass) => setTone({ bass })} />
        <Knob label="Mid" v={e.tone.mid} min={-12} max={12} set={(mid) => setTone({ mid })} />
        <Knob label="Treble" v={e.tone.treble} min={-12} max={12} set={(treble) => setTone({ treble })} />
        <Knob label="Presence" v={e.tone.presence} min={-12} max={12} set={(presence) => setTone({ presence })} />
        <Knob label="Gate" v={e.tone.gate} min={0} max={10} step={0.5} set={(gate) => setTone({ gate })} />
        <Knob label="Delay" v={e.tone.delay} min={0} max={10} step={0.5} set={(delay) => setTone({ delay })} />
        <Knob label="Delay ms" v={e.tone.delayMs} min={80} max={900} step={10} set={(delayMs) => setTone({ delayMs })} />
        <Knob label="Chorus" v={e.tone.chorus ?? 0} min={0} max={10} step={0.5} set={(chorus) => setTone({ chorus })} />
        <Knob label="Octave ↓" v={e.tone.octave ?? 0} min={0} max={10} step={0.5} set={(octave) => setTone({ octave })} />
        <Knob label="Reverb" v={e.tone.reverb} min={0} max={10} step={0.5} set={(reverb) => setTone({ reverb })} />
        <Knob label="Level" v={e.tone.level} min={0} max={10} step={0.1} set={(level) => setTone({ level })} />
      </div>
      {!captureOn && !setup.ir && (
        <label className="toggle-inline">
          <input type="checkbox" checked={e.tone.cab} onChange={(ev) => setTone({ cab: ev.target.checked })} /> Built-in cabinet
        </label>
      )}
      {captureOn && <p className="hint">With a capture, gain comes from the captured amp; the EQ and effects still apply.</p>}
      <a className="t3k-badge" href="https://www.tone3000.com" target="_blank" rel="noreferrer">
        Powered by TONE3000
      </a>

      {setupFor && (
        <Tone3000Setup
          onClose={() => setSetupFor(null)}
          onDone={() => {
            const slot = setupFor
            setSetupFor(null)
            goTone3000(slot)
          }}
        />
      )}
      {picker && <ModelPicker toneId={picker} onUse={useModel} onClose={() => setPicker(null)} />}
    </section>
  )
}

function Knob({ label, v, min, max, step = 1, set, disabled }: { label: string; v: number; min: number; max: number; step?: number; set: (v: number) => void; disabled?: boolean }) {
  return (
    <label className={`knob ${disabled ? 'disabled' : ''}`}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} disabled={disabled} onChange={(e) => set(Number(e.target.value))} />
      <b>{Number.isInteger(v) ? v : v.toFixed(1)}</b>
    </label>
  )
}
