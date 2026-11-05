// The Technique basics sheet: a modal carousel of the seven cards, this lesson's two first.
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { BASICS_ORDER } from './basics'
import type { BasicsId } from './basics'
import { BasicsCard } from './BasicsCards'
import { useStill } from './useFrame'
import './teach.css'

export function BasicsSheet({ first, strum, startAt, onClose }: { first: BasicsId[]; strum: boolean; startAt?: BasicsId; onClose: () => void }) {
  const order = [...first, ...BASICS_ORDER.filter((id) => !first.includes(id))]
  const still = useStill()
  const [idx, setIdx] = useState(Math.max(0, startAt ? order.indexOf(startAt) : 0))
  const boxRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Focus moves in, and back to where it was on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => before?.focus?.()
  }, [])

  // Jump to the opening card without animating
  useEffect(() => {
    const tr = trackRef.current
    const card = tr?.children[idx] as HTMLElement | undefined
    if (tr && card) tr.scrollTo({ left: card.offsetLeft - tr.offsetLeft, behavior: 'auto' })
    // only on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const go = (i: number) => {
    const n = Math.max(0, Math.min(order.length - 1, i))
    setIdx(n)
    const tr = trackRef.current
    const card = tr?.children[n] as HTMLElement | undefined
    if (tr && card) tr.scrollTo({ left: card.offsetLeft - tr.offsetLeft, behavior: still ? 'auto' : 'smooth' })
  }

  // Which card is in view after a swipe
  const onScroll = () => {
    const tr = trackRef.current
    if (!tr || !tr.clientWidth) return
    const i = Math.round(tr.scrollLeft / tr.clientWidth)
    if (i !== idx && i >= 0 && i < order.length) setIdx(i)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      onClose()
      return
    }
    if (e.key === 'ArrowRight') go(idx + 1)
    else if (e.key === 'ArrowLeft') go(idx - 1)
    else if (e.key === 'Tab') {
      // focus trap
      const els = boxRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex]:not([tabindex="-1"])')
      if (!els || !els.length) return
      const firstEl = els[0]
      const lastEl = els[els.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }
  }

  return (
    <div className="tc-sheet-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={boxRef} className="tc-sheet" role="dialog" aria-modal="true" aria-labelledby="tc-sheet-title" onKeyDown={onKey}>
        <header className="tc-sheet-head">
          <h2 id="tc-sheet-title">Technique basics</h2>
          <button ref={closeRef} className="ls-btn small" onClick={onClose}>
            Done
          </button>
        </header>
        <div ref={trackRef} className="tc-track" onScroll={onScroll}>
          {order.map((id, i) => (
            <div key={id} className="tc-cardslot" aria-hidden={i !== idx}>
              <BasicsCard id={id} still={still || i !== idx} strum={strum} mark={first.includes(id) ? 'For this lesson' : undefined} />
            </div>
          ))}
        </div>
        <footer className="tc-sheet-foot">
          <button className="ls-btn small" onClick={() => go(idx - 1)} disabled={idx === 0}>
            Back
          </button>
          <div className="tc-dots" role="tablist" aria-label="Cards">
            {order.map((id, i) => (
              <button key={id} role="tab" aria-selected={i === idx} aria-label={`Card ${i + 1} of ${order.length}`} className={i === idx ? 'on' : ''} onClick={() => go(i)} />
            ))}
          </div>
          <button className="ls-btn small" onClick={() => go(idx + 1)} disabled={idx === order.length - 1}>
            Next
          </button>
        </footer>
      </div>
    </div>
  )
}
