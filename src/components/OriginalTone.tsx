import { useState } from 'react'
import { engine } from '../audio/engine'
import type { SongInfo } from '../audio/presets'
import { addGear, getCurrentSong, linkToCurrentSong, loadPresets, savePreset, setGear } from '../audio/presets'
import type { T3kModel } from '../tone3000/client'
import { captureKindFor, downloadModel, getClientId, getTone, listModels, loadToneInPopup } from '../tone3000/client'
import type { Cost } from '../aiCost'
import { describeCost, usd, useAiStatus } from '../aiCost'

interface Match {
  toneId: string
  title: string
  url: string
  why?: string
  gear?: string
}

interface Lookup {
  rig?: string
  confidence?: 'high' | 'medium' | 'low'
  amp?: { search: string; versionHint?: string; matches: Match[] }
  cab?: { search: string; matches: Match[] }
  settings?: Partial<Record<'bass' | 'mid' | 'treble' | 'presence' | 'gate' | 'reverb' | 'delay' | 'delayMs' | 'chorus' | 'level', number>>
  tips?: string
  error?: string
  cost?: Cost
}

/** The last lookup per song part, so reopening the panel doesn't ask again. */
const key = (s: SongInfo) => `original-tone:${s.artist}|${s.title}|${s.track}`.toLowerCase()
const loadLookup = (s: SongInfo | null): Lookup | null => {
  if (!s) return null
  try {
    return JSON.parse(localStorage.getItem(key(s)) ?? 'null') as Lookup | null
  } catch {
    return null
  }
}
const storeLookup = (s: SongInfo, l: Lookup | null) => {
  try {
    if (l) localStorage.setItem(key(s), JSON.stringify(l))
    else localStorage.removeItem(key(s))
  } catch {
    /* storage unavailable */
  }
}

/** The version of a tone that best fits the hint ("red channel, high gain"); NAM versions must be A2. */
function pickModel(models: T3kModel[], isIr: boolean, hint?: string): T3kModel | null {
  // TONE3000 reports the version as a string ("2"), so compare loosely.
  const usable = isIr ? models : models.filter((m) => Number(m.architecture_version) === 2)
  if (!usable.length) return null
  const words = (hint ?? '').toLowerCase().match(/[a-z]{3,}|\d+/g) ?? []
  const score = (m: T3kModel) => words.filter((w) => m.name.toLowerCase().includes(w)).length + (m.size === 'standard' ? 0.5 : 0)
  const best = Math.max(...usable.map(score))
  const top = usable.filter((m) => score(m) === best)
  return top[Math.floor((top.length - 1) / 2)]
}

