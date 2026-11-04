import { useId } from 'react'
import type { Cosmetic, DinoMood } from '../types'
import type { Eye, Look, Plate, Shape } from '../dinoArt'
import { DINO_COLORS as C, GUITAR, SPARKLES, STAGE_NAMES, lookFor, noteGlyph, pickPath, starPath } from '../dinoArt'
import './dino.css'

const OUTLINE = 4 // drawn under the fill, so 2 units show outside the silhouette

function shape(s: Shape, key: number, fill: string, stroke?: string, sw?: number) {
  const p = { fill, stroke, strokeWidth: sw, strokeLinejoin: 'round' as const }
  if (s.t === 'c') return <circle key={key} cx={s.cx} cy={s.cy} r={s.r} {...p} />
  if (s.t === 'r') return <rect key={key} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx} {...p} />
  if (s.t === 'p') return <path key={key} d={s.d} {...p} />
  return <ellipse key={key} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} transform={s.rot ? `rotate(${s.rot} ${s.cx} ${s.cy})` : undefined} {...p} />
}

// Outline pass then fill pass: shapes in one part merge into one clean silhouette.
function Part({ shapes, cls, fill = C.body }: { shapes: Shape[]; cls: string; fill?: string }) {
  return (
    <g className={cls}>
      {shapes.map((s, i) => shape(s, i, C.outline, C.outline, OUTLINE))}
      {shapes.map((s, i) => shape(s, i + 100, fill))}
    </g>
  )
}

// Each arm in its own group: CSS turns the group, the ellipse keeps its own rotate attribute.
function Arms({ shapes }: { shapes: Shape[] }) {
  return (
    <g className="d-arms">
      {shapes.map((s, i) => (
        <g key={i} className="d-arm">
          {shape(s, 0, C.outline, C.outline, OUTLINE)}
          {shape(s, 1, C.body)}
        </g>
      ))}
    </g>
  )
}

function Plates({ plates, fill, edge, cls }: { plates: Plate[]; fill: string; edge: string; cls: string }) {
  return (
    <g className={cls}>
      {plates.map((p, i) => (
        <path key={i} d={pickPath(0, 0, p.s)} transform={`translate(${p.x} ${p.y}) rotate(${p.rot})`} fill={fill} stroke={edge} strokeWidth={1.5} strokeLinejoin="round" />
      ))}
    </g>
  )
}

function Eyes({ eyes, shades }: { eyes: Eye[]; shades: boolean }) {
  return (
    <>
      <g className="d-eyes">
        {eyes.map((e, i) => (
          <ellipse key={i} cx={e.cx} cy={e.cy} rx={e.r} ry={e.r * e.sq} fill={C.eye} stroke={C.outline} strokeWidth={1.4} />
        ))}
        <g className="d-pupils">
          {eyes.map((e, i) => (
            <g key={i}>
              <ellipse cx={e.cx + e.r * 0.22} cy={e.cy + e.r * 0.12} rx={e.r * 0.56} ry={e.r * 0.56 * Math.min(1, e.sq + 0.08)} fill={C.pupil} />
              <circle cx={e.cx + e.r * 0.04} cy={e.cy - e.r * 0.2} r={e.r * 0.2} fill={C.eye} />
            </g>
          ))}
        </g>
      </g>
      <g className="d-lids">
        {eyes.map((e, i) => (
          <ellipse key={i} cx={e.cx} cy={e.cy} rx={e.r + 0.4} ry={e.r * e.sq + 0.4} fill={C.body} stroke={C.outline} strokeWidth={1.4} />
        ))}
      </g>
      <g className="d-closed">
        {eyes.map((e, i) => (
          <path key={i} d={`M${e.cx - e.r * 0.75},${e.cy} Q${e.cx},${e.cy + e.r * 0.6} ${e.cx + e.r * 0.75},${e.cy}`} fill="none" stroke={C.outline} strokeWidth={1.6} strokeLinecap="round" />
        ))}
      </g>
      {shades && (
        <g className="d-prop">
          {eyes.map((e, i) => (
            <rect key={i} x={e.cx - e.r - 1.4} y={e.cy - e.r * 0.72} width={e.r * 2 + 2.8} height={e.r * 1.5} rx={2.2} fill={C.shades} />
          ))}
          <path d={`M${eyes[1].cx + eyes[1].r},${eyes[1].cy - 1.4} L${eyes[0].cx - eyes[0].r},${eyes[0].cy - 1.4}`} stroke={C.shades} strokeWidth={1.6} />
          <path d={`M${eyes[1].cx - eyes[1].r * 0.6},${eyes[1].cy - eyes[1].r * 0.3} l${eyes[1].r * 0.7},0`} stroke={C.eye} strokeOpacity={0.5} strokeWidth={1} strokeLinecap="round" />
        </g>
      )}
    </>
  )
}

