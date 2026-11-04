// Runs first (main.tsx imports it before anything else): moves an old Lessons-only sign-in over, and
// watches every localStorage write so changes to synced keys can be sent to the account. Patching once
// covers all the components that write storage inline.
import { ACCOUNT_KEY, LEGACY_ACCOUNT_KEY, SYNC_STATE_KEY, isSyncedKey } from './keys'

const origGet = Storage.prototype.getItem
const origSet = Storage.prototype.setItem
const origRemove = Storage.prototype.removeItem
const origClear = Storage.prototype.clear

/** Writes without telling the sync code (pulled data, plumbing). Throws like setItem does. */
export function rawSet(k: string, v: string): void {
  origSet.call(localStorage, k, v)
}
export function rawRemove(k: string): void {
  origRemove.call(localStorage, k)
}

let applying = false
/** While true, writes are not echoed back to the account. */
export function setApplying(on: boolean): void {
  applying = on
}

let listener: ((k: string) => void) | null = null
/** The sync code's hook for "this key changed here". */
export function onKvChange(fn: (k: string) => void): void {
  listener = fn
}

function isLocal(s: Storage): boolean {
  try {
    return s === localStorage
  } catch {
    return false
  }
}

function note(k: string) {
  if (applying || !listener || !isSyncedKey(k)) return
  try {
    listener(k)
  } catch (err) {
    console.warn('Sync note failed', err)
  }
}

// An account from the Lessons-only build: everything else in this browser is guest data, so it goes
// through the first-sign-in merge. Its lessons keys were already that account's, so they are merged, not replaced.
function migrateLegacy() {
  try {
    if (localStorage.getItem(ACCOUNT_KEY) !== null) return
    const raw = localStorage.getItem(LEGACY_ACCOUNT_KEY)
    if (raw === null) return
    const a = JSON.parse(raw) as { name?: unknown; token?: unknown } | null
    if (a && typeof a.name === 'string' && typeof a.token === 'string' && /^[0-9a-f]{64}$/.test(a.token)) {
      rawSet(ACCOUNT_KEY, JSON.stringify({ id: '', name: a.name, token: a.token }))
      rawSet(SYNC_STATE_KEY, JSON.stringify({ userId: '', rev: 0, dirtyKv: {}, dirtyRec: {}, firstMerge: true, legacy: true }))
    }
    rawRemove(LEGACY_ACCOUNT_KEY)
  } catch {
    /* storage unavailable or junk: nothing to move */
  }
}

migrateLegacy()

// Only real changes count: components that write their state back on mount must not look like new edits.
Storage.prototype.setItem = function (this: Storage, k: string, v: string) {
  const local = isLocal(this)
  const prev = local ? origGet.call(this, k) : null
  origSet.call(this, k, v)
  if (local && prev !== String(v)) note(String(k))
}

Storage.prototype.removeItem = function (this: Storage, k: string) {
  const local = isLocal(this)
  const prev = local ? origGet.call(this, k) : null
  origRemove.call(this, k)
  if (local && prev !== null) note(String(k))
}

Storage.prototype.clear = function (this: Storage) {
  const local = isLocal(this)
  const keys: string[] = []
  if (local) {
    for (let i = 0; i < this.length; i++) {
      const k = this.key(i)
      if (k !== null && isSyncedKey(k)) keys.push(k)
    }
  }
  origClear.call(this)
  keys.forEach(note)
}
