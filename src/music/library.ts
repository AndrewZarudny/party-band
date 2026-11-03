// Personal song library: imported Guitar Pro files kept in IndexedDB.

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

export const listSongs = () => run<SongEntry[]>('readonly', (s) => s.getAll())
export const saveSong = (e: SongEntry) => run('readwrite', (s) => s.put(e))
export const deleteSong = (id: string) => run('readwrite', (s) => s.delete(id))

export const getCapture = (id: string) => run<CaptureEntry | undefined>('readonly', (s) => s.get(id), CAPTURES)
export const listCaptures = () => run<CaptureEntry[]>('readonly', (s) => s.getAll(), CAPTURES)
export const saveCapture = (c: CaptureEntry) => run('readwrite', (s) => s.put(c), CAPTURES)

/** The user's own copy of a song, to jam along with (kept only in this browser). */
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
export const saveRecording = (r: RecordingEntry) => run('readwrite', (s) => s.put(r), RECORDINGS)
export const deleteRecording = (id: string) => run('readwrite', (s) => s.delete(id), RECORDINGS)
