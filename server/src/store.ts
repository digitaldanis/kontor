import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const SYNC_TABLES = ['settings', 'customers', 'documents', 'timeEntries', 'timer', 'reminders', 'catalog', 'recurring', 'expenses', 'attachments', 'projects'] as const

export interface User {
  id: number
  email: string
  password_hash: string
  created_at: string
}

export interface Change {
  table: string
  id: string
  data: unknown
  deleted: boolean
  seq: number
}

export interface SmtpRow {
  host: string
  port: number
  secure: number
  username: string
  password_enc: string
  from_address: string
}

export class Store {
  db: DatabaseSync

  constructor(dataDir: string) {
    if (dataDir === ':memory:') this.db = new DatabaseSync(':memory:')
    else {
      mkdirSync(dataDir, { recursive: true })
      this.db = new DatabaseSync(join(dataDir, 'kontor.sqlite'))
    }
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS records (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tbl TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT,
        deleted INTEGER NOT NULL DEFAULT 0,
        seq INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, tbl, id)
      );
      CREATE INDEX IF NOT EXISTS records_seq ON records (user_id, seq);
      CREATE TABLE IF NOT EXISTS counters (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS smtp (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        secure INTEGER NOT NULL,
        username TEXT NOT NULL,
        password_enc TEXT NOT NULL,
        from_address TEXT NOT NULL
      );
    `)
  }

  userCount(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n)
  }

  createUser(email: string, passwordHash: string): User {
    const now = new Date().toISOString()
    const info = this.db.prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)').run(email, passwordHash, now)
    return { id: Number(info.lastInsertRowid), email, password_hash: passwordHash, created_at: now }
  }

  userByEmail(email: string): User | undefined {
    return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined
  }

  createSession(tokenHash: string, userId: number, days: number): void {
    const now = new Date()
    const expires = new Date(now.getTime() + days * 86_400_000)
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(tokenHash, userId, now.toISOString(), expires.toISOString())
  }

  userBySession(tokenHash: string): User | undefined {
    return this.db
      .prepare('SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?')
      .get(tokenHash, new Date().toISOString()) as User | undefined
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
  }

  cursor(userId: number): number {
    const row = this.db.prepare('SELECT seq FROM counters WHERE user_id = ?').get(userId) as { seq: number } | undefined
    return row ? Number(row.seq) : 0
  }

  /** Stores changes in one transaction; every change gets the next sequence number. */
  push(userId: number, changes: { table: string; id: string; data: unknown }[]): number {
    const now = new Date().toISOString()
    let seq = this.cursor(userId)
    const upsert = this.db.prepare(`
      INSERT INTO records (user_id, tbl, id, data, deleted, seq, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, tbl, id) DO UPDATE SET data = excluded.data, deleted = excluded.deleted, seq = excluded.seq, updated_at = excluded.updated_at
    `)
    this.db.exec('BEGIN')
    try {
      for (const c of changes) {
        seq += 1
        const deleted = c.data === null || c.data === undefined
        upsert.run(userId, c.table, c.id, deleted ? null : JSON.stringify(c.data), deleted ? 1 : 0, seq, now)
      }
      this.db.prepare('INSERT INTO counters (user_id, seq) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET seq = excluded.seq').run(userId, seq)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    return seq
  }

  pull(userId: number, since: number, limit: number): Change[] {
    const rows = this.db.prepare('SELECT tbl, id, data, deleted, seq FROM records WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?').all(userId, since, limit) as {
      tbl: string
      id: string
      data: string | null
      deleted: number
      seq: number
    }[]
    return rows.map((r) => ({ table: r.tbl, id: r.id, data: r.data ? JSON.parse(r.data) : null, deleted: !!r.deleted, seq: Number(r.seq) }))
  }

  smtp(userId: number): SmtpRow | undefined {
    return this.db.prepare('SELECT host, port, secure, username, password_enc, from_address FROM smtp WHERE user_id = ?').get(userId) as SmtpRow | undefined
  }

  saveSmtp(userId: number, row: SmtpRow): void {
    this.db
      .prepare(
        `INSERT INTO smtp (user_id, host, port, secure, username, password_enc, from_address) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET host = excluded.host, port = excluded.port, secure = excluded.secure, username = excluded.username, password_enc = excluded.password_enc, from_address = excluded.from_address`,
      )
      .run(userId, row.host, row.port, row.secure, row.username, row.password_enc, row.from_address)
  }

  deleteSmtp(userId: number): void {
    this.db.prepare('DELETE FROM smtp WHERE user_id = ?').run(userId)
  }

  close(): void {
    this.db.close()
  }
}
