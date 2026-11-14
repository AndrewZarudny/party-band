// The live coach in the browser: listens for the player's voice (Chrome's speech recognition, through the
// Mac's default microphone), sends what was said and each run's numbers to the coach (server/liveCoach.ts),
// and speaks the replies aloud. It never listens during a run, or while it is speaking, so it doesn't hear
// the guitar or itself. A mute button stops the listening; the coach still speaks after runs.

export type CoachPhase = 'off' | 'listening' | 'thinking' | 'speaking' | 'paused' | 'muted'

export interface LiveCoachState {
  on: boolean
  muted: boolean
  playing: boolean
  phase: CoachPhase
  /** What the microphone is hearing right now, before it is sent. */
  heard: string
  /** The conversation so far, newest last. */
  log: { who: 'you' | 'coach'; text: string }[]
  error: string | null
}

// ---- Speech recognition (Chrome's, prefixed) ----------------------------------------------------

interface RecResult {
  isFinal: boolean
  0: { transcript: string; confidence: number }
}
interface Rec {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((ev: { resultIndex: number; results: ArrayLike<RecResult> }) => void) | null
  onend: (() => void) | null
  onerror: ((ev: { error: string }) => void) | null
}
type RecCtor = new () => Rec

function recCtor(): RecCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const canListen = () => typeof window !== 'undefined' && !!recCtor()

// ---- State --------------------------------------------------------------------------------------

let state: LiveCoachState = { on: false, muted: false, playing: false, phase: 'off', heard: '', log: [], error: null }
const listeners = new Set<() => void>()

function set(patch: Partial<LiveCoachState>) {
  state = { ...state, ...patch }
  state = { ...state, phase: phaseOf(state) }
  for (const l of listeners) l()
  syncListening()
}

let thinking = 0 // requests waiting for a reply
let speaking = false

function phaseOf(s: LiveCoachState): CoachPhase {
  if (!s.on) return 'off'
  if (speaking) return 'speaking'
  if (thinking) return 'thinking'
  if (s.playing) return 'paused'
  if (s.muted) return 'muted'
  return 'listening'
}

export function subscribeLiveCoach(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const getLiveCoach = () => state
export const liveCoachOn = () => state.on

const addLog = (who: 'you' | 'coach', text: string) => set({ log: [...state.log, { who, text }].slice(-20) })

// ---- Listening ----------------------------------------------------------------------------------

let rec: Rec | null = null
let recRunning = false
let restartTimer: number | null = null

/** Listening runs only while the coach is on, not muted, not in a run, not speaking. */
function shouldListen() {
  return state.on && !state.muted && !state.playing && !speaking
}

function syncListening() {
  const want = shouldListen()
  if (want && !recRunning) startRec()
  else if (!want && recRunning) {
    recRunning = false
    rec?.abort()
    if (state.heard) set({ heard: '' })
  }
}

function startRec() {
  const Ctor = recCtor()
  if (!Ctor) return
  if (!rec) {
    rec = new Ctor()
    rec.lang = navigator.language || 'en-US'
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (ev) => {
      let interim = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]
        const text = r[0].transcript.trim()
        if (!r.isFinal) {
          interim += ' ' + text
          continue
        }
        // A word or two of low confidence is usually the guitar, not the player.
        const words = text.split(/\s+/).filter(Boolean).length
        if (words >= 2 || (words === 1 && r[0].confidence > 0.7)) void ask('player', text)
      }
      if (interim.trim() !== state.heard) set({ heard: interim.trim() })
    }
    rec.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        set({ error: 'Chrome was not allowed to use the microphone. Allow it in the address bar (or the site settings), then turn the coach on again.', muted: true })
      } else if (ev.error === 'audio-capture') {
        set({ error: "No microphone found. Check the Mac's sound input in System Settings, Sound." })
      }
      // 'no-speech', 'aborted', 'network': onend restarts it.
    }
    rec.onend = () => {
      // Chrome stops listening now and then by itself: start again while it should be listening.
      recRunning = false
      if (restartTimer) window.clearTimeout(restartTimer)
      restartTimer = window.setTimeout(() => {
        if (shouldListen() && !recRunning) startRec()
      }, 250)
    }
  }
  try {
    rec.start()
    recRunning = true
  } catch {
    // already started
    recRunning = true
  }
}

// ---- Speaking -----------------------------------------------------------------------------------

let voice: SpeechSynthesisVoice | null = null
function pickVoice(): SpeechSynthesisVoice | null {
  if (voice) return voice
  const lang = (navigator.language || 'en-US').slice(0, 2)
  const all = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang))
  const rank = (v: SpeechSynthesisVoice) =>
    (/premium/i.test(v.name) ? 0 : /enhanced/i.test(v.name) ? 1 : /google/i.test(v.name) ? 2 : /samantha|daniel|karen|moira|alex/i.test(v.name) ? 3 : 4) + (v.localService ? 0 : 0.5)
  voice = [...all].sort((a, b) => rank(a) - rank(b))[0] ?? null
  return voice
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => (voice = null)

