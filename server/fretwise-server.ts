// Local-only API for the dev server: AI song search and Downloads-folder import.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { z } from 'zod'
import type { Cost, Feature, ModelId } from './ai'
import { aiError, costSummary, getClient, runJson } from './ai'
import { handleSession, isLocal } from './session'
import { accountsReady, closeAccounts, handleAccounts } from './accounts'

const GP_EXT = /\.(gp|gp3|gp4|gp5|gpx|gp7|gp8|musicxml|mxl|nam|zip)$/i
const DOWNLOADS = path.join(os.homedir(), 'Downloads')
/** The project's own songs folder (git-ignored): tab files put there join the library too. */
const SONGS = path.join(process.cwd(), 'songs')

export interface FoundTab {
  title: string
  url: string
  site: string
  kind: string // "Guitar Pro", "Tab", "Chords", ...
  note?: string
}

export interface SearchResult {
  ai: boolean
  artist: string
  title: string
  about?: string
  tabs: FoundTab[]
  searchLinks: { label: string; url: string }[]
  error?: string
}

const SYSTEM = `You help a guitarist find downloadable Guitar Pro (.gp/.gp5/.gpx) files for songs they want to learn.
Given their request, which may be vague ("that eagles song about a hotel", "the solo from comfortably numb"):
1. Work out the exact song and artist.
2. Search ultimate-guitar.com for user-submitted "Guitar Pro" versions of that song. Their URLs look like
   https://tabs.ultimate-guitar.com/tab/<artist>/<song>-guitar-pro-<id>. "Official" tabs cannot be downloaded, so skip them.
   Also include a Songsterr page for the song if you find one.
3. Prefer highly rated versions and versions covering the part the user mentioned (e.g. solo, rhythm, acoustic).
Always search before answering: you cannot know these URLs otherwise. Only include URLs that appeared in your search results.
Never invent URLs. Keep "about" and "note" short.`

const SongSearchSchema = z.object({
  artist: z.string(),
  title: z.string(),
  about: z.string(),
  tabs: z.array(z.object({ title: z.string(), url: z.string(), site: z.enum(['Ultimate Guitar', 'Songsterr']), kind: z.enum(['Guitar Pro', 'Tab', 'Chords']), note: z.string() })),
})

/** Default model per feature: the cheapest one that gave correct answers in our comparison (README). */
const MODELS: Record<Feature, ModelId> = {
  'song-search': 'claude-haiku-5-5',
  'original-tone': 'claude-haiku-5-5',
  'song-setup': 'claude-haiku-5-5',
  'lyrics-arrange': 'claude-haiku-5-5',
  coach: 'claude-opus-5-5',
}
const CoachSchema = z.object({ message: z.string(), next: z.string() })

const COACH_SYSTEM = `You are Claude, the personal guitar coach inside Fretwise, a practice app. You write a short note to one player: an adult beginner on electric guitar who practises 20-30 minutes, 3-4 evenings a week, relaxed rock and blues, and wants to jam with a band.

You are given facts from the app as JSON: where the player stands against a 12-week plan, this week's sessions, today's session blocks with scores, what got better, what is not sticking yet, recent timing, and whether this is the moment they open the app or the moment they finish a session.

Write as a coach who knows this player and is on their side: warm, direct, specific, honest. Speak to them as "you". Use their name once if one is given.

Rules:
- Use only the facts given. Never invent a number, a lesson, a feeling or something you "heard": you have not heard them play, you only see the app's numbers.
- Name one or two concrete things from the facts (a lesson by its title, a score, minutes, a tempo, the week). Generic encouragement is worthless.
- Be honest about what is not going well, in a way that helps: say what it means and what to do. Do not pile on.
- Scores from a "cold" first try are low by nature for a beginner; treat a low cold score as normal information, not failure.
- If they were away for several days, welcome them back without guilt. Days off are part of the plan.
- If hand pain was flagged, put that first and keep the advice gentle.
- Opening note: set up today in two or three sentences. Finishing note: say what today showed in two to four sentences.
- "next" is one short, concrete thing to do next (at most 20 words). For a finishing note it may be "rest" or something for the next session.
- Plain words, no hype, no emoji, no exclamation marks, no headings or lists. Do not mention JSON, data or "the app says".`

