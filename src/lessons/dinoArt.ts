// Pebble the dino: palette, stage names and the shapes Dino.tsx draws. Data and small geometry helpers only.
// Everything is in a 120 × 120 viewBox, the dino faces right and stands on y ≈ 107.

import type { Cosmetic } from './types'

// Tweed amp palette: sage-green hide, tweed-cream belly, gold pick plates (matches the app's tokens).
export const DINO_COLORS = {
  body: '#93b46a',
  outline: '#55702f',
  spot: '#84a65c',
  belly: '#efe3cc',
  plate: '#d9a441',
  plateShade: '#a5772a',
  plateHi: '#efc673',
  plateTip: '#f6dfa8',
  eye: '#fff8ea',
  pupil: '#1a1410',
  egg: '#efe3cc',
  eggLine: '#a8936b', // deep enough to outline the cream egg on the light theme's pale disc too
  eggWindow: '#e2d3b3',
  crack: '#4a3a2c',
  shadow: '#000',
  sweat: '#84c9c6',
  sparkle: '#84c9c6',
  mouth: '#3a1d16',
  tongue: '#de6f56',
  neck: '#a39a8c',
  box: '#33281f',
  boxLine: '#4a3a2c',
  shades: '#1a1410',
  zz: '#a8977c',
}

export const STAGE_NAMES = ['Egg', 'Hatchling', 'Nibbler', 'Stomper', 'Spikeback', 'Scale-Runner', 'Crestsinger', 'Echo-Roarer', 'Jam Titan']

/** A guitar-pick plate of size s centred at (x, y), point up. */
export function pickPath(x: number, y: number, s: number): string {
  const r = (n: number) => Math.round(n * 100) / 100
  return `M${r(x - s)},${r(y)} Q${r(x)},${r(y - 2.2 * s)} ${r(x + s)},${r(y)} Q${r(x)},${r(y + 0.5 * s)} ${r(x - s)},${r(y)} Z`
}

export type Shape =
  | { t: 'e'; cx: number; cy: number; rx: number; ry: number; rot?: number }
  | { t: 'c'; cx: number; cy: number; r: number }
  | { t: 'r'; x: number; y: number; w: number; h: number; rx: number }
  | { t: 'p'; d: string }

export interface Plate {
  x: number
  y: number
  s: number
  rot: number // degrees, 0 = point up
}

export interface Eye {
  cx: number
  cy: number
  r: number
  sq: number // vertical squash, 1 = round
}

export interface Look {
  stage: number
  tail: Shape[]
  legsBack: Shape[]
  body: Shape[]
  belly: Shape[]
  spots: Shape[]
  legsFront: Shape[]
  toes: string[] // cream toe or claw triangles
  arms: Shape[]
  head: Shape[]
  eyes: Eye[]
  cheeks: Shape[]
  mouth: { x: number; y: number; w: number } // anchor of the mouth, w = half width
  roundMouth: boolean // the hatchling's tiny "o"
  nostril: { x: number; y: number } | null
  plates: Plate[]
  crest: Plate[]
  necklace: { d: string; pick: Plate } | null
  headband: { d: string; tails: string[] } | null
  guitar: { x: number; y: number; rot: number } | null
  stageBox: Shape | null
  cape: string | null
  aura: boolean
  /** where props sit: head centre and radius, the neck point */
  hx: number
  hy: number
  hr: number
  neck: { x: number; y: number }
  lean: number
}

interface Ell {
  cx: number
  cy: number
  rx: number
  ry: number
}

/** A plate sitting on an ellipse edge at angle deg (0 = right, 270 = up), pointing outward. */
function edgePlate(e: Ell, deg: number, s: number): Plate {
  const a = (deg * Math.PI) / 180
  const nx = Math.cos(a) / e.rx
  const ny = Math.sin(a) / e.ry
  return {
    x: e.cx + (e.rx - s * 0.15) * Math.cos(a),
    y: e.cy + (e.ry - s * 0.15) * Math.sin(a),
    s,
    rot: (Math.atan2(ny, nx) * 180) / Math.PI + 90,
  }
}

const ell = (e: Ell, rot?: number): Shape => ({ t: 'e', ...e, rot })
const circ = (cx: number, cy: number, r: number): Shape => ({ t: 'c', cx, cy, r })
const rect = (x: number, y: number, w: number, h: number, rx: number): Shape => ({ t: 'r', x, y, w, h, rx })

