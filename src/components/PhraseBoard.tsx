import { useState } from 'react'
import type { SavedPhrase } from '../music/pinned'
export type { SavedPhrase } from '../music/pinned'
import { Toggle } from '../modes/SongMode'




const STRING_ROWS = [5, 4, 3, 2, 1, 0]
const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e']

/** A phrase as a small six-line tab. `ptr` marks progress when it's the one being played. */
function PhraseCard(props: { phrase: SavedPhrase; ptr?: number; small?: boolean; pinned: boolean; active?: boolean; onPin: () => void; onPlay?: () => void; extra?: React.ReactNode }) {
  const { phrase, ptr, small, pinned, active } = props
  return (
    <div className={`phrase ${small ? 'small' : ''} ${active ? 'active' : ''}`} onClick={props.onPlay} title={props.onPlay ? 'Play this phrase' : undefined}>
      <div className="phrase-head">
        <span className="label">{small ? `over ${phrase.chord}` : `Phrase to try · over ${phrase.chord}`}</span>
        <button
          className={`pin ${pinned ? 'on' : ''}`}
          title={pinned ? 'Unpin' : 'Pin to my set'}
          onClick={(e) => {
            e.stopPropagation()
            props.onPin()
          }}
        >
          📌
        </button>
        {props.extra}
      </div>
      <div className="phrase-tab">
        {STRING_ROWS.map((s) => (
          <div key={s} className="tab-line">
            <span className="tab-name">{STRING_NAMES[s]}</span>
            {phrase.notes.map((p, i) => (
              <span key={i} className={`tab-cell ${p.string === s ? 'has' : ''} ${ptr === undefined ? '' : i < ptr ? 'done' : i === ptr ? 'cur' : ''}`}>
                {p.string === s ? p.fret : ''}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Current phrase, earlier phrases flowing to the right, and the pinned set (drag to reorder). */
export function PhraseBoard(props: {
  upcoming: SavedPhrase | null
  current: SavedPhrase | null
  ptr: number
  history: SavedPhrase[]
  pinned: SavedPhrase[]
  setMode: boolean
  setIdx: number
  onNew: () => void
  onPin: (p: SavedPhrase) => void
  onPlay: (p: SavedPhrase) => void
  onReorder: (p: SavedPhrase[]) => void
  onSetMode: (v: boolean) => void
}) {
  const { current, pinned } = props
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const isPinned = (p: SavedPhrase) => pinned.some((x) => x.id === p.id)
  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return
    const from = pinned.findIndex((p) => p.id === dragId)
    const to = pinned.findIndex((p) => p.id === targetId)
    if (from < 0 || to < 0) return
    const next = pinned.slice()
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    props.onReorder(next)
  }
  return (
    <div className="phrase-board">
      <div className="phrase-row">
        {props.upcoming && (
          <div className="phrase-next">
            <span className="label">Next</span>
            <PhraseCard phrase={props.upcoming} small pinned={isPinned(props.upcoming)} onPin={() => props.onPin(props.upcoming!)} onPlay={() => props.onPlay(props.upcoming!)} />
          </div>
        )}
        {current && (
          <PhraseCard
            phrase={current}
            ptr={props.ptr}
            pinned={isPinned(current)}
            active
            onPin={() => props.onPin(current)}
            extra={
              <button className="link" onClick={props.onNew} title="N">
                {props.setMode ? 'next in set' : 'new phrase'}
              </button>
            }
          />
        )}
        {props.history.length > 0 && (
          <div className="phrase-history">
            <span className="label">Earlier</span>
            <div className="phrase-scroll">
              {props.history.map((p) => (
                <PhraseCard key={p.id} phrase={p} small pinned={isPinned(p)} onPin={() => props.onPin(p)} onPlay={() => props.onPlay(p)} />
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="phrase-set">
        <div className="phrase-set-head">
          <span className="label">My set ({pinned.length})</span>
          {pinned.length > 0 && <Toggle on={props.setMode} set={props.onSetMode} label="Practise my set" />}
          <span className="hint">{pinned.length ? 'Drag to reorder · click to play' : 'Pin phrases you like (📌) to build your own set to practise.'}</span>
        </div>
        {pinned.length > 0 && (
          <div className="phrase-scroll">
            {pinned.map((p, i) => (
              <div
                key={p.id}
                draggable
                className={`pinned-slot ${dragId === p.id ? 'dragging' : ''} ${overId === p.id && dragId !== p.id ? 'over' : ''}`}
                onDragStart={(e) => {
                  setDragId(p.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  setOverId(p.id)
                }}
                onDragLeave={() => setOverId(null)}
                onDrop={(e) => {
                  e.preventDefault()
                  drop(p.id)
                  setDragId(null)
                  setOverId(null)
                }}
                onDragEnd={() => {
                  setDragId(null)
                  setOverId(null)
                }}
              >
                <span className="slot-num">{i + 1}</span>
                <PhraseCard
                  phrase={p}
                  small
                  pinned
                  active={props.setMode && i === props.setIdx}
                  onPin={() => props.onPin(p)}
                  onPlay={() => props.onPlay(p)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