/** A short coach note from Claude, written from the practice facts the browser sends. */
async function coachNote(facts: unknown) {
  const user = JSON.stringify(facts).slice(0, 12000)
  const { data, cost } = await runJson({
    feature: 'coach',
    model: MODELS.coach,
    system: COACH_SYSTEM,
    user,
    schema: CoachSchema,
    searchDomains: [],
    maxSearches: 0,
    cacheKey: createHash('sha1').update(user).digest('hex'),
  })
  return { message: data.message, next: data.next, cost }
}

const ALLOWED_MODELS: ModelId[] = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']
const pickModel = (f: Feature, override?: string) => (ALLOWED_MODELS.includes(override as ModelId) ? (override as ModelId) : MODELS[f])

function searchLinks(q: string) {
  const enc = encodeURIComponent(q)
  return [
    { label: 'Ultimate Guitar: Guitar Pro results', url: `https://www.ultimate-guitar.com/search.php?search_type=title&value=${enc}&type=500` },
    { label: 'Ultimate Guitar: all results', url: `https://www.ultimate-guitar.com/search.php?search_type=title&value=${enc}` },
    { label: 'Songsterr', url: `https://www.songsterr.com/?pattern=${enc}` },
  ]
}

async function aiSearch(query: string, model?: string): Promise<SearchResult & { cost?: Cost }> {
  const base: SearchResult = { ai: false, artist: '', title: query, tabs: [], searchLinks: searchLinks(query) }
  if (!getClient()) return { ...base, error: 'AI search is off: add ANTHROPIC_API_KEY to .env.local and restart.' }
  try {
    const { data, seenUrls, cost } = await runJson({
      feature: 'song-search',
      model: pickModel('song-search', model),
      system: SYSTEM,
      user: query,
      schema: SongSearchSchema,
      searchDomains: ['ultimate-guitar.com', 'songsterr.com'],
      maxSearches: 3,
      cacheKey: query,
    })
    // Only keep URLs that really came back from the web search.
    const tabs = data.tabs.filter((t) => seenUrls.has(t.url.replace(/\/$/, '')))
    const q = `${data.artist} ${data.title}`.trim() || query
    return { ai: true, artist: data.artist, title: data.title || query, about: data.about, tabs, searchLinks: searchLinks(q), cost }
  } catch (err) {
    return { ...base, ai: true, error: aiError(err) }
  }
}

// ---- Original tone: the recorded rig, matched to real captures on TONE3000 ----

const Match = z.object({ title: z.string(), url: z.string(), why: z.string() })
const OriginalToneSchema = z.object({
  rig: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  amp: z.object({ search: z.string(), versionHint: z.string(), matches: z.array(Match) }),
  cab: z.object({ search: z.string(), matches: z.array(Match) }),
  settings: z.object({
    bass: z.number(),
    mid: z.number(),
    treble: z.number(),
    presence: z.number(),
    gate: z.number(),
    reverb: z.number(),
    delay: z.number(),
    delayMs: z.number(),
    chorus: z.number(),
    level: z.number(),
  }),
  tips: z.string(),
})

export interface OriginalTone {
  ai: boolean
  rig?: string
  confidence?: 'high' | 'medium' | 'low'
  amp?: { search: string; matches: { toneId: string; title: string; url: string; why?: string; gear?: string }[]; versionHint?: string }
  cab?: { search: string; matches: { toneId: string; title: string; url: string; why?: string }[] }
  settings?: Partial<Record<'bass' | 'mid' | 'treble' | 'presence' | 'gate' | 'reverb' | 'delay' | 'delayMs' | 'chorus' | 'level', number>>
  tips?: string
  error?: string
  cost?: Cost
}

