import type { DatabaseSync } from 'node:sqlite'
import { Database, type Backend, type BackendFactory, type CollectionName, type Records } from '../../src/lib/store'
import type { InvoiceDocument, Settings } from '../../src/lib/types'

export class Forbidden extends Error {
  status = 409
}

export interface Context {
  workspaceId: string
  userId: string | null
  /** Domain operations run trusted; plain record writes from the client don't. */
  trusted: boolean
  /** Backup restore and wipe bypass the immutability rules, they are audited separately. */
  restoring?: boolean
  changed: Set<string>
}

/** Fields of a finalized document that may still change: payment state and links to later documents. */
const MUTABLE_FIELDS = new Set(['status', 'cancelledById', 'creditNotes', 'payments', 'paidAt', 'settledById', 'sentAt', 'updatedAt'])

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
    return `{${entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

function frozenPart(doc: InvoiceDocument): string {
  const copy: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(doc)) if (!MUTABLE_FIELDS.has(k)) copy[k] = v
  return stable(copy)
}

function describe(collection: string, record: unknown): string {
  if (collection === 'documents') {
    const d = record as InvoiceDocument
    return [d.kind, d.number ?? 'draft', d.status].join(' ')
  }
  return ''
}

const SEQUENCES = ['invoiceNumbers', 'quoteNumbers', 'creditNoteNumbers'] as const

function guardWrite(collection: string, before: unknown, after: unknown, ctx: Context) {
  if (ctx.restoring) return after
  if (collection === 'documents') {
    const prev = before as InvoiceDocument | undefined
    const next = after as InvoiceDocument
    if (prev && prev.status !== 'draft') {
      if (!ctx.trusted) throw new Forbidden('Abgeschlossene Dokumente können nicht mehr geändert werden.')
      if (next.status === 'draft' || frozenPart(prev) !== frozenPart(next)) throw new Forbidden('Abgeschlossene Dokumente können nicht mehr geändert werden.')
    } else if (!ctx.trusted && next.status !== 'draft') {
      throw new Forbidden('Dokumente werden nur beim Abschließen festgeschrieben.')
    }
  }
  if (collection === 'settings' && !ctx.trusted && before) {
    // number counters only move forward through finalization
    const prev = before as Settings
    const next = { ...(after as Settings) }
    for (const key of SEQUENCES) if (prev[key]) next[key] = { ...next[key], counters: prev[key].counters }
    return next
  }
  return after
}

function guardDelete(collection: string, before: unknown, ctx: Context) {
  if (ctx.restoring || !before) return
  if (collection === 'documents') {
    const doc = before as InvoiceDocument
    if (doc.status !== 'draft' && doc.kind !== 'quote') throw new Forbidden('Abgeschlossene Rechnungen können nicht gelöscht werden.')
  }
}

const AUDITED = new Set(['documents', 'settings'])

export function audit(sql: DatabaseSync, ctx: Pick<Context, 'workspaceId' | 'userId'>, action: string, collection: string | null, id: string | null, summary = '') {
  sql
    .prepare('INSERT INTO audit_log (workspace_id, user_id, at, action, collection, record_id, summary) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(ctx.workspaceId, ctx.userId, new Date().toISOString(), action, collection, id, summary.slice(0, 500))
}

function recordBackend<T extends { id: string }>(sql: DatabaseSync, collection: string, ctx: Context): Backend<T> {
  // a running timer belongs to the user, everything else to the workspace
  const storeId = (id: string) => (collection === 'timer' ? `timer:${ctx.userId ?? ''}` : id)
  const parse = (data: string) => {
    const rec = JSON.parse(data)
    return collection === 'timer' ? { ...rec, id: 'timer' } : rec
  }
  const select = sql.prepare('SELECT data FROM records WHERE workspace_id = ? AND collection = ? AND id = ?')
  return {
    async all() {
      if (collection === 'timer') {
        const row = select.get(ctx.workspaceId, collection, storeId('timer')) as { data: string } | undefined
        return row ? [parse(row.data)] : []
      }
      const rows = sql.prepare('SELECT data FROM records WHERE workspace_id = ? AND collection = ?').all(ctx.workspaceId, collection) as { data: string }[]
      return rows.map((r) => parse(r.data))
    },
    async get(id) {
      const row = select.get(ctx.workspaceId, collection, storeId(id)) as { data: string } | undefined
      return row ? parse(row.data) : undefined
    },
    async put(record) {
      const row = select.get(ctx.workspaceId, collection, storeId(record.id)) as { data: string } | undefined
      const before = row ? parse(row.data) : undefined
      const value = guardWrite(collection, before, record, ctx) as T
      sql
        .prepare(
          `INSERT INTO records (workspace_id, collection, id, data, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (workspace_id, collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        )
        .run(ctx.workspaceId, collection, storeId(record.id), JSON.stringify(value), new Date().toISOString(), ctx.userId)
      ctx.changed.add(collection)
      if (AUDITED.has(collection)) audit(sql, ctx, before ? 'update' : 'create', collection, record.id, describe(collection, value))
    },
    async remove(id) {
      const row = select.get(ctx.workspaceId, collection, storeId(id)) as { data: string } | undefined
      if (!row) return
      const before = parse(row.data)
      guardDelete(collection, before, ctx)
      sql.prepare('DELETE FROM records WHERE workspace_id = ? AND collection = ? AND id = ?').run(ctx.workspaceId, collection, storeId(id))
      ctx.changed.add(collection)
      if (collection !== 'timer') audit(sql, ctx, 'delete', collection, id, describe(collection, before))
    },
  }
}

