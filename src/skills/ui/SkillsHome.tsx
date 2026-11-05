// The Skills area: five short games next to the lessons, each with its best result.
import { useState } from 'react'
import { bestKey } from '../data'
import type { GameId, SkillStart } from '../data'
import { loadStats } from '../store'
import { FretGame } from './FretGame'
import { ChordChanges } from './ChordChanges'
import { InnerClock } from './InnerClock'
import { RecordTakes } from './RecordTakes'
import { EarGame } from './EarGame'
import '../skills.css'

type Screen = 'home' | 'find' | 'name' | 'changes' | 'clock' | 'record' | 'ear'

interface Card {
  id: Exclude<Screen, 'home'>
  title: string
  text: string
  best: (b: Record<string, number>) => string | null
}

const bestOf = (b: Record<string, number>, g: GameId) => b[bestKey(g)]

/** The highest best among a game's keyed results (e.g. every chord pair). */
const topOf = (b: Record<string, number>, g: GameId) => {
  const vals = Object.entries(b)
    .filter(([k]) => k.startsWith(`${g}:`))
    .map(([, v]) => v)
  return vals.length ? Math.max(...vals) : undefined
}

const CARDS: Card[] = [
  { id: 'find', title: 'Find every note', text: 'Every A on the neck, string by string.', best: (b) => (bestOf(b, 'find') !== undefined ? `Best ${bestOf(b, 'find')} spots` : null) },
  { id: 'name', title: 'Name that note', text: 'A spot lights up. Play it.', best: (b) => (bestOf(b, 'name') !== undefined ? `Best ${bestOf(b, 'name')} right` : null) },
  { id: 'changes', title: 'One-minute changes', text: 'Two chords, 60 seconds, count the clean switches. Retire a pair at 60.', best: (b) => (topOf(b, 'changes') !== undefined ? `Best ${topOf(b, 'changes')} changes` : null) },
  { id: 'clock', title: 'Inner clock', text: 'The click drops out. Stay on the beat.', best: (b) => (bestOf(b, 'clock') !== undefined ? `Best ${bestOf(b, 'clock')} ms off` : null) },
  { id: 'ear', title: 'Ear training', text: 'Hear a short phrase, play it back.', best: (b) => (bestOf(b, 'ear') !== undefined ? `Longest ${bestOf(b, 'ear')} notes` : null) },
  { id: 'record', title: 'Record yourself', text: 'Record a take, listen back, note what to fix.', best: () => null },
]

function CardIcon({ id }: { id: Card['id'] }) {
  // Simple line marks, one per game.
  const paths: Record<Card['id'], string> = {
    find: 'M3 7h18M3 12h18M3 17h18M8 4v16M14 4v16',
    name: 'M3 8h18M3 16h18M10 4v16M17 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0',
    changes: 'M5 8h11l-3-3M19 16H8l3 3',
    clock: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 7v5l3 2',
    ear: 'M7 10a5 5 0 0 1 10 0c0 3-3 4-3 7a2.5 2.5 0 0 1-5 0M10 10a2 2 0 0 1 4 0',
    record: 'M12 12m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0',
  }
  return (
    <svg className="sk-icon" viewBox="0 0 24 24" aria-hidden>
      <path d={paths[id]} />
    </svg>
  )
}

export function SkillsHome({ keyboard, onBack, onConnect, start }: { keyboard: boolean; onBack: () => void; onConnect: () => void; start?: SkillStart }) {
  // A start (from the session plan or a pocket session) opens that game at once; the mental card isn't a game here.
  const [screen, setScreen] = useState<Screen>(() => (start && start.game !== 'mental' ? start.game : 'home'))
  const [stats, setStats] = useState(loadStats)
  const home = () => {
    setStats(loadStats())
    setScreen('home')
  }
  const pair = start?.game === 'changes' ? start.pair : undefined
  const band = start?.game === 'record' ? start.band : undefined

  if (screen === 'find' || screen === 'name') return <FretGame key={screen} mode={screen} keyboard={keyboard} onBack={home} />
  if (screen === 'changes') return <ChordChanges keyboard={keyboard} onBack={home} pair={pair} />
  if (screen === 'clock') return <InnerClock keyboard={keyboard} onBack={home} />
  if (screen === 'record') return <RecordTakes keyboard={keyboard} onBack={home} band={band} />
  if (screen === 'ear') return <EarGame keyboard={keyboard} onBack={home} />

  return (
    <section className="ls-panel sk-home" aria-labelledby="sk-home-h">
      <header className="ls-panel-head sk-home-head">
        <button className="ls-btn ghost small" onClick={onBack}>
          Back
        </button>
        <div>
          <h2 id="sk-home-h" className="ls-display">
            Skills
          </h2>
          <p className="ls-muted">Short games, one to three minutes each. They count as practice.</p>
        </div>
      </header>
      {keyboard && (
        <p className="sk-kbd-note">
          No guitar connected, so the games take keys and clicks instead.{' '}
          <button className="ls-link" onClick={onConnect}>
            Connect your guitar
          </button>
        </p>
      )}
      <ul className="sk-cards">
        {CARDS.map((c) => {
          const best = c.best(stats.best)
          return (
            <li key={c.id}>
              <button className="sk-card" onClick={() => setScreen(c.id)}>
                <CardIcon id={c.id} />
                <span className="sk-card-text">
                  <b>{c.title}</b>
                  <span className="ls-muted">{c.text}</span>
                  {best && <span className="sk-card-best ls-num">{best}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
