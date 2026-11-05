// What each instrument plays over a chord: guitar shapes, keyboard voicings, rhythm feels.
import type { Chord, FretPos } from './theory'
import { STANDARD_TUNING, pc } from './theory'

// ---- Guitar chord shapes ---------------------------------------------------

/** Frets low E → high E; -1 = don't play that string. */
export interface ChordShape {
  frets: number[]
}

type Family = 'maj' | 'm' | '7' | 'm7' | 'maj7' | 'sus2' | 'sus4' | 'dim' | 'm7b5' | 'dim7' | 'aug' | '5' | '6'

const FAMILY: Record<string, Family> = {
  '': 'maj', maj: 'maj', M: 'maj', add9: 'maj', '6': '6', '9': '7', '11': '7', '13': '7', '7': '7',
  m: 'm', min: 'm', '-': 'm', madd9: 'm', m6: 'm', m7: 'm7', min7: 'm7', m9: 'm7', mmaj7: 'm',
  maj7: 'maj7', M7: 'maj7', maj9: 'maj7', sus2: 'sus2', sus4: 'sus4', sus: 'sus4', '7sus4': 'sus4',
  dim: 'dim', '°': 'dim', dim7: 'dim7', '°7': 'dim7', m7b5: 'm7b5', 'ø': 'm7b5', 'ø7': 'm7b5', aug: 'aug', '+': 'aug', '5': '5',
}

const X = -1
// Common open-position chords, keyed "rootPc:family".
const OPEN: Record<string, number[]> = {
  '0:maj': [X, 3, 2, 0, 1, 0], '0:maj7': [X, 3, 2, 0, 0, 0], '0:7': [X, 3, 2, 3, 1, 0],
  '2:maj': [X, X, 0, 2, 3, 2], '2:m': [X, X, 0, 2, 3, 1], '2:7': [X, X, 0, 2, 1, 2], '2:m7': [X, X, 0, 2, 1, 1],
  '2:maj7': [X, X, 0, 2, 2, 2], '2:sus2': [X, X, 0, 2, 3, 0], '2:sus4': [X, X, 0, 2, 3, 3],
  '4:maj': [0, 2, 2, 1, 0, 0], '4:m': [0, 2, 2, 0, 0, 0], '4:7': [0, 2, 0, 1, 0, 0], '4:m7': [0, 2, 0, 0, 0, 0],
  '4:sus4': [0, 2, 2, 2, 0, 0], '4:5': [0, 2, 2, X, X, X],
  '5:maj7': [X, X, 3, 2, 1, 0],
  '7:maj': [3, 2, 0, 0, 0, 3], '7:7': [3, 2, 0, 0, 0, 1], '7:maj7': [3, 2, 0, 0, 0, 2],
  '9:maj': [X, 0, 2, 2, 2, 0], '9:m': [X, 0, 2, 2, 1, 0], '9:7': [X, 0, 2, 0, 2, 0], '9:m7': [X, 0, 2, 0, 1, 0],
  '9:maj7': [X, 0, 2, 1, 2, 0], '9:sus2': [X, 0, 2, 2, 0, 0], '9:sus4': [X, 0, 2, 2, 3, 0], '9:5': [X, 0, 2, 2, X, X],
  '11:7': [X, 2, 1, 2, 0, 2],
}
// Movable barre shapes, as offsets from the barre fret.
const E_FORM: Partial<Record<Family, number[]>> = {
  maj: [0, 2, 2, 1, 0, 0], m: [0, 2, 2, 0, 0, 0], '7': [0, 2, 0, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0],
  maj7: [0, X, 1, 1, 0, X], sus4: [0, 2, 2, 2, 0, 0], '5': [0, 2, 2, X, X, X],
}
const A_FORM: Record<Family, number[]> = {
  maj: [X, 0, 2, 2, 2, 0], m: [X, 0, 2, 2, 1, 0], '7': [X, 0, 2, 0, 2, 0], m7: [X, 0, 2, 0, 1, 0],
  maj7: [X, 0, 2, 1, 2, 0], sus2: [X, 0, 2, 2, 0, 0], sus4: [X, 0, 2, 2, 3, 0], dim: [X, 0, 1, 2, 1, X],
  m7b5: [X, 0, 1, 0, 1, X], dim7: [X, 0, 1, 2, 1, 2], aug: [X, 0, 3, 2, 2, 1], '5': [X, 0, 2, 2, X, X], '6': [X, 0, 2, 2, 2, 2],
}

const shift = (offs: number[], base: number) => offs.map((o) => (o < 0 ? X : o + base))