const ORIGINAL_SYSTEM = `You help a guitarist recreate the recorded guitar tone of a song with real amp captures from TONE3000 (tone3000.com),
a library of Neural Amp Modeler (NAM) captures and cabinet impulse responses (IRs).

1. From what you know, identify the guitarist's rig on the recording for this song and part: amp (and channel/gain), cabinet/speakers, key pedals.
2. Search tone3000.com for the closest captures:
   - amp: a NAM capture of that amp (or the closest similar amp). Prefer "amp" (head) or "full rig" captures.
   - cab: a cabinet IR matching the speaker cabinet (only needed if the amp capture is a head without cab).
   Prefer captures whose title mentions the right model/channel. Up to 3 matches each, best first.
3. Suggest settings for the app's post-amp EQ and effects (the captured amp provides the gain):
   bass/mid/treble/presence in dB (-12..12, usually small, 0 = neutral), gate 0-10, reverb 0-10, delay 0-10, delayMs 80-900, chorus 0-10, level 0-10 (5 = normal).
You cannot know TONE3000 URLs without searching: always run one search for the amp and one for the cabinet IR before answering.
Only use tone3000.com URLs that appeared in your search results; never invent URLs. If nothing suitable, return empty matches.
rig: 1-2 sentences naming the gear. tips: one sentence. Keep "why" to a few words.`

// ---- Song setup: a song's key, tempo and form for a band jam ------------------------

const SONG_SYSTEM = `You set up a band jam session for a song a group of friends wants to play together.
Give the song's real chords and structure so everyone can follow along:
- key (tonic as a note name like "G", "F#", "Bb") and whether it is minor, tempo in BPM, and the closest feel:
  pop (pop/rock strumming), ballad, blues (shuffle), funk, reggae.
- capo: the capo fret on the original recording (0 if none). Give chords as they SOUND (concert pitch), not capo shapes.
- sections: each distinct section once (Intro, Verse, Pre-Chorus, Chorus, Bridge, Solo, Outro…). Give ONE pass of the
  section's chord pattern in order, with how many beats each chord lasts in 4/4 (4 = one bar, 2 = half a bar, 8 = two
  bars), and "repeat": how many times that pattern is played in the section on the recording, so the section has its
  real length (e.g. a 4-bar loop played 4 times in a 16-bar verse → repeat 4). Sections must be as long as on the record:
  singers read the words in time with them. Use standard chord symbols (C, Am, F#m7, Bb, Dsus4, G/B). Mark instrumental sections where someone takes a guitar/keys solo with solo: true;
  if the song has no solo section, mark the instrumental intro or outro as solo, or none.
- for each section, how the rhythm guitar plays it on the recording:
  strum: one bar as exactly 8 eighth-note slots using D (down strum), U (up strum), x (muted chop / scratch),
  _ (rest or let the chord ring), - (hold). Examples: "D_DU_UDU" (folk/pop), "D_D_D_D_" (driving downstrokes),
  "D_______" (one strum, let ring), "__x___x_" (chops on 2 and 4). For picked/arpeggiated parts give the strum
  of the closest strummed equivalent and say so in technique.
  technique: a few words, e.g. "palm-muted power chords", "let it ring", "arpeggiate, pick each string",
  "heavy distorted downstrokes", "light acoustic strum".
- form: the order the sections are played in, using the section names (repeat names for repeats). Every name in the
  form must be one of the sections you listed. Match the recording's length.
- notes: one short sentence of practical advice (e.g. strumming feel, a signature riff, a tricky change).
Use a quick search of chord sheets to confirm the chords if you're not sure. Never include lyrics.`

const SongSchema = z.object({
  title: z.string(),
  artist: z.string(),
  key: z.string(),
  minor: z.boolean(),
  bpm: z.number(),
  feel: z.enum(['pop', 'ballad', 'blues', 'funk', 'reggae']),
  capo: z.number(),
  sections: z.array(
    z.object({
      name: z.string(),
      solo: z.boolean(),
      repeat: z.number(),
      strum: z.string(),
      technique: z.string(),
      chords: z.array(z.object({ chord: z.string(), beats: z.number() })),
    }),
  ),
  form: z.array(z.string()),
  notes: z.string(),
})

