import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Fretboard } from '../components/Fretboard'
import { engine } from '../audio/engine'
import { useNoteOn } from '../audio/hooks'
import { makePhrase, boxNotes } from '../music/phrase'
import type { Chord, FretPos } from '../music/theory'
import { PROGRESSIONS, SCALES, STANDARD_TUNING, midiName, noteName, parseChord, pc, prefersFlats, romanToChord, transposeChord } from '../music/theory'
import { MetronomeVolume, Toggle } from './SongMode'
import { PhraseBoard } from '../components/PhraseBoard'
import { loadPinned, savePinned } from '../music/pinned'
import type { SavedPhrase } from '../music/pinned'
import { jamMarkers } from '../music/jamMarkers'
import type { SongSetup, Step } from '../music/songForm'
import { beatsToNextSection, locate, progressionSteps, soloAt, songSegments, songSteps, totalBeats } from '../music/songForm'
import { lyricTimeline } from '../music/lyrics'
import { SongsPanel } from '../session/SongsPanel'
import { LyricSync } from '../session/LyricSync'
import { loadLibrary, logEnd, logStart, saveToLibrary, songKey as libKey } from '../music/songLibrary'
import { SongProgress } from '../components/SongProgress'
import { RecordingBar } from '../session/RecordingBar'
import { analyzeBeats } from '../audio/recording'
import { barsFrom, beatFeatures, detectChords, downbeatPhase } from '../audio/analysis'
import { fitForm } from '../music/formAlign'
import { keyFromChords } from '../music/keyGuess'
import { AnalysisReview } from '../session/AnalysisReview'
import type { AnalysisResult } from '../session/AnalysisReview'
import type { RecordingEntry } from '../music/library'
import { deleteRecording, getRecording, recordingId, saveRecording } from '../music/library'
import { HostSession } from '../session/HostSession'
import { HOST_ID } from '../session/hostId'
import type { JamState, SessionMember } from '../session/shared'
import { BandSetup, MemberCard } from '../components/BandCards'
import type { CardContext } from '../components/BandCards'
import type { Instrument, Member, RolePref } from '../music/band'
import { INSTRUMENTS, loadBand, saveBand } from '../music/band'
import { holdReload, practice } from '../account/activity'
import { FEELS, keysVoicing } from '../music/parts'
import { BackingBand } from '../audio/backing'
import type { BackingPart } from '../audio/backing'
import { BandSoundSwitch } from '../components/BandSound'
import type { KeysVoicing } from '../music/parts'
import { LooperPanel } from '../components/LooperPanel'
import { useLooper } from '../audio/looper'
import { coachRunEnded, liveCoachOn, setCoachActions } from '../lessons/liveCoach'
import type { CoachActions } from '../lessons/liveCoach'
import type { JamSummary } from '../music/jamSummary'
import { emptyJamCounts, jamSummary } from '../music/jamSummary'
import { setCoachPlaying } from '../lessons/liveCoach'

interface Played {
  midi: number
  t: number
  kind: 'chord' | 'scale' | 'out'
}

