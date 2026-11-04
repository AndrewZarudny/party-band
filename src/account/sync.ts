// Keeps this browser and the signed-in account in step.
// Push: every change to a synced key or record is sent about a second later (kv in one call, files once per hash).
// Pull: changes from other browsers are written only while nothing is mounted (at boot, or right before a reload),
// because components read storage once at mount and would otherwise write their old copy back.
import { onKvChange, rawRemove, rawSet, setApplying } from './install'
import { SIGN_OUT_EXTRA, SYNC_STATE_KEY, isLiveKey, isSyncedKey, presentSyncedKeys } from './keys'
import { beforeSignOut, reloadHeld, stopForSignOut } from './activity'
import type { RecordStore } from './notify'
import { onRecord } from './notify'
import type { StoredAccount, SyncState } from './session'
import { getAccountState, loadStoredAccount, readSync, setAccountState, storeAccount, updateSync, writeSync } from './session'
import type { Changes, KvItem, PushRecord, RecordItem } from './api'
import * as api from './api'
import { ApiError, isOffline } from './api'
import { sha256Hex } from './sha256'
import { isMergeKey, mergeLessonsProgress, mergeValues } from './merge'
import { hasLocalData, snapshotAll, snapshotSome } from './backup'
import type { AnyEntry } from '../music/library'
import { rawClear, rawDelete, rawGet, rawKeys, rawPut } from '../music/library'

const STORES: RecordStore[] = ['songs', 'captures', 'recordings']
const DEBOUNCE_MS = 1000
const MAX_WAIT_MS = 5000
const BOOT_WAIT_MS = 2500
const VISIBLE_GAP_MS = 15000
const KEEPALIVE_MAX = 60000

const sidOf = (store: RecordStore, id: string) => `${store}/${id}`
function splitSid(sid: string): [RecordStore, string] | null {
  const i = sid.indexOf('/')
  const store = sid.slice(0, i) as RecordStore
  return i > 0 && STORES.includes(store) ? [store, sid.slice(i + 1)] : null
}

const OUT_OF_SPACE = 'This browser is out of space for Fretwise data.'

// ---- Module state ------------------------------------------------------------------

let booted = false // boot ran: background work allowed (never in the /join view)
let signedOut = false // the server refused the token
let offline = false
let needPull = false // a pull failed for lack of network; retry it with the push
let cycleError: string | null = null
let inflight: Promise<void> | null = null
let again = false
let timer = 0
let firstDirtyAt = 0
let retryTimer = 0
let backoff = 0
let busy = false // a pull-and-reload or sign-in/out is running
let needMerge = false // the first merge couldn't run at boot: retry it in this session
let mergeWrote = false // the first merge started changing this browser's data
let otherTab = false // another tab of this browser changed synced data: this tab's copy is old
const ERROR_KEY = 'fretwise-account-error' // sessionStorage: an error to show after a reload

// Pulled changes waiting for the reload (server copies, decided again at apply time).
interface Buffer {
  kv: Record<string, KvItem>
  records: Record<string, RecordItem>
  rev: number | null
}
const emptyBuffer = (): Buffer => ({ kv: {}, records: {}, rev: null })
let buffer = emptyBuffer()
// List keys whose push came back stale: they stay dirty (for the merge at apply) but aren't re-sent meanwhile.
const staleKeys = new Set<string>()
// Live keys: the newest server time seen. A push is stamped past it, so another browser's clock running
// ahead doesn't make every push from here come back stale.
const serverT: Record<string, number> = {}
let liveRetries = 0 // live re-pushes in a row that came back stale; capped
const LIVE_RETRY_MAX = 3

/** The time a dirty key is sent with. */
function sendT(k: string, dirty: number) {
  return isLiveKey(k) ? Math.max(dirty, (serverT[k] ?? 0) + 1) : dirty
}

function bufferKv(k: string, item: KvItem) {
  if (isLiveKey(k)) serverT[k] = Math.max(serverT[k] ?? 0, item.t)
  const cur = buffer.kv[k]
  const newer = !cur || (item.rev !== undefined && cur.rev !== undefined ? item.rev >= cur.rev : item.t >= cur.t)
  if (newer) buffer.kv[k] = item
}
function bufferRecord(r: RecordItem) {
  const sid = sidOf(r.store, r.id)
  const cur = buffer.records[sid]
  if (!cur || r.t >= cur.t) buffer.records[sid] = r
}
function bufferChanges(c: Changes) {
  for (const [k, item] of Object.entries(c.kv)) bufferKv(k, item)
  for (const r of c.records) bufferRecord(r)
  buffer.rev = Math.max(buffer.rev ?? 0, c.rev)
}
const bufferEmpty = () => !Object.keys(buffer.kv).length && !Object.keys(buffer.records).length

function pendingKeys(s: SyncState) {
  return Object.keys(s.dirtyKv).filter((k) => !staleKeys.has(k))
}
const hasDirty = (s: SyncState | null) => !!s && (pendingKeys(s).length > 0 || Object.keys(s.dirtyRec).length > 0)

function refreshStatus() {
  const a = loadStoredAccount()
  if (!a) {
    setAccountState({ account: null, status: 'guest', error: null })
    return
  }
  const s = readSync()
  const st = getAccountState()
  const status = signedOut
    ? 'signed-out'
    : offline
      ? 'offline'
      : st.error
        ? 'error'
        : inflight || hasDirty(s) || s?.firstMerge
          ? 'saving'
          : 'saved'
  const account = st.account?.id === a.id && st.account.name === a.name ? st.account : { id: a.id, name: a.name }
  setAccountState({ account, status })
}

/** Signed in with a usable sync state (the first merge is done). */
function ready(): { a: StoredAccount; s: SyncState } | null {
  const a = loadStoredAccount()
  const s = readSync()
  if (!a || !s || s.firstMerge || !s.userId || signedOut) return null
  return { a, s }
}