/** Every mouth is drawn; dino.css shows the one that fits the mood. */
function Mouths({ x, y, w, round }: { x: number; y: number; w: number; round: boolean }) {
  const line = { fill: 'none', stroke: C.outline, strokeWidth: 1.7, strokeLinecap: 'round' as const }
  return (
    <g className="d-mouth">
      {round ? <ellipse className="m-base" cx={x} cy={y} rx={2.2} ry={2.7} fill={C.mouth} /> : <path className="m-base" d={`M${x - w},${y - 0.5} Q${x - w * 0.1},${y + 3.6} ${x + w},${y - 1.2}`} {...line} />}
      <path className="m-smile" d={`M${x - w - 0.6},${y - 1.6} Q${x},${y + 5.6} ${x + w + 0.6},${y - 2.2}`} {...line} />
      <g className="m-open">
        <path d={`M${x - w},${y - 1.4} Q${x},${y + 9} ${x + w + 0.6},${y - 2}`} fill={C.mouth} stroke={C.outline} strokeWidth={1.4} strokeLinejoin="round" />
        <ellipse cx={x + 0.4} cy={y + 3.4} rx={w * 0.45} ry={1.6} fill={C.tongue} />
      </g>
      <path className="m-oops" d={`M${x - w * 0.8},${y + 0.6} q${w * 0.4},-1.8 ${w * 0.8},0 t${w * 0.8},0`} {...line} />
    </g>
  )
}

function Guitar({ g, star }: { g: { x: number; y: number; rot: number }; star: boolean }) {
  const n = GUITAR.neck
  return (
    <g className="d-guitar" transform={`translate(${g.x} ${g.y}) rotate(${g.rot})`}>
      <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={0.8} fill={C.neck} stroke={C.boxLine} strokeWidth={1} />
      <path d={GUITAR.head} fill={C.neck} stroke={C.boxLine} strokeWidth={1} strokeLinejoin="round" />
      <path d={star ? GUITAR.star : GUITAR.body} fill={C.plate} stroke={C.plateShade} strokeWidth={1.6} strokeLinejoin="round" />
      <rect {...GUITAR.pickup} rx={0.6} fill={C.box} />
      <rect {...GUITAR.bridge} rx={0.6} fill={C.box} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <line key={i} x1={-8} x2={38} y1={-1.25 + i * 0.5} y2={-1.25 + i * 0.5} stroke={C.belly} strokeOpacity={0.75} strokeWidth={0.22} />
      ))}
    </g>
  )
}

function Egg({ cracked }: { cracked: boolean }) {
  return (
    <g className="d-body">
      {cracked && (
        <g className="d-tail">
          <path d="M74,88 C80,90 84,88 87,84 C86,90 82,94 75,94 Z" fill={C.body} stroke={C.outline} strokeWidth={2} strokeLinejoin="round" />
        </g>
      )}
      <ellipse cx={60} cy={66} rx={22} ry={28} fill={C.egg} stroke={C.eggLine} strokeWidth={2} />
      <path d="M44,80 Q48,92 60,93" fill="none" stroke={C.eggLine} strokeWidth={1.4} strokeLinecap="round" opacity={0.8} />
      <circle cx={50} cy={55} r={4} fill={C.plate} />
      <circle cx={68} cy={62} r={3} fill={C.plate} />
      <circle cx={56} cy={80} r={5} fill={C.plate} />
      <circle cx={70} cy={78} r={3.4} fill={C.plate} />
      <ellipse cx={60} cy={52} rx={9} ry={6} fill={C.eggWindow} />
      <g className="d-eyes">
        <circle cx={57} cy={52.4} r={1.6} fill={C.pupil} />
        <circle cx={63} cy={52.4} r={1.6} fill={C.pupil} />
      </g>
      {cracked && (
        <polyline points="39,54 44,48 48,53 52,44 58,41 64,44 69,40 74,47 81,50" fill="none" stroke={C.crack} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      )}
    </g>
  )
}

