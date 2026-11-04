import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as alphaTab from '@coderline/alphatab'
type Beat = alphaTab.model.Beat
type Score = alphaTab.model.Score
type Track = alphaTab.model.Track
import { Fretboard } from '../components/Fretboard'
import { SongFinder } from '../components/SongFinder'
import type { Marker } from '../components/Fretboard'
import { engine } from '../audio/engine'
import { useEngineState, useNoteOn } from '../audio/hooks'
import { loadSongTone } from '../audio/tone'
import type { SongToneData } from '../audio/songTone'
import type { ToneVariant } from '../audio/songTone'
import { estimateTone, loadToneData, readCues, saveToneData, toneAt } from '../audio/songTone'
import { allPresets, applyTone, currentSetup, findPreset, importGearFile, importGearZip, onSetup, setCurrentSong, takePendingLink } from '../audio/presets'
import { deleteSong, listSongs, saveSong } from '../music/library'
import type { SongEntry } from '../music/library'
import { STANDARD_TUNING, midiName, nearestPosition, pc } from '../music/theory'
import type { BeatLike } from '../music/tunings'
import { TUNINGS, describeTuning, isUniformShift, refinger, setSongTuning, tuningLabel } from '../music/tunings'
import { holdReload, practice } from '../account/activity'

interface Conversion {
  to: number[] // low → high
  mode: 'pitch' | 'shapes'
}

const convKey = (artist: string, title: string) => `conv:${artist.toLowerCase()}|${title.toLowerCase()}`
function loadConversion(artist: string, title: string): Conversion | null {
  try {
    return JSON.parse(localStorage.getItem(convKey(artist, title)) ?? 'null') as Conversion | null
  } catch {
    return null
  }
}

/** Rewrites a track for another tuning. Returns a one-line explanation. */
function convertTrack(track: Track, conv: Conversion): string {
  const staff = track.staves[0]
  const from = [...staff.tuning].reverse()
  const beats = staff.bars.flatMap((bar) => bar.voices.flatMap((v) => v.beats))
  const name = describeTuning(conv.to)
  if (conv.mode === 'shapes' && from.length === conv.to.length) {
    staff.stringTuning.tunings = [...conv.to].reverse()
    const diff = Math.round(conv.to.reduce((s, n, i) => s + n - from[i], 0) / conv.to.length)
    const dir = diff > 0 ? 'higher' : 'lower'
    return diff === 0 ? `Same fingering in ${name}.` : `Same fingering in ${name}: sounds ${Math.abs(diff)} semitone${Math.abs(diff) > 1 ? 's' : ''} ${dir} than the recording, so the backing tracks are muted.`
  }
  const pitches = new Map<unknown, number>()
  for (const b of beats) for (const n of b.notes) pitches.set(n, n.realValue)
  staff.stringTuning.tunings = [...conv.to].reverse()
  const r = refinger(beats as unknown as BeatLike[], (n) => pitches.get(n) ?? n.realValue, conv.to)
  const extra = [
    r.octaveShifted ? `${r.octaveShifted} note${r.octaveShifted > 1 ? 's' : ''} moved an octave to fit` : '',
    r.dropped ? `${r.dropped} doubled note${r.dropped > 1 ? 's' : ''} removed from chords` : '',
  ].filter(Boolean)
  return `Re-fingered for ${name}; it sounds like the recording.${extra.length ? ` ${extra.join(', ')}.` : ''}${isUniformShift(from, conv.to) ? ' Tip: "Keep the fingering" is usually easier for this change.' : ''}`
}

const ACCEPT = '.gp,.gp3,.gp4,.gp5,.gpx,.gp7,.gp8,.musicxml,.mxl,.xml,.cap'

interface Expected {
  midis: number[]
  markers: { string: number; fret: number; midi: number }[]
}

function expectedFor(beat: Beat | null): Expected {
  if (!beat) return { midis: [], markers: [] }
  const notes = beat.notes.filter((n) => !n.isDead && !n.isTieDestination && n.isStringed)
  const strings = beat.voice.bar.staff.tuning.length || 6
  return {
    midis: notes.map((n) => n.realValue),
    // alphaTab: string 1 = lowest. Our fretboard: 0 = low E.
    markers: notes.map((n) => ({ string: Math.min(5, Math.max(0, n.string - 1 - (strings - 6))), fret: n.fret, midi: n.realValue })),
  }
}