function handleError(err: unknown) {
  if (err instanceof ApiError && err.code === 'signed-out') signedOut = true
  else if (isOffline(err)) {
    offline = true
    scheduleRetry()
  } else {
    console.warn('Account sync:', err)
    setAccountState({ error: err instanceof Error ? err.message : String(err) })
  }
  refreshStatus()
}

// ---- Change notes --------------------------------------------------------------------

// Noted even while the first merge is waiting: an edit made then beats the account's older copy in the merge.
onKvChange((k) => {
  if (!loadStoredAccount()) return
  const s = updateSync((st) => {
    st.dirtyKv[k] = Date.now()
  })
  staleKeys.delete(k)
  if (isLiveKey(k)) liveRetries = 0 // a new save: the live key may try again
  if (s) schedulePush()
})

onRecord((store, id) => {
  if (!loadStoredAccount()) return
  const sid = sidOf(store, id)
  const s = updateSync((st) => {
    st.dirtyRec[sid] = Date.now()
    if (st.hashes) delete st.hashes[sid]
  })
  if (s) schedulePush()
})

// ---- Push ------------------------------------------------------------------------

function schedulePush() {
  if (!booted) return
  const now = Date.now()
  if (!firstDirtyAt) firstDirtyAt = now
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void flush(), Math.max(0, Math.min(DEBOUNCE_MS, firstDirtyAt + MAX_WAIT_MS - now)))
  refreshStatus()
}

function scheduleRetry() {
  if (!booted) return
  backoff = backoff ? Math.min(backoff * 2, 60000) : 2000
  window.clearTimeout(retryTimer)
  retryTimer = window.setTimeout(retryNow, backoff)
}

function retryNow() {
  window.clearTimeout(retryTimer)
  if (needMerge) {
    void retryFirstMerge()
    return
  }
  if (needPull) void backgroundPull()
  void flush()
}

/** Sends everything that changed here; resolves when done (or failed). */
export function flush(): Promise<void> {
  if (inflight) {
    again = true
    return inflight
  }
  window.clearTimeout(timer)
  firstDirtyAt = 0
  inflight = (async () => {
    try {
      cycleError = null
      await pushOnce()
      offline = false
      backoff = 0
      setAccountState({ error: cycleError })
    } catch (err) {
      handleError(err)
    }
  })()
  const p = inflight
  void p.then(() => {
    inflight = null
    refreshStatus()
    if (again) {
      again = false
      if (hasDirty(readSync())) schedulePush()
    }
  })
  refreshStatus()
  return p
}

function metaOf(e: AnyEntry): Record<string, unknown> {
  const m: Record<string, unknown> = { ...e }
  delete m.data
  return m
}

async function ensureContent(token: string, hash: string, data: ArrayBuffer) {
  if (!(await api.hasContent(token, hash))) await api.putContent(token, hash, data)
}

type Report = (done: number, total: number) => void

async function pushOnce(report?: Report): Promise<void> {
  const r = ready()
  if (!r) return
  const { a } = r
  let s = r.s
  const keys = pendingKeys(s)
  const sids = Object.keys(s.dirtyRec)
  const total = sids.length + (keys.length ? 1 : 0)
  let done = 0

  // Key/values, in batches under the server's limits.
  let batch: Record<string, KvItem> = {}
  const stamps: Record<string, number> = {} // key → the dirty time it was sent for
  let count = 0
  let bytes = 0
  const sendKv = async () => {
    if (!count) return
    const items = batch
    batch = {}
    count = 0
    bytes = 0
    const res = await api.putKv(a.token, items)
    let stale = false
    updateSync((st) => {
      st.kvRev ??= {}
      st.refusedKv ??= {}
      for (const k of res.applied) {
        if (st.dirtyKv[k] === stamps[k]) delete st.dirtyKv[k]
        delete st.refusedKv[k]
        const rev = res.revs?.[k]
        if (rev !== undefined && isMergeKey(k)) st.kvRev[k] = rev
        if (isLiveKey(k) && items[k]) serverT[k] = Math.max(serverT[k] ?? 0, items[k].t)
      }
      // Refused: only this browser has it now, so sign-out backs it up.
      for (const k of Object.keys(res.rejected)) {
        if (st.dirtyKv[k] !== stamps[k]) continue
        delete st.dirtyKv[k]
        if (items[k]?.v !== null) st.refusedKv[k] = true
      }
      for (const k of Object.keys(res.stale)) if (!isMergeKey(k) && st.dirtyKv[k] === stamps[k]) delete st.dirtyKv[k]
    })
    let live = false
    for (const [k, item] of Object.entries(res.stale)) {
      bufferKv(k, item)
      if (isMergeKey(k)) staleKeys.add(k)
      if (isLiveKey(k)) live = true
      else stale = true
    }
    if (res.applied.some(isLiveKey)) liveRetries = 0
    // Practice time from another browser: merge it in now (no reload) and send the result.
    // A few tries in a row at most; after that it waits for the next practice save.
    if (live && liveRetries < LIVE_RETRY_MAX) {
      liveRetries++
      void backgroundPull().then(() => {
        if (hasDirty(readSync())) schedulePush()
      })
    }
    for (const [k, why] of Object.entries(res.rejected)) {
      console.warn(`Account didn't take "${k}": ${why}`)
      if (why === 'quota') cycleError = 'Your account has no room for more settings and song setups (20 MB).'
    }
    if (stale) setAccountState({ reloadReady: true })
  }
  for (const k of keys) {
    let v: string | null = null
    try {
      v = localStorage.getItem(k)
    } catch {
      continue
    }
    const size = (v?.length ?? 0) * 2 + k.length + 40
    if (count && (count >= 1500 || bytes + size > 16 * 1024 * 1024)) await sendKv()
    // A list is sent with the account version it was edited from; the server refuses it if that's old.
    stamps[k] = s.dirtyKv[k]
    const t = sendT(k, s.dirtyKv[k])
    batch[k] = isMergeKey(k) ? { v, t, base: s.kvRev?.[k] ?? 0 } : { v, t }
    count++
    bytes += size
  }
  await sendKv()
  if (keys.length) report?.(++done, total)

  // Records: files first (once per hash), then the small records.
  s = readSync() ?? s
  // Deletions first, then records whose file the account has, then new uploads: one upload the account
  // can't take (full) must not hold back the deletions that would make room.
  const present = new Map<RecordStore, Set<string>>()
  for (const st of STORES) present.set(st, new Set((await rawKeys(st)).map(String)))
  const rank = (sid: string) => {
    const p = splitSid(sid)
    if (!p || !present.get(p[0])?.has(p[1])) return 0
    return s.hashes?.[sid] ? 1 : 2
  }
  sids.sort((x, y) => rank(x) - rank(y))
  let items: PushRecord[] = []
  const hashSid = new Map<string, string>()
  for (const sid of sids) {
    const t = s.dirtyRec[sid]
    const parts = splitSid(sid)
    if (!parts || t === undefined) {
      updateSync((st) => void delete st.dirtyRec[sid])
      continue
    }
    const [store, id] = parts
    const e = await rawGet(store, id)
    if (!e) items.push({ store, id, t, deleted: true })
    else {
      const hash = await sha256Hex(e.data)
      try {
        await ensureContent(a.token, hash, e.data)
      } catch (err) {
        if (err instanceof ApiError && err.code === 'too-large') {
          // Never fits: stop sending it, but remember it's only here.
          console.warn(`"${sid}" is too big for the account`)
          cycleError = err.message
          updateSync((st) => {
            if (st.dirtyRec[sid] === t) delete st.dirtyRec[sid]
            st.refusedRec = { ...st.refusedRec, [sid]: true }
          })
          report?.(++done, total)
          continue
        }
        if (err instanceof ApiError && (err.code === 'quota' || err.code === 'disk')) {
          // No room now: stays waiting, and the rest still goes out.
          cycleError = err.message
          report?.(++done, total)
          continue
        }
        throw err
      }
      hashSid.set(hash, sid)
      items.push({ store, id, meta: metaOf(e), hash, size: e.data.byteLength, t })
    }
    report?.(++done, total)
    if (items.length >= 200) {
      await sendRecords(a.token, items, hashSid)
      items = []
    }
  }
  if (items.length) await sendRecords(a.token, items, hashSid)
}

