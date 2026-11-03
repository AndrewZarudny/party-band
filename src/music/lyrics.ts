// Matching pasted lyrics to a song's form. The app never fetches or generates lyrics:
// the singer's words come from the band (pasted from their own songbook or lyrics source).

const KINDS = 'intro|verse|pre[\\s-]?chorus|post[\\s-]?chorus|chorus|refrain|hook|bridge|middle 8|breakdown|interlude|solo|outro|coda'
// A heading looks like a heading: any line in square brackets ("[Verse 2]", "[Guitar Solo]", "[Instrumental]"),
// "(Chorus)", or just a section name with an optional number and colon ("Chorus:", "Verse 2"). A lyric line that
// merely starts with one of these words is not a heading, and "(oh yeah)" ad-libs stay lyrics.
const PLAIN = new RegExp(`^\\s*(?:\\(\\s*(${KINDS})\\b[^)\\n]*\\)|(${KINDS})(?:\\s*\\d+)?\\s*:?)\\s*$`, 'i')
const KIND_IN = new RegExp(`\\b(${KINDS})\\b`, 'i')
/** The section a heading line names (or its text, for labels like "[Instrumental]"), else null. */
function headingKind(line: string): string | null {
  const bracket = /^\s*\[([^\]\n]+)\]\s*$/.exec(line)
  if (bracket) return KIND_IN.exec(bracket[1])?.[1] ?? bracket[1].trim()
  const m = PLAIN.exec(line)
  return m ? (m[1] ?? m[2]) : null
}

export function sectionKey(name: string): string {
  const k = name.toLowerCase().replace(/[^a-z]/g, '')
  if (k.startsWith('prechorus')) return 'prechorus'
  if (k.startsWith('postchorus')) return 'postchorus'
  if (k.startsWith('chorus') || k.startsWith('refrain') || k.startsWith('hook')) return 'chorus'
  if (k.startsWith('verse')) return 'verse'
  if (k.startsWith('bridge') || k.startsWith('middle')) return 'bridge'
  if (k.startsWith('outro') || k.startsWith('coda')) return 'outro'
  return k
}

/**
 * Splits pasted lyrics into blocks and assigns them to the song form, in order.
 * With headings ([Verse 1], Chorus:), each block goes to the next form entry of that kind; a chorus
 * written out once is reused for later choruses. Without headings, paragraphs fill the sung
 * sections (not solos or the intro) in order.
 */
export function matchLyrics(text: string, form: string[], soloSections: Set<string>): string[] {
  const lines = text.replace(/\r/g, '').split('\n')
  const blocks: { key: string | null; text: string }[] = []
  let cur: { key: string | null; lines: string[] } | null = null
  const flush = () => {
    if (cur && cur.lines.join('').trim()) blocks.push({ key: cur.key, text: cur.lines.join('\n').trim() })
  }
  const hasHeadings = lines.some((l) => headingKind(l) !== null)
  for (const line of lines) {
    if (hasHeadings && headingKind(line) !== null) {
      flush()
      cur = { key: sectionKey(headingKind(line)!), lines: [] }
    } else if (!hasHeadings && !line.trim()) {
      flush()
      cur = null
    } else {
      cur ??= { key: null, lines: [] }
      cur.lines.push(line)
    }
  }
  flush()

  const out: string[] = form.map(() => '')
  if (hasHeadings) {
    let from = 0
    for (const b of blocks) {
      const i = form.findIndex((name, j) => j >= from && sectionKey(name) === b.key)
      if (i < 0) continue
      out[i] = b.text
      from = i + 1
    }
    // Repeated sections without their own text (usually the chorus) reuse the last one.
    const last = new Map<string, string>()
    form.forEach((name, i) => {
      const k = sectionKey(name)
      if (out[i]) last.set(k, out[i])
      else if (last.has(k) && k === 'chorus') out[i] = last.get(k)!
    })
  } else {
    let b = 0
    form.forEach((name, i) => {
      if (b >= blocks.length || soloSections.has(name) || sectionKey(name) === 'intro') return
      out[i] = blocks[b++].text
    })
  }
  return out
}

