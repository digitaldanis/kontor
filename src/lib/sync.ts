import type { Table, Transaction } from 'dexie'
import { blobToDataUrl, dataUrlToBlob } from './backup'
import { db, type KontorDB } from './db'
import { normalizeDocument, normalizeSettings } from './migrate'
import { api, getConnection, onConnectionChange } from './server'
import type { Attachment, InvoiceDocument, Settings } from './types'

export const SYNCED_TABLES = ['settings', 'customers', 'documents', 'timeEntries', 'timer', 'reminders', 'catalog', 'recurring', 'expenses', 'attachments', 'projects'] as const
export type SyncedTable = (typeof SYNCED_TABLES)[number]

const DIRTY_KEY = 'kontor.sync.dirty'
const CURSOR_KEY = 'kontor.sync.cursor'
const REMOTE = Symbol('kontor-remote')

export interface SyncStatus {
  state: 'off' | 'idle' | 'syncing' | 'error'
  lastSync: string | null
  message: string
  pending: number
}

let status: SyncStatus = { state: 'off', lastSync: null, message: '', pending: 0 }
const listeners = new Set<() => void>()

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch, pending: dirty.size }
  listeners.forEach((l) => l())
}

export function getSyncStatus(): SyncStatus {
  return status
}

export function subscribeSync(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// key "table|id" -> time of the last local change
let dirty = new Map<string, number>()

function loadDirty() {
  try {
    dirty = new Map(JSON.parse(localStorage.getItem(DIRTY_KEY) ?? '[]'))
  } catch {
    dirty = new Map()
  }
}

function saveDirty() {
  try {
    localStorage.setItem(DIRTY_KEY, JSON.stringify([...dirty]))
  } catch {
    // ignore, the next full sync catches up
  }
}

function cursor(): number {
  try {
    return Number(localStorage.getItem(CURSOR_KEY) ?? 0) || 0
  } catch {
    return 0
  }
}

function setCursor(n: number) {
  try {
    localStorage.setItem(CURSOR_KEY, String(n))
  } catch {
    // ignore
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
let clock = 0

function markDirty(table: string, id: unknown) {
  if (!getConnection()?.token || id === undefined || id === null) return
  dirty.set(`${table}|${String(id)}`, Date.now() + clock++ / 1000)
  saveDirty()
  clearTimeout(timer)
  timer = setTimeout(() => void syncNow(), 2500)
  setStatus({})
}

function isRemote(tx: Transaction | undefined): boolean {
  return !!tx && (tx as unknown as Record<symbol, boolean>)[REMOTE] === true
}

let hooked = false

/** Records every local write so it can be pushed. Writes coming from the server are skipped. */
export function installSyncHooks(database: KontorDB = db) {
  if (hooked) return
  hooked = true
  loadDirty()
  for (const name of SYNCED_TABLES) {
    const table = database.table(name)
    table.hook('creating', (pk, obj, tx) => {
      if (!isRemote(tx)) markDirty(name, pk ?? (obj as { id?: string }).id)
    })
    table.hook('updating', (_mods, pk, _obj, tx) => {
      if (!isRemote(tx)) markDirty(name, pk)
    })
    table.hook('deleting', (pk, _obj, tx) => {
      if (!isRemote(tx)) markDirty(name, pk)
    })
  }
}

/** On first connect every local record is pushed. */
export async function markAllDirty(database: KontorDB = db) {
  const stamp = Date.now()
  for (const name of SYNCED_TABLES) {
    const keys = await database.table(name).toCollection().primaryKeys()
    for (const k of keys) dirty.set(`${name}|${String(k)}`, stamp)
  }
  saveDirty()
}

export function resetSyncState() {
  dirty = new Map()
  saveDirty()
  setCursor(0)
  setStatus({ state: getConnection()?.token ? 'idle' : 'off', lastSync: null, message: '' })
}

async function serialize(table: SyncedTable, record: unknown): Promise<unknown> {
  if (table === 'attachments' && record) {
    const { data, ...rest } = record as Attachment
    return { ...rest, dataUrl: await blobToDataUrl(data, rest.mime) }
  }
  return record
}

function deserialize(table: string, data: unknown): unknown {
  if (table === 'attachments') {
    const { dataUrl, ...rest } = data as Omit<Attachment, 'data'> & { dataUrl: string }
    return { ...rest, data: dataUrlToBlob(dataUrl) }
  }
  if (table === 'documents') return normalizeDocument(data as InvoiceDocument)
  if (table === 'settings') return normalizeSettings(data as Settings)
  return data
}

interface RemoteChange {
  table: string
  id: string
  data: unknown
  deleted: boolean
  seq: number
}

let running: Promise<void> | null = null

export function syncNow(database: KontorDB = db): Promise<void> {
  if (running) return running
  running = doSync(database).finally(() => {
    running = null
  })
  return running
}

async function doSync(database: KontorDB) {
  const c = getConnection()
  if (!c?.token) {
    setStatus({ state: 'off' })
    return
  }
  setStatus({ state: 'syncing', message: '' })
  try {
    // push
    const snapshot = [...dirty]
    for (let i = 0; i < snapshot.length; i += 200) {
      const batch = snapshot.slice(i, i + 200)
      const changes = await Promise.all(
        batch.map(async ([key]) => {
          const [table, ...rest] = key.split('|')
          const id = rest.join('|')
          const record = await database.table(table).get(id)
          return { table, id, data: record ? await serialize(table as SyncedTable, record) : null }
        }),
      )
      await api('/api/sync', { body: { changes } })
      for (const [key, stamp] of batch) if (dirty.get(key) === stamp) dirty.delete(key)
      saveDirty()
    }

    // pull
    let since = cursor()
    for (;;) {
      const res = await api<{ changes: RemoteChange[]; cursor: number; more: boolean }>(`/api/sync?since=${since}`)
      if (res.changes.length) await applyRemote(database, res.changes)
      since = res.cursor
      setCursor(since)
      if (!res.more) break
    }
    setStatus({ state: 'idle', lastSync: new Date().toISOString() })
  } catch (e) {
    setStatus({ state: 'error', message: e instanceof Error ? e.message : 'Synchronisierung fehlgeschlagen' })
  }
}

async function applyRemote(database: KontorDB, changes: RemoteChange[]) {
  const tables = [...new Set(changes.map((c) => c.table))].filter((t): t is SyncedTable => (SYNCED_TABLES as readonly string[]).includes(t))
  await database.transaction('rw', tables.map((t) => database.table(t)), async (tx) => {
    ;(tx as unknown as Record<symbol, boolean>)[REMOTE] = true
    for (const c of changes) {
      if (!tables.includes(c.table as SyncedTable)) continue
      // local edits that are not pushed yet win, they go out with the next push
      if (dirty.has(`${c.table}|${c.id}`)) continue
      const table = database.table(c.table) as Table<unknown, string>
      if (c.deleted || c.data === null) await table.delete(c.id)
      else await table.put(deserialize(c.table, c.data))
    }
  })
}

let started = false

/** Starts background sync while a server is connected. */
export function startSync() {
  if (started || typeof window === 'undefined') return
  started = true
  installSyncHooks()
  const tick = () => {
    if (getConnection()?.token && navigator.onLine !== false) void syncNow()
  }
  setStatus({ state: getConnection()?.token ? 'idle' : 'off' })
  tick()
  setInterval(tick, 30_000)
  window.addEventListener('online', tick)
  window.addEventListener('focus', tick)
  onConnectionChange(() => {
    setStatus({ state: getConnection()?.token ? 'idle' : 'off' })
    tick()
  })
}