/** Three small triangles along the front of a foot. */
function footTips(x: number, w: number, bottom: number, claw: boolean): string[] {
  const out: string[] = []
  const n = 3
  const tw = claw ? 3 : 3.4
  for (let i = 0; i < n; i++) {
    const cx = x + w * (0.42 + i * 0.22)
    if (claw) out.push(`M${cx - tw / 2},${bottom - 0.6} L${cx + tw / 2 + 1.2},${bottom - 0.6} L${cx + 0.4},${bottom - 4.4} Z`)
    else out.push(`M${cx - tw / 2},${bottom - 0.4} L${cx + tw / 2},${bottom - 0.4} L${cx},${bottom - 3.6} Z`)
  }
  return out
}

interface Plan {
  body: Ell
  head: { cx: number; cy: number; r: number }
  snout: Ell | null
  belly: Ell
  back: [number, number, number, number] // x, y, w, h
  front: [number, number, number, number]
  tail: string
  arm: { cx: number; cy: number; rx: number; ry: number; rot: number }[]
  plates: [number, number, 'body' | 'head'][] // angle, size, on
  eyeR: number
  sq: number
  feet: 'plain' | 'toes' | 'claws'
  lean: number
}

// Hand-placed per stage. Babies: big round heads, small bodies. Adults: smaller head, snout, longer tail.
const PLANS: Record<number, Plan> = {
  2: {
    body: { cx: 58, cy: 79, rx: 20, ry: 22 },
    head: { cx: 66, cy: 46, r: 22 },
    snout: null,
    belly: { cx: 64.5, cy: 84, rx: 11, ry: 14 },
    back: [44, 91, 11, 16],
    front: [59, 92, 11, 15],
    tail: 'M44,84 C36,86 30,86 25,90 C30,95 39,97 48,96 Z',
    arm: [{ cx: 74.5, cy: 80, rx: 5.5, ry: 3.2, rot: 38 }],
    plates: [
      [190, 4, 'body'],
      [216, 5, 'body'],
      [206, 5, 'head'],
      [236, 4.4, 'head'],
    ],
    eyeR: 5.6,
    sq: 1,
    feet: 'plain',
    lean: 0,
  },
  3: {
    body: { cx: 58, cy: 77, rx: 22, ry: 24 },
    head: { cx: 68, cy: 44, r: 21 },
    snout: null,
    belly: { cx: 65.5, cy: 82, rx: 12, ry: 16 },
    back: [42, 90, 14, 17],
    front: [59, 91, 14, 16],
    tail: 'M42,84 C32,87 24,88 18,93 C25,98 36,99 47,97 Z',
    arm: [{ cx: 77, cy: 78, rx: 6, ry: 3.5, rot: 34 }],
    plates: [
      [186, 4, 'body'],
      [207, 5, 'body'],
      [228, 5.6, 'body'],
      [212, 5, 'head'],
    ],
    eyeR: 5.2,
    sq: 1,
    feet: 'toes',
    lean: 0,
  },
  4: {
    body: { cx: 57, cy: 75, rx: 22, ry: 25 },
    head: { cx: 69, cy: 39, r: 19 },
    snout: { cx: 83, cy: 44, rx: 11, ry: 8.5 },
    belly: { cx: 64.5, cy: 81, rx: 12, ry: 17 },
    back: [41, 89, 14, 18],
    front: [58, 90, 14, 17],
    tail: 'M41,82 C29,86 18,86 9,92 C17,99 32,100 46,96 Z',
    arm: [{ cx: 77, cy: 75, rx: 6.5, ry: 3.6, rot: 32 }],
    plates: [
      [178, 3.5, 'body'],
      [196, 4.3, 'body'],
      [214, 5.1, 'body'],
      [232, 6, 'body'],
      [250, 6.8, 'body'],
    ],
    eyeR: 4.8,
    sq: 0.84,
    feet: 'toes',
    lean: 0,
  },
  5: {
    body: { cx: 56, cy: 73, rx: 21, ry: 25 },
    head: { cx: 72, cy: 36, r: 18 },
    snout: { cx: 86, cy: 41, rx: 11, ry: 8 },
    belly: { cx: 63, cy: 79, rx: 11, ry: 17 },
    back: [40, 86, 15, 21],
    front: [57, 87, 15, 20],
    tail: 'M42,74 C30,66 16,60 5,64 C15,69 26,79 32,88 C36,93 42,95 48,93 Z',
    arm: [{ cx: 75, cy: 73, rx: 6.5, ry: 3.8, rot: 30 }],
    plates: [
      [176, 3.5, 'body'],
      [192, 4.2, 'body'],
      [208, 5, 'body'],
      [224, 5.6, 'body'],
      [240, 6.2, 'body'],
      [256, 6.6, 'body'],
    ],
    eyeR: 4.6,
    sq: 0.82,
    feet: 'claws',
    lean: 4,
  },
}

