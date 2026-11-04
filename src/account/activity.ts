// What a page reload would interrupt right now (a jam or song playing, a lesson, a live session).
// While anything holds, changes pulled from the account wait for the user's "Reload".
const holds = new Set<string>()

export function holdReload(key: string, on: boolean): void {
  if (on) holds.add(key)
  else holds.delete(key)
}

export const reloadHeld = (): boolean => holds.size > 0

// What the player is practising right now, for the practice log. Separate from the holds above:
// an open but paused lesson holds the reload, yet isn't practice time.
export type PracticeActivity = 'lessons' | 'jam' | 'songs'
const practising = new Map<object, PracticeActivity>()

/** Marks an activity as running; returns the undo (fits a useEffect's return). */
export function practice(a: PracticeActivity, on: boolean): (() => void) | undefined {
  if (!on) return undefined
  const token = {}
  practising.set(token, a)
  return () => void practising.delete(token)
}

export const practisingNow = (): Set<PracticeActivity> => new Set(practising.values())

// Sign-out asks the practice log to store its unsaved seconds first (so they are sent with the rest),
// and to stop writing before this browser's copy is cleared.
interface SignOutHook {
  save(): void
  stop(): void
}
const signOutHooks: SignOutHook[] = []
export function onSignOut(h: SignOutHook): void {
  signOutHooks.push(h)
}
export const beforeSignOut = (): void => signOutHooks.forEach((h) => h.save())
export const stopForSignOut = (): void => signOutHooks.forEach((h) => h.stop())