async function sendRecords(token: string, items: PushRecord[], hashSid: Map<string, string>) {
  let res = await api.putRecords(token, items)
  const applied = [...res.applied]
  const stale = [...res.stale]
  const rejected = { ...res.rejected }
  if (res.missing.length) {
    // Uploaded content the server doesn't have (e.g. cleaned up meanwhile): upload again, retry once.
    const missing = new Set(res.missing)
    for (const h of missing) {
      const parts = splitSid(hashSid.get(h) ?? '')
      const e = parts ? await rawGet(parts[0], parts[1]) : undefined
      if (e && (await sha256Hex(e.data)) === h) await api.putContent(token, h, e.data)
    }
    const retry = items.filter((i) => 'hash' in i && i.hash && missing.has(i.hash))
    if (retry.length) {
      res = await api.putRecords(token, retry)
      applied.push(...res.applied)
      stale.push(...res.stale)
      Object.assign(rejected, res.rejected)
    }
  }
  const bySid = new Map(items.map((i) => [sidOf(i.store, i.id), i]))
  updateSync((st) => {
    st.hashes ??= {}
    st.refusedRec ??= {}
    for (const sid of applied) {
      const i = bySid.get(sid)
      if (!i) continue
      if (st.dirtyRec[sid] === i.t) delete st.dirtyRec[sid]
      delete st.refusedRec[sid]
      if ('hash' in i && i.hash && !i.deleted) st.hashes[sid] = i.hash
      else delete st.hashes[sid]
    }
    for (const sid of Object.keys(rejected)) {
      const i = bySid.get(sid)
      if (!i || st.dirtyRec[sid] !== i.t) continue
      if (rejected[sid] === 'quota') continue // no room now: try again later
      delete st.dirtyRec[sid]
      if (!i.deleted) st.refusedRec[sid] = true
    }
    // The account has a newer copy: it wins, and arrives with the reload.
    for (const r of stale) delete st.dirtyRec[sidOf(r.store, r.id)]
  })
  for (const [sid, why] of Object.entries(rejected)) {
    console.warn(`Account didn't take "${sid}": ${why}`)
    if (why === 'quota') cycleError = 'Your account has no room for more song details. Remove some songs or recordings.'
  }
  if (stale.length) {
    stale.forEach(bufferRecord)
    setAccountState({ reloadReady: true })
  }
}

// ---- Pull ------------------------------------------------------------------------

interface KvWrite {
  k: string
  v: string | null
  dirty: 'drop' | 'bump'
}
type RecWrite =
  | { kind: 'put'; sid: string; item: RecordItem; reuse: AnyEntry | null }
  | { kind: 'delete'; sid: string; store: RecordStore; id: string; repoint?: string }