function Hatchling() {
  const eyes: Eye[] = [
    { cx: 52, cy: 50, r: 6, sq: 1 },
    { cx: 68, cy: 50, r: 6, sq: 1 },
  ]
  const head: Shape[] = [{ t: 'c', cx: 60, cy: 52, r: 22 }]
  return (
    <>
      <Part shapes={[{ t: 'e', cx: 60, cy: 72, rx: 16, ry: 12 }]} cls="d-body" />
      <Plates plates={[235, 270, 305].map((deg, i) => headPlate(60, 52, 22, deg, i === 1 ? 4.6 : 3.6))} fill={C.plate} edge={C.plateShade} cls="d-plates" />
      <Part shapes={head} cls="d-head" />
      <g className="d-shell">
        <path d="M38.3,72 L44,65 L49,72 L55,64 L61,72 L67,64 L73,72 L77,66 L81.7,72 A22 26 0 0 1 38.3,72 Z" fill={C.egg} stroke={C.eggLine} strokeWidth={2} strokeLinejoin="round" />
        <circle cx={51} cy={83} r={3.6} fill={C.plate} />
        <circle cx={70} cy={86} r={2.6} fill={C.plate} />
      </g>
      <Arms
        shapes={[
          { t: 'e', cx: 44, cy: 71.5, rx: 5, ry: 3.4, rot: -12 },
          { t: 'e', cx: 76, cy: 71.5, rx: 5, ry: 3.4, rot: 12 },
        ]}
      />
      <g className="d-cheeks">
        <ellipse cx={46} cy={60} rx={3.4} ry={2.1} fill={C.plate} opacity={0.55} />
        <ellipse cx={74} cy={60} rx={3.4} ry={2.1} fill={C.plate} opacity={0.55} />
      </g>
      <Eyes eyes={eyes} shades={false} />
      <Mouths x={60} y={62} w={4} round />
    </>
  )
}

function headPlate(cx: number, cy: number, r: number, deg: number, s: number): Plate {
  const a = (deg * Math.PI) / 180
  return { x: cx + (r - s * 0.15) * Math.cos(a), y: cy + (r - s * 0.15) * Math.sin(a), s, rot: deg + 90 }
}

function Grown({ look, cosmetics, gid }: { look: Look; cosmetics: Cosmetic[]; gid: string }) {
  const has = (c: Cosmetic) => cosmetics.indexOf(c) >= 0
  const m = look.mouth
  const titan = look.stage >= 8
  const plateFill = titan ? `url(#${gid}-plate)` : C.plate
  const fxX = m.x + m.w + 4
  return (
    <g transform={look.lean ? `rotate(${look.lean} 60 107)` : undefined}>
      {look.cape && <path className="d-cape" d={look.cape} fill={C.plate} stroke={C.plateShade} strokeWidth={2} strokeLinejoin="round" />}
      <Part shapes={look.tail} cls="d-tail" />
      <Plates plates={look.plates} fill={plateFill} edge={C.plateShade} cls="d-plates" />
      <Plates plates={look.plates} fill={C.plateHi} edge={C.plateShade} cls="d-plates-hi" />
      <Part shapes={look.legsBack} cls="d-legs d-legs-back" fill={C.spot} />
      {look.stageBox && shape(look.stageBox, 0, C.box, C.boxLine, 1.5)}
      <Part shapes={look.body} cls="d-body" />
      <g className="d-belly">
        {look.belly.map((s, i) => shape(s, i, C.belly))}
        {look.spots.map((s, i) => shape(s, i + 10, C.spot))}
      </g>
      <Part shapes={look.legsFront} cls="d-legs" />
      {look.toes.length > 0 && (
        <g className="d-toes">
          {look.toes.map((d, i) => (
            <path key={i} d={d} fill={C.belly} />
          ))}
        </g>
      )}
      {look.guitar && <Guitar g={look.guitar} star={has('star-guitar')} />}
      <Arms shapes={look.arms} />
      {look.necklace && (
        <g className="d-prop">
          <path d={look.necklace.d} fill="none" stroke={C.outline} strokeWidth={0.9} />
        </g>
      )}
      <Part shapes={look.head} cls="d-head" />
      {look.necklace && <Plates plates={[look.necklace.pick]} fill={C.plate} edge={C.plateShade} cls="d-prop" />}
      {has('bandana') && (
        <g className="d-prop">
          <path d={`M${look.neck.x - 11},${look.neck.y - 2} L${look.neck.x + 10},${look.neck.y - 0.5} L${look.neck.x - 1},${look.neck.y + 10} Z`} fill={C.plate} stroke={C.plateShade} strokeWidth={1.5} strokeLinejoin="round" />
          <circle cx={look.neck.x - 11} cy={look.neck.y - 2} r={2} fill={C.plateShade} />
        </g>
      )}
      {look.headband && (
        <g className="d-prop">
          {look.headband.tails.map((d, i) => (
            <path key={i} d={d} fill={C.plate} stroke={C.plateShade} strokeWidth={1.2} strokeLinejoin="round" />
          ))}
          <path d={look.headband.d} fill="none" stroke={C.plateShade} strokeWidth={6.2} />
          <path d={look.headband.d} fill="none" stroke={C.plate} strokeWidth={4.2} />
        </g>
      )}
      {look.crest.length > 0 && <Plates plates={look.crest} fill={plateFill} edge={C.plateShade} cls="d-plates d-crest" />}
      {look.nostril && <ellipse cx={look.nostril.x} cy={look.nostril.y} rx={1} ry={0.8} fill={C.outline} />}
      <g className="d-cheeks">
        {look.cheeks.map((s, i) => shape(s, i, C.plate))}
      </g>
      <Eyes eyes={look.eyes} shades={has('shades')} />
      <Mouths x={m.x} y={m.y} w={m.w} round={false} />
      <g className="d-fx">
        <g className="fx-roar" fill="none" stroke={C.plate} strokeWidth={2} strokeLinecap="round">
          <path d={`M${fxX},${m.y - 5} q3.5,5 0,10`} />
          <path d={`M${fxX + 5},${m.y - 8} q5,8 0,16`} />
          <path d={`M${fxX + 10},${m.y - 11} q6.5,11 0,22`} />
        </g>
        <path className="fx-sweat" d={`M${look.hx - look.hr * 0.55},${look.hy - look.hr * 0.75} q4,5.5 0,8.4 q-4,-2.9 0,-8.4 Z`} fill={C.sweat} />
        <g className="fx-notes" fill={C.plate} stroke={C.plate} strokeWidth={1.2} strokeLinecap="round">
          <g className="fx-note">
            <circle cx={fxX + 3} cy={m.y - 10} r={2.1} stroke="none" />
            <path d={noteGlyph(fxX + 3, m.y - 10)} fill="none" />
          </g>
          <g className="fx-note">
            <circle cx={fxX + 10} cy={m.y - 18} r={1.8} stroke="none" />
            <path d={noteGlyph(fxX + 9.7, m.y - 18)} fill="none" />
          </g>
        </g>
        <g className="fx-z" fill={C.zz} fontWeight={800} fontFamily="var(--font-display)">
          <text x={look.hx + look.hr * 0.6} y={look.hy - look.hr - 1} fontSize={9}>
            z
          </text>
          <text x={look.hx + look.hr * 0.6 + 7} y={look.hy - look.hr - 9} fontSize={7}>
            z
          </text>
        </g>
      </g>
    </g>
  )
}

