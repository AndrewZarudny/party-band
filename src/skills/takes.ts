// Recorded takes, kept in this browser only (IndexedDB): the newest five, each with a short note.
const DB = 'fretwise-takes'
const STORE = 'takes'
export const KEEP = 5

export interface Take {
  id: string
  at: number
  blob: Blob
  sec: number
  band: string | null // the backing used, or null for guitar only
  note: string
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexedDB'))
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open()
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const req = fn(t.objectStore(STORE))
      t.oncomplete = () => resolve(req ? req.result : undefined)
      t.onerror = () => reject(t.error ?? new Error('indexedDB'))
      t.onabort = () => reject(t.error ?? new Error('indexedDB'))
    })
  } finally {
    db.close()
  }
}

/** Newest first. Empty when storage is unavailable. */
export async function listTakes(): Promise<Take[]> {
  try {
    const all = ((await tx<Take[]>('readonly', (s) => s.getAll() as IDBRequest<Take[]>)) ?? []) as Take[]
    return all.sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
}

/** Saves a take and drops the oldest beyond five. */
export async function addTake(t: Take): Promise<void> {
  await tx('readwrite', (s) => {
    s.put(t)
  })
  const all = await listTakes()
  for (const old of all.slice(KEEP)) await deleteTake(old.id)
}

export async function saveNote(id: string, note: string): Promise<void> {
  await tx('readwrite', (s) => {
    const req = s.get(id)
    req.onsuccess = () => {
      const t = req.result as Take | undefined
      if (t) s.put({ ...t, note })
    }
  })
}

export async function deleteTake(id: string): Promise<void> {
  await tx('readwrite', (s) => {
    s.delete(id)
  })
}