interface FileRow {
  id: string
  name: string
  mime: string
  size: number
  created_at: string
  data?: Uint8Array
}

function fileBackend(sql: DatabaseSync, ctx: Context): Backend<Records['attachments']> {
  const toRecord = (r: FileRow) => ({ id: r.id, name: r.name, mime: r.mime, size: Number(r.size), createdAt: r.created_at, data: (r.data ? Buffer.from(r.data) : undefined) as unknown as Blob })
  return {
    async all() {
      const rows = sql.prepare('SELECT id, name, mime, size, created_at FROM files WHERE workspace_id = ?').all(ctx.workspaceId) as unknown as FileRow[]
      return rows.map(toRecord)
    },
    async get(id) {
      const row = sql.prepare('SELECT * FROM files WHERE workspace_id = ? AND id = ?').get(ctx.workspaceId, id) as unknown as FileRow | undefined
      return row ? toRecord(row) : undefined
    },
    async put(record) {
      const raw = record.data as unknown
      const bytes = raw instanceof Uint8Array ? raw : raw instanceof Blob ? new Uint8Array(await raw.arrayBuffer()) : new Uint8Array()
      sql
        .prepare(
          `INSERT INTO files (workspace_id, id, name, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (workspace_id, id) DO UPDATE SET name = excluded.name, mime = excluded.mime, size = excluded.size, data = excluded.data`,
        )
        .run(ctx.workspaceId, record.id, record.name, record.mime, bytes.length, bytes, record.createdAt || new Date().toISOString())
      ctx.changed.add('attachments')
    },
    async remove(id) {
      sql.prepare('DELETE FROM files WHERE workspace_id = ? AND id = ?').run(ctx.workspaceId, id)
      ctx.changed.add('attachments')
    },
  }
}

/** The shared domain store, bound to one workspace and user. */
export function workspaceDatabase(sql: DatabaseSync, ctx: Context): Database {
  const factory: BackendFactory = <K extends CollectionName>(name: K) =>
    (name === 'attachments' ? fileBackend(sql, ctx) : recordBackend(sql, name, ctx)) as unknown as Backend<Records[K]>
  return new Database(factory)
}

let chain: Promise<unknown> = Promise.resolve()

/**
 * Runs database work one after another. With a single connection this
 * keeps transactions from interleaving, which is what makes invoice
 * numbers gap-free and unique even with many clients.
 */
export function serialize<R>(fn: () => Promise<R>): Promise<R> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => undefined)
  return run
}

export async function inTransaction<R>(sql: DatabaseSync, fn: () => Promise<R>): Promise<R> {
  sql.exec('BEGIN IMMEDIATE')
  try {
    const result = await fn()
    sql.exec('COMMIT')
    return result
  } catch (e) {
    sql.exec('ROLLBACK')
    throw e
  }
}