interface Plan {
  kv: KvWrite[]
  records: RecWrite[]
  dropRec: string[]
  hashes: Record<string, string>
  revs: Record<string, number> // list key → account rev this browser's copy now includes
  changed: boolean
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .filter((k) => k !== 'id' && k !== 'data' && o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

const readLocal = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}

/** What applying these server items would change here, by the rules in the spec (section 6.5). */
async function decide(kv: Record<string, KvItem>, records: RecordItem[], s: SyncState): Promise<Plan> {
  const plan: Plan = { kv: [], records: [], dropRec: [], hashes: {}, revs: {}, changed: false }

  for (const [k, item] of Object.entries(kv)) {
    if (!isSyncedKey(k)) continue
    const local = readLocal(k)
    const d = s.dirtyKv[k]
    const merge = isMergeKey(k)
    // A list version this browser hasn't seen is always merged in, even when our edit is newer.
    const unseen = merge && item.rev !== undefined && item.rev > (s.kvRev?.[k] ?? 0)
    if (d !== undefined && d > item.t && !unseen) continue // ours is newer and will be sent
    if (merge && item.rev !== undefined) plan.revs[k] = item.rev
    if (item.v === local) {
      if (d !== undefined) plan.kv.push({ k, v: local, dirty: 'drop' })
      continue
    }
    if (d !== undefined && merge) {
      // The newer side wins per item; the other side's extra items are kept.
      const merged = d > item.t ? mergeValues(k, local, item.v) : mergeValues(k, item.v, local)
      if (merged !== null) {
        plan.kv.push({ k, v: merged, dirty: merged === item.v ? 'drop' : 'bump' })
        if (merged !== local && !isLiveKey(k)) plan.changed = true
        continue
      }
    }
    plan.kv.push({ k, v: item.v, dirty: 'drop' })
    // A live key is read fresh, so writing it needs no reload.
    if (!isLiveKey(k)) plan.changed = true
  }

  // Hashes of songs added here and not sent yet: the same file pulled under another id replaces them.
  let localSongs: Map<string, string> | null = null
  const localSongHashes = async () => {
    if (localSongs) return localSongs
    localSongs = new Map()
    for (const sid of Object.keys(s.dirtyRec)) {
      const parts = splitSid(sid)
      if (!parts || parts[0] !== 'songs') continue
      const e = await rawGet('songs', parts[1])
      if (e) localSongs.set(await sha256Hex(e.data), parts[1])
    }
    return localSongs
  }

  for (const item of records) {
    if (!STORES.includes(item.store)) continue
    const sid = sidOf(item.store, item.id)
    const d = s.dirtyRec[sid]
    if (d !== undefined && d > item.t) continue
    const local = await rawGet(item.store, item.id)
    if (item.deleted || !item.hash || !item.meta) {
      if (local) {
        plan.records.push({ kind: 'delete', sid, store: item.store, id: item.id })
        plan.changed = true
      } else if (d !== undefined) plan.dropRec.push(sid)
      continue
    }
    if (local) {
      const lh = (d === undefined ? s.hashes?.[sid] : undefined) ?? (await sha256Hex(local.data))
      if (lh === item.hash) {
        plan.hashes[sid] = lh
        if (stable(metaOf(local)) === stable(item.meta)) {
          if (d !== undefined) plan.dropRec.push(sid)
          continue
        }
        plan.records.push({ kind: 'put', sid, item, reuse: local })
        plan.changed = true
        continue
      }
    }
    plan.records.push({ kind: 'put', sid, item, reuse: null })
    plan.changed = true
    if (item.store === 'songs') {
      const other = (await localSongHashes()).get(item.hash)
      if (other !== undefined && other !== item.id)
        plan.records.push({ kind: 'delete', sid: sidOf('songs', other), store: 'songs', id: other, repoint: item.id })
    }
  }
  return plan
}

interface Progress {
  bytes: (done: number, total: number) => void
  count?: (done: number, total: number) => void
}

/** Writes a plan. Returns false when stopped early (skip); what was written stays written. */
async function execute(token: string, plan: Plan, progress?: Progress, signal?: AbortSignal): Promise<boolean> {
  const bumped = new Set<string>()
  setApplying(true)
  try {
    for (const w of plan.kv) {
      let v = w.v
      // A live key may have been saved here while the plan was being decided: merge that in too.
      if (v !== null && isLiveKey(w.k)) {
        const now = readLocal(w.k)
        if (now !== null && now !== v) {
          const merged = mergeValues(w.k, now, v) ?? v
          if (merged !== v) bumped.add(w.k)
          v = merged
        }
      }
      if (v === null) rawRemove(w.k)
      else rawSet(w.k, v)
    }
  } catch (err) {
    setAccountState({ error: OUT_OF_SPACE })
    throw err
  } finally {
    setApplying(false)
  }
  updateSync((st) => {
    st.refusedKv ??= {}
    for (const w of plan.kv) {
      if (w.dirty === 'bump' || bumped.has(w.k)) st.dirtyKv[w.k] = Date.now()
      else delete st.dirtyKv[w.k]
      staleKeys.delete(w.k)
      delete st.refusedKv[w.k] // the account's copy is here now
    }
    st.kvRev = { ...st.kvRev, ...plan.revs }
    st.hashes = { ...st.hashes, ...plan.hashes }
    for (const sid of plan.dropRec) delete st.dirtyRec[sid]
  })

  if (!plan.records.length) return true
  try {
    return await writeRecords(token, plan, progress, signal)
  } finally {
    // Other tabs can't see record writes (IndexedDB): this tells them their screens hold old copies.
    updateSync((st) => void (st.recRev = (st.recRev ?? 0) + 1))
  }
}

async function writeRecords(token: string, plan: Plan, progress?: Progress, signal?: AbortSignal): Promise<boolean> {
  const downloads = plan.records.filter((w) => w.kind === 'put' && !w.reuse)
  const totalBytes = downloads.reduce((n, w) => n + (w.kind === 'put' ? w.item.size : 0), 0)
  let doneBytes = 0
  let doneCount = 0
  for (const w of plan.records) {
    if (signal?.aborted) return false
    if (w.kind === 'delete') {
      await rawDelete(w.store, w.id)
      updateSync((st) => {
        delete st.dirtyRec[w.sid]
        if (st.hashes) delete st.hashes[w.sid]
        if (st.refusedRec) delete st.refusedRec[w.sid]
      })
      if (w.repoint && readLocal('last-song') === w.id) {
        try {
          localStorage.setItem('last-song', w.repoint)
        } catch {
          /* storage unavailable */
        }
      }
      continue
    }
    const { item } = w
    let data: ArrayBuffer
    if (w.reuse) data = w.reuse.data
    else {
      try {
        data = await api.getContent(
          token,
          item.hash!,
          (n) => {
            doneBytes += n
            progress?.bytes(doneBytes, totalBytes)
          },
          signal,
        )
      } catch (err) {
        if (signal?.aborted) return false
        if (err instanceof ApiError && err.status === 404) {
          console.warn(`Account file for "${w.sid}" is missing`)
          continue
        }
        throw err
      }
      progress?.count?.(++doneCount, downloads.length)
    }
    try {
      await rawPut(item.store, { ...item.meta, id: item.id, data } as AnyEntry)
    } catch (err) {
      setAccountState({ error: OUT_OF_SPACE })
      throw err
    }
    updateSync((st) => {
      delete st.dirtyRec[w.sid]
      if (st.refusedRec) delete st.refusedRec[w.sid]
      st.hashes = { ...st.hashes, [w.sid]: item.hash! }
    })
  }
  return true
}

function saveRev(rev: number | null) {
  if (rev !== null) updateSync((st) => void (st.rev = Math.max(st.rev, rev)))
}

/** Applies everything waiting (and anything newer on the server). Returns false when stopped early. */
async function applyBuffer(token: string, progress?: Progress, signal?: AbortSignal): Promise<boolean> {
  const s = readSync()
  if (!s) return false
  const plan = await decide(buffer.kv, Object.values(buffer.records), s)
  const done = await execute(token, plan, progress, signal)
  if (done) {
    saveRev(buffer.rev)
    buffer = emptyBuffer()
    staleKeys.clear()
    setAccountState({ reloadReady: false })
  }
  return done
}

/**
 * Other changes wait for a reload: write the live keys of the plan now (they need none), so practice time
 * pulled in is merged and sent instead of waiting stale. The rest stays in the buffer.
 */
async function applyLive(token: string, plan: Plan) {
  const kv = plan.kv.filter((w) => isLiveKey(w.k))
  if (!kv.length) return
  const revs: Record<string, number> = {}
  for (const w of kv) {
    if (plan.revs[w.k] !== undefined) revs[w.k] = plan.revs[w.k]
    delete buffer.kv[w.k]
  }
  await execute(token, { kv, records: [], dropRec: [], hashes: {}, revs, changed: false })
}

/** Pulled after render: keep it for the reload, unless nothing would change. */
async function backgroundPull(pending?: Promise<Changes>) {
  const r = ready()
  if (!r) return
  needPull = false
  try {
    bufferChanges(await (pending ?? api.changes(r.a.token, r.s.rev)))
    offline = false
    const s = readSync()
    if (!s) return
    const plan = await decide(buffer.kv, Object.values(buffer.records), s)
    if (plan.changed) {
      await applyLive(r.a.token, plan)
      setAccountState({ reloadReady: true })
    } else {
      // Only our own changes came back: note them and move on.
      await execute(r.a.token, plan)
      saveRev(buffer.rev)
      buffer = emptyBuffer()
    }
  } catch (err) {
    if (isOffline(err)) needPull = true
    handleError(err)
  }
  refreshStatus()
}

function reloadNow() {
  // Nothing written during unload may count as a new change.
  setApplying(true)
  location.reload()
}

/** The "Updated elsewhere. Reload" pill. */
export async function reloadWithUpdates(): Promise<void> {
  const r = ready()
  if (!r || busy) return reloadNow()
  busy = true
  const label = 'Getting the latest changes…'
  setAccountState({ progress: { done: 0, total: 1, label } })
  try {
    try {
      bufferChanges(await api.changes(r.a.token, r.s.rev))
    } catch {
      /* apply what we have */
    }
    await applyBuffer(r.a.token, { bytes: (done, total) => setAccountState({ progress: { done, total, label } }) })
  } catch (err) {
    console.warn('Reload with updates:', err)
  }
  reloadNow()
}

// Coming back to this tab: send what's waiting, fetch what changed elsewhere, reload if anything did.
let lastVisible = 0
async function onVisible() {
  const st = getAccountState()
  if (!booted || busy || st.dialog || st.progress) return
  if (needMerge) return retryNow()
  const r = ready()
  if (!r) return
  // Another tab of this browser changed synced data: this tab's screens hold the old copy.
  if (otherTab) {
    if (reloadHeld()) return setAccountState({ reloadReady: true })
    otherTab = false
    return reloadWithUpdates()
  }
  if (Date.now() - lastVisible < VISIBLE_GAP_MS) return
  lastVisible = Date.now()
  busy = true
  try {
    await flush()
    const s = readSync()
    if (!s) return
    bufferChanges(await api.changes(r.a.token, s.rev))
    offline = false
    const plan = await decide(buffer.kv, Object.values(buffer.records), s)
    if (!plan.changed) {
      await execute(r.a.token, plan)
      saveRev(buffer.rev)
      buffer = emptyBuffer()
      setAccountState({ reloadReady: false })
      return
    }
    // Something is playing (or a lesson is open): the changes wait for the user's Reload.
    if (reloadHeld()) {
      await applyLive(r.a.token, plan)
      if (hasDirty(readSync())) schedulePush()
      return setAccountState({ reloadReady: true })
    }
    if (await applyBuffer(r.a.token)) reloadNow()
  } catch (err) {
    handleError(err)
  } finally {
    busy = false
    refreshStatus()
  }
}

if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void onVisible()
  })
  window.addEventListener('online', () => {
    if (booted && (needMerge || ready())) retryNow()
  })
  window.addEventListener('focus', () => {
    if (booted && offline && (needMerge || ready())) retryNow()
  })
  // Another tab wrote synced data, or pulled from the account: reload this one before it writes old copies back.
  window.addEventListener('storage', (ev) => {
    if (!booted || !ev.key || ev.storageArea !== localStorage) return
    // Only pulls that wrote records (or a different account) count: synced keys raise their own events, and
    // practice time pulled in (a live key) changes no screen. A bare rev bump happens after any pull.
    const markOf = (raw: string | null) => {
      try {
        const s = JSON.parse(raw ?? 'null') as { recRev?: unknown; userId?: unknown } | null
        return `${String(s?.userId ?? '')}/${Number(s?.recRev) || 0}`
      } catch {
        return ''
      }
    }
    const pulled = ev.key === SYNC_STATE_KEY && markOf(ev.newValue) !== markOf(ev.oldValue)
    if (!pulled && (!isSyncedKey(ev.key) || isLiveKey(ev.key))) return
    if (!ready()) return
    otherTab = true
    if (document.visibilityState === 'visible') setAccountState({ reloadReady: true })
  })
  // Closing the tab: small key/value changes go out with a keepalive request; files wait for next time.
  window.addEventListener('pagehide', () => {
    const r = booted ? ready() : null
    if (!r) return
    const items: Record<string, KvItem> = {}
    let size = 0
    for (const k of pendingKeys(r.s)) {
      const v = readLocal(k)
      const t = sendT(k, r.s.dirtyKv[k])
      items[k] = isMergeKey(k) ? { v, t, base: r.s.kvRev?.[k] ?? 0 } : { v, t }
      size += (v?.length ?? 0) + k.length + 40
    }
    if (size && size < KEEPALIVE_MAX && new Blob([JSON.stringify({ items })]).size < KEEPALIVE_MAX) api.putKvKeepalive(r.a.token, items)
  })
}

