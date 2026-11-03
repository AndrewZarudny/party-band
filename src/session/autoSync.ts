// Auto-sync: the local helper finds when each pasted word is sung on the user's recording; this turns
// those times into the song's beats (line starts and word starts, per section).
import type { Segment, SongSetup } from '../music/songForm'
import { sungLines } from '../music/lyrics'

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
  lyricBeats: (number[] | null)[]
  lyricWords: (number[][] | null)[]
  lyricSecs: (number[][] | null)[] // word starts in seconds of the recording
  placed: number
  total: number
  sections: number
  seconds: number
}

type Placed = { start: number } | null

/** Fills in words the aligner couldn't place, between their placed neighbours. */
function fillGaps(times: (number | null)[], from: number, to: number): number[] {
  const known = times.map((t, i) => (t === null ? null : { i, t })).filter((x): x is { i: number; t: number } => !!x)
  return times.map((t, i) => {
    if (t !== null) return t
    const prev = [...known].reverse().find((k) => k.i < i)
    const next = known.find((k) => k.i > i)
    const a = prev ?? { i: -1, t: from }
    const b = next ?? { i: times.length, t: to }
    return a.t + ((b.t - a.t) * (i - a.i)) / (b.i - a.i)
  })
}

export async function autoSync(song: SongSetup, segments: Segment[], rec: Recording, language: string): Promise<AutoSyncResult> {
  const up = (await (await fetch(`/api/align/audio?name=${encodeURIComponent(rec.fileName)}`, { method: 'POST', body: rec.data })).json()) as { id?: string; error?: string }
  if (!up.id) throw new Error(up.error ?? 'Could not hand the recording to the helper')

  const toSec = (beat: number) => rec.beat0 + beat * rec.spb
  // One window per sung section, a little wider than the section (singers come in early or run over).
  const jobs = (song.lyrics ?? [])
    .map((words, formIdx) => ({ formIdx, lines: sungLines(words).map((l) => l.trim().split(/\s+/)), seg: segments.find((x) => x.formIdx === formIdx) }))
    .filter((j): j is typeof j & { seg: Segment } => j.lines.length > 0 && !!j.seg)
  const body = {
    id: up.id,
    language,
    segments: jobs.map((j) => ({ start: toSec(j.seg.start - 2) - 0.5, end: toSec(j.seg.start + j.seg.beats + 1) + 0.5, text: j.lines.flat().join(' ') })),
  }
  const r = (await (await fetch('/api/align/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()) as {
    segments?: { words: Placed[] }[]
    seconds?: number
    error?: string
  }
  if (!r.segments) throw new Error(r.error ?? 'The helper gave no result')

  const lyricBeats: (number[] | null)[] = [...(song.lyricBeats ?? [])]
  const lyricWords: (number[][] | null)[] = [...(song.lyricWords ?? [])]
  const lyricSecs: (number[][] | null)[] = [...(song.lyricSecs ?? [])]
  let placed = 0
  let total = 0
  let sections = 0
  jobs.forEach((j, k) => {
    const found = r.segments![k]?.words ?? []
    const n = j.lines.flat().length
    const ok = found.filter(Boolean).length
    total += n
    placed += ok
    // A section where most words weren't found keeps the timing it had.
    if (ok < n * 0.4) return
    const from = j.seg.start
    const beats = fillGaps(
      found.slice(0, n).map((w) => (w ? (w.start - rec.beat0) / rec.spb : null)),
      from,
      from + j.seg.beats,
    )
    // Words in order: never earlier than the word before.
    for (let i = 1; i < beats.length; i++) beats[i] = Math.max(beats[i], beats[i - 1])
    const perLine: number[][] = []
    const secs: number[][] = []
    let w = 0
    for (const line of j.lines) {
      perLine.push(beats.slice(w, w + line.length).map((b) => Math.round((b - from) * 100) / 100))
      secs.push(beats.slice(w, w + line.length).map((b) => Math.round((rec.beat0 + b * rec.spb) * 1000) / 1000))
      w += line.length
    }
    lyricSecs[j.formIdx] = secs
    lyricBeats[j.formIdx] = perLine.map((l) => l[0])
    lyricWords[j.formIdx] = perLine
    sections++
  })
  return { lyricBeats, lyricWords, lyricSecs, placed, total, sections, seconds: r.seconds ?? 0 }
}
