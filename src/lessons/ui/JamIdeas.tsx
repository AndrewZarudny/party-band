// Jam ideas under the runway: a phrase to try over the chord the band is on, and the one for what comes next.
import type { Idea } from '../ideas'

const ROWS = [5, 4, 3, 2, 1, 0]
const NAMES = ['E', 'A', 'D', 'G', 'B', 'e']

function IdeaTab({ idea, label, next = false }: { idea: Idea; label: string; next?: boolean }) {
  const said = idea.notes.map((n) => `${NAMES[n.string]} string fret ${n.fret}`).join(', ')
  return (
    <figure className={`lp-idea${next ? ' next' : ''}`}>
      <figcaption>{label}</figcaption>
      <div className="lp-idea-tab" role="img" aria-label={`${label}: ${said}`}>
        {ROWS.map((s) => (
          <div key={s} className="lp-idea-line">
            <span className="lp-idea-name">{NAMES[s]}</span>
            {idea.notes.map((n, i) => (
              <span key={i} className={`lp-idea-cell${n.string === s ? ' has' : ''}`}>
                {n.string === s ? n.fret : ''}
              </span>
            ))}
          </div>
        ))}
      </div>
    </figure>
  )
}

export function JamIdeas({ cur, next, dim, onNew, onHide }: { cur: Idea; next: Idea | null; /** the player's turn in an answer jam: the idea steps back */ dim: boolean; onNew: () => void; onHide: () => void }) {
  return (
    <div className={`lp-ideas${dim ? ' dim' : ''}`}>
      <IdeaTab idea={cur} label={cur.chord ? `Idea to try · over ${cur.chord}` : 'Idea to try'} />
      {next && <IdeaTab idea={next} label={next.chord ? `Next · over ${next.chord}` : 'Next'} next />}
      <div className="lp-ideas-side">
        <p>Only an idea, never scored. Play it, bend it or ignore it, then leave a gap.</p>
        <div>
          <button type="button" className="lp-peek" onClick={onNew}>
            New idea
          </button>
          <button type="button" className="lp-peek" onClick={onHide}>
            Hide ideas
          </button>
        </div>
      </div>
    </div>
  )
}
