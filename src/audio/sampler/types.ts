// Shapes of public/samples/band/manifest.json and grooves.json (shared with the asset builder).

export interface Layer {
  vel: number // upper velocity bound, 1–127
  files: string[] // round robins, relative to /samples/band/
}

export interface Zone {
  root: number // MIDI note the files were recorded at
  lo: number
  hi: number
  layers: Layer[]
}

export type DrumPiece = 'kick' | 'snare' | 'hatClosed' | 'hatOpen' | 'ride' | 'crash' | 'rimshot' | 'tomHigh' | 'tomLow'

export interface Credit {
  name: string
  author: string
  licence: string
  url: string
  licenceUrl: string
  changes: string
}

export interface Manifest {
  version: number
  instruments: {
    drums: { pieces: Partial<Record<DrumPiece, { layers: Layer[] }>> }
    bass: { zones: Zone[]; release?: unknown }
    keys: { name: string; zones: Zone[] }
  }
  credits: Credit[]
}

export interface GrooveFeel {
  offsetsMs: number[] // per 8th slot, slot 0 is always 0
  velocities: { kick: number[]; snare: number[]; hat: number[] } // 0..1
  jitterMs: number
  source: string
}

export interface Grooves {
  version: number
  feels: Record<string, GrooveFeel>
}