/** An easy guitar shape for the chord: open position if there is one, else a barre chord. */
export function guitarShape(chord: Chord): ChordShape {
  const fam = FAMILY[chord.quality] ?? 'maj'
  const open = OPEN[`${chord.root}:${fam}`]
  if (open) return { frets: open }
  const eFret = pc(chord.root - 4)
  const aFret = pc(chord.root - 9)
  const eShape = E_FORM[fam]
  const useE = eShape && eFret > 0 && (eFret <= aFret || aFret === 0)
  if (useE) return { frets: shift(eShape, eFret) }
  return { frets: shift(A_FORM[fam], aFret === 0 ? 12 : aFret) }
}

/** Root–3rd–5th on the G, B and high E strings, close to `nearFret`, for a lighter rhythm part. */
export function topTriad(chord: Chord, nearFret: number): FretPos[] {
  const need = chord.tones.slice(0, 3)
  let best: FretPos[] = []
  let bestScore = Infinity
  for (let a = 0; a <= 15; a++)
    for (let b = 0; b <= 15; b++)
      for (let c = 0; c <= 15; c++) {
        const frets = [a, b, c]
        const span = Math.max(...frets) - Math.min(...frets)
        if (span > 3) continue
        const notes = frets.map((f, i) => STANDARD_TUNING[3 + i] + f)
        const pcs = new Set(notes.map(pc))
        if (!need.every((n) => pcs.has(n)) || ![...pcs].every((p) => need.includes(p))) continue
        const score = Math.abs((a + b + c) / 3 - nearFret) + span * 0.3
        if (score < bestScore) {
          bestScore = score
          best = frets.map((f, i) => ({ string: 3 + i, fret: f, midi: notes[i] }))
        }
      }
  return best
}

// ---- Keyboard voicings -----------------------------------------------------

export interface KeysVoicing {
  right: number[] // MIDI notes for the right hand
  left: number // bass note for the left hand
}

/** Right-hand chord close to the previous one (smooth voice leading); left hand plays the root. */
export function keysVoicing(chord: Chord, prev: number[] | null): KeysVoicing {
  const tones = chord.tones.slice(0, 4)
  const candidates: number[][] = []
  for (let inv = 0; inv < tones.length; inv++) {
    const order = [...tones.slice(inv), ...tones.slice(0, inv)]
    for (const start of [52, 55, 58, 61]) {
      const notes: number[] = []
      let n = start + pc(order[0] - start)
      for (const t of order) {
        while (pc(n) !== t) n++
        notes.push(n)
        n++
      }
      if (notes[0] >= 52 && notes[notes.length - 1] <= 76) candidates.push(notes)
    }
  }
  const cost = (c: number[]) =>
    prev && prev.length ? c.reduce((s, n) => s + Math.min(...prev.map((p) => Math.abs(p - n))), 0) : Math.abs(c[0] - 60) + Math.abs(c[c.length - 1] - 67)
  const right = candidates.reduce((a, b) => (cost(b) < cost(a) ? b : a), candidates[0] ?? [60])
  return { right, left: 36 + chord.root }
}

// ---- Feels -----------------------------------------------------------------

/** 8 slots per bar of 4/4 ("1 & 2 & 3 & 4 &"). */
export interface Feel {
  label: string
  swing: boolean
  strum: string // D = down, U = up, x = muted scratch, _ = rest
  guitarTip: string
  keys: string // X = hit, - = hold, _ = rest
  keysTip: string
  bass: string // R root, 3 third, 5 fifth, 6 sixth, 8 octave, _ rest, - hold
  bassTip: string
  drums: { hat: string; snare: string; kick: string }
  leadTip: string
}