// ---- Boot ------------------------------------------------------------------------

export interface BootLoader {
  show(text: string, onSkip: (() => void) | null): void
  update(text: string): void
  hide(): void
}

const mb = (n: number, total: number) => (total < 10 * 1048576 ? (n / 1048576).toFixed(1) : String(Math.round(n / 1048576)))
const loaderText = (done: number, total: number) => `Getting your songs from your account. ${mb(done, total)} of ${mb(total, total)} MB.`

function timeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([p, new Promise<'timeout'>((r) => window.setTimeout(() => r('timeout'), ms))])
}

/** Before the first render: brings in what changed elsewhere. Guests make no network calls. */
export async function bootAccount(loader: BootLoader): Promise<void> {
  booted = true
  const a = loadStoredAccount()
  if (!a) {
    refreshStatus()
    return
  }
  // An error from just before the last reload (a sign-in that stopped part-way).
  try {
    const msg = sessionStorage.getItem(ERROR_KEY)
    if (msg) {
      sessionStorage.removeItem(ERROR_KEY)
      setAccountState({ error: msg })
    }
  } catch {
    /* storage unavailable */
  }
  let s = readSync()
  if (!s) {
    // Signed in but no sync record (cleared by hand): treat what's here as guest data.
    s = { userId: '', rev: 0, dirtyKv: {}, dirtyRec: {}, hashes: {}, firstMerge: true }
    writeSync(s)
  }
  refreshStatus()
  try {
    if (!a.id || s.firstMerge || !s.userId) {
      const m = await timeout(api.me(a.token), BOOT_WAIT_MS)
      if (m === 'timeout') throw new ApiError('network', 0)
      const acct = { id: m.id, name: m.name, token: a.token }
      storeAccount(acct)
      if (s.firstMerge || !s.userId || s.userId !== m.id) {
        loader.show('Setting up your account in this browser…', null)
        await firstMerge(acct, {
          bytes: (done, total) => loader.update(loaderText(done, total)),
        })
        needMerge = false
        loader.hide()
        refreshStatus()
        void flush()
        return
      }
    }
    const pending = api.changes(a.token, s.rev)
    const c = await timeout(pending, BOOT_WAIT_MS)
    if (c === 'timeout') {
      void backgroundPull(pending)
    } else {
      bufferChanges(c)
      const plan = await decide(buffer.kv, Object.values(buffer.records), s)
      const ctl = new AbortController()
      const big = plan.records.some((w) => w.kind === 'put' && !w.reuse)
      if (big) loader.show(loaderText(0, 1), () => ctl.abort())
      const done = await execute(a.token, plan, { bytes: (d, t) => loader.update(loaderText(d, t)) }, ctl.signal)
      loader.hide()
      if (done) {
        saveRev(buffer.rev)
        buffer = emptyBuffer()
      } else setAccountState({ reloadReady: true })
    }
  } catch (err) {
    loader.hide()
    const now = readSync()
    // The first merge didn't finish: try again in this session (online, visible, retry timer).
    if (!now || now.firstMerge || !now.userId) needMerge = true
    else if (isOffline(err)) needPull = true
    if (!bufferEmpty()) setAccountState({ reloadReady: true })
    handleError(err)
    if (needMerge && !isOffline(err) && !signedOut) scheduleRetry()
  }
  refreshStatus()
  void flush()
}