function speak(text: string): Promise<void> {
  if (!('speechSynthesis' in window) || !text) return Promise.resolve()
  return new Promise((resolve) => {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    const v = pickVoice()
    if (v) u.voice = v
    u.rate = 1.03
    const done = () => {
      speaking = false
      set({})
      resolve()
    }
    u.onend = done
    u.onerror = done
    speaking = true
    set({})
    speechSynthesis.speak(u)
  })
}

/** Stops the coach mid-sentence. */
export function hushCoach() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) speechSynthesis.cancel()
}

// ---- What the coach can do on the current screen ------------------------------------------------

/** One thing the coach may do for the player, on this screen. `arg`: e.g. "3-4" for a bar range. */
export interface CoachAction {
  /** For the coach: what it does, and the argument it takes, if any. */
  about: string
  run: (arg?: string) => boolean | void
}
export type CoachActions = Record<string, CoachAction>

let actionsNow: () => CoachActions = () => ({})
/** The screen tells the coach what it can do there (Lessons keeps this current). */
export function setCoachActions(get: () => CoachActions) {
  actionsNow = get
}

function actionsLine(): string {
  const a = actionsNow()
  const names = Object.keys(a)
  return names.length ? `\n[actions you can take now: ${names.map((n) => `${n} = ${a[n].about}`).join('; ')}]` : '\n[no actions available on this screen]'
}

/** The reply without its action tag, and the action it asks for, if any. */
export function splitAction(reply: string): { say: string; action: { name: string; arg?: string } | null } {
  const m = reply.match(/<<\s*do:\s*([a-z-]+)(?:\s+([^>]*?))?\s*>>/i)
  const say = reply.replace(/<<[^>]*>>/g, '').replace(/\s+/g, ' ').trim()
  return { say, action: m ? { name: m[1].toLowerCase(), arg: m[2]?.trim() || undefined } : null }
}

// ---- Talking to the coach -----------------------------------------------------------------------

async function send(kind: 'run' | 'player' | 'context', body: { text?: string; facts?: unknown }): Promise<string | null> {
  thinking++
  set({ error: null })
  try {
    const res = await fetch('/api/live-coach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, ...body }) })
    const o = (await res.json().catch(() => ({}))) as { reply?: string; error?: string }
    if (!res.ok) {
      set({ error: o.error ?? 'The coach could not answer.' })
      return null
    }
    return (o.reply ?? '').trim()
  } catch {
    set({ error: 'The coach could not be reached.' })
    return null
  } finally {
    thinking--
    set({})
  }
}

async function ask(kind: 'run' | 'player', text: string, facts?: unknown): Promise<string | null> {
  if (!state.on) return null
  if (kind === 'player') {
    addLog('you', text)
    set({ heard: '' })
  }
  const reply = await send(kind, kind === 'run' ? { facts: { ...(facts as object), actionsNow: actionsLine().trim() } } : { text: text + actionsLine() })
  if (!reply || !state.on) return reply
  const { say, action } = splitAction(reply)
  const act = action ? actionsNow()[action.name] : undefined
  addLog('coach', say + (act ? ` (${action?.name}${action?.arg ? ' ' + action.arg : ''})` : ''))
  await speak(say)
  // The action after the words, so the player hears what's about to happen.
  if (act && state.on) act.run(action?.arg)
  return say
}

/** Turns the coach on. `context`: facts about the player and today, so the first words fit. */
export function startLiveCoach(context: unknown) {
  if (state.on) return
  set({ on: true, muted: false, error: null, log: [], heard: '' })
  void (async () => {
    const hello = await send('context', {
      facts: { ...(context as object), instruction: 'The player just turned the live coach on. Greet them in one short sentence and say what to start with today.' },
    })
    if (hello && state.on) {
      addLog('coach', hello)
      await speak(hello)
    }
  })()
}

export function stopLiveCoach() {
  if (!state.on) return
  hushCoach()
  speaking = false
  set({ on: false, heard: '' })
  void fetch('/api/live-coach/end', { method: 'POST' }).catch(() => {})
}

export const setCoachMuted = (muted: boolean) => set({ muted, error: muted ? state.error : null })

// Who is playing now: Lessons (a run), Learn a song (the track), Jam (the band). Each tab reports for itself, so
// one tab stopping can't switch listening back on while another still plays.
const players = new Set<string>()

/** `source` is playing (a run, a song, the band): no listening while any source plays. */
export function setCoachPlaying(source: string, playing: boolean) {
  if (playing) players.add(source)
  else players.delete(source)
  const any = players.size > 0
  if (any !== state.playing) {
    if (any) hushCoach()
    set({ playing: any })
  }
}

/** A run just finished: the coach says something about it. The reply, or null when the coach is off. */
export function coachRunEnded(facts: unknown): Promise<string | null> {
  return ask('run', '', facts)
}
