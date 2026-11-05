import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { MAX_LOOP_BARS } from '../loop'
import './loop.css'

function LoopGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M3 8a5 5 0 0 1 8.6-3.5M13 8a5 5 0 0 1-8.6 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12.4 1.6v3.3H9.1M3.6 14.4v-3.3h3.3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const bucket = (a: number | null) => (a === null ? 'none' : a >= 0.9 ? 'hi' : a >= 0.7 ? 'mid' : 'lo')
const range = (from: number, to: number) => (from === to ? `bar ${from + 1}` : `bars ${from + 1}–${to + 1}`)

/** The result card's bars, coloured by how clean each one was. Tap a bar, then another, to loop that part. */
export function BarStrip({ acc, listen, hard, onLoop }: { acc: (number | null)[]; listen: number[]; hard: { from: number; to: number } | null; onLoop: (from: number, to: number) => void }) {
  const [sel, setSel] = useState<{ anchor: number; from: number; to: number } | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const listenSet = new Set(listen)

  const tap = (b: number) => {
    if (!sel || (b >= sel.from && b <= sel.to) || Math.abs(b - sel.anchor) > MAX_LOOP_BARS - 1) {
      setSel({ anchor: b, from: b, to: b })
      return
    }
    setSel({ anchor: sel.anchor, from: Math.min(sel.anchor, b), to: Math.max(sel.anchor, b) })
  }

  // Arrow keys walk the strip, skipping bars with nothing to play.
  const onKey = (e: KeyboardEvent<HTMLOListElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
    const btns = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    if (!btns.length) return
    const i = btns.indexOf(document.activeElement as HTMLButtonElement)
    let j = i
    if (e.key === 'Home') j = 0
    else if (e.key === 'End') j = btns.length - 1
    else if (e.key === 'ArrowLeft') j = i < 0 ? 0 : Math.max(0, i - 1)
    else j = i < 0 ? 0 : Math.min(btns.length - 1, i + 1)
    e.preventDefault()
    btns[j]?.focus()
  }

  const shown = sel ?? hard
  const selPlayable = !!sel && acc.slice(sel.from, sel.to + 1).some((a) => a !== null)

  return (
    <section className="lo-strip" aria-label="Bar by bar">
      <h3 className="lo-strip-h">Bar by bar</h3>
      <ol className="ls-bars" ref={listRef} onKeyDown={onKey}>
        {acc.map((a, i) => {
          const b = bucket(a)
          const inShown = !!shown && i >= shown.from && i <= shown.to
          const pressed = !!sel && i >= sel.from && i <= sel.to
          const label = a === null ? `Bar ${i + 1}: ${listenSet.has(i) ? 'listen' : 'rest'}` : `Bar ${i + 1}: ${Math.round(a * 100)}% clean`
          return (
            <li key={i}>
              <button
                type="button"
                className={`lo-bar ${b}${inShown ? (sel ? ' sel' : ' hard') : ''}`}
                aria-label={label}
                aria-pressed={pressed}
                title={label}
                disabled={a === null}
                onClick={() => tap(i)}
              >
                <span className="ls-num">{i + 1}</span>
              </button>
            </li>
          )
        })}
      </ol>
      <p className="lo-legend" aria-hidden="true">
        <i className="hi" />
        90%+ clean
        <i className="mid" />
        70%+
        <i className="lo" />
        less
      </p>
      <div className="lo-strip-act">
        {sel ? (
          <button className="ls-btn primary small" disabled={!selPlayable} title={selPlayable ? undefined : 'Nothing to play in these bars'} onClick={() => onLoop(sel.from, sel.to)}>
            <LoopGlyph />
            Loop {range(sel.from, sel.to)}
          </button>
        ) : (
          hard && (
            <button className="ls-btn primary small" onClick={() => onLoop(hard.from, hard.to)}>
              <LoopGlyph />
              Loop the hard part: {range(hard.from, hard.to)}
            </button>
          )
        )}
      </div>
      <p className="ls-muted lo-hint">Tap a bar, then another, to pick a part to loop.</p>
    </section>
  )
}
