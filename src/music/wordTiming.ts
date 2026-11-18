// When each word is sung, in seconds of the song's recording, is the one source of truth for the words'
// timing. Everything else follows from it on the recording's beat grid: the karaoke (line and word beats),
// the section lengths (each sung part starts where its first word is sung), and the chords written over the words.
//
// The times are kept per form entry, per sung line, per word (null: not known, e.g. the aligner wasn't sure).
// When the words are edited or reloaded, the times move with the words they belong to (matched by the words
// themselves, in order), so a sync survives a new line split or a corrected word.
import type { Segment, SongSetup } from './songForm'
import { sungLines } from './lyrics'

export type LineSecs = (number | null)[] // one line: each word's start in seconds (null: unknown)
export type EntrySecs = LineSecs[] | null // one form entry: its sung lines (null: not synced)

/** The words of every sung line of a form entry, as the timing counts them. */
export const lineWords = (words: string | undefined) => sungLines(words).map((l) => l.trim().split(/\s+/))

const norm = (w: string) =>
  w
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '')

interface Tok {
  w: string
  f: number
  line: number
  i: number
}

function tokens(lyrics: string[] | undefined): Tok[] {
  const out: Tok[] = []
  ;(lyrics ?? []).forEach((words, f) =>
    lineWords(words).forEach((ws, line) =>
      ws.forEach((w, i) => {
        const n = norm(w)
        if (n) out.push({ w: n, f, line, i })
      }),
    ),
  )
  return out
}

/** The timing for new words, taken from the old words they match (longest common run of words, in order). */
export function remapSecs(oldLyrics: string[] | undefined, oldSecs: EntrySecs[] | undefined, newLyrics: string[] | undefined): EntrySecs[] {
  const out: EntrySecs[] = (newLyrics ?? []).map((words) => {
    const ls = lineWords(words)
    return ls.length ? ls.map((ws) => ws.map(() => null)) : null
  })
  if (!oldSecs?.some(Boolean)) return out.map(() => null)
  const a = tokens(oldLyrics).filter((t) => typeof oldSecs[t.f]?.[t.line]?.[t.i] === 'number')
  const b = tokens(newLyrics)
  // LCS table (a few hundred words each way).
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i].w === b[j].w ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i].w === b[j].w) {
      const t = b[j]
      const line = out[t.f]?.[t.line]
      if (line) line[t.i] = oldSecs[a[i].f]![a[i].line]![a[i].i] as number
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  return out.map((e) => (e && e.some((l) => l.some((x) => x !== null)) ? e : null))
}

/**
 * A form entry's times with the unknown words filled in between the known ones (or 0.3 s apart at the ends),
 * never earlier than the word before. Null when too few of its words are known to trust.
 */
export function filledSecs(e: EntrySecs): number[][] | null {
  if (!e) return null
  const flat = e.flat()
  const known = flat.map((t, k) => (t === null ? null : { k, t })).filter((x): x is { k: number; t: number } => !!x)
  if (!known.length || known.length < flat.length * 0.4) return null
  const filled = flat.map((t, k) => {
    if (t !== null) return t
    const prev = [...known].reverse().find((x) => x.k < k)
    const next = known.find((x) => x.k > k)
    if (prev && next) return prev.t + ((next.t - prev.t) * (k - prev.k)) / (next.k - prev.k)
    if (prev) return prev.t + 0.3 * (k - prev.k)
    return next!.t - 0.3 * (next!.k - k)
  })
  for (let k = 1; k < filled.length; k++) filled[k] = Math.max(filled[k], filled[k - 1])
  const out: number[][] = []
  let k = 0
  for (const l of e) {
    out.push(filled.slice(k, k + l.length))
    k += l.length
  }
  return out
}

/** The recording's beat grid: where the song's beat 0 is in the file, and seconds per beat. */
export interface Grid {
  beat0: number
  spb: number
}

/** Line and word beats (from each section's start) from the times in seconds; entries without times keep `fallback`. */
export function beatsFromSecs(lyricSecs: EntrySecs[] | undefined, grid: Grid, segments: Segment[], fallback: { lyricBeats?: (number[] | null)[]; lyricWords?: (number[][] | null)[] }) {
  const lyricBeats = [...(fallback.lyricBeats ?? [])]
  const lyricWords = [...(fallback.lyricWords ?? [])]
  lyricSecs?.forEach((e, f) => {
    const filled = filledSecs(e)
    const seg = segments.find((x) => x.formIdx === f)
    if (!filled || !seg) return
    lyricWords[f] = filled.map((l) => l.map((t) => Math.round(((t - grid.beat0) / grid.spb - seg.start) * 100) / 100))
    lyricBeats[f] = lyricWords[f]!.map((l) => l[0])
  })
  return { lyricBeats, lyricWords }
}