export const FEELS: Record<string, Feel> = {
  pop: {
    label: 'Pop / rock',
    swing: false,
    strum: 'D_DU_UDU',
    guitarTip: 'Steady down-down-up, up-down-up. Keep your hand moving even when you miss strings.',
    keys: 'X---X-X-',
    keysTip: 'Hold the chord, re-hit on beat 3. Left hand plays the root.',
    bass: 'RRRRRRRR',
    bassTip: 'Driving root eighth notes.',
    drums: { hat: 'xxxxxxxx', snare: '__x___x_', kick: 'x___x_x_' },
    leadTip: 'Short phrases, leave space. Land on a chord tone when the chord changes.',
  },
  ballad: {
    label: 'Ballad',
    swing: false,
    strum: 'D___D_DU',
    guitarTip: 'Let each chord ring. Or pick the notes one at a time (arpeggio).',
    keys: 'X-------',
    keysTip: 'Hold whole notes, soft. Try a gentle broken chord with the right hand.',
    bass: 'R---5---',
    bassTip: 'Long notes: root, then fifth.',
    drums: { hat: 'x_x_x_x_', snare: '____x___', kick: 'x_______' },
    leadTip: 'Slow, singing notes. Bend into chord tones, use lots of space.',
  },
  blues: {
    label: 'Blues shuffle',
    swing: true,
    strum: 'D_D_D_D_',
    guitarTip: 'Shuffle feel (long-short). Rock between the 5th and 6th on the two low strings under the root.',
    keys: '__X___X_',
    keysTip: 'Comp short chords on beats 2 and 4, shuffle feel.',
    bass: 'R_3_5_6_',
    bassTip: 'Walk up root–3rd–5th–6th each bar.',
    drums: { hat: 'x_x_x_x_', snare: '__x___x_', kick: 'x___x___' },
    leadTip: 'Minor pentatonic/blues scale. Repeat a lick, then answer it.',
  },
  funk: {
    label: 'Funk',
    swing: false,
    strum: 'D_xU_UxU',
    guitarTip: 'Tight, short chords on the top strings; mute (x) with the fretting hand between hits.',
    keys: '_X_X__X_',
    keysTip: 'Short stabs on the off-beats. Less is more.',
    bass: 'R__8_R_5',
    bassTip: 'Root on 1, then syncopated octaves and fifths.',
    drums: { hat: 'xxxxxxxx', snare: '__x___x_', kick: 'x__x__x_' },
    leadTip: 'Rhythmic, percussive riffs. Repeat short motifs.',
  },
  reggae: {
    label: 'Reggae',
    swing: false,
    strum: '__D___D_',
    guitarTip: 'Short "chop" on beats 2 and 4 only. Mute right after.',
    keys: '__X___X_',
    keysTip: 'Chords on 2 and 4, same as the guitar chop.',
    bass: 'R__5R___',
    bassTip: 'Round, laid-back root and fifth. Leave beat 1 space sometimes.',
    drums: { hat: 'x_x_x_x_', snare: '____x___', kick: '____x___' },
    leadTip: 'Sparse melodic lines between the chops.',
  },
  // 12/8 is approximated as swung 8ths in 4/4: the hat plays the first and third triplet of each beat
  // (the middle one isn't played), because the band engine has 8 slots per bar.
  slowblues: {
    label: 'Slow blues',
    swing: true,
    strum: 'D___D___',
    guitarTip: 'Slow 12/8 feel: count 1-2-3, 2-2-3. Let the chords ring and leave space.',
    keys: 'X---X---',
    keysTip: 'Hold the chord through each half bar, soft.',
    bass: 'R_5_8_5_',
    bassTip: 'Root, fifth, octave, fifth: slow and round.',
    drums: { hat: 'xxxxxxxx', snare: '__x___x_', kick: 'x___x___' },
    leadTip: 'Fewer notes, more feeling. Bend into chord tones and hold them.',
  },
  // A minor blues: no major 3rd or 6th in the bass walk, so it never clashes with the minor box.
  minorblues: {
    label: 'Minor blues',
    swing: true,
    strum: 'D_D_D_D_',
    guitarTip: 'Shuffle feel (long-short). Short minor chords, or just the root and fifth.',
    keys: '__X___X_',
    keysTip: 'Comp short chords on beats 2 and 4, shuffle feel.',
    bass: 'R_5_8_5_',
    bassTip: 'Root, fifth, octave, fifth each bar.',
    drums: { hat: 'x_x_x_x_', snare: '__x___x_', kick: 'x___x___' },
    leadTip: 'Minor pentatonic: the same box fits every chord. Land on the root or the minor 3rd.',
  },
}

export const COUNTS = ['1', '&', '2', '&', '3', '&', '4', '&']

/** Bass pattern symbols → MIDI notes for the chord (in the E1–E3 range). */
export function bassNotes(pattern: string, chord: Chord): (number | null)[] {
  const root = 28 + pc(chord.root - 4) // E1..D#2
  const third = chord.tones.find((t) => pc(t - chord.root) === 3 || pc(t - chord.root) === 4)
  const fifth = chord.tones.find((t) => pc(t - chord.root) === 7) ?? pc(chord.root + 7)
  const map: Record<string, number> = {
    R: root,
    '3': root + pc((third ?? chord.root + 4) - chord.root),
    '5': root + pc(fifth - chord.root),
    '6': root + 9,
    '8': root + 12,
  }
  return [...pattern].map((c) => map[c] ?? null)
}
