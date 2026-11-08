// MariaDB storage for Fretwise accounts (server/accounts.ts): users, sign-in tokens, and each user's key/values
// and record details. File bytes stay on disk; the database only lists them by hash.
// Plain SQL that runs on MariaDB 10.6+ (a shared cPanel host too): no JSON column type, text in LONGTEXT, utf8mb4.
import { createPool, type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise'

/** A database call failed (unreachable, timed out, refused...). Carries only the error code, never the URL. */
export class DbError extends Error {
  code: string
  constructor(code: string) {
    super(`database: ${code}`)
    this.name = 'DbError'
    this.code = code
  }
}

export interface DbUser {
  id: string
  name: string
  nameKey: string
  salt: string
  hash: string
  created: number
  rev: number
}
export interface DbToken {
  hash: string // sha256 of the token
  userId: string
  created: number
}
export interface DbKv {
  k: string
  v: string | null // null = deleted
  t: number
  rev: number
}
export interface DbRecord {
  store: string
  id: string
  meta: string | null // JSON text
  hash: string | null
  size: number
  t: number
  rev: number
  deleted: boolean
}
export interface DbUserData {
  rev: number
  kv: DbKv[]
  records: DbRecord[]
}

// Keys and ids use utf8mb4_nopad_bin: localStorage keys are case-sensitive, and the plain _bin collation
// would also treat "a" and "a " as the same key (PAD SPACE). User ids, hashes and store names are ASCII.
const ID = 'CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL'
const TABLE = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'

// Each version runs once, in order; schema_migrations remembers which ran. Never edit a released version:
// add a new one. MariaDB commits each CREATE/ALTER on its own, so statements are written to be safe to rerun.
const MIGRATIONS: { version: number; statements: string[] }[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
        id ${ID},
        name VARCHAR(100) NOT NULL,
        name_key VARCHAR(100) COLLATE utf8mb4_nopad_bin NOT NULL,
        salt VARCHAR(64) CHARACTER SET ascii NOT NULL,
        hash VARCHAR(255) CHARACTER SET ascii NOT NULL,
        created BIGINT NOT NULL,
        rev BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        UNIQUE KEY users_name_key (name_key)
      ) ${TABLE}`,
      `CREATE TABLE IF NOT EXISTS tokens (
        hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        user_id ${ID},
        created BIGINT NOT NULL,
        PRIMARY KEY (hash),
        KEY tokens_user (user_id),
        CONSTRAINT tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ${TABLE}`,
      `CREATE TABLE IF NOT EXISTS kv (
        user_id ${ID},
        k VARCHAR(300) COLLATE utf8mb4_nopad_bin NOT NULL,
        v LONGTEXT NULL,
        t BIGINT NOT NULL,
        rev BIGINT NOT NULL,
        PRIMARY KEY (user_id, k),
        CONSTRAINT kv_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ${TABLE}`,
      `CREATE TABLE IF NOT EXISTS records (
        user_id ${ID},
        store VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        id VARCHAR(200) COLLATE utf8mb4_nopad_bin NOT NULL,
        meta LONGTEXT NULL,
        hash CHAR(64) CHARACTER SET ascii NULL,
        size BIGINT NOT NULL DEFAULT 0,
        t BIGINT NOT NULL,
        rev BIGINT NOT NULL,
        deleted TINYINT(1) NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, store, id),
        CONSTRAINT records_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ${TABLE}`,
    ],
  },
]

// Multi-row inserts stay well under a shared host's max_allowed_packet (often 16 MB).
const CHUNK_ROWS = 500
const CHUNK_CHARS = 2 * 1024 * 1024

/** Splits rows into inserts of at most CHUNK_ROWS rows and about CHUNK_CHARS characters (a bigger row goes alone). */
function chunks<T>(rows: T[], size: (r: T) => number): T[][] {
  const out: T[][] = []
  let cur: T[] = []
  let chars = 0
  for (const r of rows) {
    const n = size(r) + 100
    if (cur.length && (cur.length >= CHUNK_ROWS || chars + n > CHUNK_CHARS)) {
      out.push(cur)
      cur = []
      chars = 0
    }
    cur.push(r)
    chars += n
  }
  if (cur.length) out.push(cur)
  return out
}

/** Turns any driver error into a DbError, so callers can answer 503 and logs never show the connection URL. */
function wrap(err: unknown): DbError {
  if (err instanceof DbError) return err
  const e = err as { code?: unknown; errno?: unknown }
  return new DbError(typeof e?.code === 'string' ? e.code : typeof e?.errno === 'number' ? `errno ${e.errno}` : 'unknown')
}

const num = (v: unknown) => Number(v)

export interface AccountsDb {
  /** Connects and brings the schema up to date. */
  connect(): Promise<void>
  hasUsers(): Promise<boolean>
  /** Everything: all users, tokens, and every user's key/values and records (Fretwise has a few dozen accounts). */
  loadAll(): Promise<{ users: DbUser[]; tokens: DbToken[]; data: Map<string, DbUserData> }>
  /** One user's key/values and records; null when the user isn't in the database. */
  loadUser(id: string): Promise<DbUserData | null>
  /** False when the name is taken. */
  addUser(u: DbUser): Promise<boolean>
  /** The user with this lower-cased name; null when there's none. */
  findUser(nameKey: string): Promise<DbUser | null>
  /** Saves a new token and drops the ones created before `cutoff`. */
  addToken(t: DbToken, cutoff: number): Promise<void>
  dropToken(hash: string): Promise<void>
  /** Writes the changed key/values and records and the user's rev in one transaction. */
  saveChanges(userId: string, rev: number, kv: DbKv[], records: DbRecord[]): Promise<void>
  /** Copies accounts in, in one transaction, only while the database has no users. False when it already had some. */
  importAll(users: DbUser[], tokens: DbToken[], data: Map<string, DbUserData>): Promise<boolean>
  close(): Promise<void>
}

export function openDb(url: string): AccountsDb {
  // A small pool: one dev server, a band's worth of players. Short connect timeout so a stopped database
  // answers 503 quickly instead of hanging requests.
  const pool: Pool = createPool({ uri: url, connectionLimit: 4, maxIdle: 2, connectTimeout: 5000, enableKeepAlive: true })

  /** Runs fn in a transaction; any error rolls it back and comes out as a DbError. */
  async function tx<T>(fn: (c: PoolConnection) => Promise<T>): Promise<T> {
    let c: PoolConnection
    try {
      c = await pool.getConnection()
    } catch (err) {
      throw wrap(err)
    }
    let broken = false
    try {
      await c.beginTransaction()
      const out = await fn(c)
      await c.commit()
      return out
    } catch (err) {
      try {
        await c.rollback()
      } catch {
        broken = true // the connection is gone: don't hand it back to the pool
      }
      throw wrap(err)
    } finally {
      if (broken) c.destroy()
      else c.release()
    }
  }

  async function rows(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
    try {
      const [r] = await pool.query<RowDataPacket[]>(sql, params)
      return r
    } catch (err) {
      throw wrap(err)
    }
  }

  async function upsertKv(c: PoolConnection, userId: string, kv: DbKv[]) {
    for (const part of chunks(kv, (r) => r.k.length + (r.v?.length ?? 0)))
      await c.query('INSERT INTO kv (user_id, k, v, t, rev) VALUES ? ON DUPLICATE KEY UPDATE v = VALUES(v), t = VALUES(t), rev = VALUES(rev)', [
        part.map((r) => [userId, r.k, r.v, r.t, r.rev]),
      ])
  }

  async function upsertRecords(c: PoolConnection, userId: string, records: DbRecord[]) {
    for (const part of chunks(records, (r) => r.id.length + (r.meta?.length ?? 0)))
      await c.query(
        'INSERT INTO records (user_id, store, id, meta, hash, size, t, rev, deleted) VALUES ? ' +
          'ON DUPLICATE KEY UPDATE meta = VALUES(meta), hash = VALUES(hash), size = VALUES(size), t = VALUES(t), rev = VALUES(rev), deleted = VALUES(deleted)',
        [part.map((r) => [userId, r.store, r.id, r.meta, r.hash, r.size, r.t, r.rev, r.deleted ? 1 : 0])],
      )
  }

  const toUser = (r: RowDataPacket): DbUser => ({ id: r.id, name: r.name, nameKey: r.name_key, salt: r.salt, hash: r.hash, created: num(r.created), rev: num(r.rev) })
  const toKv = (r: RowDataPacket): DbKv => ({ k: r.k as string, v: (r.v as string | null) ?? null, t: num(r.t), rev: num(r.rev) })
  const toRecord = (r: RowDataPacket): DbRecord => ({
    store: r.store as string,
    id: r.id as string,
    meta: (r.meta as string | null) ?? null,
    hash: (r.hash as string | null) ?? null,
    size: num(r.size),
    t: num(r.t),
    rev: num(r.rev),
    deleted: num(r.deleted) === 1,
  })

  return {
    async connect() {
      let c: PoolConnection
      try {
        c = await pool.getConnection()
      } catch (err) {
        throw wrap(err)
      }
      try {
        await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INT NOT NULL, applied BIGINT NOT NULL, PRIMARY KEY (version)) ' + TABLE)
        // Two servers starting together (a restart overlapping the old one) don't migrate twice.
        await c.query('SELECT GET_LOCK(?, 30)', ['fretwise_migrate'])
        try {
          const [done] = await c.query<RowDataPacket[]>('SELECT version FROM schema_migrations')
          const have = new Set(done.map((r) => num(r.version)))
          for (const m of MIGRATIONS) {
            if (have.has(m.version)) continue
            for (const s of m.statements) await c.query(s)
            await c.query('INSERT INTO schema_migrations (version, applied) VALUES (?, ?)', [m.version, Date.now()])
            console.log(`[accounts] database schema now at version ${m.version}`)
          }
        } finally {
          await c.query('SELECT RELEASE_LOCK(?)', ['fretwise_migrate'])
        }
      } catch (err) {
        throw wrap(err)
      } finally {
        c.release()
      }
    },

    async hasUsers() {
      return (await rows('SELECT 1 FROM users LIMIT 1')).length > 0
    },

    async loadAll() {
      const users = (await rows('SELECT id, name, name_key, salt, hash, created, rev FROM users')).map(toUser)
      const tokens = (await rows('SELECT hash, user_id, created FROM tokens')).map((r): DbToken => ({ hash: r.hash, userId: r.user_id, created: num(r.created) }))
      const data = new Map<string, DbUserData>(users.map((u) => [u.id, { rev: u.rev, kv: [], records: [] }]))
      for (const r of await rows('SELECT user_id, k, v, t, rev FROM kv')) data.get(r.user_id as string)?.kv.push(toKv(r))
      for (const r of await rows('SELECT user_id, store, id, meta, hash, size, t, rev, deleted FROM records')) data.get(r.user_id as string)?.records.push(toRecord(r))
      return { users, tokens, data }
    },

    async loadUser(id) {
      const u = await rows('SELECT rev FROM users WHERE id = ?', [id])
      if (!u.length) return null
      const kv = (await rows('SELECT k, v, t, rev FROM kv WHERE user_id = ?', [id])).map(toKv)
      const records = (await rows('SELECT store, id, meta, hash, size, t, rev, deleted FROM records WHERE user_id = ?', [id])).map(toRecord)
      return { rev: num(u[0].rev), kv, records }
    },

    async addUser(u) {
      try {
        await pool.query('INSERT INTO users (id, name, name_key, salt, hash, created, rev) VALUES (?, ?, ?, ?, ?, ?, ?)', [u.id, u.name, u.nameKey, u.salt, u.hash, u.created, u.rev])
        return true
      } catch (err) {
        if ((err as { code?: string }).code === 'ER_DUP_ENTRY') return false
        throw wrap(err)
      }
    },

    async findUser(nameKey) {
      const r = await rows('SELECT id, name, name_key, salt, hash, created, rev FROM users WHERE name_key = ?', [nameKey])
      return r.length ? toUser(r[0]) : null
    },

    async addToken(t, cutoff) {
      await tx(async (c) => {
        await c.query('INSERT INTO tokens (hash, user_id, created) VALUES (?, ?, ?)', [t.hash, t.userId, t.created])
        await c.query('DELETE FROM tokens WHERE created < ?', [cutoff])
      })
    },

    async dropToken(hash) {
      try {
        await pool.query('DELETE FROM tokens WHERE hash = ?', [hash])
      } catch (err) {
        throw wrap(err)
      }
    },

    async saveChanges(userId, rev, kv, records) {
      await tx(async (c) => {
        if (kv.length) await upsertKv(c, userId, kv)
        if (records.length) await upsertRecords(c, userId, records)
        await c.query('UPDATE users SET rev = ? WHERE id = ?', [rev, userId])
      })
    },

    async importAll(users, tokens, data) {
      return tx(async (c) => {
        // FOR UPDATE also locks the empty table's gap, so a signup can't slip in during the import.
        const [have] = await c.query<RowDataPacket[]>('SELECT id FROM users LIMIT 1 FOR UPDATE')
        if (have.length) return false
        for (const part of chunks(users, () => 300))
          await c.query('INSERT INTO users (id, name, name_key, salt, hash, created, rev) VALUES ?', [part.map((u) => [u.id, u.name, u.nameKey, u.salt, u.hash, u.created, u.rev])])
        for (const part of chunks(tokens, () => 120)) await c.query('INSERT INTO tokens (hash, user_id, created) VALUES ?', [part.map((t) => [t.hash, t.userId, t.created])])
        for (const [id, d] of data) {
          if (d.kv.length) await upsertKv(c, id, d.kv)
          if (d.records.length) await upsertRecords(c, id, d.records)
        }
        return true
      })
    },

    async close() {
      await pool.end().catch(() => {})
    },
  }
}