async function songSetup(query: string, model?: string) {
  if (!getClient()) return { error: 'Add ANTHROPIC_API_KEY to .env.local and restart to use this.' }
  try {
    const { data, cost } = await runJson({
      feature: 'song-setup',
      model: pickModel('song-setup', model),
      system: SONG_SYSTEM,
      user: query,
      schema: SongSchema,
      searchDomains: ['ultimate-guitar.com'],
      maxSearches: 2,
      cacheKey: query,
    })
    const names = new Set(data.sections.map((s) => s.name))
    return {
      song: {
        ...data,
        bpm: clamp(Math.round(data.bpm), 40, 220),
        capo: clamp(Math.round(data.capo), 0, 12),
        form: data.form.filter((n) => names.has(n)),
        sections: data.sections.map((s) => ({
          ...s,
          repeat: clamp(Math.round(s.repeat), 1, 16),
          // Keep only a valid one-bar pattern (8 slots of D U x _ -); otherwise the feel's pattern is used.
          strum: /^[DUx_-]{8}$/.test(s.strum.replace(/\s/g, '')) ? s.strum.replace(/\s/g, '') : '',
          technique: s.technique.slice(0, 80),
          chords: s.chords.map((c) => ({ chord: c.chord.trim(), beats: clamp(Math.round(c.beats), 1, 16) })),
        })),
      },
      cost,
    }
  } catch (err) {
    return { error: aiError(err) }
  }
}

// ---- Arrange lyrics: map the user's pasted text onto the song form -----------------
// The model only returns line numbers; the app splits the user's own text. No lyrics come back.

const ARRANGE_SYSTEM = `The user pasted the words of a song they are about to sing, copied from a lyrics page, with
numbered lines. Map the lines onto the song's form so the singer sees the right words in each section.
For each form entry, give the first and last line number of its words (inclusive), or 0 and 0 if nothing is sung
there (intro, solo, instrumental). Repeated sections (e.g. every chorus) may point to the same line range.
Skip lines that are not sung: section headings like [Chorus], credits, "Embed", "Translations", ads, chord-only lines.
The page's own headings are only hints: lyrics sites label sections differently from this form (a page's "[Intro]"
is often really the first sung verse, and "[Refrain]" is the chorus). Place words by where they are sung in the form,
keeping the order of the text. An Intro, Solo, Interlude or Outro in the form gets no words unless the text clearly
has words sung there; the first sung block normally belongs to the first Verse.
Return only numbers in the JSON. Never quote or rewrite any of the words.`

const ArrangeSchema = z.object({
  entries: z.array(z.object({ form: z.number(), from: z.number(), to: z.number() })),
})

async function arrangeLyrics(req: { title: string; artist: string; form: string[]; solo: string[]; text: string }, model?: string) {
  if (!getClient()) return { error: 'Add ANTHROPIC_API_KEY to .env.local and restart to use this.' }
  const lines = req.text.replace(/\r/g, '').split('\n').slice(0, 400)
  const numbered = lines.map((l, i) => `${i + 1}| ${l}`).join('\n')
  const form = req.form.map((n, i) => `${i + 1}. ${n}${req.solo.includes(n) ? ' (instrumental solo)' : ''}`).join('\n')
  try {
    const { data, cost } = await runJson({
      feature: 'lyrics-arrange',
      model: pickModel('lyrics-arrange', model),
      system: ARRANGE_SYSTEM,
      user: `Song: "${req.title}" by ${req.artist}\nForm:\n${form}\n\nPasted text:\n${numbered}`,
      schema: ArrangeSchema,
      searchDomains: [],
      maxSearches: 0,
      // Hash the text so the cache file never contains the words.
      cacheKey: createHash('sha1').update(`${req.form.join('|')}\n${req.text}`).digest('hex'),
    })
    // Keep only sane ranges inside the pasted text.
    const ranges = req.form.map((_, i) => {
      const e = data.entries.find((x) => x.form === i + 1)
      if (!e || e.from < 1 || e.to < e.from || e.to > lines.length) return null
      return [e.from, e.to] as const
    })
    return { ranges, cost }
  } catch (err) {
    return { error: aiError(err) }
  }
}

interface ToneCheck {
  ok: boolean
  gear?: string // amp | amp-cab | pedal | cab | …
  a2?: number // models the browser engine can play
  irs?: number
}
const toneChecks = new Map<string, { at: number; check: ToneCheck }>()

/**
 * Checks a TONE3000 tone page: removed tones return 404. The page embeds the tone's data, so we
 * also learn its gear type and how many A2 (browser-playable) models or IRs it has.
 */
