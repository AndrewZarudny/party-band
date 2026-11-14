// The whole song on the right: every section in playing order with its chords bar by bar and the words, the
// section playing now lit up and kept in view. Click a section to jump there.
import { useEffect, useRef } from 'react'
import type { SheetSection } from '../music/songForm'

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
                  {b.join(' ')}
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
    </aside>
  )
}
