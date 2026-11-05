// "Hear amp": whether the app plays your guitar through its amp sim. Off when you hear the guitar
// through the interface (Scarlett Direct Monitor) or a real amp, so there's no doubled, delayed sound.
// Kept per browser: it depends on this computer's hardware, not on the player.
const KEY = 'hear-amp'

export function loadHearAmp(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function saveHearAmp(on: boolean): void {
  try {
    if (on) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, 'off')
  } catch {
    /* storage unavailable */
  }
}