async function checkTone(url: string, id: string): Promise<ToneCheck> {
  const hit = toneChecks.get(id)
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.check
  let check: ToneCheck = { ok: false }
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Fretwise' }, signal: AbortSignal.timeout(8000) })
    if (res.ok) {
      const html = (await res.text()).replace(/\\"/g, '"')
      const at = html.search(new RegExp(`"id":${id}[,}]`))
      const win = at >= 0 ? html.slice(at, at + 2000) : ''
      const field = (k: string) => new RegExp(`"${k}":"?([^,"}]*)`).exec(win)?.[1]
      check = { ok: true, gear: field('gear'), a2: Number(field('a2_models_count') ?? NaN), irs: Number(field('irs_count') ?? NaN) }
    }
  } catch {
    check = { ok: true } // couldn't check (offline/timeout): keep the match rather than hide it
  }
  toneChecks.set(id, { at: Date.now(), check })
  return check
}

/** Tone ids appear in TONE3000 URLs like /tones/<id> or /tones/<slug>-<id>. */
const toneIdFromUrl = (url: string) => /tone3000\.com\/tones\/(?:[^/?#]*?-)?(\d+)(?:[/?#]|$)/.exec(url)?.[1] ?? null
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo))

async function originalTone(req: { artist: string; title: string; track: string; cues?: string[]; model?: string }): Promise<OriginalTone> {
  if (!getClient()) return { ai: false, error: 'Add ANTHROPIC_API_KEY to .env.local and restart to use this.' }
  const user = `Song: "${req.title}" by ${req.artist}\nGuitar part: "${req.track}"${req.cues?.length ? `\nNotes from the tab file: ${req.cues.slice(0, 30).join('; ')}` : ''}`
  try {
    const { data, seenUrls, cost } = await runJson({
      feature: 'original-tone',
      model: pickModel('original-tone', req.model),
      system: ORIGINAL_SYSTEM,
      user,
      schema: OriginalToneSchema,
      searchDomains: ['tone3000.com'],
      maxSearches: 4,
      cacheKey: `${req.artist}|${req.title}|${req.track}`,
    })
    // Keep matches that came from the search, still exist, and have something the app can play.
    const clean = async (ms: { url: string; title: string; why: string }[], kind: 'amp' | 'cab') => {
      const found = ms
        .filter((m) => seenUrls.has(m.url.replace(/\/$/, '')))
        .map((m) => ({ ...m, toneId: toneIdFromUrl(m.url) }))
        .filter((m): m is { url: string; title: string; why: string; toneId: string } => !!m.toneId)
      const checked = await Promise.all(found.map(async (m) => ({ ...m, ...(await checkTone(m.url, m.toneId)) })))
      return checked
        .filter((m) => m.ok && (kind === 'amp' ? !(m.a2 === 0) : !(m.irs === 0)))
        .map((m) => ({ toneId: m.toneId, title: m.title, url: m.url, why: m.why, gear: m.gear }))
        // Full rigs first: they need no separate cab.
        .sort((a, b) => (kind === 'amp' ? Number(b.gear === 'amp-cab') - Number(a.gear === 'amp-cab') : 0))
    }
    const [ampMatches, cabMatches] = await Promise.all([clean(data.amp.matches, 'amp'), clean(data.cab.matches, 'cab')])
    const st = data.settings
    return {
      ai: true,
      rig: data.rig,
      confidence: data.confidence,
      amp: { search: data.amp.search, versionHint: data.amp.versionHint, matches: ampMatches },
      cab: { search: data.cab.search, matches: cabMatches },
      settings: {
        bass: clamp(st.bass, -12, 12),
        mid: clamp(st.mid, -12, 12),
        treble: clamp(st.treble, -12, 12),
        presence: clamp(st.presence, -12, 12),
        gate: clamp(st.gate, 0, 10),
        reverb: clamp(st.reverb, 0, 10),
        delay: clamp(st.delay, 0, 10),
        delayMs: clamp(st.delayMs, 80, 900),
        chorus: clamp(st.chorus, 0, 10),
        level: clamp(st.level, 0, 10),
      },
      tips: data.tips,
      cost,
    }
  } catch (err) {
    return { ai: true, error: aiError(err) }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function readBytes(req: IncomingMessage, limit = 200 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) req.destroy(new Error('Too large'))
      else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// ---- Auto-sync: the words lined up with the singing on the user's recording (local Python helper) ----

const ALIGN_DIR = path.resolve('.cache/align')
const ALIGN_PY = path.resolve('.cache/align-venv/bin/python')
const ALIGN_SCRIPT = path.resolve('server/align/align.py')
const BREW_BIN = '/opt/homebrew/bin'
const ALIGN_VERSION = 3 // bump when align.py changes, so cached results are redone

function alignStatus() {
  const hasPython = fs.existsSync(ALIGN_PY)
  const lib = path.resolve('.cache/align-venv/lib')
  const site = hasPython && fs.existsSync(lib) ? fs.readdirSync(lib).map((d) => path.join(lib, d, 'site-packages')) : []
  const pkg = (name: string) => site.some((d) => fs.existsSync(path.join(d, name)))
  const ffmpeg = [BREW_BIN, '/usr/local/bin', ...(process.env.PATH ?? '').split(':')].some((d) => fs.existsSync(path.join(d, 'ffmpeg')))
  return { ready: hasPython && pkg('whisperx') && pkg('demucs') && ffmpeg, python: hasPython, whisperx: pkg('whisperx'), demucs: pkg('demucs'), ffmpeg }
}

function runAlign(job: unknown): Promise<unknown> {
  fs.mkdirSync(ALIGN_DIR, { recursive: true })
  const jobFile = path.join(ALIGN_DIR, `job-${Date.now()}.json`)
  fs.writeFileSync(jobFile, JSON.stringify(job))
  const models = path.resolve('.cache/models')
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PATH: `${BREW_BIN}:${process.env.PATH ?? ''}`, HF_HOME: models, TORCH_HOME: path.join(models, 'torch'), PYTORCH_ENABLE_MPS_FALLBACK: '1', TOKENIZERS_PARALLELISM: 'false' }
    execFile(ALIGN_PY, [ALIGN_SCRIPT, jobFile], { env, maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 }, (err, stdout, stderr) => {
      fs.rm(jobFile, () => {})
      if (stderr) console.log(`[fretwise] align: ${stderr.trim().split('\n').slice(-6).join(' | ')}`)
      if (err) return reject(new Error(stderr.trim().split('\n').filter(Boolean).pop() ?? err.message))
      try {
        resolve(JSON.parse(stdout))
      } catch {
        reject(new Error('The aligner gave no result'))
      }
    })
  })
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