/** The first merge, after the app is on screen: runs it, then reloads so every screen reads the merged data. */
async function retryFirstMerge(): Promise<void> {
  const a = loadStoredAccount()
  const s = readSync()
  if (!a || !s || signedOut || (!s.firstMerge && s.userId)) {
    needMerge = false
    return
  }
  if (busy) return
  // Not under a playing jam or an open lesson: wait for a quiet moment.
  if (reloadHeld() || getAccountState().dialog) return scheduleRetry()
  busy = true
  mergeWrote = false
  try {
    const m = await api.me(a.token)
    const acct = { id: m.id, name: m.name, token: a.token }
    storeAccount(acct)
    setProgress('Setting up your account in this browser…')
    await firstMerge(acct, { bytes: (d, t) => setProgress(`Getting your songs: ${mb(d, t)} of ${mb(t, t)} MB`, d, t) })
    needMerge = false
    await pushOnce().catch((err) => console.warn('Push after setup:', err))
    reloadNow()
  } catch (err) {
    setAccountState({ progress: null })
    if (mergeWrote) return reloadAfterError(err)
    busy = false
    handleError(err)
    if (!isOffline(err) && !signedOut) scheduleRetry()
  }
}

/** Data here already changed: reload anyway (screens hold old copies) and show the error after. */
function reloadAfterError(err: unknown) {
  console.warn('Account setup stopped part-way:', err)
  try {
    sessionStorage.setItem(ERROR_KEY, err instanceof Error ? err.message : 'Something went wrong. Try again.')
  } catch {
    /* storage unavailable */
  }
  reloadNow()
}