function playableBeats(track: Track): Beat[] {
  const out: Beat[] = []
  for (const bar of track.staves[0]?.bars ?? []) {
    for (const b of bar.voices[0]?.beats ?? []) {
      if (!b.isRest && b.notes.some((n) => !n.isTieDestination && !n.isDead)) out.push(b)
    }
  }
  return out
}

const isGuitar = (t: Track) => t.staves[0]?.isStringed && !t.isPercussion && (/guit|gtr/i.test(t.name) || (t.playbackInfo.program >= 24 && t.playbackInfo.program <= 31))

export function SongMode({ onToneLabel, onImported, onEditTone }: { onToneLabel: (label: string) => void; onImported?: () => void; onEditTone: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null)
  const [songs, setSongs] = useState<SongEntry[]>([])
  const [score, setScore] = useState<Score | null>(null)
  const [trackIdx, setTrackIdx] = useState(0)
  const trackIdxRef = useRef(0)
  trackIdxRef.current = trackIdx
  const [ready, setReady] = useState(false)
  const [loadPct, setLoadPct] = useState(0)
  const [playing, setPlaying] = useState(false)
  // Account updates from elsewhere wait while the song plays.
  useEffect(() => {
    holdReload('song', playing)
    const stopPractice = practice('songs', playing)
    return () => {
      holdReload('song', false)
      stopPractice?.()
    }
  }, [playing])
  const [speed, setSpeed] = useState(100)
  const [metronome, setMetronome] = useState(false)
  const metroLevel = useEngineState().metronomeLevel
  const [countIn, setCountIn] = useState(true)
  const [muteMine, setMuteMine] = useState(false)
  const [notation, setNotation] = useState<'Tab' | 'ScoreTab'>('Tab')
  const [waitMode, setWaitMode] = useState(false)
  const [beat, setBeat] = useState<Beat | null>(null)
  const [hits, setHits] = useState({ hit: 0, miss: 0 })
  const [beatHit, setBeatHit] = useState(false)
  const [trail, setTrail] = useState<{ midi: number; t: number }[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')

  const beatRef = useRef<Beat | null>(null)
  // Lets the alphaTab event handlers (set up once) call the latest tone switcher.
  const applyToneRef = useRef<(bar: number) => void>(() => {})
  const beatHitRef = useRef(false)
  const waitRef = useRef({ on: false, beats: [] as Beat[], i: 0 })
  const songMeta = useRef({ artist: '', title: '' })
  const entryRef = useRef<SongEntry | null>(null)
  const lastScore = useRef<Score | null>(null)
  const pendingTrack = useRef<number | null>(null)
  const pendingTrackName = useRef<string | null>(null)
  const converted = useRef(new WeakSet<object>())
  const [conversion, setConversion] = useState<Conversion | null>(null)
  const [origTuning, setOrigTuning] = useState<number[]>(STANDARD_TUNING)
  const [convInfo, setConvInfo] = useState('')

  // Song tone: variants (clean / drive / lead…) and which bar each one starts at.
  const [toneData, setToneData] = useState<SongToneData | null>(null)
  const [activeTone, setActiveTone] = useState('')
  const [autoTone, setAutoTone] = useState(true)
  const [toneErr, setToneErr] = useState('')
  /** Plays a song part's tone: its linked preset, or the tone stored with the song. */
  const applyVariant = useCallback(async (v: ToneVariant) => {
    try {
      const p = findPreset(v.presetId)
      await applyTone(p ?? { name: v.name, settings: v.settings, capture: v.capture, ir: v.ir })
    } catch (err) {
      setToneErr(`Couldn't load ${v.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])
  const toneRef = useRef({ data: null as SongToneData | null, active: '', auto: true })
  toneRef.current.data = toneData
  toneRef.current.auto = autoTone
  /** Switches the amp to the tone for this bar (1-based) if it differs from the current one. */
  const applyToneAtBar = useCallback(
    (bar: number, force = false) => {
      const d = toneRef.current.data
      if (!d || (!toneRef.current.auto && !force)) return
      const v = toneAt(d, bar)
      if (!force && v.id === toneRef.current.active) return
      toneRef.current.active = v.id
      setActiveTone(v.id)
      void applyVariant(v)
      onToneLabel(findPreset(v.presetId)?.name ?? v.name)
    },
    [onToneLabel, applyVariant],
  )

  const refreshLibrary = useCallback(() => {
    listSongs()
      .then((s) => setSongs(s.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title))))
      .catch(() => setSongs([]))
  }, [])

  useEffect(refreshLibrary, [refreshLibrary])

  // On start: reopen the last song played.
  const reopened = useRef(false)
  useEffect(() => {
    if (reopened.current || !songs.length || !apiRef.current) return
    reopened.current = true
    let id: string | null = null
    try {
      id = localStorage.getItem('last-song')
    } catch {
      /* storage unavailable */
    }
    const e = songs.find((x) => x.id === id)
    if (e) loadEntry(e)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songs])


  // alphaTab instance lives for the whole lifetime of this mode.
  useEffect(() => {
    if (!hostRef.current || !viewportRef.current) return
    const api = new alphaTab.AlphaTabApi(hostRef.current, {
      core: { fontDirectory: '/font/' },
      display: { staveProfile: 'Tab', layoutMode: 'Page', scale: 1.05 },
      player: {
        playerMode: alphaTab.PlayerMode.EnabledSynthesizer,
        soundFont: '/soundfont/sonivox.sf2',
        scrollElement: viewportRef.current,
        enableCursor: true,
        enableAnimatedBeatCursor: true,
        enableElementHighlighting: true,
        enableUserInteraction: true,
      },
    })
    apiRef.current = api
    api.soundFontLoad.on((e) => setLoadPct(Math.round((e.loaded / Math.max(1, e.total)) * 100)))
    api.playerReady.on(() => setReady(true))
    api.playerStateChanged.on((e) => setPlaying(e.state === alphaTab.synth.PlayerState.Playing))
    api.scoreLoaded.on((s) => {
      // renderScore() re-announces the same score; only react to genuinely new loads.
      if (s === lastScore.current) return
      lastScore.current = s
      setScore(s)
      const byName = pendingTrackName.current ? s.tracks.findIndex((t) => t.name === pendingTrackName.current) : -1
      pendingTrackName.current = null
      const idx = byName >= 0 ? byName : (pendingTrack.current ?? Math.max(0, s.tracks.findIndex(isGuitar)))
      pendingTrack.current = null
      setTrackIdx(idx)
      setHits({ hit: 0, miss: 0 })
    })
    api.playedBeatChanged.on((b) => {
      if (waitRef.current.on) return
      const prev = beatRef.current
      if (prev && expectedFor(prev).midis.length && !beatHitRef.current) setHits((h) => ({ ...h, miss: h.miss + 1 }))
      beatRef.current = b
      beatHitRef.current = false
      setBeat(b)
      setBeatHit(false)
      applyToneRef.current(b.voice.bar.index + 1)
    })
    return () => {
      api.destroy()
      apiRef.current = null
    }
  }, [])

  const track = score?.tracks[trackIdx] ?? null

  // Render the chosen track and pick its tone.
  useEffect(() => {
    const api = apiRef.current
    if (!api || !score || !track) return
    const { artist, title } = songMeta.current
    const tuningNow = () => [...(track.staves[0]?.tuning ?? [])].reverse()
    if (!converted.current.has(track)) setOrigTuning(tuningNow().length ? tuningNow() : STANDARD_TUNING)
    if (conversion && track.staves[0]?.isStringed && !converted.current.has(track)) {
      converted.current.add(track)
      setConvInfo(convertTrack(track, conversion))
      api.renderScore(score, [trackIdx])
      const others = score.tracks.filter((t) => t !== track)
      api.changeTrackMute(others, conversion.mode === 'shapes')
    } else if (!converted.current.has(track)) {
      setConvInfo('')
      api.renderTracks([track])
    } else api.renderTracks([track])
    setSongTuning(track.staves[0]?.isStringed ? { song: title || 'this song', notes: tuningNow() } : null)
    // Tone: cached (AI or edited) data for this part, else an estimate; then ask the AI once.
    const cues = readCues(score, track)
    setCurrentSong({ artist, title, track: track.name, cues: cues.map((c) => c.text) })
    const cached = loadToneData(artist, title, track.name)
    const legacy = loadSongTone(artist, `${title}#${track.name}`)
    const data =
      cached ??
      (legacy
        ? { source: 'estimate' as const, tones: [{ id: 'main', name: legacy.name, settings: legacy }], timeline: [{ bar: 1, tone: 'main' }] }
        : estimateTone({ artist, title, trackName: track.name, program: track.playbackInfo.program }, cues))
    toneRef.current = { data, active: '', auto: toneRef.current.auto }
    setToneData(data)
    setToneErr('')
    applyToneAtBar(1, true)
    // AI tone runs only when asked (button in the tone strip).
    waitRef.current.beats = playableBeats(track)
    waitRef.current.i = 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score, track, onToneLabel])

  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    api.playbackSpeed = speed / 100
    api.metronomeVolume = metronome ? metroLevel : 0
    api.countInVolume = countIn ? metroLevel : 0
  }, [speed, metronome, countIn, ready, metroLevel])

  useEffect(() => {
    const api = apiRef.current
    if (!api || !track) return
    api.changeTrackMute([track], muteMine)
  }, [muteMine, track, ready])

  useEffect(() => {
    const api = apiRef.current
    if (!api || !score) return
    api.settings.display.staveProfile = notation === 'Tab' ? alphaTab.StaveProfile.Tab : alphaTab.StaveProfile.ScoreTab
    api.updateSettings()
    api.render()
  }, [notation, score])

  /** Changes the tuning to play in: reloads the original file, then converts the track. */
  const chooseTuning = (c: Conversion | null) => {
    const { artist, title } = songMeta.current
    try {
      if (c) localStorage.setItem(convKey(artist, title), JSON.stringify(c))
      else localStorage.removeItem(convKey(artist, title))
    } catch {
      /* storage unavailable */
    }
    pendingTrack.current = trackIdx
    if (entryRef.current) loadEntry(entryRef.current)
  }

  const loadEntry = useCallback((e: SongEntry) => {
    setError('')
    songMeta.current = { artist: e.artist, title: e.title }
    entryRef.current = e
    try {
      localStorage.setItem('last-song', e.id)
    } catch {
      /* storage unavailable */
    }
    setConversion(loadConversion(e.artist, e.title))
    setScore(null)
    setBeat(null)
    beatRef.current = null
    if (!apiRef.current?.load(new Uint8Array(e.data))) setError(`Couldn't read ${e.fileName}`)
  }, [])

  const importFiles = useCallback(
    async (files: FileList | File[], fallback?: { artist: string; title: string }) => {
      for (const file of Array.from(files)) {
        const data = await file.arrayBuffer()
        try {
          const settings = new alphaTab.Settings()
          const s = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(data), settings)
          const base = file.name.replace(/\.[^.]+$/, '')
          const entry: SongEntry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            title: s.title || fallback?.title || base,
            artist: s.artist || fallback?.artist || 'Unknown artist',
            fileName: file.name,
            addedAt: Date.now(),
            data,
          }
          await saveSong(entry)
          loadEntry(entry)
        } catch {
          setError(`${file.name} isn't a Guitar Pro / MusicXML file alphaTab can read.`)
        }
      }
      refreshLibrary()
    },
    [loadEntry, refreshLibrary],
  )

  // Song finder: the song being looked for, so a downloaded file can be labelled with it.
  const [finderOpen, setFinderOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const lookingFor = useRef<{ artist: string; title: string } | undefined>(undefined)

  // New Guitar Pro files in ~/Downloads are imported automatically.
  useEffect(() => {
    const es = new EventSource('/api/downloads/events')
    es.onmessage = async (ev) => {
      const { name } = JSON.parse(ev.data) as { name: string }
      const res = await fetch(`/api/downloads/file?name=${encodeURIComponent(name)}`)
      if (!res.ok) return
      const file = new File([await res.arrayBuffer()], name)
      if (/\.zip$/i.test(name)) {
        // TONE3000 downloads are zips of captures; other zips are ignored.
        const what = await importGearZip(file).catch(() => null)
        if (what) {
          setNotice(`Loaded “${what}” from Downloads into the current tone (🎸 to save it as a preset)`)
          setTimeout(() => setNotice(''), 6000)
        }
        return
      }
      if (/\.nam$/i.test(name)) {
        await importGearFile(file)
        setNotice(`Loaded amp capture “${name}” from Downloads into the current tone (🎸 to save it as a preset)`)
        setTimeout(() => setNotice(''), 5000)
        return
      }
      await importFiles([file], lookingFor.current)
      setFinderOpen(false)
      setNotice(`Imported “${name}” from Downloads`)
      onImported?.()
      setTimeout(() => setNotice(''), 5000)
    }
    return () => es.close()
  }, [importFiles, onImported])

  applyToneRef.current = applyToneAtBar

  /** Updates the tone data for this song part, saves it, and re-applies the active variant. */
  const updateToneData = (fn: (d: SongToneData) => SongToneData) => {
    const d = toneRef.current.data
    const tr = apiRef.current?.score?.tracks[trackIdxRef.current]
    if (!d || !tr) return
    const next = { ...fn(d), source: 'custom' as const }
    saveToneData(songMeta.current.artist, songMeta.current.title, tr.name, next)
    toneRef.current.data = next
    setToneData(next)
    const v = next.tones.find((t) => t.id === toneRef.current.active) ?? next.tones[0]
    void applyVariant(v)
    onToneLabel(findPreset(v.presetId)?.name ?? v.name)
  }

  /** Links a saved preset to a song part (or unlinks it with undefined). */
  const linkPreset = (variant: string, presetId: string | undefined) =>
    updateToneData((d) => ({ ...d, tones: d.tones.map((t) => (t.id === variant ? { ...t, presetId } : t)) }))

  // "Get original tone" in the 🎸 panel links its new preset to the part that's playing.
  const linkRef = useRef(linkPreset)
  linkRef.current = linkPreset
  useEffect(
    () =>
      onSetup(() => {
        const id = takePendingLink()
        const d = toneRef.current.data
        if (id && d) linkRef.current(toneRef.current.active || d.tones[0].id, id)
      }),
    [],
  )

  /** Stores the amp's current settings as the active tone variant for this song. */
  const saveCurrentTone = () => {
    const d = toneRef.current.data
    if (!d || !track) return
    const id = toneRef.current.active || d.tones[0].id
    const g = currentSetup()
    const next: SongToneData = {
      ...d,
      source: 'custom',
      tones: d.tones.map((t) => (t.id === id ? { ...t, settings: { ...engine.tone, name: t.name }, capture: g.capture, ir: g.ir, presetId: g.presetId } : t)),
    }
    saveToneData(songMeta.current.artist, songMeta.current.title, track.name, next)
    toneRef.current.data = next
    setToneData(next)
  }

  // Wait mode: park the cursor on the next beat and advance when it is played.
  const gotoWaitBeat = useCallback((i: number) => {
    const w = waitRef.current
    const api = apiRef.current
    if (!api || !w.beats.length) return
    w.i = Math.max(0, Math.min(i, w.beats.length - 1))
    const b = w.beats[w.i]
    api.tickPosition = b.absolutePlaybackStart
    applyToneRef.current(b.voice.bar.index + 1)
    beatRef.current = b
    beatHitRef.current = false
    setBeat(b)
    setBeatHit(false)
  }, [])

  useEffect(() => {
    waitRef.current.on = waitMode
    const api = apiRef.current
    if (!api) return
    if (waitMode) {
      api.pause()
      const w = waitRef.current
      const at = beatRef.current ? w.beats.indexOf(beatRef.current) : 0
      gotoWaitBeat(at < 0 ? 0 : at)
    }
  }, [waitMode, gotoWaitBeat])

  useNoteOn(
    useCallback(
      (midi: number) => {
        setTrail((t) => [...t.slice(-7), { midi, t: performance.now() }])
        const cur = expectedFor(beatRef.current)
        // Octave slips are common on low strings, so accept the same note an octave away.
        if (!cur.midis.some((m) => m === midi || Math.abs(m - midi) === 12)) return
        if (!beatHitRef.current) {
          beatHitRef.current = true
          setBeatHit(true)
          setHits((h) => ({ ...h, hit: h.hit + 1 }))
        }
        if (waitRef.current.on) gotoWaitBeat(waitRef.current.i + 1)
      },
      [gotoWaitBeat],
    ),
  )

  const now = expectedFor(beat)
  const nextBeat = waitMode ? waitRef.current.beats[waitRef.current.i + 1] ?? null : (beat?.nextBeat ?? null)
  const next = expectedFor(nextBeat && !nextBeat.isRest ? nextBeat : (nextBeat?.nextBeat ?? null))

  const fbTuning = track?.staves[0]?.isStringed && track.staves[0].tuning.length === 6 ? [...track.staves[0].tuning].reverse() : STANDARD_TUNING
  const markers = useMemo<Marker[]>(() => {
    const m: Marker[] = []
    for (const p of next.markers) m.push({ ...p, kind: 'upcoming', label: midiName(p.midi).replace(/-?\d+$/, '') })
    for (const p of now.markers) m.push({ ...p, kind: beatHit ? 'played' : 'chord', label: midiName(p.midi).replace(/-?\d+$/, '') })
    for (const p of now.markers) m.push({ ...p, kind: 'target' })
    const ref = now.markers[0]?.fret ?? 5
    const t0 = performance.now()
    trail.forEach((n) => {
      const pos = now.markers.find((p) => p.midi === n.midi) ?? nearestPosition(n.midi, ref, fbTuning)
      if (pos) m.push({ string: pos.string, fret: pos.fret, kind: 'played', opacity: Math.max(0.15, 1 - (t0 - n.t) / 2500) })
    })
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now.markers, next.markers, trail, beatHit, fbTuning.join()])

  const total = hits.hit + hits.miss
  const pct = total ? Math.round((hits.hit / total) * 100) : 0
  const guitarTracks = score?.tracks ?? []

  return (
    <div
      className={`song-mode ${dragOver ? 'drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files)
      }}
    >
      <aside className="library">
        <div className="library-head">
          <h2>My songs</h2>
          <label className="btn small">
            + Import
            <input type="file" accept={ACCEPT} multiple hidden onChange={(e) => e.target.files && importFiles(e.target.files)} />
          </label>
        </div>
        <button className="btn primary find-btn" onClick={() => setFinderOpen(true)}>
          🔍 Find a song
        </button>
        {songs.length === 0 && (
          <p className="hint">
            Download a Guitar Pro file from Ultimate Guitar (tab page → <b>Download Guitar Pro</b>) and drop it anywhere here.
          </p>
        )}
        <ul>
          {songs.map((s) => (
            <li key={s.id} className={songMeta.current.title === s.title && songMeta.current.artist === s.artist ? 'active' : ''}>
              <button className="song-item" onClick={() => loadEntry(s)}>
                <span className="song-title">{s.title}</span>
                <span className="song-artist">{s.artist}</span>
              </button>
              <button
                className="icon-btn"
                title="Remove from library"
                onClick={async () => {
                  await deleteSong(s.id)
                  refreshLibrary()
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="song-main">
        {score ? (
          <div className="song-bar">
            <div className="song-name">
              <b>{score.title || songMeta.current.title}</b>
              <span>{score.artist}</span>
            </div>
            <select value={trackIdx} onChange={(e) => setTrackIdx(Number(e.target.value))} title="Track to learn">
              {guitarTracks.map((t, i) => (
                <option key={i} value={i}>
                  {t.name || `Track ${i + 1}`}
                  {isGuitar(t) ? '' : ' (not guitar)'}
                </option>
              ))}
            </select>
            <TuningPicker orig={origTuning} conversion={conversion} onChange={chooseTuning} />
            <button className="btn primary" disabled={!ready || waitMode} onClick={() => apiRef.current?.playPause()}>
              {playing ? '❚❚ Pause' : '▶ Play'}
            </button>
            <button className="btn" disabled={!ready} onClick={() => apiRef.current?.stop()}>
              ■
            </button>
            <label className="speed">
              Speed {speed}%
              <input type="range" min={25} max={125} step={5} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
            </label>
            <Toggle on={metronome} set={setMetronome} label="Metronome" />
            <MetronomeVolume />
            <Toggle on={countIn} set={setCountIn} label="Count-in" />
            <Toggle on={muteMine} set={setMuteMine} label="Mute my part" />
            <Toggle on={waitMode} set={setWaitMode} label="Wait for me" />
            <button className="btn small" onClick={() => setNotation(notation === 'Tab' ? 'ScoreTab' : 'Tab')}>
              {notation === 'Tab' ? 'Tab only' : 'Notes + tab'}
            </button>
            <button
              className="btn small"
              title="Remember the current amp settings for this song and track"
              onClick={saveCurrentTone}
            >
              Save tone
            </button>
          </div>
        ) : (
          <div className="empty-state">
            <h2>Pick a song or drop a Guitar Pro file</h2>
            <p>
              <b>.gp / .gp5 / .gpx / .gp7</b> files and MusicXML work. You get interactive tab, playback with the backing tracks, slow-down, looping (drag across bars), and
              a tone picked for the song.
            </p>
            {!ready && loadPct > 0 && loadPct < 100 && <p className="hint">Loading instrument sounds… {loadPct}%</p>}
          </div>
        )}
        {error && <div className="error">{error}</div>}
        {score && convInfo && <div className="notice">{convInfo}</div>}
        {score && toneData && (
          <ToneStrip
            data={toneData}
            active={activeTone}
            auto={autoTone}
            error={toneErr}
            onAuto={setAutoTone}
            onPick={(id) => {
              const v = toneData.tones.find((t) => t.id === id)
              if (!v) return
              toneRef.current.active = id
              setActiveTone(id)
              void applyVariant(v)
            }}
            onLink={(presetId) => linkPreset(toneRef.current.active || toneData.tones[0].id, presetId)}
            onEdit={onEditTone}
          />
        )}
        {notice && <div className="notice">{notice}</div>}
        {finderOpen && (
          <SongFinder
            onClose={() => setFinderOpen(false)}
            onPicked={(m) => {
              lookingFor.current = m
            }}
          />
        )}
        <div className="tab-viewport" ref={viewportRef}>
          <div ref={hostRef} />
        </div>

        {score && (
          <div className="follow-panel">
            <div className="follow-info">
              <div>
                <span className="label">Now</span>
                <span className={`now-notes ${beatHit ? 'ok' : ''}`}>{now.midis.map(midiName).join(' ') || '—'}</span>
              </div>
              <div>
                <span className="label">Next</span>
                <span className="next-notes">{next.midis.map(midiName).join(' ') || '—'}</span>
              </div>
              <div>
                <span className="label">You played</span>
                <span className="played-notes">
                  {trail.slice(-5).map((n, i) => (
                    <span key={i} className={now.midis.some((m) => pc(m) === pc(n.midi)) ? 'ok' : ''}>
                      {midiName(n.midi)}{' '}
                    </span>
                  ))}
                </span>
              </div>
              <div>
                <span className="label">Accuracy</span>
                <span>
                  {pct}% <small>({hits.hit}/{total})</small>
                </span>
                <button className="link" onClick={() => setHits({ hit: 0, miss: 0 })}>
                  reset
                </button>
              </div>
              {waitMode && <div className="hint">Wait mode: play the highlighted note to move on.</div>}
            </div>
            <Fretboard markers={markers} maxFret={22} tuning={fbTuning} />
          </div>
        )}
      </section>
    </div>
  )
}

export function Toggle({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) {
  return (
    <button className={`toggle ${on ? 'on' : ''}`} onClick={() => set(!on)} aria-pressed={on}>
      <span className="dot" />
      {label}
    </button>
  )
}

function TuningPicker({ orig, conversion, onChange }: { orig: number[]; conversion: Conversion | null; onChange: (c: Conversion | null) => void }) {
  const value = conversion ? TUNINGS.find((t) => t.notes.every((n, i) => n === conversion.to[i]))?.id ?? '' : 'orig'
  const mode = conversion?.mode ?? 'pitch'
  return (
    <span className="tuning-picker" title="Play this song in a different tuning">
      <select
        value={value}
        onChange={(e) => {
          const t = TUNINGS.find((x) => x.id === e.target.value)
          // A plain shift (e.g. E♭ → E) is best played with the same shapes; otherwise keep the sound.
          onChange(t ? { to: t.notes, mode: isUniformShift(orig, t.notes) ? 'shapes' : 'pitch' } : null)
        }}
      >
        <option value="orig">
          Tuning: {describeTuning(orig)} ({tuningLabel(orig)})
        </option>
        {TUNINGS.filter((t) => t.notes.length === orig.length && !t.notes.every((n, i) => n === orig[i])).map((t) => (
          <option key={t.id} value={t.id}>
            Convert to {t.name}
          </option>
        ))}
      </select>
      {conversion && (
        <select value={mode} onChange={(e) => onChange({ ...conversion, mode: e.target.value as Conversion['mode'] })}>
          <option value="pitch">Keep the sound (re-finger)</option>
          <option value="shapes">Keep the fingering</option>
        </select>
      )}
    </span>
  )
}


/** Song parts (clean / distortion…), the preset each one uses, and automatic switching. */
function ToneStrip(props: {
  data: SongToneData
  active: string
  auto: boolean
  error: string
  onAuto: (v: boolean) => void
  onPick: (id: string) => void
  onLink: (presetId: string | undefined) => void
  onEdit: () => void
}) {
  const { data, auto, error } = props
  const v = data.tones.find((t) => t.id === props.active) ?? data.tones[0]
  const presets = allPresets()
  const switches = data.timeline.length > 1
  const label = (t: ToneVariant) => findPreset(t.presetId)?.name ?? t.name
  return (
    <div className="tone-strip">
      <div className="tone-row">
        <span className="label">Tone</span>
        {data.tones.length > 1 &&
          data.tones.map((t) => (
            <button key={t.id} className={`seg ${t.id === v.id ? 'on' : ''}`} onClick={() => props.onPick(t.id)} title="Use this part's tone now">
              {t.name}
            </button>
          ))}
        <select value={v.presetId ?? ''} onChange={(e) => props.onLink(e.target.value || undefined)} title={`Tone preset for ${v.name}`}>
          <option value="">{v.presetId ? 'Song default' : `${label(v)} (song default)`}</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.builtIn ? p.name : `★ ${p.name}`}
            </option>
          ))}
        </select>
        <button className="btn small" onClick={props.onEdit}>
          🎸 Edit tone
        </button>
        {switches && <Toggle on={auto} set={props.onAuto} label="Switch with the song" />}
        {switches && (
          <span className="hint">
            {data.timeline.map((e, i) => (
              <span key={i}>
                {i > 0 && ' → '}bar {e.bar}: {(() => {
                  const t = data.tones.find((x) => x.id === e.tone)
                  return t ? label(t) : e.tone
                })()}
              </span>
            ))}
          </span>
        )}
        {error && <span className="tone-err">{error}</span>}
      </div>
    </div>
  )
}

/** Loudness of the metronome and count-in (shared by every tab). */
export function MetronomeVolume() {
  const e = useEngineState()
  return (
    <label className="metro-vol" title="Metronome volume">
      🔊
      <input type="range" min={0} max={3} step={0.1} value={e.metronomeLevel} onChange={(ev) => engine.setMetronomeLevel(Number(ev.target.value))} />
      <span>{Math.round(e.metronomeLevel * 100)}%</span>
    </label>
  )
}