/** Watches ~/Downloads and tells open pages about new Guitar Pro files (server-sent events). */
function downloadsWatcher() {
  const clients = new Set<ServerResponse>()
  const announced = new Set<string>()
  const pending = new Map<string, NodeJS.Timeout>()

  const announce = (name: string) => {
    const file = path.join(DOWNLOADS, name)
    let last = -1
    // Wait until the file stops growing, then announce it once.
    const check = () => {
      fs.stat(file, (err, st) => {
        if (err) return pending.delete(name)
        if (st.size > 0 && st.size === last) {
          pending.delete(name)
          const key = `${name}:${st.mtimeMs}`
          if (announced.has(key)) return
          announced.add(key)
          const msg = `data: ${JSON.stringify({ name })}\n\n`
          clients.forEach((c) => c.write(msg))
        } else {
          last = st.size
          pending.set(name, setTimeout(check, 400))
        }
      })
    }
    clearTimeout(pending.get(name))
    pending.set(name, setTimeout(check, 300))
  }

  try {
    fs.watch(DOWNLOADS, (_event, name) => {
      if (name && GP_EXT.test(name)) announce(name.toString())
    })
  } catch (err) {
    console.warn(`[fretwise] Can't watch ${DOWNLOADS}:`, err)
  }
  return clients
}

