// A tiny registry, so the song library can say "this record changed" without importing the sync code.

export type RecordStore = 'songs' | 'captures' | 'recordings'

const listeners: ((store: RecordStore, id: string) => void)[] = []

export function noteRecord(store: RecordStore, id: string): void {
  for (const fn of listeners) {
    try {
      fn(store, id)
    } catch (err) {
      console.warn('Record listener failed', err)
    }
  }
}

export function onRecord(fn: (store: RecordStore, id: string) => void): void {
  listeners.push(fn)
}
