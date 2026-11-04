import { useEffect, useRef } from 'react'
import type { Cosmetic, Progress } from '../types'
import { ACHIEVEMENTS } from '../achievements'
import { DINO_STAGES, dinoStageFor } from '../progress'
import { Dino } from './Dino'

const COSMETIC_NAME: Record<Cosmetic, string> = {
  shades: 'Shades',
  bandana: 'Bandana',
  'pick-crown': 'Pick crown',
  'star-guitar': 'Star guitar',
}
const PICK = 'M20 41C13 34 3 23 3 13.5 3 6 10.5 2.5 20 2.5S37 6 37 13.5C37 23 27 34 20 41Z'

function when(ts: number) {
  try {
    return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}

export function AchievementsPanel({ progress, onEquip, onClose }: { progress: Progress; onEquip: (c: Cosmetic[]) => void; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null)
  const stage = dinoStageFor(progress)
  const earned = ACHIEVEMENTS.filter((a) => progress.achievements[a.id]).length

  useEffect(() => {
    first.current?.focus()
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggle = (c: Cosmetic) => {
    const on = progress.cosmetics.includes(c)
    onEquip(on ? progress.cosmetics.filter((x) => x !== c) : [...progress.cosmetics, c])
  }

  return (
    <section className="ls-panel ls-achievements" aria-labelledby="ls-ach-h">
      <header className="ls-panel-head">
        <h2 id="ls-ach-h" className="ls-display">
          Achievements <span className="ls-num ls-muted">{earned}/{ACHIEVEMENTS.length}</span>
        </h2>
        <button ref={first} className="ls-btn ghost" onClick={onClose}>
          Done
        </button>
      </header>

      <div className="ls-ach-layout">
        <aside className="ls-wardrobe">
          <Dino stage={stage} mood="proud" size={150} cosmetics={progress.cosmetics} />
          <p className="ls-muted">
            {progress.dinoName}, {DINO_STAGES[stage]?.name}
          </p>
          {stage < 2 && <p className="ls-caption">Gear shows once your dino is out of the shell.</p>}
        </aside>

        <ul className="ls-badges">
          {ACHIEVEMENTS.map((a) => {
            const at = progress.achievements[a.id]
            const c = a.cosmetic
            const worn = !!c && progress.cosmetics.includes(c)
            return (
              <li key={a.id} className={`ls-badge ${at ? 'got' : ''}`}>
                <svg viewBox="0 0 40 44" aria-hidden>
                  <path d={PICK} />
                </svg>
                <div>
                  <p className="ls-badge-name">{a.name}</p>
                  <p className="ls-badge-text">{a.text}</p>
                  {at ? <p className="ls-badge-when">Earned {when(at)}</p> : null}
                  {c && at && (
                    <button className={`ls-btn small ${worn ? 'on' : ''}`} aria-pressed={worn} onClick={() => toggle(c)}>
                      {worn ? `Wearing ${COSMETIC_NAME[c].toLowerCase()}` : `Wear ${COSMETIC_NAME[c].toLowerCase()}`}
                    </button>
                  )}
                  {c && !at && <p className="ls-badge-when">Unlocks: {COSMETIC_NAME[c].toLowerCase()}</p>}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
