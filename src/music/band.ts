// Who is in the jam, and what role each person has right now.

export type Instrument = 'electric' | 'acoustic' | 'keys' | 'bass' | 'drums' | 'vocals'
export type RolePref = 'auto' | 'lead' | 'rhythm'

export interface Member {
  id: string
  name: string
  instrument: Instrument
  role: RolePref
  me?: boolean // the player the app listens to through the Scarlett
}

export const INSTRUMENTS: Record<Instrument, { label: string; icon: string; canLead: boolean }> = {
  electric: { label: 'Electric guitar', icon: '🎸', canLead: true },
  acoustic: { label: 'Acoustic guitar', icon: '🪕', canLead: true },
  keys: { label: 'Keys / synth', icon: '🎹', canLead: true },
  bass: { label: 'Bass', icon: '🎸', canLead: false },
  drums: { label: 'Drums / percussion', icon: '🥁', canLead: false },
  vocals: { label: 'Vocals', icon: '🎤', canLead: false },
}

export const DEFAULT_BAND: Member[] = [
  { id: 'me', name: 'Me', instrument: 'electric', role: 'auto', me: true },
  { id: 'p2', name: 'Acoustic', instrument: 'acoustic', role: 'auto' },
  { id: 'p3', name: 'Keys', instrument: 'keys', role: 'auto' },
]

export function loadBand(): Member[] {
  try {
    const raw = localStorage.getItem('jam-band')
    const band = raw ? (JSON.parse(raw) as Member[]) : null
    return band?.length ? band : DEFAULT_BAND
  } catch {
    return DEFAULT_BAND
  }
}

export function saveBand(band: Member[]) {
  try {
    localStorage.setItem('jam-band', JSON.stringify(band))
  } catch {
    /* storage unavailable */
  }
}

/**
 * Who solos now. With rotation on, players who can lead take turns every `roundsPerSolo`
 * passes through the progression; everyone else accompanies.
 */
export function soloistFor(band: Member[], round: number, roundsPerSolo: number): Member | null {
  // "Always lead" wins over rotation.
  const forced = band.find((m) => m.role === 'lead')
  if (forced) return forced
  if (!roundsPerSolo) return band.find((m) => m.me && INSTRUMENTS[m.instrument].canLead) ?? null
  const pool = band.filter((m) => m.role !== 'rhythm' && INSTRUMENTS[m.instrument].canLead)
  if (!pool.length) return null
  return pool[Math.floor(round / roundsPerSolo) % pool.length]
}