/** Builds what Dino.tsx draws for a stage of 2–8. Stages 0 and 1 are drawn directly by Dino.tsx. */
export function lookFor(stage: number, cosmetics: Cosmetic[]): Look {
  const s = Math.max(2, Math.min(8, stage))
  const plan = PLANS[Math.min(s, 5)]
  const { body, head, snout, belly } = plan
  const guitarStage = s >= 7
  const front = guitarStage ? ([62, 81, 15, 15] as const) : plan.front
  const back = plan.back
  const hx = head.cx
  const hy = head.cy
  const hr = head.r

  const plates = plan.plates.map(([deg, size, on]) => edgePlate(on === 'body' ? body : { cx: hx, cy: hy, rx: hr, ry: hr }, deg, size))

  const near: Eye = snout ? { cx: hx + 1, cy: hy - 4, r: plan.eyeR, sq: plan.sq } : { cx: hx + 2, cy: hy - 2, r: plan.eyeR, sq: plan.sq }
  const far: Eye = snout
    ? { cx: hx + 11.5, cy: hy - 5, r: plan.eyeR * 0.76, sq: plan.sq }
    : { cx: hx + 14.5, cy: hy - 3, r: plan.eyeR * 0.78, sq: plan.sq }

  const mouth = snout ? { x: snout.cx + 1, y: snout.cy + snout.ry * 0.45, w: 7 } : { x: hx + 11, y: hy + 10, w: 5 }

  const spots: Shape[] = [
    circ(body.cx - body.rx * 0.55, body.cy - body.ry * 0.35, 2.4),
    circ(body.cx - body.rx * 0.72, body.cy + body.ry * 0.05, 1.7),
    circ(body.cx - body.rx * 0.35, body.cy - body.ry * 0.62, 1.5),
  ]

  const legShape = (l: readonly [number, number, number, number]) => rect(l[0], l[1], l[2], l[3], Math.min(6, l[2] / 2))
  const toes = plan.feet === 'plain' ? [] : footTips(front[0], front[2], front[1] + front[3], plan.feet === 'claws')

  let arms: Shape[] = plan.arm.map((a) => ell(a, a.rot))
  if (guitarStage) {
    // one hand on the neck, one strumming over the body
    arms = [ell({ cx: 82, cy: 66, rx: 6.5, ry: 3.4 }, -18), ell({ cx: 66, cy: 79, rx: 6, ry: 3.4 }, 58)]
  }

  const crest: Plate[] =
    s >= 6
      ? [
          { ...edgePlate({ cx: hx, cy: hy, rx: hr, ry: hr }, 236, 5) },
          { ...edgePlate({ cx: hx, cy: hy, rx: hr, ry: hr }, 258, 6.4) },
          { ...edgePlate({ cx: hx, cy: hy, rx: hr, ry: hr }, 280, 5) },
        ]
      : []
  const crownOn = cosmetics.indexOf('pick-crown') >= 0
  if (crownOn) {
    // three small picks sitting on the head; nudged forward when the crest is there
    const off = s >= 6 ? 18 : 0
    for (const [deg, size] of [
      [262 + off, 3.4],
      [282 + off, 4.2],
      [302 + off, 3.4],
    ])
      crest.push({ ...edgePlate({ cx: hx, cy: hy, rx: hr - 1, ry: hr - 1 }, deg, size) })
  }

  const neck = { x: hx - 5, y: hy + hr - 3 }
  const necklace =
    s === 4
      ? {
          d: `M${hx - 15},${hy + hr - 6} Q${hx - 4},${hy + hr + 7} ${hx + 9},${hy + hr - 3}`,
          pick: { x: hx - 3.5, y: hy + hr + 2.6, s: 2.8, rot: 180 },
        }
      : null

  const headband =
    s >= 5
      ? {
          // a thick arc that follows the head, with two tails flying back
          d: `M${hx - hr * 0.92},${hy - hr * 0.38} A${hr} ${hr} 0 0 1 ${hx + hr * 0.82},${hy - hr * 0.57}`,
          tails: [
            `M${hx - hr * 0.86},${hy - hr * 0.5} C${hx - hr - 6},${hy - hr * 0.6} ${hx - hr - 10},${hy - hr * 0.2} ${hx - hr - 15},${hy - hr * 0.3} C${hx - hr - 9},${hy - hr * 0.05} ${hx - hr - 4},${hy - hr * 0.2} ${hx - hr * 0.9},${hy - hr * 0.26} Z`,
            `M${hx - hr * 0.9},${hy - hr * 0.3} C${hx - hr - 4},${hy - hr * 0.05} ${hx - hr - 7},${hy + hr * 0.25} ${hx - hr - 12},${hy + hr * 0.3} C${hx - hr - 5},${hy + hr * 0.42} ${hx - hr - 1},${hy + hr * 0.1} ${hx - hr * 0.84},${hy - hr * 0.12} Z`,
          ],
        }
      : null

  const headShapes: Shape[] = [circ(hx, hy, hr)]
  if (snout) headShapes.unshift(ell(snout))

  return {
    stage: s,
    tail: [{ t: 'p', d: plan.tail }],
    legsBack: [legShape(back)],
    body: [ell(body)],
    belly: [ell(belly)],
    spots,
    legsFront: [legShape(front)],
    toes,
    arms,
    head: headShapes,
    eyes: [far, near],
    cheeks: [
      { t: 'e', cx: near.cx - 1.5, cy: near.cy + near.r + 4, rx: 3.4, ry: 2.1 },
      { t: 'e', cx: far.cx + 3.5, cy: far.cy + far.r + 4, rx: 1.8, ry: 1.5 },
    ],
    mouth,
    roundMouth: false,
    nostril: snout ? { x: snout.cx + snout.rx * 0.62, y: snout.cy - snout.ry * 0.3 } : null,
    plates,
    crest,
    necklace,
    headband,
    guitar: guitarStage ? { x: 66, y: 81, rot: -30 } : null,
    stageBox: guitarStage ? rect(60, 96, 31, 11, 2) : null,
    cape: s >= 8 ? 'M52,57 C40,62 31,79 28,101 Q33,97 38,102 Q43,97 48,102 Q53,97 58,101 C57,86 58,72 62,60 Z' : null,
    aura: s >= 8,
    hx,
    hy,
    hr,
    neck,
    lean: plan.lean,
  }
}

