// Who is signed in, how saving is going, and the per-browser account records in localStorage.
import { useSyncExternalStore } from 'react'
import { ACCOUNT_KEY, SYNC_STATE_KEY } from './keys'
import { rawRemove, rawSet } from './install'

export type SyncStatus = 'guest' | 'saved' | 'saving' | 'offline' | 'signed-out' | 'error'

export interface AccountState {
  account: { id: string; name: string } | null // never exposes the token to components
  status: SyncStatus
  error: string | null
  reloadReady: boolean // pulled changes waiting: show "Reload"
  dialog: 'signup' | 'login' | null
  progress: { done: number; total: number; label: string } | null
}

// ---- Stored account and sync state ----------------------------------------------

export interface StoredAccount {
  id: string
  name: string
  token: string
}

export interface SyncState {
  userId: string
  rev: number
  dirtyKv: Record<string, number> // key → local change time
  dirtyRec: Record<string, number> // "store/id" → local change time
  hashes?: Record<string, string> // "store/id" → content hash the account has (skips re-hashing)
  kvRev?: Record<string, number> // list key → the account's rev this browser's copy is based on
  refusedKv?: Record<string, true> // keys the account wouldn't take: only in this browser
  refusedRec?: Record<string, true> // "store/id" the account wouldn't take
  recRev?: number // counts pulls that wrote records here (other tabs watch it to know their copy is old)
  firstMerge?: true
  legacy?: true // moved over from the Lessons-only build
}

export function loadStoredAccount(): StoredAccount | null {
  try {
    const a = JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? 'null') as StoredAccount | null
    if (!a || typeof a.name !== 'string' || typeof a.token !== 'string' || !/^[0-9a-f]{64}$/.test(a.token)) return null
    return { id: typeof a.id === 'string' ? a.id : '', name: a.name, token: a.token }
  } catch {
    return null
  }
}

export function storeAccount(a: StoredAccount | null): void {
  try {
    if (a) rawSet(ACCOUNT_KEY, JSON.stringify(a))
    else rawRemove(ACCOUNT_KEY)
  } catch {
    /* storage unavailable */
  }
}

export function readSync(): SyncState | null {
  try {
    const s = JSON.parse(localStorage.getItem(SYNC_STATE_KEY) ?? 'null') as SyncState | null
    if (!s || typeof s !== 'object') return null
    return {
      userId: typeof s.userId === 'string' ? s.userId : '',
      rev: typeof s.rev === 'number' && s.rev >= 0 ? s.rev : 0,
      dirtyKv: s.dirtyKv && typeof s.dirtyKv === 'object' ? s.dirtyKv : {},
      dirtyRec: s.dirtyRec && typeof s.dirtyRec === 'object' ? s.dirtyRec : {},
      hashes: s.hashes && typeof s.hashes === 'object' ? s.hashes : {},
      kvRev: s.kvRev && typeof s.kvRev === 'object' ? s.kvRev : {},
      refusedKv: s.refusedKv && typeof s.refusedKv === 'object' ? s.refusedKv : {},
      refusedRec: s.refusedRec && typeof s.refusedRec === 'object' ? s.refusedRec : {},
      ...(typeof s.recRev === 'number' ? { recRev: s.recRev } : {}),
      ...(s.firstMerge ? { firstMerge: true as const } : {}),
      ...(s.legacy ? { legacy: true as const } : {}),
    }
  } catch {
    return null
  }
}

export function writeSync(s: SyncState | null): void {
  try {
    if (s) rawSet(SYNC_STATE_KEY, JSON.stringify(s))
    else rawRemove(SYNC_STATE_KEY)
  } catch (err) {
    console.warn("Couldn't save the sync state", err)
  }
}

/** Read, change and write the sync state in one go (other tabs of this browser share it). */
export function updateSync(fn: (s: SyncState) => void): SyncState | null {
  const s = readSync()
  if (!s) return null
  fn(s)
  writeSync(s)
  return s
}

// ---- State store ------------------------------------------------------------------

function initial(): AccountState {
  const a = loadStoredAccount()
  return {
    account: a ? { id: a.id, name: a.name } : null,
    status: a ? 'saved' : 'guest',
    error: null,
    reloadReady: false,
    dialog: null,
    progress: null,
  }
}

let state: AccountState = initial()
const subs = new Set<() => void>()

export function getAccountState(): AccountState {
  return state
}

export function setAccountState(patch: Partial<AccountState>): void {
  const next = { ...state, ...patch }
  const same = (Object.keys(patch) as (keyof AccountState)[]).every((k) => next[k] === state[k])
  if (same) return
  state = next
  subs.forEach((fn) => fn())
}

export function subscribeAccount(fn: () => void): () => void {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}

export function useAccount(): AccountState {
  return useSyncExternalStore(subscribeAccount, getAccountState)
}

export function openAccountDialog(mode: 'signup' | 'login'): void {
  setAccountState({ dialog: mode })
}

export function closeAccountDialog(): void {
  setAccountState({ dialog: null })
}
