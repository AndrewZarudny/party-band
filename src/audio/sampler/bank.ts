// Loads the band's recorded samples (public/samples/band) on first use and shares them: one
// decoded set per sample rate, used by every BackingBand and AudioContext at that rate. Each
// part becomes usable as soon as its own files are decoded; until then it stays null. Parts that
// failed are loaded again later (by a band after RETRY_MS, or at once by retrySamples).
import type { Credit, DrumPiece, Layer, Manifest, Zone } from './types'

const BASE = `${import.meta.env.BASE_URL}samples/band/`
const PARALLEL = 6
const RETRY_MS = 15000
/** The drum pieces the band plays; the manifest's other pieces are not loaded. */
const KIT_PIECES: DrumPiece[] = ['kick', 'snare', 'hatClosed', 'rimshot']

export interface RLayer {
  vel: number
  bufs: AudioBuffer[]
  rr: number // round-robin position
}

export interface RZone {
  root: number
  lo: number
  hi: number
  layers: RLayer[]
}

export type Kit = Partial<Record<DrumPiece, RLayer[]>>

export interface Bank {
  drums: Kit | null
  bass: RZone[] | null
  keys: RZone[] | null
}

export type SampleState = 'idle' | 'loading' | 'ready' | 'error'
export type BankPart = keyof Bank

export interface SampleStatus {
  state: SampleState // 'error' when any part failed
  loaded: number // files decoded so far
  total: number
  parts: Record<BankPart, SampleState>
  error?: string
}

let status: SampleStatus = { state: 'idle', loaded: 0, total: 0, parts: { drums: 'idle', bass: 'idle', keys: 'idle' } }
const listeners = new Set<() => void>()

function setStatus(s: SampleStatus) {
  status = s
  listeners.forEach((l) => l())
}

/** Loading progress of the most recent sample load. */
export const sampleStatus = () => status

export function onSampleStatus(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

let manifest: Promise<Manifest> | null = null

export function loadManifest(): Promise<Manifest> {
  if (!manifest) {
    const p = fetch(`${BASE}manifest.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`manifest: HTTP ${r.status}`)
        return r.json() as Promise<Manifest>
      })
      .then((m) => {
        if (m?.version !== 1 || !m.instruments) throw new Error('manifest: unexpected format')
        return m
      })
    // A failed load is retried by the next band.
    p.catch(() => {
      if (manifest === p) manifest = null
    })
    manifest = p
  }
  return manifest
}

/** Licence credits for the samples and grooves (empty when the manifest can't be read). */
export const bandCredits = (): Promise<Credit[]> => loadManifest().then((m) => m.credits ?? [], () => [])

interface Entry {
  bank: Bank
  ctx: BaseAudioContext // the latest context asking for it (decodes the next retry)
  loading: boolean
  failedAt: number // performance.now() of the last failure, 0 if none
}

const PARTS: BankPart[] = ['drums', 'bass', 'keys']
const banks = new Map<number, Entry>()
const missing = (b: Bank) => PARTS.some((p) => !b[p])

/**
 * The shared sample set for this context's rate; starts loading it the first time and loads
 * failed parts again after RETRY_MS. The object stays the same, so bands keep a live reference.
 */
export function bankFor(ctx: BaseAudioContext): Bank {
  let e = banks.get(ctx.sampleRate)
  if (!e) {
    e = { bank: { drums: null, bass: null, keys: null }, ctx, loading: false, failedAt: 0 }
    banks.set(ctx.sampleRate, e)
    void fill(e)
  } else {
    e.ctx = ctx
    if (!e.loading && e.failedAt && performance.now() - e.failedAt > RETRY_MS) void fill(e)
  }
  return e.bank
}

/** Loads the parts that failed again now (the "Real band" button after an error). */
export function retrySamples() {
  for (const e of banks.values()) if (!e.loading && missing(e.bank)) void fill(e)
}

function limiter(n: number) {
  let active = 0
  const waiting: (() => void)[] = []
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    while (active >= n) await new Promise<void>((r) => waiting.push(r))
    active++
    try {
      return await fn()
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}

/** Loads the parts of the entry's bank that are still null. */
async function fill(e: Entry) {
  const b = e.bank
  const ctx = e.ctx
  const todo = PARTS.filter((p) => !b[p])
  const parts = { ...status.parts }
  for (const p of PARTS) parts[p] = b[p] ? 'ready' : 'loading'
  e.loading = true
  setStatus({ state: 'loading', loaded: 0, total: 0, parts })
  let m: Manifest
  try {
    m = await loadManifest()
  } catch (err) {
    e.loading = false
    e.failedAt = performance.now()
    for (const p of todo) parts[p] = 'error'
    setStatus({ state: 'error', loaded: 0, total: 0, parts, error: String(err) })
    return
  }
  const run = limiter(PARALLEL)
  const base = new URL(BASE, location.href)
  let loaded = 0
  let total = 0
  const decode = (file: string) =>
    run(async () => {
      const r = await fetch(new URL(file, base).href)
      if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`)
      const buf = await ctx.decodeAudioData(await r.arrayBuffer())
      loaded++
      setStatus({ ...status, state: 'loading', loaded, total })
      return buf
    })
  const layers = (ls: Layer[]): Promise<RLayer[]> => {
    if (!ls?.length || ls.some((l) => !l.files?.length)) return Promise.reject(new Error('empty layer'))
    total += ls.reduce((s, l) => s + l.files.length, 0)
    const sorted = [...ls].sort((a, c) => a.vel - c.vel)
    return Promise.all(sorted.map(async (l) => ({ vel: l.vel, bufs: await Promise.all(l.files.map(decode)), rr: 0 })))
  }
  const zones = (zs: Zone[] | undefined): Promise<RZone[]> => {
    if (!zs?.length) return Promise.reject(new Error('no zones'))
    const sorted = [...zs].sort((a, c) => a.root - c.root)
    return Promise.all(sorted.map(async (z) => ({ root: z.root, lo: z.lo, hi: z.hi, layers: await layers(z.layers) })))
  }
  const kit = async (): Promise<Kit> => {
    const pieces = m.instruments.drums?.pieces ?? {}
    if (!pieces.kick || !pieces.snare || !pieces.hatClosed) throw new Error('drums: kick, snare and hatClosed are required')
    const out: Kit = {}
    await Promise.all(
      KIT_PIECES.filter((k) => pieces[k]).map(async (k) => {
        out[k] = await layers(pieces[k]!.layers)
      }),
    )
    return out
  }
  const load: Record<BankPart, () => Promise<void>> = {
    drums: () =>
      kit().then((k) => {
        b.drums = k
      }),
    bass: () =>
      zones(m.instruments.bass?.zones).then((z) => {
        b.bass = z
      }),
    keys: () =>
      zones(m.instruments.keys?.zones).then((z) => {
        b.keys = z
      }),
  }
  // Drums first (the queue is first come, first served), then bass, then keys.
  const res = await Promise.allSettled(
    todo.map((p) =>
      load[p]().then(
        () => {
          parts[p] = 'ready'
        },
        (err) => {
          parts[p] = 'error'
          throw err
        },
      ),
    ),
  )
  const failed = res.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  e.loading = false
  e.failedAt = failed.length ? performance.now() : 0
  setStatus(
    failed.length
      ? { state: 'error', loaded, total, parts, error: failed.map((f) => String(f.reason)).join('; ') }
      : { state: 'ready', loaded, total, parts },
  )
}
