// The whole song on the right: every section in playing order with its chords bar by bar and the words, the
// section playing now lit up and kept in view. Click a section to jump there.
import { useEffect, useRef, useState } from 'react'
import type { SheetSection } from '../music/songForm'
import { guitarShape } from '../music/parts'
import { parseChord } from '../music/theory'
import { chordFingering } from '../lessons/fingering'
import { ChordDiagram } from '../components/PartViews'

/** How to hold a chord: its box with finger numbers, beside the sheet while the pointer is on its name. */
function ChordTip({ symbol, at }: { symbol: string; at: { x: number; y: number } }) {
  const chord = parseChord(symbol)
  if (!chord) return null
  const shape = guitarShape(chord)
  const f = chordFingering(shape.frets)
  const played = shape.frets.filter((x) => x > 0)
  const low = played.length ? Math.min(...played) : 0
  return (
    <div className="chord-tip" role="tooltip" style={{ left: at.x, top: at.y }}>
      <ChordDiagram shape={shape} name={symbol} size={1.1} fingers={f.fingers} />
      <p className="hint">
        {f.barre ? `Barre fret ${f.barre.fret} with your index finger. ` : low > 4 ? `Starts at fret ${low}. ` : ''}Numbers are fingers: 1 index … 4 pinky. × = don't play, ○ = open string.
      </p>
    </div>
  )
}

export function SongSheet({
  title,
  artist,
  keyLabel,
  capo,
  sheet,
  current,
  onJump,
  onClose,
}: {
  title: string
  artist: string
  keyLabel: string
  capo: number
  sheet: SheetSection[]
  current: number // formIdx playing now, -1 when stopped before the song
  onJump: (formIdx: number) => void
  onClose: () => void
}) {
  const list = useRef<HTMLOListElement>(null)
  const [tip, setTip] = useState<{ symbol: string; x: number; y: number } | null>(null)
  // The tip sits just left of the sheet, level with the chord (inside the window).
  const showTip = (symbol: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const left = box.current?.getBoundingClientRect().left ?? r.left
    const W = 190
    setTip({ symbol, x: Math.max(8, left - W - 10), y: Math.min(window.innerHeight - 260, Math.max(8, r.top - 40)) })
  }
  const box = useRef<HTMLElement>(null)
  // Right under the app's top bar, however tall it is (it wraps in a narrow window).
  useEffect(() => {
    const place = () => {
      const bottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 64
      box.current?.style.setProperty('top', `${Math.max(0, Math.round(bottom))}px`)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [])
  // Keep the section playing now in view.
  useEffect(() => {
    if (current < 0) return
    list.current?.querySelector('.ss-sec.now')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [current])

  return (
    <aside className="song-sheet" ref={box} aria-label={`The whole song: ${title}`}>
      <header className="ss-head">
        <div>
          <b>{title}</b>
          <span className="hint">
            {artist} · key {keyLabel}
            {capo ? ` · capo ${capo} on the record` : ''}
          </span>
        </div>
        <button className="btn small" onClick={onClose} title="Hide the song sheet">
          ✕
        </button>
      </header>
      <ol className="ss-list" ref={list}>
        {sheet.map((s) => (
          <li key={s.formIdx} className={`ss-sec${s.formIdx === current ? ' now' : ''}${s.solo ? ' solo' : ''}`}>
            <button className="ss-name" onClick={() => onJump(s.formIdx)} title="Jump here">
              {s.name}
              {s.passes > 1 && <span className="ss-x"> ×{s.passes}</span>}
              {s.solo && <span className="ss-x"> · solo</span>}
            </button>
            <div className="ss-bars">
              {s.bars.map((b, i) => (
                <span key={i} className="ss-bar">
                  {b.map((c, j) => (
                    <span
                      key={j}
                      className="ss-chord"
                      tabIndex={0}
                      onMouseEnter={(ev) => showTip(c, ev.currentTarget)}
                      onMouseLeave={() => setTip(null)}
                      onFocus={(ev) => showTip(c, ev.currentTarget)}
                      onBlur={() => setTip(null)}
                    >
                      {c}
                    </span>
                  ))}
                </span>
              ))}
            </div>
            {s.lines.length > 0 && (
              <div className="ss-words">
                {s.lines.map((l, i) => (
                  <p key={i}>{l}</p>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
      {tip && <ChordTip symbol={tip.symbol} at={tip} />}
    </aside>
  )
}