/** "Get original tone": the recorded rig, matched to real TONE3000 captures, one click to play. */
export function OriginalTone({ onReady, needKey }: { onReady: (name: string) => void; needKey: () => void }) {
  const song = getCurrentSong()
  const [lookup, setLookupState] = useState<Lookup | null>(() => loadLookup(song))
  const [lookupFor, setLookupFor] = useState(song ? key(song) : '')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [using, setUsing] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const status = useAiStatus(tick)

  // The open song changed: show that song's lookup, if any.
  if (song && key(song) !== lookupFor) {
    setLookupFor(key(song))
    setLookupState(loadLookup(song))
    setDone('')
    setError('')
  }
  const setLookup = (l: Lookup | null) => {
    if (song) storeLookup(song, l)
    setLookupState(l)
  }

  const find = async () => {
    if (!song) return
    setBusy(`Finding the original rig for “${song.title}” and matching captures on TONE3000…`)
    setError('')
    setDone('')
    try {
      const r = (await (await fetch('/api/original-tone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(song) })).json()) as Lookup
      if (r.error) setError(r.error)
      else setLookup(r)
      setTick((t) => t + 1)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy('')
    }
  }

  /** Download the best version of a TONE3000 tone into the current tone (popup sign-in if needed). */
  const fetchTone = async (m: Match, isIr: boolean, hint?: string) => {
    const toneId = await loadToneInPopup(m.toneId)
    setBusy(`Downloading “${m.title}”…`)
    const [tone, models] = await Promise.all([getTone(toneId), listModels(toneId, isIr)])
    const model = pickModel(models, isIr, hint)
    if (!model) throw new Error(`“${tone.title}” has no version the browser engine can play. Try another one.`)
    const name = model.name && model.name !== tone.title ? `${tone.title} · ${model.name}` : tone.title
    await addGear({
      id: `t3k-${tone.id}-${model.id}`,
      kind: isIr ? 'ir' : 'nam',
      name,
      gear: isIr ? undefined : captureKindFor(tone),
      creator: tone.user?.username,
      license: tone.license,
      url: tone.url ?? `https://www.tone3000.com/tones/${tone.id}`,
      // eslint-disable-next-line react-hooks/purity -- runs in a click handler after an await, never during render
      addedAt: Date.now(),
      data: await downloadModel(model),
    })
    return { tone, name }
  }

  /** Saves (or updates) "<song> – original", links it to the song part, and reports what's playing. */
  const saveAndLink = (what: string) => {
    if (!song) return
    const name = `${song.title} – original`
    const existing = loadPresets().find((p) => p.name === name)
    const preset = savePreset(name, existing?.id)
    linkToCurrentSong(preset.id)
    onReady(name)
    setDone(`${what} · saved as “${name}” and set for this song.`)
  }

  const loadAmp = (m: Match) => {
    if (!getClientId()) return needKey()
    setUsing(m.toneId)
    setError('')
    setDone('')
    setBusy('Waiting for TONE3000…')
    fetchTone(m, false, lookup?.amp?.versionHint)
      .then(async ({ tone, name }) => {
        engine.setTone({ ...engine.tone, ...lookup?.settings, cab: true })
        // A full rig includes its cabinet; drop any IR left over from another tone.
        if (captureKindFor(tone) !== 'amp') await setGear('ir', undefined)
        saveAndLink(`Playing ${name}`)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setBusy('')
        setUsing(null)
      })
  }

  const loadCab = (m: Match) => {
    if (!getClientId()) return needKey()
    setUsing(m.toneId)
    setError('')
    setBusy('Waiting for TONE3000…')
    fetchTone(m, true)
      .then(({ name }) => saveAndLink(`Cab IR ${name} added`))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setBusy('')
        setUsing(null)
      })
  }

  const ampMatches = lookup?.amp?.matches ?? []
  const cabMatches = lookup?.cab?.matches ?? []
  const loadedHead = !!done && ampMatches.some((m) => m.gear === 'amp')

  return (
    <div className="original-tone">
      {!song && <p className="hint">Open a song in Learn a song to get its original tone.</p>}
      {song && !lookup && (
        <>
          <button className="btn primary" disabled={!!busy} onClick={() => void find()}>
            ✨ Get original tone for “{song.title}”
            {status?.ai && <span className="cost-tag">~{usd(status.estimates['original-tone'])}</span>}
          </button>
          {status?.ai && (
            <p className="hint cost-line">
              {status.models['original-tone']} + tone3000.com search · about {usd(status.estimates['original-tone'])}, free if asked again · this month {usd(status.monthUsd)}
            </p>
          )}
        </>
      )}
      {song && lookup && (
        <div className="ot-card">
          <div className="row spread">
            <b>Original tone · {song.title}</b>
            <button className="link" onClick={() => setLookup(null)}>
              ask again
            </button>
          </div>
          {lookup.rig && <p>{lookup.rig}</p>}
          {ampMatches.length ? (
            <div className="ot-matches">
              {ampMatches.map((m) => (
                <div key={m.toneId} className="ot-match">
                  <button className="btn small primary" disabled={!!busy} onClick={() => loadAmp(m)}>
                    {using === m.toneId ? 'Loading…' : 'Use'}
                  </button>
                  <span>
                    <a href={m.url} target="_blank" rel="noreferrer">
                      {m.title}
                    </a>
                    <small>
                      {m.gear === 'amp-cab' ? ' · full rig (amp + cab)' : m.gear === 'amp' ? ' · amp head' : ''}
                      {m.why ? ` · ${m.why}` : ''}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">No playable captures found for this one. Try “ask again”, or “Find amp on TONE3000” below.</p>
          )}
          {loadedHead && cabMatches.length > 0 && (
            <div className="ot-matches">
              <span className="label">Add a matching cab (optional; the built-in cab is used until then)</span>
              {cabMatches.map((m) => (
                <div key={m.toneId} className="ot-match">
                  <button className="btn small" disabled={!!busy} onClick={() => loadCab(m)}>
                    {using === m.toneId ? 'Loading…' : 'Add cab'}
                  </button>
                  <a href={m.url} target="_blank" rel="noreferrer">
                    {m.title}
                  </a>
                </div>
              ))}
            </div>
          )}
          {done && <p className="ot-done">✓ {done}</p>}
          {lookup.cost && <p className="hint cost-line">{describeCost(lookup.cost)}</p>}
        </div>
      )}
      {busy && <p className="hint">{busy}</p>}
      {error && <div className="error">{error}</div>}
    </div>
  )
}