export function Dino({ stage, mood = 'idle', size = 120, cosmetics = [], cracked = false, className = '' }: { stage: number; mood?: DinoMood; size?: number; cosmetics?: Cosmetic[]; cracked?: boolean; className?: string }) {
  const st = Math.max(0, Math.min(8, Math.round(stage) || 0))
  const gid = 'dg' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const look = st >= 2 ? lookFor(st, cosmetics) : null
  const name = STAGE_NAMES[st]
  return (
    <svg
      className={`dino stage-${st} mood-${mood}${cracked ? ' cracked' : ''}${className ? ' ' + className : ''}`}
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="img"
      aria-label={`Your dino: ${name}`}
    >
      {st >= 8 && (
        <defs>
          <linearGradient id={`${gid}-plate`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0.35" stopColor={C.plate} />
            <stop offset="1" stopColor={C.plateTip} />
          </linearGradient>
        </defs>
      )}
      <circle className="d-disc" cx={60} cy={60} r={56} />
      {look?.aura && (
        <g className="d-aura" fill="none" stroke={C.plate}>
          <circle cx={60} cy={60} r={52} strokeOpacity={0.25} strokeWidth={2} />
          <circle cx={60} cy={60} r={58} strokeOpacity={0.12} strokeWidth={2} />
        </g>
      )}
      <ellipse className="d-shadow" cx={60} cy={108} rx={30} ry={5} fill={C.shadow} opacity={0.25} />
      <g className="d-fig">
        <g className="d-breath">
          {st === 0 && <Egg cracked={cracked} />}
          {st === 1 && <Hatchling />}
          {look && <Grown look={look} cosmetics={cosmetics} gid={gid} />}
        </g>
      </g>
      {st <= 1 && <SmallFx hatched={st === 1} />}
      {look?.aura && (
        <g className="d-orbit">
          {SPARKLES.map((s, i) => (
            <path key={i} d={starPath(s.x, s.y, s.r, s.r * 0.32, 4)} fill={C.sparkle} />
          ))}
        </g>
      )}
    </svg>
  )
}

// The egg and the hatchling can doze too; the hatchling can also sweat a little.
function SmallFx({ hatched }: { hatched: boolean }) {
  return (
    <g className="d-fx">
      {hatched && <path className="fx-sweat" d="M41,32 q4,5.5 0,8.4 q-4,-2.9 0,-8.4 Z" fill={C.sweat} />}
      <g className="fx-z" fill={C.zz} fontWeight={800} fontFamily="var(--font-display)">
        <text x={80} y={40} fontSize={9}>
          z
        </text>
        <text x={87} y={32} fontSize={7}>
          z
        </text>
      </g>
    </g>
  )
}
