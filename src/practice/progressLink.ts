// "What's sticking" in the practice dialog opens Lessons on its progress screen. The dialog sits in the top bar,
// apart from App's tabs and from LessonsMode, so it asks with a window event (as the theme does). Lessons may
// not be mounted yet when the event fires, so the ask is also kept until LessonsMode has shown the screen.

export const PROGRESS_EVENT = 'fretwise-open-progress'

let asked = false

/** Switch to Lessons and show "Your progress". */
export function openProgress(): void {
  asked = true
  window.dispatchEvent(new Event(PROGRESS_EVENT))
}

/** Whether the progress screen was asked for and not shown yet (read when LessonsMode mounts). */
export const progressAsked = (): boolean => asked

/**
 * The screen Lessons opens on. A new player (nothing saved yet) gets the Welcome and the timing setup first,
 * even when the progress screen was asked for: there is nothing to show on it yet.
 */
export function lessonsStartScreen(saved: boolean, asked: boolean): 'welcome' | 'progress' | 'home' {
  if (!saved) return 'welcome'
  return asked ? 'progress' : 'home'
}

/** LessonsMode showed it: the ask is done. */
export function progressShown(): void {
  asked = false
}

export function onOpenProgress(cb: () => void): () => void {
  window.addEventListener(PROGRESS_EVENT, cb)
  return () => window.removeEventListener(PROGRESS_EVENT, cb)
}