export function fretwiseServer(): Plugin {
  return {
    name: 'fretwise-server',
    configureServer(server) {
      const sse = downloadsWatcher()
      // Read the accounts now (MariaDB or the JSON files), so a database problem shows in the log at start.
      void accountsReady()
      server.httpServer?.on('close', () => void closeAccounts())

      // On this Mac, the app always runs at localhost: songs, tones and history are kept per address
      // in the browser unless signed in, so opening the Wi-Fi address here would show an empty app.
      server.middlewares.use((req, res, next) => {
        const host = (req.headers.host ?? '').split(':')[0]
        const page = req.method === 'GET' && !req.url?.startsWith('/join') && (req.headers.accept ?? '').includes('text/html')
        if (page && host !== 'localhost' && host !== '127.0.0.1' && isLocal(req)) {
          res.statusCode = 302
          res.setHeader('Location', `http://localhost:${server.config.server.port ?? 5173}${req.url ?? '/'}`)
          return res.end()
        }
        next()
      })

      // Other devices on the Wi-Fi may only use the live-session and account endpoints (accounts need a
      // password and keep each player's songs and settings in MariaDB or .cache/, files in .cache/accounts/). Everything else
      // (AI calls on your API key, the Downloads folder, the TONE3000 relay) answers to this Mac only.
      server.middlewares.use(async (req, res, next) => {
        // Connect matches routes without regard to case, so the check must not care about case either.
        let apiPath = ''
        try {
          apiPath = new URL(req.url ?? '', 'http://x').pathname.toLowerCase()
        } catch {
          return json(res, 400, { error: 'Bad request' })
        }
        if (!apiPath.startsWith('/api/')) return next()
        try {
          if (await handleSession(req, res, server.config.server.port ?? 5173)) return
          if (await handleAccounts(req, res)) return
        } catch (err) {
          return json(res, 500, { error: String(err) })
        }
        if (!isLocal(req)) return json(res, 403, { error: 'Only available on the host Mac' })
        next()
      })

      server.middlewares.use('/api/ai-status', (_req, res) => json(res, 200, { ai: !!getClient(), ...costSummary(MODELS) }))

      // The coach note (this computer only, like every AI call): practice facts in, two short strings out.
      server.middlewares.use('/api/coach', async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
        if (!getClient()) return json(res, 503, { error: 'AI is off' })
        try {
          const { facts } = JSON.parse(await readBody(req)) as { facts?: unknown }
          if (!facts || typeof facts !== 'object') return json(res, 400, { error: 'No facts' })
          json(res, 200, await coachNote(facts))
        } catch (err) {
          json(res, 500, { error: aiError(err) })
        }
      })

      server.middlewares.use('/api/find', async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
        try {
          const { query, model } = JSON.parse(await readBody(req)) as { query?: string; model?: string }
          if (!query?.trim()) return json(res, 400, { error: 'Empty query' })
          json(res, 200, await aiSearch(query.trim().slice(0, 300), model))
        } catch (err) {
          json(res, 500, { error: String(err) })
        }
      })

      // Relays TONE3000 calls if the browser can't reach them directly (CORS).
      // API calls go to tone3000.com only; other hosts are allowed for GET (model file downloads).
      server.middlewares.use('/api/t3k', async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
        try {
          const { url, method = 'GET', headers = {}, body } = JSON.parse(await readBody(req)) as { url: string; method?: string; headers?: Record<string, string>; body?: string }
          const u = new URL(url)
          const isT3k = u.hostname === 'tone3000.com' || u.hostname.endsWith('.tone3000.com')
          if (u.protocol !== 'https:' || (!isT3k && method !== 'GET')) return json(res, 400, { error: 'Not allowed' })
          const upstream = await fetch(u, { method, headers, body })
          res.statusCode = upstream.status
          res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream')
          res.end(Buffer.from(await upstream.arrayBuffer()))
        } catch (err) {
          json(res, 502, { error: String(err) })
        }
      })

      server.middlewares.use('/api/original-tone', async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
        try {
          json(res, 200, await originalTone(JSON.parse(await readBody(req))))
        } catch (err) {
          json(res, 500, { error: String(err) })
        }
      })

      server.middlewares.use('/api/song-setup', async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
        try {
          const { query, model } = JSON.parse(await readBody(req)) as { query?: string; model?: string }
          if (!query?.trim()) return json(res, 400, { error: 'Type a song' })
          json(res, 200, await songSetup(query.trim().slice(0, 200), model))
        } catch (err) {
          json(res, 500, { error: String(err) })
        }
      })

      server.middlewares.use('/api/lyrics-arrange', async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
        try {
          const body = JSON.parse(await readBody(req)) as { title: string; artist: string; form: string[]; solo: string[]; text: string; model?: string }
          if (!body.text?.trim() || !body.form?.length) return json(res, 400, { error: 'Paste the words first' })
          json(res, 200, await arrangeLyrics(body, body.model))
        } catch (err) {
          json(res, 500, { error: String(err) })
        }
      })

      server.middlewares.use('/api/downloads/events', (req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        res.write(': connected\n\n')
        sse.add(res)
        req.on('close', () => sse.delete(res))
      })

      server.middlewares.use('/api/align/status', (_req, res) => json(res, 200, alignStatus()))

      // The recording's file, stored once by content hash (it stays on this Mac).
      server.middlewares.use('/api/align/audio', async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
        try {
          const name = new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'audio'
          const ext = (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] ?? 'bin').toLowerCase()
          const data = await readBytes(req)
          const id = `${createHash('sha256').update(data).digest('hex').slice(0, 24)}.${ext}`
          fs.mkdirSync(ALIGN_DIR, { recursive: true })
          const file = path.join(ALIGN_DIR, id)
          if (!fs.existsSync(file)) fs.writeFileSync(file, data)
          json(res, 200, { id })
        } catch (err) {
          json(res, 500, { error: String(err) })
        }
      })

      // Lines the words up with the vocal: { id, language, segments: [{ start, end, text }] } (seconds).
      server.middlewares.use('/api/align/run', async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
        try {
          const body = JSON.parse(await readBody(req)) as { id?: string; language?: string; segments?: { start: number; end: number; text: string }[] }
          const id = body.id ?? ''
          if (!/^[0-9a-f]{24}\.[a-z0-9]{1,5}$/.test(id) || !fs.existsSync(path.join(ALIGN_DIR, id))) return json(res, 400, { error: 'Unknown recording' })
          if (!alignStatus().ready) return json(res, 503, { error: 'The auto-sync tools are not installed' })
          const language = /^[a-z]{2}$/.test(body.language ?? '') ? body.language! : 'en'
          const segments = (body.segments ?? []).map((x) => ({ start: Number(x.start), end: Number(x.end), text: String(x.text).slice(0, 5000) }))
          const key = createHash('sha256').update(JSON.stringify({ v: ALIGN_VERSION, id, language, segments })).digest('hex').slice(0, 24)
          const cached = path.join(ALIGN_DIR, `result-${key}.json`)
          if (fs.existsSync(cached)) return json(res, 200, { ...JSON.parse(fs.readFileSync(cached, 'utf8')), cached: true })
          const result = await runAlign({ audio: path.join(ALIGN_DIR, id), cache: ALIGN_DIR, language, segments })
          fs.writeFileSync(cached, JSON.stringify(result))
          json(res, 200, result)
        } catch (err) {
          json(res, 500, { error: err instanceof Error ? err.message : String(err) })
        }
      })

      // The Guitar Pro tabs in ~/Downloads, newest first (names only).
      server.middlewares.use('/api/downloads/list', (_req, res) => {
        fs.readdir(DOWNLOADS, (err, names) => {
          if (err) return json(res, 200, { files: [] })
          const files = names
            .filter((n) => /\.(gp|gp3|gp4|gp5|gpx|gp7|gp8)$/i.test(n))
            .map((name) => {
              try {
                return { name, mtime: fs.statSync(path.join(DOWNLOADS, name)).mtimeMs }
              } catch {
                return null
              }
            })
            .filter((x): x is { name: string; mtime: number } => !!x)
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 60)
          json(res, 200, { files })
        })
      })

      // The tab files in the project's songs folder (names only).
      server.middlewares.use('/api/songs/list', (_req, res) => {
        fs.readdir(SONGS, (err, names) => json(res, 200, { files: err ? [] : names.filter((n) => /\.(gp|gp3|gp4|gp5|gpx|gp7|gp8)$/i.test(n)).slice(0, 100) }))
      })

      // Serves a file from ~/Downloads by bare name only (no paths), and only tab files.
      server.middlewares.use('/api/downloads/file', (req, res) => {
        const name = new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? ''
        if (!name || name !== path.basename(name) || !GP_EXT.test(name)) return json(res, 400, { error: 'Bad file name' })
        const dir = new URL(req.url ?? '', 'http://x').searchParams.get('from') === 'songs' ? SONGS : DOWNLOADS
        fs.readFile(path.join(dir, name), (err, data) => {
          if (err) return json(res, 404, { error: 'Not found' })
          res.setHeader('Content-Type', 'application/octet-stream')
          res.end(data)
        })
      })
    },
  }
}