/** The guitar in its own coordinates: body centred at (0, 0), neck along +x. */
export const GUITAR = {
  body: 'M-12.5,-1.5 C-15,-9.5 -6.5,-11.5 -2.5,-7.5 C0,-9.5 3.6,-10.6 5.6,-8 L3.4,-3.6 C6.4,-2.4 6.4,2.4 3.4,3.6 L5.6,8 C3.6,10.6 0,9.5 -2.5,7.5 C-6.5,11.5 -15,9.5 -12.5,1.5 Z',
  star: starPath(-3, 0, 12, 5.2, 5),
  neck: { x: 4, y: -1.7, w: 30, h: 3.4 },
  head: 'M33.5,-2.6 L41,-3.4 Q42.4,0 41,3.4 L33.5,2.6 Z',
  bridge: { x: -9, y: -3.4, w: 2, h: 6.8 },
  pickup: { x: -4, y: -3, w: 2.6, h: 6 },
}

/** A pointed star path, used for the star guitar and the Titan's sparkles. */
export function starPath(cx: number, cy: number, outer: number, inner: number, points: number): string {
  let d = ''
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = (Math.PI * i) / points - Math.PI / 2
    d += `${i === 0 ? 'M' : 'L'}${Math.round((cx + r * Math.cos(a)) * 100) / 100},${Math.round((cy + r * Math.sin(a)) * 100) / 100} `
  }
  return d + 'Z'
}

/** Five sparkles orbiting the Titan, as angles on a circle of r 50 around (60, 60). */
export const SPARKLES = [18, 90, 162, 234, 306].map((deg, i) => {
  const a = (deg * Math.PI) / 180
  return { x: 60 + 50 * Math.cos(a), y: 60 + 50 * Math.sin(a), r: i % 2 ? 2.6 : 3.4 }
})

/** A small eighth-note glyph at (x, y) (the note head's centre). */
export function noteGlyph(x: number, y: number): string {
  return `M${x + 2.1},${y} L${x + 2.1},${y - 8} Q${x + 5},${y - 6.5} ${x + 5.6},${y - 4}`
}
