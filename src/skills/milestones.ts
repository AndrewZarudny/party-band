// "Then and now": once a month the player records the same short piece, and can hear the first take next to the
// latest. Kept in this browser (IndexedDB), never pruned: a few small recordings a year. The piece is saved too.

export interface Milestone {
  id: string
  month: string // 'YYYY-MM'
  at: number
  pieceId: string
  pieceTitle: string
  blob: Blob
  sec: number
}

/** The calendar month of a date, 'YYYY-MM'. */
export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/** This month's take is still to record: a piece is chosen and no take of it is from this month. */
export function milestoneDue(ms: Pick<Milestone, 'month' | 'pieceId'>[], pieceId: string | null, now: Date): boolean {
  return !!pieceId && !ms.some((m) => m.pieceId === pieceId && m.month === monthKey(now))
}

/** The first and the latest take of the piece, when they are from different months (else nothing to compare). */
export function thenAndNow<T extends Pick<Milestone, 'month' | 'at' | 'pieceId'>>(ms: T[], pieceId: string | null): { then: T; now: T } | null {
  const mine = ms.filter((m) => m.pieceId === pieceId).sort((a, b) => a.at - b.at)
  if (mine.length < 2) return null
  const then = mine[0]
  const now = mine[mine.length - 1]
  return then.month !== now.month ? { then, now } : null
}

// ---- The chosen piece (a lesson or song part id) ----------------------------------------------------

const PIECE_KEY = 'then-now-piece'
export function loadPiece(): string | null {
  try {
    return localStorage.getItem(PIECE_KEY)
  } catch {
    return null
  }
}
export function savePiece(id: string) {
  try {
    localStorage.setItem(PIECE_KEY, id)
  } catch {
    /* storage unavailable */
  }
}

// ---- Storage ------------------------------------------------------------------------------------------

const DB = 'fretwise-milestones'
const STORE = 'milestones'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
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

/** Oldest first. Empty when storage is unavailable. */
export async function listMilestones(): Promise<Milestone[]> {
  try {
    const all = ((await tx<Milestone[]>('readonly', (s) => s.getAll() as IDBRequest<Milestone[]>)) ?? []) as Milestone[]
    return all.sort((a, b) => a.at - b.at)
  } catch {
    return []
  }
}

/** Saves this month's take of the piece (a second one this month replaces the first). */
export async function addMilestone(m: Milestone): Promise<void> {
  const same = (await listMilestones()).filter((x) => x.pieceId === m.pieceId && x.month === m.month)
  await tx('readwrite', (s) => {
    for (const x of same) s.delete(x.id)
    s.put(m)
  })
}
