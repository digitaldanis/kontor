import { api, clientId, request, revive } from './api'
import { Database, type Backend, type CollectionName, type Records } from './store'
import type { Attachment } from './types'

/**
 * Browser side of the store: every collection is loaded from the API on
 * demand and kept in memory only, so nothing is persisted in the browser.
 * Changes from other devices arrive as server-sent events.
 */
const cache = new Map<string, Promise<Map<string, unknown>>>()
const listeners = new Set<() => void>()
let notifyScheduled = false

export function subscribeChanges(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notify() {
  if (notifyScheduled) return
  notifyScheduled = true
  queueMicrotask(() => {
    notifyScheduled = false
    listeners.forEach((l) => l())
  })
}

/** Drops cached collections so the next read fetches them again. */
export function invalidate(collections: readonly string[] | 'all') {
  if (collections === 'all') cache.clear()
  else for (const c of collections) cache.delete(c)
  notify()
}

function load(name: string): Promise<Map<string, unknown>> {
  let p = cache.get(name)
  if (!p) {
    p = api<{ id: string }[]>(`/api/data/${name}`).then((rows) => new Map(revive(rows).map((r) => [r.id, r])))
    p.catch(() => cache.delete(name))
    cache.set(name, p)
  }
  return p
}

function recordBackend<T extends { id: string }>(name: string): Backend<T> {
  return {
    async all() {
      return [...(await load(name)).values()].map((v) => structuredClone(v)) as T[]
    },
    async get(id) {
      const v = (await load(name)).get(id)
      return v === undefined ? undefined : (structuredClone(v) as T)
    },
    async put(record) {
      const saved = await api<T>(`/api/data/${name}/${encodeURIComponent(record.id)}`, { method: 'PUT', body: record })
      const map = await load(name)
      map.set(record.id, saved ?? record)
      notify()
    },
    async remove(id) {
      await api(`/api/data/${name}/${encodeURIComponent(id)}`, { method: 'DELETE' })
      ;(await load(name)).delete(id)
      notify()
    },
  }
}

function fileBackend(): Backend<Attachment> {
  return {
    async all() {
      return [...(await load('attachments')).values()] as Attachment[]
    },
    async get(id) {
      const meta = (await load('attachments')).get(id) as Attachment | undefined
      if (!meta) return undefined
      const res = await request(`/api/files/${encodeURIComponent(id)}`)
      return { ...meta, data: await res.blob() }
    },
    async put(record) {
      const meta = await api<Attachment>('/api/files', {
        raw: record.data,
        headers: { 'Content-Type': record.mime || 'application/octet-stream', 'X-File-Name': encodeURIComponent(record.name), 'X-File-Id': record.id },
      })
      ;(await load('attachments')).set(meta.id, meta)
      notify()
    },
    async remove(id) {
      await api(`/api/data/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' })
      ;(await load('attachments')).delete(id)
      notify()
    },
  }
}

export function remoteDatabase(): Database {
  return new Database(<K extends CollectionName>(name: K) => (name === 'attachments' ? fileBackend() : recordBackend(name)) as unknown as Backend<Records[K]>)
}

let source: EventSource | null = null

/** Listens for changes made on other devices or by the server's scheduler. */
export function connectEvents() {
  if (source || typeof EventSource === 'undefined') return
  source = new EventSource(`/api/events?client=${encodeURIComponent(clientId)}`)
  source.onmessage = (e) => {
    try {
      const { collections } = JSON.parse(e.data) as { collections: string[] }
      invalidate(collections)
    } catch {
      // ignore malformed events
    }
  }
  // after a reconnect we may have missed events
  source.onopen = () => invalidate('all')
}

export function disconnectEvents() {
  source?.close()
  source = null
  cache.clear()
}