const PHRASE_LEN = 7

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem('jam-prefs') ?? '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Free jamming (view "jam") or playing the band's songs (view "songs"); one engine serves both tabs. */
export function JamMode({ view = 'jam', active = true, suspend = false }: { view?: 'jam' | 'songs'; active?: boolean; suspend?: boolean }) {
  const prefs = useMemo(loadPrefs, [])
  const [keyRoot, setKeyRoot] = useState<number>((prefs.keyRoot as number) ?? 9)
  const [scaleId, setScaleId] = useState<string>((prefs.scaleId as string) ?? 'minorPent')
  const [progIdx, setProgIdx] = useState<number>((prefs.progIdx as number) ?? 5)
  const [custom, setCustom] = useState<string>((prefs.custom as string) ?? '')
  const [bpm, setBpm] = useState<number>((prefs.bpm as number) ?? 90)
  const [beatsPerChord, setBeatsPerChord] = useState<number>((prefs.beatsPerChord as number) ?? 4)
  const [click, setClick] = useState<boolean>((prefs.click as boolean) ?? true)
  const [auto, setAuto] = useState<boolean>((prefs.auto as boolean) ?? true)
  const [position, setPosition] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const looper = useLooper()
  // This jam in numbers (notes against chord and scale, phrases played), shown when the band stops.
  const jamCounts = useRef(emptyJamCounts())
  const jamStartedAt = useRef(0)
  const runningRef = useRef(false)
  const [jamDone, setJamDone] = useState<JamSummary | null>(null)
  // The live coach doesn't listen while the band plays.
  useEffect(() => {
    setCoachPlaying('jam', running)
    return () => setCoachPlaying('jam', false)
  }, [running])
  const [chordIdx, setChordIdx] = useState(0)
  const [beatInChord, setBeatInChord] = useState(0)
  const [phrase, setPhrase] = useState<FretPos[]>([])
  const [ptr, setPtr] = useState(0)
  const [played, setPlayed] = useState<Played[]>([])
  const [feelId, setFeelId] = useState<string>((prefs.feelId as string) ?? 'pop')
  const [rotation, setRotation] = useState<number>((prefs.rotation as number) ?? 2)
  const [backingOn, setBackingOn] = useState<boolean>((prefs.backingOn as boolean) ?? false)
  const [backingVol, setBackingVol] = useState<number>((prefs.backingVol as number) ?? 0.7)
  const [savedBand, setSavedBand] = useState<Member[]>(loadBand)
  const [eighth, setEighth] = useState<number | null>(null)
  const [chordCount, setChordCount] = useState(0)

  // Live session: while one runs, tonight's band is you plus whoever joined from their phone.
  const [liveMembers, setLiveMembers] = useState<SessionMember[] | null>(null)
  // Account updates from elsewhere wait while the jam plays or bandmates are connected.
  const live = !!liveMembers
  useEffect(() => {
    holdReload('jam', running)
    holdReload('live', live)
    const stopPractice = practice('jam', running)
    return () => {
      holdReload('jam', false)
      holdReload('live', false)
      stopPractice?.()
    }
  }, [running, live])
  const [liveRoles, setLiveRoles] = useState<Record<string, RolePref>>(() => {
    try {
      return JSON.parse(localStorage.getItem('live-roles') ?? '{}') as Record<string, RolePref>
    } catch {
      return {}
    }
  })
  const [startAt, setStartAt] = useState(0)
  const hostMe = savedBand.find((m) => m.me) ?? { id: 'me', name: 'Me', instrument: 'electric' as const, role: 'auto' as const, me: true }
  const band: Member[] = liveMembers
    ? [hostMe, ...liveMembers.map((m) => ({ id: m.id, name: m.name, instrument: m.instrument, role: liveRoles[m.id] ?? 'auto' }))]
    : savedBand
  const setBand = (b: Member[]) => {
    if (!liveMembers) {
      setSavedBand(b)
      saveBand(b)
      return
    }
    // In a session the members come from who joined; only your own entry and the roles are editable here.
    const me = b.find((m) => m.me)
    if (me) {
      const next = savedBand.map((m) => (m.me ? { ...me } : m))
      setSavedBand(next)
      saveBand(next)
    }
    const roles = { ...liveRoles }
    for (const m of b) if (!m.me) roles[m.id] = m.role
    setLiveRoles(roles)
    localStorage.setItem('live-roles', JSON.stringify(roles))
  }

  useEffect(() => {
    localStorage.setItem('jam-prefs', JSON.stringify({ keyRoot, scaleId, progIdx, custom, bpm, beatsPerChord, click, auto, feelId, rotation, backingOn, backingVol }))
  }, [keyRoot, scaleId, progIdx, custom, bpm, beatsPerChord, click, auto, feelId, rotation, backingOn, backingVol])

  const feel = FEELS[feelId] ?? FEELS.pop

  const scale = SCALES[scaleId]
  const flats = prefersFlats(keyRoot, scale.minor)
  const scalePcs = useMemo(() => scale.intervals.map((i) => pc(keyRoot + i)), [scale, keyRoot])

  const progChords = useMemo<Chord[]>(() => {
    if (custom.trim()) {
      return custom
        .split(/[\s,|]+/)
        .filter(Boolean)
        .map((s) => parseChord(s) ?? romanToChord(s, keyRoot, flats))
        .filter((c): c is Chord => !!c)
    }
    return PROGRESSIONS[progIdx].romans.map((r) => romanToChord(r, keyRoot, flats)).filter((c): c is Chord => !!c)
  }, [custom, progIdx, keyRoot, flats])

  // A song set up by AI replaces the free-jam progression with the song's form.
  const [songSel, setSongState] = useState<SongSetup | null>(() => {
    try {
      return JSON.parse(localStorage.getItem('jam-song') ?? 'null') as SongSetup | null
    } catch {
      return null
    }
  })
  // A song loaded before the song list existed joins the list.
  useEffect(() => {
    if (songSel && !loadLibrary().some((x) => libKey(x) === libKey(songSel))) saveToLibrary(songSel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The Songs tab plays the selected song; the Jam tab is free jamming.
  const song = view === 'songs' ? songSel : null
  const steps = useMemo<Step[]>(() => {
    if (!song) return progressionSteps(progChords, beatsPerChord)
    const shift = song.transpose ?? 0
    const all = songSteps(song)
    if (!shift) return all
    // Another key for everyone: every chord moves, spelled for the new key.
    const root = parseChord(song.key)?.root ?? 0
    const flats = prefersFlats(root + shift, song.minor)
    return all.map((x) => ({ ...x, chord: parseChord(transposeChord(x.chord.symbol, shift, flats)) ?? x.chord }))
  }, [song, progChords, beatsPerChord])
  const chords = useMemo(() => steps.map((x) => x.chord), [steps])
  const playSong = (sg: SongSetup | null) => {
    if (running) stop()
    setSongState(sg)
    localStorage.setItem('jam-song', JSON.stringify(sg))
    if (sg) saveToLibrary(sg)
    setChordIdx(0)
    setChordCount(0)
    if (!sg) return
    const root = parseChord(sg.key)?.root
    if (root !== undefined) setKeyRoot(pc(root + (sg.transpose ?? 0)))
    setScaleId(sg.minor ? 'minorPent' : 'majorPent')
    setBpm(sg.bpm)
    if (FEELS[sg.feel]) setFeelId(sg.feel)
  }

  const safeIdx = chords.length ? chordIdx % chords.length : 0
  const chord = chords[safeIdx] ?? null
  const nextChord = chords.length ? chords[(safeIdx + 1) % chords.length] : null

  // Default position: the box whose lowest note is the key root on the low E string.
  const autoPos = pc(keyRoot - STANDARD_TUNING[0])
  const pos = position ?? autoPos
  const box = useMemo(() => boxNotes(scalePcs, chord?.tones ?? [], pos === 0 ? 0 : pos - 1), [scalePcs, chord, pos])

  // ---- Clock -------------------------------------------------------------
  const clock = useRef({ start: 0, timer: 0, raf: 0, nextEighth: 0, withRec: false, recSrc: null as AudioBufferSourceNode | null, finished: false })

  // The song's original recording (the user's own file), when the band plays along with it.
  const [rec, setRec] = useState<{ entry: RecordingEntry; buffer: AudioBuffer } | null>(null)
  const [recOn, setRecOn] = useState(true)
  // The record's volume (0–1) and mute, kept between sessions; they apply live while it plays.
  const [recVol, setRecVol] = useState(() => {
    const v = Number(localStorage.getItem('rec-volume') ?? '1')
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1
  })
  const [recMuted, setRecMuted] = useState(false)
  const recGain = useRef<GainNode | null>(null)
  const recLevel = useRef(1)
  recLevel.current = recMuted ? 0 : recVol * recVol
  useEffect(() => {
    localStorage.setItem('rec-volume', String(recVol))
    const g = recGain.current
    // Squared: the slider feels even across its range.
    if (g) g.gain.setTargetAtTime(recMuted ? 0 : recVol * recVol, g.context.currentTime, 0.03)
  }, [recVol, recMuted])
  const recRef = useRef({ rec, recOn })
  recRef.current = { rec, recOn }
  // What the backing band needs at scheduling time; filled in further down each render.
  const groove = useRef({
    on: false,
    chords: [] as Chord[],
    voicings: [] as KeysVoicing[],
    feel: FEELS.pop,
    parts: { drums: true, bass: true, keys: false } as Record<BackingPart, boolean>,
    manualIdx: 0,
  })
  const backing = useRef<BackingBand | null>(null)
  const [countIn, setCountIn] = useState(0)
  // What the jam is over, in words (for the live coach).
  const words = { keyName: noteName(keyRoot, flats), scaleName: scale.label, chordNames: chords.map((c) => c.symbol) }
  const settings = useRef({ bpm, beatsPerChord, click, auto, len: chords.length, steps, isSong: !!song, total: totalBeats(steps), ...words })
  settings.current = { bpm, beatsPerChord, click, auto, len: chords.length, steps, isSong: !!song, total: totalBeats(steps), ...words }
  // Where we are in the song (beats from its start), for the progress bar; and whether it has ended.
  const [songBeat, setSongBeat] = useState(0)
  const [ended, setEnded] = useState(false)
  const songBeatRef = useRef(0)
  songBeatRef.current = songBeat
  const songRef = useRef(song)
  songRef.current = song
  const playLog = useRef<string | null>(null)
  const [historyTick, setHistoryTick] = useState(0)
  const activeRef = useRef(active)
  activeRef.current = active

  const stop = useCallback(() => {
    clearInterval(clock.current.timer)
    cancelAnimationFrame(clock.current.raf)
    try {
      clock.current.recSrc?.stop()
    } catch {
      /* already stopped */
    }
    clock.current.recSrc = null
    // Silence the band at once (a finished song's last chord rings out).
    if (!clock.current.finished) backing.current?.stop()
    if (playLog.current) {
      logEnd(playLog.current, (songBeatRef.current * 60) / settings.current.bpm, clock.current.finished)
      playLog.current = null
      setHistoryTick((n) => n + 1)
    }
    clock.current.finished = false
    if (runningRef.current) {
      runningRef.current = false
      jamCounts.current.sec = (performance.now() - jamStartedAt.current) / 1000
      const sum = jamSummary(jamCounts.current)
      setJamDone(sum)
      // The live coach, when on, hears about the jam (the same numbers, and what was played over).
      const st = settings.current
      if (sum && liveCoachOn())
        void coachRunEnded({
          moment: 'the player just stopped a free jam in the Jam tab: improvising over a band or click',
          jam: { ...sum, pointer: undefined, key: st.keyName, scale: st.scaleName, chords: st.chordNames, bpm: st.bpm },
          suggestedPointer: sum.pointer,
        })
    }
    setRunning(false)
    setEighth(null)
    setCountIn(0)
  }, [])

  // The Lessons tab has its own clock and band: stop the jam so they don't play over each other.
  useEffect(() => {
    if (suspend && running) stop()
  }, [suspend, running, stop])

  /** Starts the jam, from the top or from beat `fromBeat` (jumping to a section of a song). */
  const start = useCallback(async (fromBeat = 0) => {
    const ctx = await engine.ensureContext()
    const c = clock.current
    const g0 = groove.current
    const spb0 = 60 / settings.current.bpm
    const r = recRef.current.recOn ? recRef.current.rec : null
    c.withRec = !!r
    // With a backing track, one bar of count-in clicks first so everyone comes in together.
    // With the recording, it plays from the top and the grid sits on its first beat instead.
    const countInBeats = g0.on && !r ? 4 : 0
    c.start = ctx.currentTime + 0.15 + countInBeats * spb0 - fromBeat * spb0
    if (r) {
      const src = ctx.createBufferSource()
      src.buffer = r.buffer
      if (!recGain.current) {
        recGain.current = ctx.createGain()
        recGain.current.connect(ctx.destination)
      }
      recGain.current.gain.value = recLevel.current
      src.connect(recGain.current)
      const t0 = ctx.currentTime + 0.2
      // Where the song's beat 0 is in the file, and where to start playing it.
      const beat0 = r.entry.firstBeat + r.entry.offsetMs / 1000 + r.entry.beatShift * spb0
      const from = Math.max(0, beat0 + fromBeat * spb0)
      src.start(t0, from)
      src.onended = () => {
        // The record finished: that's the end of the song.
        if (clock.current.recSrc !== src) return
        clock.current.finished = true
        stopRef.current()
        setEnded(true)
      }
      c.recSrc = src
      c.start = t0 - from + beat0
    }
    setEnded(false)
    // History: log each song play (when, who, with the record or not).
    if (settings.current.isSong && songRef.current && fromBeat === 0) {
      const sg = songRef.current
      playLog.current = logStart({
        key: libKey(sg),
        title: sg.title,
        artist: sg.artist,
        startedAt: Date.now(),
        totalSec: (settings.current.total * 60) / settings.current.bpm,
        players: bandRef.current.map((m) => `${INSTRUMENTS[m.instrument].icon} ${m.name}`),
        withRecording: c.withRec,
      })
    }
    // The same moment on the wall clock (this Mac is the session server), for bandmates' screens.
    setStartAt(Date.now() + (c.start - ctx.currentTime) * 1000)
    c.nextEighth = Math.round(fromBeat) * 2 - countInBeats * 2
    if (g0.on) backing.current ??= new BackingBand(ctx, ctx.destination)
    const at0 = locate(settings.current.steps, Math.max(0, Math.round(fromBeat)))
    setChordIdx(at0.idx)
    setBeatInChord(at0.beatInChord)
    setChordCount(at0.chordCount)
    // Lookahead scheduler, one 8th note at a time: clicks, count-in and the backing band.
    c.timer = window.setInterval(() => {
      const s = settings.current
      const g = groove.current
      const e = 30 / s.bpm // seconds per 8th
      // Song position and end-of-song are checked here too: this timer keeps running when the
      // browser tab is in the background, while screen-refresh frames pause.
      if (s.isSong) {
        const beatNow = ((ctx.currentTime - c.start) * s.bpm) / 60
        // With the record the song runs until the record ends, which can be past the form's last bar.
        setSongBeat(Math.max(0, c.withRec ? beatNow : Math.min(beatNow, s.total)))
        if (beatNow >= s.total && !c.withRec) {
          c.finished = true
          stopRef.current()
          setEnded(true)
          return
        }
      }
      for (;;) {
        const n = c.nextEighth
        const swing = g.feel.swing && n % 2 !== 0 ? e * 0.33 : 0
        const t = c.start + n * e + swing
        if (t >= ctx.currentTime + 0.12) break
        const beat = Math.floor(n / 2)
        // A song ends after its last section: nothing more is scheduled.
        const past = s.isSong && beat >= s.total
        const at = n >= 0 && !past ? locate(s.steps, beat) : null
        if (n % 2 === 0 && !past && (s.click || n < 0)) engine.click(t, n < 0 ? beat === -4 : at?.beatInChord === 0, n < 0 ? 0.5 : 0.35)
        if (at && g.on && !c.withRec && g.chords.length) {
          backing.current ??= new BackingBand(ctx, ctx.destination)
          const idx = s.auto ? at.idx % g.chords.length : g.manualIdx % g.chords.length
          backing.current.playStep(t, n % 8, e, g.chords[idx], g.feel, g.voicings[idx], g.parts)
        }
        c.nextEighth++
      }
    }, 25)
    const frame = () => {
      const s = settings.current
      const beatF = ((ctx.currentTime - c.start) * s.bpm) / 60
      const beat = Math.floor(beatF)
      setCountIn(beat < 0 ? -beat : 0)
      if (s.isSong) setSongBeat((b) => (Math.abs(b - beatF) > 0.1 ? Math.max(0, c.withRec ? beatF : Math.min(beatF, s.total)) : b))
      if (s.isSong && beat >= s.total) {
        // End of the song. With the recording, hold the last chord until the record finishes.
        if (!c.withRec) {
          c.finished = true
          stopRef.current()
          setEnded(true)
          return
        }
        setChordIdx(s.steps.length - 1)
        c.raf = requestAnimationFrame(frame)
        return
      }
      if (beat >= 0) {
        const at = locate(s.steps, beat)
        setBeatInChord(at.beatInChord)
        setEighth(Math.floor(beatF * 2) % 8)
        if (s.auto && s.len) {
          setChordIdx(at.idx)
          setChordCount(at.chordCount)
        }
      }
      c.raf = requestAnimationFrame(frame)
    }
    frame()
    jamCounts.current = emptyJamCounts()
    jamStartedAt.current = performance.now()
    runningRef.current = true
    setJamDone(null)
    setRunning(true)
  }, [])

  useEffect(() => stop, [stop])
  const stopRef = useRef(stop)
  stopRef.current = stop

  /** Jump to a beat of the song (clicking the progress bar), playing or not. */
  const seek = (beat: number) => {
    if (running) stop()
    setSongBeat(beat)
    void start(beat)
  }

  // Load this song's recording, if one was added before.
  const songKey = song ? recordingId(song.title, song.artist) : ''
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new song drops the old recording before its own one loads
    setRec(null)
    if (!songKey) return
    let cancelled = false
    void getRecording(songKey).then(async (entry) => {
      if (!entry || cancelled) return
      const ctx = await engine.ensureContext(false)
      const buffer = await ctx.decodeAudioData(entry.data.slice(0))
      if (cancelled) return
      setRec({ entry, buffer })
      if (recRef.current.recOn) setBpm(entry.bpm)
    })
    return () => {
      cancelled = true
    }
  }, [songKey])

  const addRecording = async (file: File) => {
    if (!song) return
    const data = await file.arrayBuffer()
    const ctx = await engine.ensureContext(false)
    const buffer = await ctx.decodeAudioData(data.slice(0))
    const grid = analyzeBeats(buffer, song.bpm)
    const entry: RecordingEntry = { id: songKey, fileName: file.name, data, bpm: grid.bpm, firstBeat: grid.firstBeat, offsetMs: 0, beatShift: 0 }
    await saveRecording(entry)
    setRec({ entry, buffer })
    setRecOn(true)
    setBpm(grid.bpm)
  }

  // Analysing the recording: chords, bar lines and section lengths, reviewed before applying.
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [analysing, setAnalysing] = useState(false)
  const analyse = () => {
    if (!rec || !song) return
    setAnalysing(true)
    // Let the button repaint before the (few seconds of) number crunching.
    setTimeout(() => {
      try {
        const grid = { bpm: rec.entry.bpm, firstBeat: rec.entry.firstBeat }
        const feats = beatFeatures(rec.buffer, grid)
        const labels = detectChords(feats)
        const bars = barsFrom(feats, labels, downbeatPhase(labels))
        const fit = fitForm(song, bars.chords, bars.novelty)
        if (fit)
          setAnalysis({
            bpm: rec.entry.bpm,
            songStart: feats.times[bars.startBeat] ?? rec.entry.firstBeat,
            barChords: bars.chords,
            formBars: fit.bars,
            agreement: fit.agreement,
            key: keyFromChords(bars.chords),
          })
      } finally {
        setAnalysing(false)
      }
    }, 50)
  }

  /** Moves the grid against the recording (live while playing) and remembers it. */
  const nudge = (ms: number, beats: number) => {
    if (!rec) return
    const entry = { ...rec.entry, offsetMs: rec.entry.offsetMs + ms, beatShift: rec.entry.beatShift + beats }
    setRec({ ...rec, entry })
    void saveRecording(entry)
    const c = clock.current
    if (running && c.withRec) {
      c.start += ms / 1000 + (beats * 60) / bpm
      setStartAt((t) => t + ms + (beats * 60000) / bpm)
    }
  }

  // Restart the clock cleanly when tempo or chord length changes while running.
  useEffect(() => {
    if (running) {
      stop()
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restarts the running backing clock on a tempo or chord-length change
      start()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpm, beatsPerChord])

  const nextManual = useCallback(
    (d = 1) => {
      setChordIdx((i) => (i + d + chords.length) % Math.max(1, chords.length))
      setChordCount((n) => Math.max(0, n + d))
    },
    [chords.length],
  )

  // ---- Band ----------------------------------------------------------------
  const len = Math.max(1, chords.length)
  const { soloist, nextSoloist, chordsUntilSwap } = soloAt(band, rotation, steps, chordCount)
  const bandRef = useRef(band)
  bandRef.current = band
  // Switching between the Jam and Songs tabs stops whatever was playing.
  useEffect(() => {
    if (clock.current.timer) stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])
  const me = band.find((m) => m.me)
  const iSolo = !!me && soloist?.id === me.id

  // Keyboard voicings for the whole progression, each led smoothly from the previous one.
  const voicings = useMemo<KeysVoicing[]>(() => {
    const out: KeysVoicing[] = []
    let prev: number[] | null = null
    for (const c of chords) {
      const v = keysVoicing(c, prev)
      out.push(v)
      prev = v.right
    }
    return out
  }, [chords])

  const segments = useMemo(() => songSegments(steps), [steps])
  // Auto-synced words are kept in seconds of the recording; their beats follow the recording's
  // current grid and the song's current sections, so later nudges or Analyse don't pull them off the record.
  const timing = useMemo(() => {
    if (!song?.lyricSecs || !rec) return { lyricBeats: song?.lyricBeats, lyricWords: song?.lyricWords }
    const spb = 60 / rec.entry.bpm
    const beat0 = rec.entry.firstBeat + rec.entry.offsetMs / 1000 + rec.entry.beatShift * spb
    const lyricBeats = [...(song.lyricBeats ?? [])]
    const lyricWords = [...(song.lyricWords ?? [])]
    song.lyricSecs.forEach((lines, f) => {
      const seg = segments.find((x) => x.formIdx === f)
      if (!lines || !seg) return
      lyricWords[f] = lines.map((l) => l.map((t) => Math.round(((t - beat0) / spb - seg.start) * 100) / 100))
      lyricBeats[f] = lyricWords[f]!.map((l) => l[0])
    })
    return { lyricBeats, lyricWords }
  }, [song, rec, segments])
  const lyricLines = useMemo(() => lyricTimeline({ lyrics: song?.lyrics, vocalPhrases: song?.vocalPhrases, ...timing }, segments), [song, timing, segments])

  // Backing track: by default it plays only the parts nobody in tonight's band covers.
  const [partOverride, setPartOverride] = useState<Partial<Record<BackingPart, boolean>>>({})
  const covered = (inst: Instrument) => band.some((m) => m.instrument === inst)
  const parts: Record<BackingPart, boolean> = {
    drums: partOverride.drums ?? !covered('drums'),
    bass: partOverride.bass ?? !covered('bass'),
    keys: partOverride.keys ?? !covered('keys'),
  }
  groove.current = { on: backingOn, chords, voicings, feel, parts, manualIdx: safeIdx }

  // Live session: publish the jam so every bandmate's screen shows the same moment.
  const liveState: JamState | null = liveMembers
    ? {
        running,
        startAt,
        bpm,
        beatsPerChord,
        auto,
        manualIdx: safeIdx,
        chordCount,
        keyRoot,
        scaleId,
        chords: chords.map((c) => c.symbol),
        timeline: steps.map((x) => ({ symbol: x.chord.symbol, beats: x.beats, section: x.section, solo: x.solo, first: x.first, formIdx: x.formIdx })),
        lyrics: song?.lyrics,
        lyricBeats: timing.lyricBeats,
        lyricWords: timing.lyricWords,
        withRecording: recOn && !!rec,
        vocalPhrases: song?.vocalPhrases,
        songTitle: song ? `${song.title} – ${song.artist}` : '',
        ended: !!song && ended && !running,
        rhythm: song ? Object.fromEntries(song.sections.map((x) => [x.name, { strum: x.strum, technique: x.technique }])) : undefined,
        feelId,
        rotation,
        position: pos,
        band,
        hostName: hostMe.name,
      }
    : null
  const liveJson = liveState ? JSON.stringify(liveState) : ''
  useEffect(() => {
    if (!liveJson) return
    const send = () => void fetch('/api/session/state', { method: 'POST', headers: { 'x-host-id': HOST_ID }, body: liveJson }).catch(() => {})
    const t = setTimeout(send, 60)
    // Re-send every few seconds, so a phone that missed an update is put right quickly.
    const beat = setInterval(send, 3000)
    return () => {
      clearTimeout(t)
      clearInterval(beat)
    }
  }, [liveJson])
  useEffect(() => backing.current?.setVolume(backingVol), [backingVol])


  // ---- Phrase ------------------------------------------------------------
  // The current phrase, earlier ones (newest first) and the player's pinned set.
  const [history, setHistory] = useState<SavedPhrase[]>([])
  const [pinned, setPinnedState] = useState<SavedPhrase[]>(loadPinned)
  const [setMode, setSetMode] = useState(false)
  const [setIdx, setSetIdx] = useState(0)
  const currentRef = useRef<SavedPhrase | null>(null)
  const setPinned = (p: SavedPhrase[]) => {
    setPinnedState(p)
    savePinned(p)
  }

  /** Shows a phrase as the current one; the previous one moves into the history. */
  const showPhrase = useCallback((p: SavedPhrase) => {
    const prev = currentRef.current
    if (prev && prev.notes.length && prev.id !== p.id) setHistory((h) => [prev, ...h.filter((x) => x.id !== prev.id)].slice(0, 12))
    currentRef.current = p
    setPhrase(p.notes)
    setPtr(0)
  }, [])

  const newPhrase = useCallback(
    (towardsNext: boolean) => {
      if (!chord) return
      const target = towardsNext && nextChord ? nextChord.tones : chord.tones
      showPhrase({ id: `ph${Date.now()}${Math.random().toString(36).slice(2, 6)}`, notes: makePhrase(box, scalePcs, chord.tones, target, PHRASE_LEN), chord: chord.symbol })
    },
    [box, scalePcs, chord, nextChord, showPhrase],
  )

  const playFromSet = useCallback(
    (i: number) => {
      if (!pinned.length) return
      const k = ((i % pinned.length) + pinned.length) % pinned.length
      setSetIdx(k)
      showPhrase(pinned[k])
    },
    [pinned, showPhrase],
  )

  // The phrase for the next chord, made in advance so it can be shown as "Next" and then
  // actually played when that chord comes round.
  const [upcoming, setUpcoming] = useState<SavedPhrase | null>(null)
  const makeFor = useCallback(
    (c: Chord): SavedPhrase => ({
      id: `ph${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      notes: makePhrase(boxNotes(scalePcs, c.tones, pos === 0 ? 0 : pos - 1), scalePcs, c.tones, c.tones, PHRASE_LEN),
      chord: c.symbol,
    }),
    [scalePcs, pos],
  )

  // On every chord change: play the prepared phrase if it was made for this chord, then prepare
  // the next one (not while practising the pinned set).
  useEffect(() => {
    if (setMode || !chord) return
    if (upcoming && upcoming.chord === chord.symbol) showPhrase(upcoming)
    else newPhrase(false)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- on a chord change: prepare the phrase for the next chord
    setUpcoming(nextChord ? makeFor(nextChord) : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeIdx, chord?.symbol, box])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- switching the pinned set on or off starts its phrases
    if (setMode) playFromSet(0)
    else {
      newPhrase(false)
      setUpcoming(nextChord ? makeFor(nextChord) : null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setMode])

  // In the pinned set, "next" is simply the following phrase of the set.
  const nextShown = setMode ? (pinned.length > 1 ? pinned[(setIdx + 1) % pinned.length] : null) : upcoming

  const togglePin = (p: SavedPhrase) => setPinned(pinned.some((x) => x.id === p.id) ? pinned.filter((x) => x.id !== p.id) : [...pinned, p])

  const state = useRef({ phrase, ptr, chord, scalePcs, beatInChord, beatsPerChord, setMode, setIdx })
  state.current = { phrase, ptr, chord, scalePcs, beatInChord, beatsPerChord, setMode, setIdx }

  useNoteOn(
    useCallback(
      (midi: number) => {
        const s = state.current
        const p = pc(midi)
        const kind: Played['kind'] = s.chord?.tones.includes(p) ? 'chord' : s.scalePcs.includes(p) ? 'scale' : 'out'
        setPlayed((list) => [...list.slice(-15), { midi, t: performance.now(), kind }])
        if (runningRef.current) jamCounts.current[kind]++
        const want = s.phrase[s.ptr]
        if (want && pc(want.midi) === p) {
          const n = s.ptr + 1
          setPtr(n)
          // Phrase finished: next one from the set, or a new one resolving towards the next chord late in the bar.
          if (n >= s.phrase.length && runningRef.current) jamCounts.current.phrases++
          if (n >= s.phrase.length) setTimeout(() => (s.setMode ? playFromSet(s.setIdx + 1) : newPhrase(s.beatInChord >= s.beatsPerChord / 2)), 350)
        }
      },
      [newPhrase, playFromSet],
    ),
  )

  // What the live coach may do here, while the Jam tab is the one showing.
  const coachHere = useRef(false)
  useEffect(() => {
    if (!active || view !== 'jam') {
      // Left the Jam tab (it stays mounted): its actions go with it.
      if (coachHere.current) setCoachActions(() => ({}))
      coachHere.current = false
      return
    }
    coachHere.current = true
    const acts: CoachActions = {
      ...(running ? { stop: { about: 'stop the band', run: () => stop() } } : { start: { about: 'start the band', run: () => void start() } }),
      slower: { about: `the tempo 5 BPM slower (now ${bpm})`, run: () => setBpm((b) => Math.max(40, b - 5)) },
      faster: { about: `the tempo 5 BPM faster (now ${bpm})`, run: () => setBpm((b) => Math.min(220, b + 5)) },
      phrase: { about: 'a new phrase to play', run: () => (setMode ? playFromSet(setIdx + 1) : newPhrase(false)) },
      ...(!auto ? { 'next-chord': { about: 'on to the next chord', run: () => nextManual(1) } } : {}),
    }
    setCoachActions(() => acts)
  })

  // Keyboard: space = start/stop, arrows = change chord, N = new phrase.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current || (e.target as HTMLElement).closest('input, select, textarea')) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (running) stop()
        else start()
      } else if (e.code === 'ArrowRight') nextManual(1)
      else if (e.code === 'ArrowLeft') nextManual(-1)
      else if (e.code === 'KeyN') {
        if (setMode) playFromSet(setIdx + 1)
        else newPhrase(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running, start, stop, nextManual, newPhrase, setMode, setIdx, playFromSet])

  // ---- Fretboard markers --------------------------------------------------
  const lo = pos === 0 ? 0 : pos - 1
  const hi = lo + 4
  const markers = useMemo(() => jamMarkers({ scalePcs, chord, nextChord, lo, hi, phrase, ptr, played }), [scalePcs, chord, nextChord, lo, hi, phrase, ptr, played])

  const chordNames = (c: Chord | null) => (c ? c.tones.map((t) => noteName(t, flats)).join(' ') : '')

  return (
    <div className="jam-mode">
      <div className="jam-controls">
        {view === 'jam' && (
          <>
        <label>
          Key
          <select value={keyRoot} onChange={(e) => setKeyRoot(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i}>
                {noteName(i, prefersFlats(i, scale.minor))}
              </option>
            ))}
          </select>
        </label>
        <label>
          Scale
          <select value={scaleId} onChange={(e) => setScaleId(e.target.value)}>
            {Object.entries(SCALES).map(([id, s]) => (
              <option key={id} value={id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Progression
          <select value={progIdx} onChange={(e) => setProgIdx(Number(e.target.value))} disabled={!!custom.trim() || !!song}>
            {PROGRESSIONS.map((p, i) => (
              <option key={i} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          …or type chords
          <input value={custom} placeholder="e.g. Am F C G   or   i bVII bVI V" onChange={(e) => setCustom(e.target.value)} />
        </label>
          </>
        )}
        <label>
          BPM {Math.round(bpm * 10) / 10}
          <input type="range" min={50} max={180} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} />
        </label>
        {view === 'jam' && (
          <label>
            Beats / chord
            <select value={beatsPerChord} onChange={(e) => setBeatsPerChord(Number(e.target.value))}>
              {[2, 3, 4, 6, 8].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          Position: fret {pos}
          <input type="range" min={0} max={15} value={pos} onChange={(e) => setPosition(Number(e.target.value))} />
        </label>
        <label>
          Feel
          <select value={feelId} onChange={(e) => setFeelId(e.target.value)}>
            {Object.entries(FEELS).map(([id, f]) => (
              <option key={id} value={id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Solos
          <select value={rotation} onChange={(e) => setRotation(Number(e.target.value))}>
            <option value={0}>Fixed (no rotation)</option>
            <option value={1}>Swap every round</option>
            <option value={2}>Swap every 2 rounds</option>
            <option value={4}>Swap every 4 rounds</option>
          </select>
        </label>
        <Toggle on={click} set={setClick} label="Click" />
        <MetronomeVolume />
        <div className="backing-ctl">
          <Toggle on={backingOn} set={setBackingOn} label="Backing track" />
          {backingOn &&
            (['drums', 'bass', 'keys'] as BackingPart[]).map((p) => (
              <button
                key={p}
                className={`seg ${parts[p] ? 'on' : ''}`}
                title={covered(p === 'keys' ? 'keys' : p) ? 'Someone in the band plays this' : 'Nobody in the band plays this'}
                onClick={() => setPartOverride({ ...partOverride, [p]: !parts[p] })}
              >
                {p === 'drums' ? '🥁 Drums' : p === 'bass' ? '🎸 Bass' : '🎹 Keys'}
              </button>
            ))}
          {backingOn && <input type="range" min={0} max={1} step={0.05} value={backingVol} onChange={(e) => setBackingVol(Number(e.target.value))} title="Backing volume" />}
          {backingOn && <BandSoundSwitch />}
        </div>
        <Toggle on={auto} set={setAuto} label="Auto-advance" />
        {/* The main pedal starts and stops the band, unless the looper is open (then it records). */}
        <button className="btn primary" onClick={() => (running ? stop() : start())} data-pedal={looper.panelOpen ? undefined : 'go'} title="Space, or the main pedal">
          {running ? '■ Stop' : '▶ Start'}
        </button>
      </div>

      {view === 'jam' && jamDone && <JamSummaryCard s={jamDone} onClose={() => setJamDone(null)} />}
      {view === 'jam' && <LooperPanel jamBpm={bpm} />}

      {view === 'songs' && (
        <SongsPanel
          song={songSel}
          singers={band.filter((m) => m.instrument === 'vocals').map((m) => m.name)}
          historyTick={historyTick}
          onPlay={playSong}
          onUpdate={(sg) => {
            // A new key for the song (transposed, or a corrected key): the scale and solos follow.
            if (sg.key !== songSel?.key || (sg.transpose ?? 0) !== (songSel?.transpose ?? 0)) {
              const root = parseChord(sg.key)?.root
              if (root !== undefined) setKeyRoot(pc(root + (sg.transpose ?? 0)))
            }
            setSongState(sg)
            localStorage.setItem('jam-song', JSON.stringify(sg))
            saveToLibrary(sg)
          }}
        />
      )}
      {song && (
        <RecordingBar
          rec={rec?.entry ?? null}
          transposed={song.transpose ?? 0}
          volume={recVol}
          muted={recMuted}
          onVolume={(v) => {
            setRecVol(v)
            setRecMuted(false)
          }}
          onMute={setRecMuted}
          on={recOn}
          onToggle={(v) => {
            setRecOn(v)
            if (v && rec) setBpm(rec.entry.bpm)
          }}
          onFile={(f) => void addRecording(f)}
          onNudge={nudge}
          onRemove={() => {
            void deleteRecording(songKey)
            setRec(null)
          }}
          analysing={analysing}
          onAnalyse={analyse}
        />
      )}
      {song?.lyrics?.some(Boolean) && (
        <LyricSync
          song={{ ...song, ...timing }}
          segments={segments}
          running={running}
          songBeat={songBeat}
          // What's being heard now: the audio clock minus the output's delay.
          beatNow={() => {
            const ac = engine.ctx
            return running && ac ? ((ac.currentTime - (ac.outputLatency || 0) - clock.current.start) * bpm) / 60 : null
          }}
          onStart={() => void start()}
          recording={
            rec
              ? {
                  data: rec.entry.data,
                  fileName: rec.entry.fileName,
                  beat0: rec.entry.firstBeat + rec.entry.offsetMs / 1000 + (rec.entry.beatShift * 60) / rec.entry.bpm,
                  spb: 60 / rec.entry.bpm,
                }
              : null
          }
          onAutoSync={(r) => {
            const next = { ...song, lyricBeats: r.lyricBeats, lyricWords: r.lyricWords, lyricSecs: r.lyricSecs }
            setSongState(next)
            localStorage.setItem('jam-song', JSON.stringify(next))
            saveToLibrary(next)
          }}
          onSave={(lyricBeats) => {
            // Re-tapped sections lose the tab's word timing (it was for the old line starts).
            const same = (f: number) => JSON.stringify(lyricBeats[f] ?? null) === JSON.stringify(timing.lyricBeats?.[f] ?? null)
            const lyricWords = timing.lyricWords?.map((w, f) => (same(f) ? w : null))
            const lyricSecs = song.lyricSecs?.map((w, f) => (same(f) ? w : null))
            const next = { ...song, lyricBeats, lyricWords, lyricSecs }
            setSongState(next)
            localStorage.setItem('jam-song', JSON.stringify(next))
            saveToLibrary(next)
          }}
        />
      )}
      {song && analysis && (
        <AnalysisReview
          song={song}
          result={analysis}
          onClose={() => setAnalysis(null)}
          onApply={(lengths, useChords, useKey) => {
            const k = useKey ? analysis.key : null
            const next: SongSetup = {
              ...song,
              ...(k ? { key: noteName(k.root, prefersFlats(k.root, k.minor)), minor: k.minor } : {}),
              formBars: lengths ? analysis.formBars : song.formBars,
              barChords: analysis.barChords,
              useRecordedChords: useChords,
            }
            setSongState(next)
            localStorage.setItem('jam-song', JSON.stringify(next))
            saveToLibrary(next)
            if (lengths && rec) {
              // Beat 0 of the song is now its first bar in the record, at the measured tempo.
              const entry = { ...rec.entry, bpm: analysis.bpm, firstBeat: analysis.songStart, offsetMs: 0, beatShift: 0 }
              setRec({ ...rec, entry })
              void saveRecording(entry)
              setBpm(analysis.bpm)
            }
            if (k) {
              setKeyRoot(pc(k.root + (song.transpose ?? 0)))
              setScaleId(k.minor ? 'minorPent' : 'majorPent')
            }
            setAnalysis(null)
          }}
        />
      )}
      <HostSession onMembers={setLiveMembers} />
      <BandSetup band={band} setBand={setBand} live={!!liveMembers} />

      <div className="game-plan">
        <span className="label">The plan</span>
        {song ? (
          <>
            Song <b>{song.title}</b> – {song.artist} · {song.form.join(' → ')} ·{' '}
          </>
        ) : null}
        Key of <b>{noteName(keyRoot, flats)} {scale.minor ? 'minor' : 'major'}</b> ·{' '}
        {song ? '' : <><b>{chords.map((c) => c.symbol).join(' → ')}</b>, {beatsPerChord} beats each, repeat · </>}
        <b>{Math.round(bpm * 10) / 10} BPM</b>,{' '}
        {feel.label.toLowerCase()} feel · Count in “1, 2, 3, 4” and everyone starts on <b>{chords[0]?.symbol}</b>.
        {backingOn && (parts.drums || parts.bass || parts.keys) && (
          <>
            {' '}
            Backing track plays {(['drums', 'bass', 'keys'] as BackingPart[]).filter((p) => parts[p]).join(' + ')}.
          </>
        )}
        {soloist && (
          <>
            {' '}
            Solos: {rotation ? 'take turns, ' : ''}
            {band
              .filter((m) => m.role !== 'rhythm' && INSTRUMENTS[m.instrument].canLead && (rotation || m.id === soloist.id))
              .map((m) => m.name)
              .join(' → ')}
            {rotation ? ` (${rotation} round${rotation > 1 ? 's' : ''} each)` : ''}; everyone else keeps the groove.
          </>
        )}
      </div>

      {song && <SongProgress segments={segments} beat={songBeat} bpm={bpm} ended={ended && !running} onSeek={seek} />}

      <div className="chord-strip">
        {countIn > 0 && <span className="count-in">Count-in: {5 - countIn}</span>}
        {song && (
          <span className="section-tag">
            {steps[safeIdx]?.section}
            {(steps[safeIdx]?.passes ?? 1) > 1 && ` · ${(steps[safeIdx]?.pass ?? 0) + 1}/${steps[safeIdx]?.passes}`}
            {steps[safeIdx]?.solo && ' · solo'}
          </span>
        )}
        {steps.map((st, i) => (song && !(sameSection(steps, i, safeIdx) && st.pass === steps[safeIdx]?.pass) ? null : (
          <button
            key={i}
            className={`chord-cell ${i === safeIdx ? 'now' : ''} ${i === (safeIdx + 1) % chords.length && chords.length > 1 ? 'next' : ''} ${i < safeIdx ? 'past' : ''}`}
            onClick={() => setChordIdx(i)}
          >
            {st.chord.symbol}
            {song && st.beats !== 4 && <small className="beats-n">{st.beats}</small>}
            {i === safeIdx && (
              <span className="beats">
                {Array.from({ length: st.beats }, (_, b) => (
                  <i key={b} className={b <= beatInChord && running ? 'on' : ''} />
                ))}
              </span>
            )}
          </button>
        )))}
        {song && <span className="section-next">then: {nextSectionName(steps, safeIdx)}</span>}
        {!auto && (
          <button className="btn" onClick={() => nextManual(1)} title="Right arrow">
            Next chord →
          </button>
        )}
      </div>

      <div className="jam-now">
        <div className="big-chord">
          <span className="label">Now</span>
          <span className="sym">{chord?.symbol ?? '—'}</span>
          <span className="tones">notes: {chordNames(chord)}</span>
        </div>
        <div className="arrow">→</div>
        <div className="big-chord next">
          <span className="label">Next</span>
          <span className="sym">{nextChord?.symbol ?? '—'}</span>
          <span className="tones">notes: {chordNames(nextChord)}</span>
        </div>
        {soloist && (
          <div className="solo-now">
            <span className="label">Solo now</span>
            <span className="solo-name">
              {INSTRUMENTS[soloist.instrument].icon} {soloist.name}
            </span>
            {rotation > 0 && nextSoloist && nextSoloist.id !== soloist.id && (
              <span className="tones">
                next: {nextSoloist.name} in {chordsUntilSwap} chord{chordsUntilSwap > 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {chord && (
        <div className="band-cards">
          {band.map((m, i) => {
            const ctx: CardContext = {
              chord,
              next: nextChord,
              feel,
              eighth,
              soloist,
              scaleLabel: scale.label,
              scalePcs,
              keyName: noteName(keyRoot, flats),
              flats,
              boxFret: pos,
              keys: voicings[safeIdx] ?? keysVoicing(chord, null),
              nextKeys: voicings[(safeIdx + 1) % len] ?? null,
              lyricLines,
              songBeat: running ? songBeat : 0,
              section: steps[safeIdx]?.section,
              nextSection: song ? nextSectionName(steps, safeIdx) : '',
              beatsToNext: beatsToNextSection(steps, safeIdx, beatInChord),
              songTitle: song ? `${song.title} – ${song.artist}` : '',
              strum: song?.sections.find((x) => x.name === steps[safeIdx]?.section)?.strum,
              technique: song?.sections.find((x) => x.name === steps[safeIdx]?.section)?.technique,
            }
            return <MemberCard key={m.id + i} m={m} ctx={ctx} />
          })}
        </div>
      )}

      <div className="my-part">
        <div className="my-part-head">
          <h3>Your fretboard{me ? ` (${me.name})` : ''}</h3>
          <span className="hint">
            {iSolo
              ? 'Your solo: follow the green notes, or play your own lines using the highlighted notes.'
              : `${soloist ? `${soloist.name} is soloing` : 'Rhythm time'}: keep practising the lines quietly, or use the chord tones for fills.`}
          </span>
        </div>
        <PhraseBoard
          upcoming={nextShown}
          current={currentRef.current}
          ptr={ptr}
          history={history}
          pinned={pinned}
          setMode={setMode}
          setIdx={setIdx}
          onNew={() => (setMode ? playFromSet(setIdx + 1) : newPhrase(false))}
          onPin={togglePin}
          onPlay={(p) => {
            const i = pinned.findIndex((x) => x.id === p.id)
            if (setMode && i >= 0) playFromSet(i)
            else showPhrase(p)
          }}
          onReorder={setPinned}
          onSetMode={setSetMode}
        />
        <Fretboard markers={markers} highlightFrom={lo} highlightTo={hi} flats={flats} />
      </div>

      <div className="jam-footer">
        <div className="legend">
          <span className="lg root" /> chord root <span className="lg chord" /> chord tone <span className="lg box" /> scale <span className="lg next" /> next chord
          <span className="lg target" /> play now <span className="lg played" /> you played
        </div>
        <div className="played-chips">
          <span className="label">You played</span>
          {played.slice(-12).map((n, i) => (
            <span key={i} className={`chip ${n.kind}`} title={n.kind === 'chord' ? 'chord tone' : n.kind === 'scale' ? 'in scale' : 'outside the scale'}>
              {midiName(n.midi)}
            </span>
          ))}
          {!engine.running && <span className="hint">Connect your guitar (top right) so the app can hear you.</span>}
        </div>
      </div>
    </div>
  )
}

/** Steps i and j are in the same run of a section (the section the chord strip shows). */
function sameSection(steps: Step[], i: number, j: number) {
  const startOf = (k: number) => {
    while (k > 0 && !steps[k].first) k--
    return k
  }
  return startOf(i) === startOf(j)
}

function nextSectionName(steps: Step[], i: number) {
  for (let k = 1; k <= steps.length; k++) {
    const st = steps[(i + k) % steps.length]
    if (st.first) return st.section + (st.solo ? ' (solo)' : '')
  }
  return ''
}

/** The jam just played, in numbers, with one pointer for next time. */
function JamSummaryCard({ s, onClose }: { s: JamSummary; onClose: () => void }) {
  const min = Math.floor(s.sec / 60)
  return (
    <section className="jam-summary" aria-label="Your jam">
      <header>
        <b>Your jam</b>
        <span className="ls-num">
          {min}:{String(s.sec % 60).padStart(2, '0')} · {s.notes} notes · {s.chordPct}% chord tones · {s.scalePct}% scale · {s.outPct}% outside
          {s.phrases > 0 && ` · ${s.phrases} phrase${s.phrases > 1 ? 's' : ''} played`}
        </span>
        <button className="btn small ghost" onClick={onClose}>
          Close
        </button>
      </header>
      <p>{s.pointer}</p>
    </section>
  )
}
