// Light / dark / follow-the-OS. The CSS does the work (src/index.css): no data-theme means the OS decides.
// index.html applies the saved choice before first paint; keep the key and values in sync with it.

export type Theme = 'system' | 'light' | 'dark'

const KEY = 'fretwise-theme'
export const THEME_EVENT = 'fretwise-theme'

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function setTheme(t: Theme): void {
  try {
    localStorage.setItem(KEY, t)
  } catch {
    // private mode: the choice still applies for this visit
  }
  const root = document.documentElement
  if (t === 'system') delete root.dataset.theme
  else root.dataset.theme = t
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: t }))
}

/** Calls back when the colours on screen may have changed: a pick in the app or the OS switching. */
export function onThemeChange(cb: () => void): () => void {
  window.addEventListener(THEME_EVENT, cb)
  let mq: MediaQueryList | null = null
  try {
    mq = window.matchMedia('(prefers-color-scheme: light)')
    mq.addEventListener('change', cb)
  } catch {
    mq = null
  }
  return () => {
    window.removeEventListener(THEME_EVENT, cb)
    mq?.removeEventListener('change', cb)
  }
}