// ---- Sign in, sign up, sign out ----------------------------------------------------

const BACKUP_FAILED = "Couldn't save a backup of this browser's data. Nothing was changed."

/** Removes every synced key and record from this browser (device settings stay). */
async function wipeLocal() {
  setApplying(true)
  try {
    for (const k of presentSyncedKeys()) rawRemove(k)
    for (const k of SIGN_OUT_EXTRA) rawRemove(k)
  } catch {
    /* storage unavailable */
  } finally {
    setApplying(false)
  }
  for (const st of STORES) await rawClear(st)
}

/**
 * First sign-in to an existing account from a browser with guest data: back the guest data up, take the
 * account's copy on conflicts, add what only this browser has. Leaves the account stored; the caller pushes.
 */
async function firstMerge(acct: StoredAccount, progress?: Progress): Promise<void> {
  try {
    await snapshotAll(`Guest data before signing in as ${acct.name}`)
  } catch (err) {
    console.warn('Backup failed', err)
    throw new Error(BACKUP_FAILED)
  }
  const c = await api.changes(acct.token, 0)
  // Edits made here while this merge was waiting (noted with their times) beat older account copies.
  const pending = readSync()
  const prior = pending && (pending.firstMerge || !pending.userId) ? pending : null
  const legacy = !!prior?.legacy
  const mineKv = (k: string, t: number) => (prior?.dirtyKv[k] ?? 0) > t
  const mineRec = (sid: string, t: number) => (prior?.dirtyRec[sid] ?? 0) > t
  const now = Date.now()
  const dirtyKv: Record<string, number> = {}
  const dirtyRec: Record<string, number> = {}
  const hashes: Record<string, string> = {}
  const kvRev: Record<string, number> = {}

  // From here on this browser's data changes. If anything below fails, the next start runs the merge again.
  mergeWrote = true
  storeAccount(acct)
  writeSync({
    userId: '',
    rev: 0,
    dirtyKv: prior?.dirtyKv ?? {},
    dirtyRec: prior?.dirtyRec ?? {},
    hashes: {},
    firstMerge: true,
    ...(legacy ? { legacy: true as const } : {}),
  })

  setApplying(true)
  try {
    for (const [k, item] of Object.entries(c.kv)) {
      if (!isSyncedKey(k)) continue
      if (isMergeKey(k) && item.rev !== undefined) kvRev[k] = item.rev
      const local = readLocal(k)
      const mine = mineKv(k, item.t)
      if (item.v === null) {
        if (local !== null) dirtyKv[k] = now // only here: kept and sent
        continue
      }
      if (local === item.v) continue
      if (local === null) {
        if (mine) dirtyKv[k] = now // removed here after the account's copy: stays removed
        else rawSet(k, item.v)
        continue
      }
      let v: string
      // A Lessons-only account's own progress: combined lesson by lesson; its lesson settings stay.
      if (legacy && k === 'lessons-progress') v = mergeLessonsProgress(local, item.v) ?? local
      else if (mine || (legacy && k === 'lessons-prefs')) v = mergeValues(k, local, item.v) ?? local
      else v = mergeValues(k, item.v, local, true) ?? item.v
      if (v !== local) rawSet(k, v)
      if (v !== item.v) dirtyKv[k] = now
    }
    for (const k of presentSyncedKeys()) if (!(k in c.kv) || c.kv[k].v === null) dirtyKv[k] = now
  } catch (err) {
    setAccountState({ error: OUT_OF_SPACE })
    throw err
  } finally {
    setApplying(false)
  }

  // Records only this browser has are sent; the account's records come down.
  const remote = new Map(c.records.map((r) => [sidOf(r.store, r.id), r]))
  const accountSongs = new Map<string, string>()
  for (const r of c.records) if (r.store === 'songs' && !r.deleted && r.hash) accountSongs.set(r.hash, r.id)
  const localHash = new Map<string, string>()
  for (const store of STORES) {
    for (const key of await rawKeys(store)) {
      const id = String(key)
      const sid = sidOf(store, id)
      const e = await rawGet(store, id)
      if (!e) continue
      const h = await sha256Hex(e.data)
      localHash.set(sid, h)
      const r = remote.get(sid)
      if (r && !r.deleted && !mineRec(sid, r.t)) continue // the account's copy wins below
      const same = store === 'songs' ? accountSongs.get(h) : undefined
      if (same !== undefined && same !== id) {
        // The same file is already in the account under another id.
        await rawDelete(store, id)
        localHash.delete(sid)
        if (readLocal('last-song') === id) {
          try {
            localStorage.setItem('last-song', same)
          } catch {
            /* storage unavailable */
          }
        }
        continue
      }
      dirtyRec[sid] = now
    }
  }
  const plan: Plan = { kv: [], records: [], dropRec: [], hashes: {}, revs: {}, changed: true }
  for (const r of c.records) {
    if (r.deleted || !r.hash || !r.meta || !STORES.includes(r.store)) continue
    const sid = sidOf(r.store, r.id)
    if (mineRec(sid, r.t)) {
      // Changed or removed here after the account's copy: this browser's version is sent instead.
      dirtyRec[sid] = now
      continue
    }
    hashes[sid] = r.hash
    if (localHash.get(sid) === r.hash) {
      const e = await rawGet(r.store, r.id)
      if (e && stable(metaOf(e)) !== stable(r.meta)) plan.records.push({ kind: 'put', sid, item: r, reuse: e })
      continue
    }
    plan.records.push({ kind: 'put', sid, item: r, reuse: null })
  }
  // Merge done; downloads that don't finish now are picked up from rev 0 at the next start.
  writeSync({ userId: acct.id, rev: 0, dirtyKv, dirtyRec, hashes, kvRev })
  await execute(acct.token, plan, progress)
  saveRev(c.rev)
}

