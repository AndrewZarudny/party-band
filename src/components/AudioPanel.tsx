import { useCallback, useEffect, useState } from 'react'
import { engine } from '../audio/engine'
import type { DeviceInfo, InputChannel } from '../audio/engine'
import { useEngineState, useLevel, useNoteOn, usePitch } from '../audio/hooks'
import type { SelectResult } from '../tone3000/client'
import { ToneBuilder } from './ToneBuilder'
import { BandSoundSection } from './BandSound'
import { midiName } from '../music/theory'

const DEVICE_KEY = 'audio-devices'

/** Connect button, input meter and tuner shown in the header. */
export function AudioStatus({ onOpen }: { onOpen: () => void }) {
  const e = useEngineState()
  const level = useLevel()
  const pitch = usePitch()
  const db = level > 0 ? 20 * Math.log10(level) : -90
  const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100))
  return (
    <div className="audio-status">
      {e.running && (
        <>
          <div className="tuner" title="Tuner">
            <span className="tuner-note">{pitch ? midiName(pitch.midi) : '—'}</span>
            <span className="tuner-bar">
              <i style={{ left: `${50 + (pitch?.cents ?? 0)}%` }} className={pitch && Math.abs(pitch.cents) < 6 ? 'in' : ''} />
            </span>
          </div>
          <div className={`meter ${db > -3 ? 'clip' : ''}`} title={`Input ${db.toFixed(0)} dBFS`}>
            <i style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
      <button className={`btn tone-btn ${e.running ? '' : 'primary'}`} onClick={onOpen} title={e.running ? `Tone: ${e.tone.name}` : undefined}>
        <span className="tone-btn-label">{e.running ? `🎸 ${e.tone.name}` : '🎸 Connect guitar'}</span>
      </button>
    </div>
  )
}

export function AudioPanel({ onClose, t3kResult, onT3kDone }: { onClose: () => void; t3kResult: SelectResult | null; onT3kDone: () => void }) {
  const e = useEngineState()
  const [devices, setDevices] = useState<{ inputs: DeviceInfo[]; outputs: DeviceInfo[] }>({ inputs: [], outputs: [] })
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(DEVICE_KEY) ?? '{}') as { input?: string; output?: string }
    } catch {
      return {}
    }
  })()
  const [input, setInput] = useState(saved.input ?? '')
  const [output, setOutput] = useState(saved.output ?? '')
  const [err, setErr] = useState('')
  const [label, setLabel] = useState('')

  const refresh = () => engine.listDevices().then(setDevices).catch(() => {})
  useEffect(() => {
    refresh()
  }, [e.running])

  const remember = (v: { input?: string; output?: string }) => localStorage.setItem(DEVICE_KEY, JSON.stringify({ input, output, ...v }))

  const connect = async (id = input) => {
    setErr('')
    try {
      // Auto-pick the Scarlett if nothing was chosen yet.
      let dev = id
      if (!dev) {
        await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop()))
        const list = await engine.listDevices()
        setDevices(list)
        dev = list.inputs.find((d) => /scarlett|focusrite/i.test(d.label))?.id ?? ''
        const out = list.outputs.find((d) => /scarlett|focusrite/i.test(d.label))?.id
        if (out && engine.canChooseOutput) {
          await engine.setOutput(out)
          setOutput(out)
        }
        setInput(dev)
        remember({ input: dev, output: out })
      }
      setLabel(await engine.start(dev || undefined))
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x))
    }
  }


  return (
    <div className="panel-backdrop" onClick={onClose}>
      <div className="panel" onClick={(ev) => ev.stopPropagation()}>
        <div className="panel-head">
          <h2>Guitar & tone</h2>
          <button className="icon-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <section>
          <h3>Input</h3>
          <div className="row">
            <select
              value={input}
              onChange={(ev) => {
                setInput(ev.target.value)
                remember({ input: ev.target.value })
                if (e.running) connect(ev.target.value)
              }}
            >
              <option value="">Auto (Scarlett if found)</option>
              {devices.inputs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
            {e.running ? (
              <button className="btn" onClick={() => engine.stop()}>
                Disconnect
              </button>
            ) : (
              <button className="btn primary" onClick={() => connect()}>
                Connect
              </button>
            )}
          </div>
          <div className="row">
            <span className="label">Channel</span>
            {(['auto', 'left', 'right', 'mix'] as InputChannel[]).map((c) => (
              <button key={c} className={`seg ${e.channel === c ? 'on' : ''}`} onClick={() => engine.setChannel(c)}>
                {c === 'auto' ? 'Auto' : c === 'left' ? 'Input 1 (mic)' : c === 'right' ? 'Input 2 (inst)' : 'Both'}
              </button>
            ))}
          </div>
          {e.running && <SignalCheck />}
          <label className="row">
            <span className="label">Input gain {e.inputGainDb > 0 ? '+' : ''}{e.inputGainDb} dB</span>
            <input type="range" min={-12} max={24} value={e.inputGainDb} onChange={(ev) => engine.setInputGain(Number(ev.target.value))} />
          </label>
          {engine.canChooseOutput && (
            <div className="row">
              <span className="label">Output</span>
              <select
                value={output}
                onChange={async (ev) => {
                  setOutput(ev.target.value)
                  remember({ output: ev.target.value })
                  await engine.setOutput(ev.target.value)
                }}
              >
                <option value="">System default</option>
                {devices.outputs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {e.running && (
            <p className="hint">
              {label && <>Using “{label}”. </>}Round-trip latency ≈ {engine.latencyMs + 6} ms. Turn <b>Direct Monitor off</b> on the Scarlett (you'd hear the dry guitar
              too), and set the gain knob so the halo flashes green, not red.
            </p>
          )}
          {err && <div className="error">{err}</div>}
        </section>

        <ToneBuilder t3kResult={t3kResult} onT3kDone={onT3kDone} />

        <BandSoundSection />
      </div>
    </div>
  )
}

/** Live view of what reaches the app: level per input and the detected note. */
function SignalCheck() {
  const pitch = usePitch()
  const level = useLevel() // re-renders ~20×/s, which also refreshes the channel meters
  const [l, r] = engine.chLevels
  const db = (v: number) => (v > 0 ? 20 * Math.log10(v) : -90)
  const pct = (v: number) => Math.max(0, Math.min(100, ((db(v) + 60) / 60) * 100))
  const active = engine.channel === 'auto' ? engine.autoPick : engine.channel
  const [lastNote, setLastNote] = useState<number | null>(null)
  useNoteOn(useCallback((m: number) => setLastNote(m), []))

  let status: string
  if (Math.max(l, r) < 0.0008) status = 'No signal on either input. Check the cable is in Input 2, INST is on, and the gain knob is up. Strum hard and watch the Scarlett halo.'
  else if (active === 'right' && l > r * 4) status = 'Signal is on Input 1, not Input 2. Choose Auto or Input 1, or move the cable.'
  else if (active === 'left' && r > l * 4) status = 'Signal is on Input 2, not Input 1. Choose Auto or Input 2.'
  else if (level < 0.0012) status = 'Very quiet. Turn up the Scarlett gain (or Input gain below) until notes register.'
  else status = pitch ? 'Hearing you.' : 'Signal OK. Play single notes to check detection.'

  return (
    <div className="signal-check">
      <div className="ch-meter">
        <span>Input 1{active === 'left' ? ' ●' : ''}</span>
        <i style={{ width: `${pct(l)}%` }} />
      </div>
      <div className="ch-meter">
        <span>Input 2{active === 'right' ? ' ●' : ''}</span>
        <i style={{ width: `${pct(r)}%` }} />
      </div>
      <div className="row">
        <span className="label">Hearing</span>
        <b className="hear-note">{pitch ? `${midiName(pitch.midi)} ${pitch.cents > 0 ? '+' : ''}${pitch.cents}¢` : '—'}</b>
        <span className="label">Last note</span>
        <b>{lastNote !== null ? midiName(lastNote) : '—'}</b>
      </div>
      <p className="hint">
        {status} <small>({engine.info.channels} ch @ {(engine.info.sampleRate / 1000).toFixed(1)} kHz)</small>
      </p>
    </div>
  )
}
