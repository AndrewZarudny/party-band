// A fixed pool of little picks and note heads for the runway. Struct-of-arrays, packed at the front:
// spawning writes a slot, dying swaps the last one in. Nothing is allocated while it runs.

export const MAX_PARTICLES = 300
export const SHAPE_PICK = 0
export const SHAPE_NOTE = 1
export const LAYER_FRONT = 0 // hit bursts, over the notes
export const LAYER_BACK = 1 // Roar embers, behind everything

/** Unit shapes (about 2 wide), centred on 0,0; built on first use. */
function pickShape(): Path2D {
  const p = new Path2D()
  p.moveTo(-1, -0.55)
  p.quadraticCurveTo(0, -1.05, 1, -0.55)
  p.quadraticCurveTo(0, 1.65, -1, -0.55)
  p.closePath()
  return p
}
function noteShape(): Path2D {
  const p = new Path2D()
  p.ellipse(0, 0.5, 0.95, 0.68, -0.45, 0, Math.PI * 2)
  p.rect(0.72, -1.8, 0.24, 2.3)
  return p
}

export class Particles {
  n = 0
  private x = new Float32Array(MAX_PARTICLES)
  private y = new Float32Array(MAX_PARTICLES)
  private vx = new Float32Array(MAX_PARTICLES)
  private vy = new Float32Array(MAX_PARTICLES)
  private age = new Float32Array(MAX_PARTICLES)
  private life = new Float32Array(MAX_PARTICLES)
  private rot = new Float32Array(MAX_PARTICLES)
  private spin = new Float32Array(MAX_PARTICLES)
  private size = new Float32Array(MAX_PARTICLES)
  private grav = new Float32Array(MAX_PARTICLES)
  private drag = new Float32Array(MAX_PARTICLES)
  private col = new Uint8Array(MAX_PARTICLES)
  private shape = new Uint8Array(MAX_PARTICLES)
  private layer = new Uint8Array(MAX_PARTICLES)
  private pickPath: Path2D | null = null
  private notePath: Path2D | null = null

  /** Adds one; when the pool is full the new one is dropped. */
  spawn(x: number, y: number, vx: number, vy: number, life: number, size: number, shape: number, col: number, layer: number, grav: number, drag: number) {
    if (this.n >= MAX_PARTICLES) return
    const i = this.n++
    this.x[i] = x
    this.y[i] = y
    this.vx[i] = vx
    this.vy[i] = vy
    this.age[i] = 0
    this.life[i] = life
    this.rot[i] = (Math.random() - 0.5) * 1.6
    this.spin[i] = (Math.random() - 0.5) * 14
    this.size[i] = size
    this.grav[i] = grav
    this.drag[i] = drag
    this.col[i] = col
    this.shape[i] = shape
    this.layer[i] = layer
  }

  step(dt: number) {
    let i = 0
    while (i < this.n) {
      const age = this.age[i] + dt
      if (age >= this.life[i]) {
        this.kill(i)
        continue
      }
      this.age[i] = age
      const d = Math.exp(-this.drag[i] * dt)
      this.vx[i] *= d
      this.vy[i] = this.vy[i] * d + this.grav[i] * dt
      this.x[i] += this.vx[i] * dt
      this.y[i] += this.vy[i] * dt
      this.rot[i] += this.spin[i] * dt
      i++
    }
  }

  clear() {
    this.n = 0
  }

  /** Draws one layer. `base` scales the alpha; the context is left at the plain dpr transform. */
  draw(g: CanvasRenderingContext2D, dpr: number, layer: number, palette: string[], base: number) {
    if (!this.n || base <= 0) return
    const pick = (this.pickPath ??= pickShape())
    const note = (this.notePath ??= noteShape())
    for (let i = 0; i < this.n; i++) {
      if (this.layer[i] !== layer) continue
      const k = this.age[i] / this.life[i]
      // bursts fade out; embers fade in and out
      const a = layer === LAYER_FRONT ? (1 - k) * (1 - k * 0.5) : Math.sin(Math.PI * k)
      g.globalAlpha = base * a
      g.fillStyle = palette[this.col[i]]
      const s = this.size[i] * dpr
      const cs = Math.cos(this.rot[i]) * s
      const sn = Math.sin(this.rot[i]) * s
      g.setTransform(cs, sn, -sn, cs, this.x[i] * dpr, this.y[i] * dpr)
      g.fill(this.shape[i] === SHAPE_NOTE ? note : pick)
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.globalAlpha = 1
  }

  private kill(i: number) {
    const j = --this.n
    if (i === j) return
    this.x[i] = this.x[j]
    this.y[i] = this.y[j]
    this.vx[i] = this.vx[j]
    this.vy[i] = this.vy[j]
    this.age[i] = this.age[j]
    this.life[i] = this.life[j]
    this.rot[i] = this.rot[j]
    this.spin[i] = this.spin[j]
    this.size[i] = this.size[j]
    this.grav[i] = this.grav[j]
    this.drag[i] = this.drag[j]
    this.col[i] = this.col[j]
    this.shape[i] = this.shape[j]
    this.layer[i] = this.layer[j]
  }
}
