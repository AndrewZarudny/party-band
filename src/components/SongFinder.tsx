import { useState } from 'react'
import type { Cost } from '../aiCost'
import { describeCost, usd, useAiStatus } from '../aiCost'

interface FoundTab {
  title: string
  url: string
  site: string
  kind: string
  note?: string
}

interface SearchResult {
  ai: boolean
  artist: string
  title: string
  about?: string
  tabs: FoundTab[]
  searchLinks: { label: string; url: string }[]
  error?: string
  cost?: Cost
}

/** Ask Claude to find downloadable Guitar Pro versions of a song. */
export function SongFinder({ onClose, onPicked }: { onClose: () => void; onPicked: (m: { artist: string; title: string }) => void }) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [tick, setTick] = useState(0)
  const status = useAiStatus(tick)
  const aiOn = status ? status.ai : null

  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/find', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })
      const r = (await res.json()) as SearchResult
      setResult(r)
      setTick((t) => t + 1)
      onPicked({ artist: r.artist, title: r.title })
    } catch (err) {
      setResult({ ai: false, artist: '', title: query, tabs: [], searchLinks: [], error: String(err) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="finder">
      <div className="finder-head">
        <h2>Find a song</h2>
        <button className="icon-btn" onClick={onClose} title="Close">
          ×
        </button>
      </div>
      <form onSubmit={search} className="finder-form">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={'Describe it any way: "Hotel California solo", "that Eagles song about a hotel"…'}
        />
        <button className="btn primary" disabled={loading || !query.trim()}>
          {loading ? 'Searching…' : 'Search'}
          {aiOn && status && !loading && <span className="cost-tag">~{usd(status.estimates['song-search'])}</span>}
        </button>
      </form>
      {aiOn && status && (
        <p className="hint cost-line">
          AI search with {status.models['song-search']} · about {usd(status.estimates['song-search'])} per new search, repeat searches are free · this month {usd(status.monthUsd)}
        </p>
      )}
      {aiOn === false && (
        <p className="hint">
          AI search is off. Add <code>ANTHROPIC_API_KEY=…</code> to <code>.env.local</code> in the app folder and restart <code>npm run dev</code>. You still get search links
          below.
        </p>
      )}
      {loading && <p className="hint">Claude is identifying the song and looking for Guitar Pro versions (about 10–30 s)…</p>}

      {result && (
        <div className="finder-results">
          {result.error && aiOn !== false && <div className="error">{result.error}</div>}
          {result.cost && <p className="hint cost-line">{describeCost(result.cost)}</p>}
          {result.artist && (
            <div className="finder-song">
              <b>{result.title}</b> <span>by {result.artist}</span>
              {result.about && <p className="hint">{result.about}</p>}
            </div>
          )}
          {result.tabs.length > 0 && (
            <ul className="finder-tabs">
              {result.tabs.map((t) => (
                <li key={t.url}>
                  <a href={t.url} target="_blank" rel="noreferrer">
                    {t.title}
                  </a>
                  <span className={`kind ${t.kind === 'Guitar Pro' ? 'gp' : ''}`}>{t.kind}</span>
                  <span className="site">{t.site}</span>
                  {t.note && <span className="hint">{t.note}</span>}
                </li>
              ))}
            </ul>
          )}
          {result.ai && !result.error && result.tabs.length === 0 && <p className="hint">No Guitar Pro versions turned up in the search. Try the links below.</p>}
          <div className="finder-links">
            {result.searchLinks.map((l) => (
              <a key={l.url} className="btn small" href={l.url} target="_blank" rel="noreferrer">
                {l.label} ↗
              </a>
            ))}
          </div>
          <p className="hint">
            Open a <b>Guitar Pro</b> version, click its download button, and it's imported here automatically from your Downloads folder.
          </p>
        </div>
      )}
    </div>
  )
}
