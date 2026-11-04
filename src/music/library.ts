// Personal song library: imported Guitar Pro files kept in IndexedDB.
import type { RecordStore } from '../account/notify'
import { noteRecord } from '../account/notify'

export type { RecordStore }

export interface SongEntry {
  id: string
  title: string
  artist: string
  fileName: string
  addedAt: number
  data: ArrayBuffer
}

const DB = 'guitar-app'
const STORE = 'songs'
const CAPTURES = 'captures'
const RECORDINGS = 'recordings'

/** An amp capture (.nam) or cabinet IR (.wav) the user downloaded or imported. */
export interface CaptureEntry {
  id: string
  kind: 'nam' | 'ir'
  name: string
  gear?: 'amp' | 'amp-cab' | 'pedal'
  creator?: string
  license?: string
  url?: string // page on TONE3000
  addedAt: number
  data: ArrayBuffer
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 3)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(CAPTURES)) db.createObjectStore(CAPTURES, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(RECORDINGS)) db.createObjectStore(RECORDINGS, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, store = STORE): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Runs the change, then tells the account sync which record changed. */
const noted = <T,>(p: Promise<T>, store: RecordStore, id: string) =>
  p.then((r) => {
    noteRecord(store, id)
    return r
  })

export const listSongs = () => run<SongEntry[]>('readonly', (s) => s.getAll())
export const saveSong = (e: SongEntry) => noted(run('readwrite', (s) => s.put(e)), 'songs', e.id)
export const deleteSong = (id: string) => noted(run('readwrite', (s) => s.delete(id)), 'songs', id)

export const getCapture = (id: string) => run<CaptureEntry | undefined>('readonly', (s) => s.get(id), CAPTURES)
export const listCaptures = () => run<CaptureEntry[]>('readonly', (s) => s.getAll(), CAPTURES)
export const saveCapture = (c: CaptureEntry) => noted(run('readwrite', (s) => s.put(c), CAPTURES), 'captures', c.id)

/** The user's own copy of a song, to jam along with (follows the account when signed in). */
export interface RecordingEntry {
  id: string // "title|artist", lower case
  fileName: string
  data: ArrayBuffer
  bpm: number
  firstBeat: number // seconds
  offsetMs: number // fine nudge
  beatShift: number // whole-beat nudge (which beat is "1")
}

export const recordingId = (title: string, artist: string) => `${title}|${artist}`.toLowerCase()
export const getRecording = (id: string) => run<RecordingEntry | undefined>('readonly', (s) => s.get(id), RECORDINGS)
export const saveRecording = (r: RecordingEntry) => noted(run('readwrite', (s) => s.put(r), RECORDINGS), 'recordings', r.id)
export const deleteRecording = (id: string) => noted(run('readwrite', (s) => s.delete(id), RECORDINGS), 'recordings', id)

// ---- For the account sync: same stores, no change notes -------------------------------

export type AnyEntry = SongEntry | CaptureEntry | RecordingEntry

export const rawGet = (store: RecordStore, id: string) => run<AnyEntry | undefined>('readonly', (s) => s.get(id), store)
export const rawGetAll = (store: RecordStore) => run<AnyEntry[]>('readonly', (s) => s.getAll(), store)
export const rawKeys = (store: RecordStore) => run<IDBValidKey[]>('readonly', (s) => s.getAllKeys(), store)
export const rawPut = (store: RecordStore, entry: AnyEntry) => run('readwrite', (s) => s.put(entry), store)
export const rawDelete = (store: RecordStore, id: string) => run('readwrite', (s) => s.delete(id), store)
export const rawClear = (store: RecordStore) => run('readwrite', (s) => s.clear(), store)
