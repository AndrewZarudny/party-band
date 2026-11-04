// Which sound the backing band uses: recorded instruments ('real', the default) or the
// synthesized voices ('synth'). Remembered on this device; every band follows it unless told otherwise.

export type BandSound = 'real' | 'synth'

const KEY = 'band-sound'
const listeners = new Set<() => void>()

let sound: BandSound = (() => {
  try {
    return localStorage.getItem(KEY) === 'synth' ? 'synth' : 'real'
  } catch {
    return 'real'
  }
})()

export const bandSound = () => sound

export function setBandSound(s: BandSound) {
  if (s === sound) return
  sound = s
  try {
    localStorage.setItem(KEY, s)
  } catch {
    // storage unavailable: keep it for this visit only
  }
  listeners.forEach((l) => l())
}

export function onBandSound(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
