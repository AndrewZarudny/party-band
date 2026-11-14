// The looper in the Jam tab: one big button (also the main foot pedal) for record, close the loop, overdub;
// Stop/Play (the second pedal), Undo, Clear. Free length, or a number of bars at a tempo with a count-in.
import { useState } from 'react'
import { useEngineState } from '../audio/hooks'
import { looperClear, looperMain, looperSecond, looperUndo, setLooper, useLooper } from '../audio/looper'

const MAIN: Record<string, string> = {
  idle: '● Record',
  recording: 'Close the loop',
  playing: '＋ Overdub',
  overdubbing: 'Overdub off',
  stopped: '▶ Play',
}

const STATUS: Record<string, string> = {
  idle: 'Press Record (or the main pedal) and play.',
  recording: 'Recording',
  playing: 'Looping',
  overdubbing: 'Overdubbing: play on top',
  stopped: 'Stopped',
}

export function LooperPanel({ jamBpm, startOpen = false }: { jamBpm: number; startOpen?: boolean }) {
  const lp = useLooper()
  const e = useEngineState()
  const [open, setOpen] = useState(startOpen)
  const bars = lp.mode === 'bars'
  const busy = lp.state !== 'idle'
  const barsRecording = bars && lp.state === 'recording'

  if (!open)
    return (
      <div className="looper closed">
        <button className="btn" onClick={() => setOpen(true)}>
          🔁 Looper{busy ? ` · ${STATUS[lp.state]}` : ''}
        </button>
      </div>
    )

  return (
    <section className={`looper ${lp.state}`} aria-label="Looper">
      <header className="looper-head">
        <h3>🔁 Looper</h3>
        <span className="looper-status" role="status">
          {lp.countIn !== null ? `Count-in: ${lp.countIn}` : STATUS[lp.state]}
          {lp.layers > 0 && ` · ${lp.layers} layer${lp.layers > 1 ? 's' : ''} · ${lp.lenSec.toFixed(1)} s`}
        </span>
        <button className="btn small ghost" onClick={() => setOpen(false)}>
          Hide
        </button>
      </header>

      {!e.running && <p className="hint">Connect your guitar first: the looper records what you play through the amp.</p>}
      {lp.error && <p className="hint looper-err">{lp.error}</p>}

      <div className="looper-bar" aria-hidden>
        <i style={{ transform: `scaleX(${lp.pos})` }} />
      </div>

      <div className="looper-main">
        <button
          className={`btn primary looper-go ${lp.state}`}
          onClick={() => void looperMain()}
          disabled={!e.running || barsRecording}
          data-pedal="go"
          title="Main pedal (Page Down)"
        >
          {barsRecording ? (lp.countIn !== null ? `Count-in ${lp.countIn}` : 'Recording…') : MAIN[lp.state]}
        </button>
        <button className="btn" onClick={() => void looperSecond()} disabled={!busy} data-pedal="next" title="Next pedal (Page Up)">
          {lp.state === 'stopped' ? '▶ Play' : '■ Stop'}
        </button>
        <button className="btn" onClick={looperUndo} disabled={lp.layers < 2}>
          Undo layer
        </button>
        <button className="btn ghost" onClick={looperClear} disabled={!busy}>
          Clear
        </button>
      </div>

      <div className="looper-opts">
        <div className="seg-group" role="radiogroup" aria-label="Loop length">
          <button className={`seg ${!bars ? 'on' : ''}`} role="radio" aria-checked={!bars} disabled={busy} onClick={() => setLooper({ mode: 'free' })}>
            Free
          </button>
          <button className={`seg ${bars ? 'on' : ''}`} role="radio" aria-checked={bars} disabled={busy} onClick={() => setLooper({ mode: 'bars', bpm: jamBpm })}>
            Bars
          </button>
        </div>
        {bars && (
          <>
            <label>
              Bars
              <select value={lp.bars} disabled={busy} onChange={(ev) => setLooper({ bars: Number(ev.target.value) })}>
                {[1, 2, 4, 8, 12, 16].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tempo
              <input type="number" min={40} max={220} value={lp.bpm} disabled={busy} onChange={(ev) => setLooper({ bpm: Math.max(40, Math.min(220, Number(ev.target.value) || 90)) })} />
            </label>
            <label className="looper-check">
              <input type="checkbox" checked={lp.click} onChange={(ev) => setLooper({ click: ev.target.checked })} /> Click
            </label>
          </>
        )}
        <label>
          Loop volume
          <input type="range" min={0} max={1.5} step={0.05} value={lp.volume} onChange={(ev) => setLooper({ volume: Number(ev.target.value) })} />
        </label>
      </div>
      <p className="hint">
        {bars
          ? 'One bar of count-in, then exactly that many bars; the loop starts on the beat.'
          : 'Press to start, press again at the end of the phrase: the loop is exactly that long.'}{' '}
        Pedals: main = Record / Overdub, next = Stop / Play. Overdubs line up using your Tap In sync from Lessons.
      </p>
    </section>
  )
}