function setProgress(label: string, done = 0, total = 0) {
  setAccountState({ progress: { done, total, label } })
}

/** The dialog's submit. Ends in a page reload; throws (with a plain message) only when nothing changed yet. */
export async function signInFlow(mode: 'signup' | 'login', name: string, password: string): Promise<void> {
  const res = await api.auth(mode, name, password)
  const acct: StoredAccount = { id: res.id, name: res.name, token: res.token }
  busy = true
  mergeWrote = false
  try {
    setProgress('One moment…')
    let prev = readSync()
    const prevName = loadStoredAccount()?.name ?? 'another account'
    // Data another account left here (its sign-in ran out): into the backup, then gone.
    if (prev && prev.userId && prev.userId !== acct.id && !prev.firstMerge) {
      try {
        await snapshotAll(`Left by ${prevName}`)
      } catch (err) {
        console.warn('Backup failed', err)
        throw new Error(BACKUP_FAILED)
      }
      await wipeLocal()
      prev = null
    }
    signedOut = false
    offline = false
    const pushReport: Report = (done, total) => setProgress(`Saving this browser's songs: ${done} of ${total}`, done, total)

    if (mode === 'signup') {
      // A new account takes everything in this browser.
      const now = Date.now()
      const dirtyKv: Record<string, number> = {}
      for (const k of presentSyncedKeys()) dirtyKv[k] = now
      const dirtyRec: Record<string, number> = {}
      for (const st of STORES) for (const key of await rawKeys(st)) dirtyRec[sidOf(st, String(key))] = now
      storeAccount(acct)
      writeSync({ userId: acct.id, rev: 0, dirtyKv, dirtyRec, hashes: {} })
    } else if ((!prev || prev.firstMerge || !prev.userId) && (await hasLocalData())) {
      await firstMerge(acct, { bytes: (d, t) => setProgress(`Getting your songs: ${mb(d, t)} of ${mb(t, t)} MB`, d, t) })
    } else {
      const same = prev && prev.userId === acct.id ? prev : null
      const c = await api.changes(acct.token, same?.rev ?? 0)
      storeAccount(acct)
      writeSync({
        userId: acct.id,
        rev: same?.rev ?? 0,
        dirtyKv: same?.dirtyKv ?? {},
        dirtyRec: same?.dirtyRec ?? {},
        hashes: same?.hashes ?? {},
        kvRev: same?.kvRev ?? {},
        refusedKv: same?.refusedKv ?? {},
        refusedRec: same?.refusedRec ?? {},
      })
      buffer = emptyBuffer()
      bufferChanges(c)
      let count = ''
      await applyBuffer(acct.token, {
        bytes: (d, t) => setProgress(`Getting your songs${count}`, d, t),
        count: (d, t) => void (count = `: ${d} of ${t}`),
      }).catch((err) => console.warn('Pull after sign-in:', err))
    }
    // Send what's here now; anything left over goes out after the reload.
    await pushOnce(pushReport).catch((err) => console.warn('Push after sign-in:', err))
    reloadNow()
  } catch (err) {
    setAccountState({ progress: null })
    // The merge already changed this browser's data: reload so no screen writes its old copy back.
    if (mergeWrote) return reloadAfterError(err)
    busy = false
    throw err
  }
}

/** Keys and records that haven't reached the account (waiting, or refused by it). */
function unsentKeys(s: SyncState) {
  return [...new Set([...Object.keys(s.dirtyKv), ...Object.keys(s.refusedKv ?? {})])]
}
function unsentRecs(s: SyncState) {
  return [...new Set([...Object.keys(s.dirtyRec), ...Object.keys(s.refusedRec ?? {})])]
}
function unsent(s: SyncState | null) {
  return s ? unsentKeys(s).length + unsentRecs(s).length : 0
}

/**
 * Sends what's waiting, then signs out and clears this browser's copy of the account. Returns 'confirm' when
 * changes couldn't be sent; call again with force to back them up and sign out anyway.
 */
export async function signOutFlow(force = false): Promise<'confirm' | void> {
  const a = loadStoredAccount()
  if (!a) return
  busy = true
  try {
    beforeSignOut()
    const s = readSync()
    if (!force) {
      if (ready()) await Promise.race([flush(), new Promise((r) => window.setTimeout(r, 10000))])
      const after = readSync()
      if (unsent(after) || after?.firstMerge) return 'confirm'
    } else if (s) {
      try {
        if (s.firstMerge) await snapshotAll(`Unsent changes of ${a.name}`)
        else if (unsent(s)) await snapshotSome(`Unsent changes of ${a.name}`, unsentKeys(s), unsentRecs(s))
      } catch (err) {
        console.warn('Backup failed', err)
        throw new Error("Couldn't save a backup of the unsent changes. You're still signed in.")
      }
    }
    window.clearTimeout(timer)
    window.clearTimeout(retryTimer)
    await api.logout(a.token).catch(() => {})
    stopForSignOut()
    await wipeLocal()
    storeAccount(null)
    writeSync(null)
    reloadNow()
  } finally {
    busy = false
  }
}
