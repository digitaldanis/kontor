import { blobToDataUrl, type Backup, type SerializedAttachment } from './backup'

const STORES = ['settings', 'customers', 'documents', 'timeEntries', 'timer', 'reminders', 'catalog', 'recurring', 'expenses', 'projects', 'attachments']

/** Reads everything the earlier, browser-only version of Kontor kept in IndexedDB. */
export async function readLegacyBrowserData(): Promise<Backup | null> {
  if (typeof indexedDB === 'undefined') return null
  if ('databases' in indexedDB) {
    const list = await indexedDB.databases()
    if (!list.some((d) => d.name === 'kontor')) return null
  }
  const database = await new Promise<IDBDatabase | null>((resolve) => {
    const req = indexedDB.open('kontor')
    // opening a database that doesn't exist would create it; abort that
    req.onupgradeneeded = () => {
      req.transaction?.abort()
      resolve(null)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
  if (!database) return null
  const names = STORES.filter((s) => database.objectStoreNames.contains(s))
  const read = (store: string) =>
    new Promise<unknown[]>((resolve, reject) => {
      const req = database.transaction(store, 'readonly').objectStore(store).getAll()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  const data: Record<string, unknown[]> = {}
  for (const s of names) data[s] = await read(s)
  database.close()
  const attachments: SerializedAttachment[] = await Promise.all(
    ((data.attachments ?? []) as { data: Blob; mime: string }[]).map(async ({ data: blob, ...meta }) => ({ ...(meta as Omit<SerializedAttachment, 'dataUrl'>), dataUrl: await blobToDataUrl(blob, meta.mime) })),
  )
  const backup = {
    app: 'kontor' as const,
    version: 3 as const,
    exportedAt: new Date().toISOString(),
    settings: ((data.settings ?? [])[0] as Backup['settings']) ?? null,
    customers: (data.customers ?? []) as Backup['customers'],
    documents: (data.documents ?? []) as Backup['documents'],
    timeEntries: (data.timeEntries ?? []) as Backup['timeEntries'],
    timer: null,
    reminders: (data.reminders ?? []) as Backup['reminders'],
    catalog: (data.catalog ?? []) as Backup['catalog'],
    recurring: (data.recurring ?? []) as Backup['recurring'],
    expenses: (data.expenses ?? []) as Backup['expenses'],
    projects: (data.projects ?? []) as Backup['projects'],
    attachments,
  }
  const empty = !backup.settings && !backup.customers.length && !backup.documents.length && !backup.timeEntries.length
  return empty ? null : backup
}

/** Deletes the old browser database after a successful import. */
export function deleteLegacyBrowserData(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('kontor')
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
}
