import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Prefs, Progress } from '../types'
import { exportProgress, importProgress, newProgress } from '../progress'
import { InputPicker } from './InputPicker'

const GOALS: Progress['dailyGoal'][] = [100, 200, 350]
const ZOOMS: Prefs['zoom'][] = [0.75, 1, 1.25]

function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="ls-set-row">
      <div className="ls-set-label">
        <span>{label}</span>
        {note && <small>{note}</small>}
      </div>
      <div className="ls-set-ctl">{children}</div>
    </div>
  )
}

function Switch({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) {
  return (
    <button className={`ls-switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => set(!on)}>
      <span className="ls-switch-track" aria-hidden>
        <span />
      </span>
      <span>{on ? 'On' : 'Off'}</span>
    </button>
  )
}

export function SettingsPanel({
  progress,
  prefs,
  onProgress,
  onPrefs,
  onResync,
  onClose,
}: {
  progress: Progress
  prefs: Prefs
  onProgress: (p: Progress) => void
  onPrefs: (p: Prefs) => void
  onResync: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(progress.dinoName)
  const [age, setAge] = useState(prefs.age === null ? '' : String(prefs.age))
  const [confirmReset, setConfirmReset] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const first = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    first.current?.focus()
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null
      if (t && t.closest('input, select, textarea')) return
      if (ev.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const doExport = () => {
    const blob = new Blob([exportProgress(progress)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'fretwise-lessons.json'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const doImport = async (f: File | undefined) => {
    if (!f) return
    const p = importProgress(await f.text())
    if (!p) {
      setNote("That file isn't a Fretwise lessons export.")
      return
    }
    onProgress(p)
    setName(p.dinoName)
    setNote('Progress imported.')
  }

  // Empty or out of range = not set.
  const saveAge = () => {
    const n = Math.round(Number(age))
    const v = age.trim() && isFinite(n) && n >= 3 && n <= 120 ? n : null
    setAge(v === null ? '' : String(v))
    if (v !== prefs.age) onPrefs({ ...prefs, age: v })
  }

  const rename = () => {
    const n = name.trim()
    if (n && n !== progress.dinoName) onProgress({ ...progress, dinoName: n })
  }

  return (
    <section className="ls-panel ls-settings" aria-labelledby="ls-settings-h">
      <header className="ls-panel-head">
        <h2 id="ls-settings-h" className="ls-display">
          Settings
        </h2>
        <button ref={first} className="ls-btn ghost" onClick={onClose}>
          Done
        </button>
      </header>

      <div className="ls-set-group">
        <InputPicker prefs={prefs} onPrefs={onPrefs} />
        <Row label="Timing sync" note={prefs.keyboard ? 'For keyboard input' : 'For your guitar setup'}>
          <button className="ls-btn small" onClick={onResync}>
            Re-sync
          </button>
        </Row>
        <Row label="Keyboard input" note="Play with Space and 1–6 even when a guitar is connected">
          <Switch on={prefs.keyboard} set={(v) => onPrefs({ ...prefs, keyboard: v })} label="Keyboard input" />
        </Row>
        <Row label="Display offset" note="Moves the notes on screen only">
          <input
            type="range"
            min={-100}
            max={100}
            step={5}
            value={prefs.visualNudgeMs}
            aria-label="Display offset in milliseconds"
            onChange={(ev) => onPrefs({ ...prefs, visualNudgeMs: Number(ev.target.value) })}
          />
          <span className="ls-num ls-set-val">
            {prefs.visualNudgeMs > 0 ? '+' : ''}
            {prefs.visualNudgeMs} ms
          </span>
        </Row>
        <Row label="Zoom">
          <div className="ls-seg" role="radiogroup" aria-label="Zoom">
            {ZOOMS.map((z) => (
              <button key={z} role="radio" aria-checked={prefs.zoom === z} className={prefs.zoom === z ? 'on' : ''} onClick={() => onPrefs({ ...prefs, zoom: z })}>
                {Math.round(z * 100)}%
              </button>
            ))}
          </div>
        </Row>
        <Row label="Show fretboard">
          <Switch on={prefs.showFretboard} set={(v) => onPrefs({ ...prefs, showFretboard: v })} label="Show fretboard" />
        </Row>
      </div>

      <div className="ls-set-group">
        <Row label="Daily goal">
          <div className="ls-seg" role="radiogroup" aria-label="Daily goal">
            {GOALS.map((g) => (
              <button key={g} role="radio" aria-checked={progress.dailyGoal === g} className={progress.dailyGoal === g ? 'on' : ''} onClick={() => onProgress({ ...progress, dailyGoal: g })}>
                {g} XP
              </button>
            ))}
          </div>
        </Row>
        <Row label="Dino name">
          <input
            className="ls-text"
            value={name}
            maxLength={20}
            aria-label="Dino name"
            onChange={(ev) => setName(ev.target.value)}
            onBlur={rename}
            onKeyDown={(ev) => ev.key === 'Enter' && rename()}
          />
        </Row>
        <Row label="Your age" note="Optional. Only used for fun timing comparisons after a lesson">
          <input
            className="ls-text ls-age"
            type="number"
            inputMode="numeric"
            min={3}
            max={120}
            placeholder="Skip"
            value={age}
            aria-label="Your age, optional"
            onChange={(ev) => setAge(ev.target.value)}
            onBlur={saveAge}
            onKeyDown={(ev) => ev.key === 'Enter' && saveAge()}
          />
        </Row>
      </div>

      <div className="ls-set-group">
        <Row label="Your progress" note="Save a copy, or move it to another browser">
          <button className="ls-btn small" onClick={doExport}>
            Export
          </button>
          <button className="ls-btn small" onClick={() => file.current?.click()}>
            Import
          </button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(ev) => void doImport(ev.target.files?.[0])} />
        </Row>
        {note && (
          <p className="ls-muted" role="status">
            {note}
          </p>
        )}
        <Row label="Reset progress" note="Stars, XP, streak and your dino start over">
          {confirmReset ? (
            <>
              <button
                className="ls-btn small danger"
                onClick={() => {
                  onProgress({ ...newProgress(), dinoName: progress.dinoName })
                  setConfirmReset(false)
                  setNote('Progress reset. A backup copy was kept.')
                }}
              >
                Yes, reset
              </button>
              <button className="ls-btn small ghost" onClick={() => setConfirmReset(false)}>
                Keep it
              </button>
            </>
          ) : (
            <button className="ls-btn small" onClick={() => setConfirmReset(true)}>
              Reset
            </button>
          )}
        </Row>
      </div>
    </section>
  )
}