/** Shares `room` bars among parts by their usual lengths (each at least a bar; the first at least `minFirst`). */
function share(weights: number[], room: number, minFirst = 1): number[] {
  const n = weights.length
  room = Math.max(room, n - 1 + minFirst)
  const w = weights.map((x) => Math.max(1, x))
  const sum = w.reduce((a, b) => a + b, 0)
  const first = Math.min(room - (n - 1), Math.max(minFirst, Math.round((w[0] * room) / sum)))
  const out = [first]
  const restRoom = room - first
  const restSum = sum - w[0]
  let acc = 0
  let given = 0
  for (let k = 1; k < n; k++) {
    acc += w[k]
    const upto = k === n - 1 ? restRoom : Math.round((acc * restRoom) / restSum)
    out.push(Math.max(1, upto - given))
    given += out[k]
  }
  return out
}

/**
 * Each form entry's length in bars, from where its words are sung on the record: a sung part starts on the
 * bar of its first word (a word in the last beat of a bar is a pickup into the next one) and lasts at least
 * to its last word. The bars up to the next sung part are shared with the parts nobody sings (intro, solo,
 * outro) by their usual lengths (`usual`, in bars); the last part runs to the end of the record.
 */
export function sectionsFromSecs(form: string[], lyricSecs: EntrySecs[] | undefined, grid: Grid, recordSeconds: number, usual: number[] = []): number[] | null {
  const barOf = (t: number) => (t - grid.beat0) / (grid.spb * 4)
  const total = Math.max(1, Math.floor(barOf(recordSeconds) + 0.25))
  const n = form.length
  const sung = form.map((_, f) => {
    const s = filledSecs(lyricSecs?.[f] ?? null)
    if (!s?.length) return null
    const flat = s.flat()
    return { first: barOf(flat[0]), last: barOf(flat[flat.length - 1]) }
  })
  if (!sung.some(Boolean)) return null
  const start: (number | null)[] = sung.map((x) => (x ? Math.max(0, Math.floor(x.first + 0.25)) : null))
  let prev = -1
  for (let f = 0; f < n; f++) {
    if (start[f] === null) continue
    if (start[f]! <= prev) start[f] = prev + 1
    prev = start[f]!
  }
  const anchors = start.map((x, f) => (x === null ? -1 : f)).filter((f) => f >= 0)
  const len = new Array<number>(n).fill(1)
  const w = (f: number) => usual[f] ?? 4
  const put = (from: number, to: number, room: number, minFirst = 1) => {
    const got = share(
      Array.from({ length: to - from }, (_, k) => w(from + k)),
      room,
      minFirst,
    )
    got.forEach((x, k) => (len[from + k] = x))
  }
  // Before the first sung part (the intro).
  if (anchors[0] > 0) put(0, anchors[0], start[anchors[0]]!)
  else start[0] = 0
  anchors.forEach((a, k) => {
    const next = anchors[k + 1]
    const end = next === undefined ? Math.max(total, start[a]! + n - a) : start[next]!
    const minA = Math.max(1, Math.ceil(sung[a]!.last + 0.25) - start[a]!)
    put(a, next ?? n, end - start[a]!, minA)
  })
  return len
}

/** What the record's timing gives a song: section lengths fitted to the singing (when asked for), and the words' beats. */
export function applySecs(song: SongSetup, grid: Grid, recordSeconds: number, segmentsOf: (s: SongSetup) => Segment[]): SongSetup {
  if (!song.lyricSecs?.some(Boolean)) return song
  let next = song
  if (song.fitToWords) {
    // Each part's usual length: as measured before, else its pattern played its number of times.
    const usual = song.form.map((name, f) => {
      const sec = song.sections.find((x) => x.name === name)
      const pattern = sec ? sec.chords.reduce((a, c) => a + c.beats, 0) * Math.max(1, sec.repeat ?? 1) : 16
      return song.formBars?.[f] ?? Math.max(1, Math.round(pattern / 4))
    })
    const bars = sectionsFromSecs(song.form, song.lyricSecs, grid, recordSeconds, usual)
    if (bars) next = { ...next, formBars: bars }
  }
  return { ...next, ...beatsFromSecs(next.lyricSecs, grid, segmentsOf(next), { lyricBeats: next.lyricBeats, lyricWords: next.lyricWords }) }
}
