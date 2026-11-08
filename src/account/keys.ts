// Which localStorage keys follow the account. Everything else stays in this browser.

export const SYNC_KEYS = [
  'band-songs',
  'song-favorites',
  'song-history',
  'jam-song',
  'jam-prefs',
  'jam-band',
  'jam-pinned-phrases',
  'rec-volume',
  'tone-presets',
  'metronome-level',
  'tuner-tuning',
  'lessons-progress',
  'lessons-prefs',
  't3k-client-id',
  'practice-log',
  'practice-goal',
  'skills-stats',
]

// Read fresh from storage on every use, so a newer account copy is merged in place without a page reload.
export const LIVE_KEYS = ['practice-log']
export const isLiveKey = (k: string): boolean => LIVE_KEYS.includes(k)

// One key per song or song part.
export const SYNC_PREFIXES = ['conv:', 'song-tone:', 'tone:', 'original-tone:']

// Never sent to the server (the server refuses them too).
export const FORBIDDEN = ['fretwise-account', 'fretwise-sync', 'lessons-account', 't3k-tokens']

// Account plumbing, per browser.
export const ACCOUNT_KEY = 'fretwise-account'
export const SYNC_STATE_KEY = 'fretwise-sync'
export const LEGACY_ACCOUNT_KEY = 'lessons-account'

// Also removed on sign-out, so the next person here doesn't inherit them.
// (A new practice bucket id too: the next account's practice never lands in this one's bucket.)
export const SIGN_OUT_EXTRA = ['lessons-progress-bak', 't3k-tokens', 'practice-device']

export function isSyncedKey(k: string): boolean {
  if (FORBIDDEN.includes(k)) return false
  return SYNC_KEYS.includes(k) || SYNC_PREFIXES.some((p) => k.startsWith(p))
}

/** Every synced key that has a value in this browser now. */
export function presentSyncedKeys(): string[] {
  const out: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k !== null && isSyncedKey(k)) out.push(k)
    }
  } catch {
    /* storage unavailable */
  }
  return out
}
