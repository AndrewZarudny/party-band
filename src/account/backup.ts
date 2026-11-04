// Snapshots of this browser's data, taken before a sign-in or sign-out could replace it, so nothing is lost.
// No UI yet; in development they are on window.fretwiseBackup.
import type { AnyEntry, CaptureEntry, RecordStore, RecordingEntry, SongEntry } from '../music/library'
import { rawGet, rawGetAll, rawKeys, rawPut } from '../music/library'
import { noteRecord } from './notify'
import { presentSyncedKeys } from './keys'
import { sha256Hex } from './sha256'

const DB = 'fretwise-backup'
const STORE = 'snapshots'
const KEEP = 5 // newest snapshots of other kinds
// Guest data a sign-in replaced, or data another account left: often the only copy, never removed automatically.
const PROTECTED = ['Guest data before', 'Left by']

export interface Snapshot {
  id: number
  label: string
  sig?: string // what was in it, to skip taking the same snapshot twice
  kv: Record<string, string>
  records: { songs: SongEntry[]; captures: CaptureEntry[]; recordings: RecordingEntry[] }
}

const STORES: RecordStore[] = ['songs', 'captures', 'recordings']

// Label and fingerprint of each snapshot, so keeping and pruning never loads the snapshots themselves.
const INFO = 'info'
interface Info {
  id: number
  label: string
  sig?: string
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(INFO)) {
        const info = db.createObjectStore(INFO, { keyPath: 'id' })
        // Snapshots from before: copy their labels over once.
        const cur = req.transaction!.objectStore(STORE).openCursor()
        cur.onsuccess = () => {
          const c = cur.result
          if (!c) return
          const s = c.value as Snapshot
          info.put({ id: s.id, label: s.label })
          c.continue()
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, name = STORE): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(name, mode)
        const req = fn(t.objectStore(name))
        // Resolve once the write is on disk, not just queued.
        t.oncomplete = () => resolve(req.result)
        t.onerror = () => reject(t.error ?? req.error)
        t.onabort = () => reject(t.error ?? new Error('Backup aborted'))
      }),
  )
}

const isProtected = (label: string) => PROTECTED.some((p) => label.startsWith(p))

/** A short fingerprint of a snapshot's contents (keys, values, record ids, sizes and details). */
async function signature(s: Snapshot): Promise<string> {
  const parts: unknown[] = [Object.entries(s.kv).sort()]
  for (const store of STORES)
    for (const e of s.records[store] as AnyEntry[]) {
      const meta: Record<string, unknown> = { ...e }
      delete meta.data
      parts.push([store, e.id, e.data.byteLength, JSON.stringify(meta)])
    }
  return sha256Hex(new TextEncoder().encode(JSON.stringify(parts)).buffer as ArrayBuffer)
}

async function save(s: Snapshot): Promise<void> {
  s.sig = await signature(s)
  const all = await tx<Info[]>('readonly', (st) => st.getAll(), INFO)
  // The same data under the same label is already kept (e.g. a sign-in tried again).
  if (all.some((o) => o.label === s.label && o.sig === s.sig)) return
  await tx('readwrite', (st) => st.put(s))
  await tx('readwrite', (st) => st.put({ id: s.id, label: s.label, sig: s.sig }), INFO)
  const others = [...all, s].filter((o) => !isProtected(o.label)).sort((a, b) => b.id - a.id)
  for (const o of others.slice(KEEP)) {
    await tx('readwrite', (st) => st.delete(o.id))
    await tx('readwrite', (st) => st.delete(o.id), INFO)
  }
}

const emptyRecords = (): Snapshot['records'] => ({ songs: [], captures: [], recordings: [] })

function readKv(keys: string[]): Record<string, string> {
  const kv: Record<string, string> = {}
  for (const k of keys) {
    const v = localStorage.getItem(k)
    if (v !== null) kv[k] = v
  }
  return kv
}

/** Every synced key and every record in this browser. Throws if it can't be written. */
export async function snapshotAll(label: string): Promise<void> {
  const records = emptyRecords()
  records.songs = (await rawGetAll('songs')) as SongEntry[]
  records.captures = (await rawGetAll('captures')) as CaptureEntry[]
  records.recordings = (await rawGetAll('recordings')) as RecordingEntry[]
  await save({ id: Date.now(), label, kv: readKv(presentSyncedKeys()), records })
}

/** Only the given keys and records ("store/id"), e.g. changes that never reached the account. */
export async function snapshotSome(label: string, keys: string[], sids: string[]): Promise<void> {
  const records = emptyRecords()
  for (const sid of sids) {
    const i = sid.indexOf('/')
    const store = sid.slice(0, i) as RecordStore
    if (!STORES.includes(store)) continue
    const e = await rawGet(store, sid.slice(i + 1))
    if (e) (records[store] as AnyEntry[]).push(e)
  }
  await save({ id: Date.now(), label, kv: readKv(keys), records })
}

/** True when this browser holds anything that would follow an account. */
export async function hasLocalData(): Promise<boolean> {
  if (presentSyncedKeys().length) return true
  for (const s of STORES) if ((await rawKeys(s)).length) return true
  return false
}

export async function listBackups(): Promise<{ id: number; label: string; keys: number; records: number }[]> {
  const all = await tx<Snapshot[]>('readonly', (st) => st.getAll())
  return all
    .sort((a, b) => b.id - a.id)
    .map((s) => ({
      id: s.id,
      label: s.label,
      keys: Object.keys(s.kv).length,
      records: s.records.songs.length + s.records.captures.length + s.records.recordings.length,
    }))
}

/** Writes a snapshot back over this browser's data (and so to the account when signed in). Reload after. */
export async function restoreBackup(id: number): Promise<void> {
  const s = await tx<Snapshot | undefined>('readonly', (st) => st.get(id))
  if (!s) throw new Error('No such backup')
  for (const [k, v] of Object.entries(s.kv)) localStorage.setItem(k, v)
  for (const store of STORES) {
    for (const e of s.records[store] as AnyEntry[]) {
      await rawPut(store, e)
      noteRecord(store, e.id)
    }
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { fretwiseBackup: unknown }).fretwiseBackup = { listBackups, restoreBackup }
}
