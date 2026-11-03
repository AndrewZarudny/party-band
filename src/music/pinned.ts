// Jam phrases and the player's pinned set (kept in this browser).
import type { FretPos } from './theory'

export interface SavedPhrase {
  id: string
  notes: FretPos[]
  chord: string // chord it was made for
}

export function loadPinned(): SavedPhrase[] {
  try {
    return JSON.parse(localStorage.getItem('jam-pinned-phrases') ?? '[]') as SavedPhrase[]
  } catch {
    return []
  }
}

export function savePinned(p: SavedPhrase[]) {
  try {
    localStorage.setItem('jam-pinned-phrases', JSON.stringify(p))
  } catch {
    /* storage unavailable */
  }
}
