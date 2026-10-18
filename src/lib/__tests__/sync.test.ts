import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// minimal localStorage and an in-memory stand-in for the server's /api/sync
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
})

const records = new Map<string, { table: string; id: string; data: unknown; seq: number }>()
let seq = 0
vi.stubGlobal('fetch', async (url: string, init: { method?: string; body?: string }) => {
  const u = new URL(url)
  if (u.pathname === '/api/sync' && init.method === 'POST') {
    for (const c of JSON.parse(init.body ?? '{}').changes) records.set(`${c.table}|${c.id}`, { ...c, seq: ++seq })
    return new Response(JSON.stringify({ cursor: seq }))
  }
  if (u.pathname === '/api/sync') {
    const since = Number(u.searchParams.get('since'))
    const changes = [...records.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq).map((r) => ({ ...r, deleted: r.data === null }))
    return new Response(JSON.stringify({ changes, cursor: changes.at(-1)?.seq ?? since, more: false }))
  }
  return new Response('{}', { status: 404 })
})

const { KontorDB } = await import('../db')
const { setConnection } = await import('../server')
const { getSyncStatus, installSyncHooks, markAllDirty, resetSyncState, syncNow } = await import('../sync')

const a = new KontorDB('device-a')
const b = new KontorDB('device-b')

beforeAll(async () => {
  await a.open()
  await b.open()
  setConnection({ url: 'http://kontor.test', token: 't', email: 'lena@example.de' })
  installSyncHooks(a)
})

describe('sync', () => {
  it('pushes existing data on first connect', async () => {
    await a.catalog.put({ id: 'k1', name: 'Webdesign', description: '', unit: 'Std.', priceCents: 8500, taxRate: 19, archived: false, createdAt: '', updatedAt: '' })
    storage.clear()
    setConnection({ url: 'http://kontor.test', token: 't', email: 'lena@example.de' })
    await markAllDirty(a)
    await syncNow(a)
    expect(getSyncStatus().state).toBe('idle')
    expect(records.has('catalog|k1')).toBe(true)
  })

  it('records later changes and deletions automatically', async () => {
    await a.catalog.update('k1', { priceCents: 9000 })
    await a.attachments.put({ id: 'f1', name: 'beleg.txt', mime: 'text/plain', size: 5, data: new Blob(['hallo'], { type: 'text/plain' }), createdAt: '' })
    await a.customers.put({ id: 'c1', company: 'Weg damit' } as never)
    await a.customers.delete('c1')
    await syncNow(a)
    expect((records.get('catalog|k1')?.data as { priceCents: number }).priceCents).toBe(9000)
    expect(records.get('customers|c1')?.data).toBeNull()
  })

  it('brings everything to a second device', async () => {
    resetSyncState()
    await syncNow(b)
    expect((await b.catalog.get('k1'))?.priceCents).toBe(9000)
    expect(await b.customers.get('c1')).toBeUndefined()
    const file = await b.attachments.get('f1')
    expect(await file?.data.text()).toBe('hallo')
  })
})
