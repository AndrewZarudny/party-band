// Parses the compact lesson note strings ("3.5 h3.7 3.7^2*2 r [G5]") into timed items.
import type { SeqItem, Tech } from './types'

// [h|p|/] string.fret [^bend] [~] [P] [*len]
const NOTE_RE = /^([hp/]?)(\d)\.(\d{1,2})(?:\^(\d+))?(~?)(P?)(?:\*(\d*\.?\d+))?$/
// '-', 'r', 'x' or '[SYM]', each with an optional *len
const OTHER_RE = /^(-|r|x|\[([^\]]+)\])(?:\*(\d*\.?\d+))?$/

const PREFIX_TECH: Record<string, Tech> = { h: 'hammer', p: 'pull', '/': 'slide' }

function tokens(src: string): string[] {
  return src.split(/\s+/).filter((t) => t && t !== '|')
}

function bad(tok: string): Error {
  return new Error(`seq: bad token "${tok}"`)
}

function lenOf(raw: string | undefined, tok: string): number {
  if (raw === undefined) return 1
  const n = parseFloat(raw)
  if (!(n > 0)) throw bad(tok)
  return n
}

/** Items with beat positions; `-` gaps advance time but produce nothing. */
export function seq(src: string, step: number): SeqItem[] {
  const out: SeqItem[] = []
  let beat = 0
  for (const tok of tokens(src)) {
    const m = NOTE_RE.exec(tok)
    if (m) {
      const s = Number(m[2])
      if (s > 5) throw bad(tok)
      const len = lenOf(m[7], tok) * step
      const item: Extract<SeqItem, { k: 'note' }> = { k: 'note', beat, len, s, f: Number(m[3]) }
      let tech: Tech | undefined = PREFIX_TECH[m[1]]
      if (m[4] !== undefined) {
        tech = 'bend'
        item.bend = Number(m[4])
      } else if (!tech && m[5]) tech = 'vibrato'
      else if (!tech && m[6]) tech = 'pm'
      if (tech) item.tech = tech
      out.push(item)
      beat += len
      continue
    }
    const o = OTHER_RE.exec(tok)
    if (!o) throw bad(tok)
    const len = lenOf(o[3], tok) * step
    if (o[1] === 'r') out.push({ k: 'rest', beat, len })
    else if (o[1] === 'x') out.push({ k: 'mute', beat, len })
    else if (o[2] !== undefined) out.push({ k: 'chord', beat, len, symbol: o[2].trim() })
    beat += len
  }
  return out
}

/** Total length in beats, gaps included. */
export function seqBeats(src: string, step: number): number {
  let total = 0
  for (const tok of tokens(src)) {
    const m = NOTE_RE.exec(tok)
    if (m) {
      total += lenOf(m[7], tok) * step
      continue
    }
    const o = OTHER_RE.exec(tok)
    if (!o) throw bad(tok)
    total += lenOf(o[3], tok) * step
  }
  return total
}
