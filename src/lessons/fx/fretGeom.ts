// The geometry of components/Fretboard.tsx, mirrored so the lesson overlay lines up with the board under it.
// Keep in step with that file.

export const FB_W = 1100
export const FB_H = 210
export const FB_NUT_X = 62
const TOP = 26
const STRING_GAP = 30

export function fbFretX(f: number, maxFret: number) {
  const real = (1 - Math.pow(2, -f / 12)) / (1 - Math.pow(2, -maxFret / 12))
  const lin = f / maxFret
  return FB_NUT_X + (FB_W - FB_NUT_X - 14) * (0.55 * real + 0.45 * lin)
}

export function fbNoteX(f: number, maxFret: number) {
  return f === 0 ? FB_NUT_X - 22 : (fbFretX(f - 1, maxFret) + fbFretX(f, maxFret)) / 2
}

/** Width of the space for fret f, for a glow that fills it */
export function fbFretW(f: number, maxFret: number) {
  return f === 0 ? 30 : fbFretX(f, maxFret) - fbFretX(f - 1, maxFret)
}

export function fbStringY(s: number) {
  return TOP + (5 - s) * STRING_GAP
}