/** The non-empty lines of a section's words. */
export const sungLines = (words: string | undefined) => (words ?? '').split('\n').filter((l) => l.trim())

/** Rough syllable count: vowel groups, at least one per line. */
const syllables = (line: string) => Math.max(1, (line.toLowerCase().match(/[aeiouyаеёиоуыэюя]+/g) ?? []).length)

export interface LyricLine {
  text: string
  start: number // song beat where the line starts
  end: number // song beat where it's sung to (the fill sweep)
  formIdx: number
  synced: boolean // timed from taps, a tab or a tab's vocal phrases (else spread over the section by guesswork)
  words?: number[] // song beat of each word (from a tab with words)
}

export interface LyricTiming {
  lyrics?: string[]
  lyricBeats?: (number[] | null)[]
  lyricWords?: (number[][] | null)[]
  vocalPhrases?: (number[] | null)[]
}

/** Fits n lines onto the sung phrases' starts: the shortest phrases merge, or the longest ones split. */
function linesOnPhrases(phrases: number[], n: number, length: number): number[] {
  const starts = [...phrases].sort((a, b) => a - b)
  while (starts.length > n) {
    let k = 1
    for (let i = 2; i < starts.length; i++) if (starts[i] - starts[i - 1] < starts[k] - starts[k - 1]) k = i
    starts.splice(k, 1)
  }
  while (starts.length < n) {
    let k = 0
    const span = (i: number) => (starts[i + 1] ?? length) - starts[i]
    for (let i = 1; i < starts.length; i++) if (span(i) > span(k)) k = i
    starts.splice(k + 1, 0, starts[k] + span(k) / 2)
  }
  return starts
}

/**
 * Every sung line of the song on the song's beat clock. Lines take their times from taps or a tab,
 * else from the tab's sung phrases, else they're spread over the section, half evenly and half by syllables.
 */
export function lyricTimeline(t: LyricTiming, segments: { start: number; beats: number; formIdx: number }[]): LyricLine[] {
  if (!t.lyrics?.some(Boolean)) return []
  const out: LyricLine[] = []
  t.lyrics.forEach((words, formIdx) => {
    const lines = sungLines(words)
    const seg = segments.find((x) => x.formIdx === formIdx)
    if (!lines.length || !seg) return
    const tapped = t.lyricBeats?.[formIdx]
    const phrases = t.vocalPhrases?.[formIdx]
    const starts = tapped && tapped.length === lines.length ? tapped : phrases?.length ? linesOnPhrases(phrases, lines.length, seg.beats) : null
    if (starts) {
      const wordBeats = tapped && tapped.length === lines.length ? t.lyricWords?.[formIdx] : null
      lines.forEach((text, i) => {
        const w = wordBeats?.[i]
        out.push({ text, start: seg.start + starts[i], end: 0, formIdx, synced: true, words: w && w.length === text.split(' ').length ? w.map((x) => seg.start + x) : undefined })
      })
      return
    }
    const syl = lines.map(syllables)
    const sylTotal = syl.reduce((a, b) => a + b, 0)
    let acc = 0
    lines.forEach((text, i) => {
      const start = seg.start + acc * seg.beats
      acc += 0.5 / lines.length + (0.5 * syl[i]) / sylTotal
      out.push({ text, start, end: seg.start + acc * seg.beats, formIdx, synced: false })
    })
  })
  out.sort((a, b) => a.start - b.start)
  // A timed line is sung until the next one starts, but not through a long instrumental gap
  // (with word timing: until a beat after its last word).
  out.forEach((l, i) => {
    if (!l.synced) return
    const next = out[i + 1]?.start ?? Infinity
    l.end = Math.min(next, l.words ? l.words[l.words.length - 1] + 1.5 : l.start + 12)
  })
  return out
}
