import type { DatabaseSync } from 'node:sqlite'
import { dataUrlToBlob, type Backup } from '../../src/lib/backup'
import { db } from '../../src/lib/db'
import { normalizeSettings } from '../../src/lib/migrate'
import { COLLECTIONS } from '../../src/lib/store'
import type { Context } from './workspace'

/** The whole workspace in the JSON backup format of the app. */
export function exportWorkspace(sql: DatabaseSync, workspaceId: string): Backup {
  const rows = sql.prepare('SELECT collection, id, data FROM records WHERE workspace_id = ?').all(workspaceId) as { collection: string; id: string; data: string }[]
  const by = (name: string) => rows.filter((r) => r.collection === name).map((r) => JSON.parse(r.data))
  const files = sql.prepare('SELECT id, name, mime, size, data, created_at FROM files WHERE workspace_id = ?').all(workspaceId) as {
    id: string
    name: string
    mime: string
    size: number
    data: Uint8Array
    created_at: string
  }[]
  return {
    app: 'kontor',
    version: 3,
    exportedAt: new Date().toISOString(),
    settings: by('settings')[0] ?? null,
    customers: by('customers'),
    documents: by('documents'),
    timeEntries: by('timeEntries'),
    timer: null,
    reminders: by('reminders'),
    catalog: by('catalog'),
    recurring: by('recurring'),
    expenses: by('expenses'),
    projects: by('projects'),
    attachments: files.map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: Number(f.size), createdAt: f.created_at, dataUrl: `data:${f.mime};base64,${Buffer.from(f.data).toString('base64')}` })),
  }
}

/**
 * Restores a backup into the workspace bound to `db`. "replace" clears the
 * workspace first, "merge" adds the records and overwrites equal ids –
 * used for the one-time import of data from the old browser storage.
 */
export async function restoreWorkspace(sql: DatabaseSync, ctx: Context, b: Backup, mode: 'replace' | 'merge') {
  if (mode === 'replace') {
    sql.prepare('DELETE FROM records WHERE workspace_id = ?').run(ctx.workspaceId)
    sql.prepare('DELETE FROM files WHERE workspace_id = ?').run(ctx.workspaceId)
    for (const c of COLLECTIONS) ctx.changed.add(c)
  }
  if (b.settings) await db.settings.put(normalizeSettings({ ...b.settings, onboarded: true }))
  await db.customers.bulkPut(b.customers)
  await db.documents.bulkPut(b.documents)
  await db.timeEntries.bulkPut(b.timeEntries)
  await db.reminders.bulkPut(b.reminders)
  await db.catalog.bulkPut(b.catalog)
  await db.recurring.bulkPut(b.recurring)
  await db.expenses.bulkPut(b.expenses)
  await db.projects.bulkPut(b.projects)
  for (const { dataUrl, ...meta } of b.attachments) {
    const bytes = new Uint8Array(await dataUrlToBlob(dataUrl).arrayBuffer())
    await db.attachments.put({ ...meta, data: bytes as unknown as Blob })
  }
}
