// Auto-sync: the local helper finds when each pasted word is sung on the user's recording; this turns
// those times into the song's beats (line starts and word starts, per section).
import type { Segment, SongSetup } from '../music/songForm'
import { lineWords } from '../music/wordTiming'

export const LANGUAGES: [string, string][] = [
  ['en', 'English'],
  ['ru', 'Russian'],
  ['uk', 'Ukrainian'],
  ['pl', 'Polish'],
  ['de', 'German'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
]

/** The words' language, from their letters. */
export function guessLanguage(text: string): string {
  if (/[іїєґ]/i.test(text)) return 'uk'
  if (/[а-яё]/i.test(text)) return 'ru'
  if (/[ąćęłńśźż]/i.test(text)) return 'pl'
  if (/[äöüß]/i.test(text)) return 'de'
  if (/[ñ¿¡]/i.test(text)) return 'es'
  if (/[àâçèêëîïôœùûÿ]/i.test(text)) return 'fr'
  return 'en'
}

export interface Recording {
  data: ArrayBuffer
  fileName: string
  beat0: number // seconds into the file of the song's beat 0
  spb: number // seconds per beat
}

export interface AutoSyncResult {
  lyricSecs: ((number | null)[][] | null)[] // word starts in seconds of the recording (null: not sure)
  placed: number // words placed with confidence
  total: number
  sections: number
  seconds: number
}

// The aligner places every word somewhere, even where the words and the singing don't match (a repeat the
// sheet didn't write out). A word it isn't sure of is left for its sure neighbours to place. (A one-letter word
// like "в" can be a single 20 ms frame and still be right, so its length says nothing.)
const SURE = 0.25
type Placed = { start: number; end: number; score?: number } | null
const sure = (w: Placed) => !!w && (w.score ?? 1) >= SURE

export async function autoSync(song: SongSetup, segments: Segment[], rec: Recording, language: string): Promise<AutoSyncResult> {
  const up = (await (await fetch(`/api/align/audio?name=${encodeURIComponent(rec.fileName)}`, { method: 'POST', body: rec.data })).json()) as { id?: string; error?: string }
  if (!up.id) throw new Error(up.error ?? 'Could not hand the recording to the helper')

  const toSec = (beat: number) => rec.beat0 + beat * rec.spb
  // Every sung part's words, in the order they're sung; the helper lines them all up over the whole record.
  const jobs = (song.lyrics ?? []).map((words, formIdx) => ({ formIdx, lines: lineWords(words), seg: segments.find((x) => x.formIdx === formIdx) })).filter((j) => j.lines.length > 0)
  const body = {
    id: up.id,
    language,
    segments: jobs.map((j) => ({ start: j.seg ? toSec(j.seg.start) : 0, end: j.seg ? toSec(j.seg.start + j.seg.beats) : 0, text: j.lines.flat().join(' ') })),
  }
  const r = (await (await fetch('/api/align/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()) as {
    segments?: { words: Placed[] }[]
    seconds?: number
    error?: string
  }
  if (!r.segments) throw new Error(r.error ?? 'The helper gave no result')

  const lyricSecs: ((number | null)[][] | null)[] = (song.lyrics ?? []).map(() => null)
  let placed = 0
  let total = 0
  let sections = 0
  jobs.forEach((j, k) => {
    const found = r.segments![k]?.words ?? []
    const n = j.lines.flat().length
    const times = Array.from({ length: n }, (_, i) => (sure(found[i]) ? Math.round(found[i]!.start * 1000) / 1000 : null))
    const ok = times.filter((t) => t !== null).length
    total += n
    placed += ok
    const secs: (number | null)[][] = []
    let w = 0
    for (const line of j.lines) {
      secs.push(times.slice(w, w + line.length))
      w += line.length
    }
    lyricSecs[j.formIdx] = secs
    if (ok >= n * 0.4) sections++
  })
  return { lyricSecs, placed, total, sections, seconds: r.seconds ?? 0 }
}
