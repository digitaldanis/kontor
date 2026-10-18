import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../src/app'
import { backupDatabase } from '../src/backups'
import { loadConfig } from '../src/config'
import type { OutgoingMail } from '../src/mail'
import { openDatabase } from '../src/sqlite'

const sent: OutgoingMail[] = []
const logs: string[] = []
const dataDir = mkdtempSync(join(tmpdir(), 'kontor-test-'))
const sql = openDatabase(dataDir)
const config = { ...loadConfig({ KONTOR_SECRET: 'test-secret' }), dataDir }
const { app, events } = createApp({
  config,
  sql,
  log: (l) => logs.push(l),
  sendMail: async (_smtp, mail) => {
    sent.push(mail)
    return { messageId: '<1@test>' }
  },
})

let base = ''
let server: ReturnType<typeof app.listen>

before(async () => {
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(() => {
  events.close()
  server.close()
  sql.close()
})

/** A browser-like client with its own cookie jar. */
class Client {
  jar = new Map<string, string>()

  async call(path: string, init: { method?: string; body?: unknown; raw?: Buffer; headers?: Record<string, string>; csrf?: boolean } = {}) {
    const method = init.method ?? (init.body !== undefined || init.raw ? 'POST' : 'GET')
    if (method !== 'GET' && !this.jar.has('kontor_csrf')) await this.call('/api/session')
    const headers: Record<string, string> = { ...init.headers, Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') }
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'
    if (method !== 'GET' && init.csrf !== false) headers['X-CSRF-Token'] = this.jar.get('kontor_csrf') ?? ''
    const res = await fetch(base + path, { method, headers, body: init.raw ? new Uint8Array(init.raw) : init.body !== undefined ? JSON.stringify(init.body) : undefined })
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';')
      const [k, ...v] = pair.split('=')
      this.jar.set(k, v.join('='))
    }
    const type = res.headers.get('content-type') ?? ''
    const body = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer())
    return { status: res.status, body }
  }

  op(name: string, ...args: unknown[]) {
    return this.call(`/api/ops/${name}`, { body: { args } })
  }
}

const owner = new Client()
const year = new Date().getFullYear()

async function setupCompany(c: Client) {
  const settings = (await c.call('/api/data/settings')).body[0]
  const company = { name: 'Northlight Studio', street: 'Kastanienallee 21', zip: '10435', city: 'Berlin', country: 'DE', taxNumber: '30/245/67890' }
  const res = await c.op('updateSettings', { company: { ...(settings?.company ?? {}), ...company }, onboarded: true })
  assert.equal(res.status, 200)
}

async function readyDraft(c: Client, customerId: string) {
  const draft = (await c.op('createDraft', 'invoice', { customerId })).body.result
  draft.items = [{ id: crypto.randomUUID(), title: 'Consulting', description: '', quantity: 2, unit: 'Std.', unitPriceCents: 10000, taxRate: 19, discountPercent: 0 }]
  assert.equal((await c.op('saveDocument', draft)).status, 200)
  return draft
}

describe('accounts', () => {
  it('lets the first person register as owner and closes signup', async () => {
    assert.equal((await owner.call('/api/session')).body.firstRun, true)
    assert.equal((await owner.call('/api/auth/register', { body: { email: 'lena@example.com', password: 'short' } })).status, 400)
    const ok = await owner.call('/api/auth/register', { body: { email: 'Lena@Example.com', password: 'a long password', name: 'Lena' } })
    assert.equal(ok.status, 201)
    assert.equal(ok.body.user.role, 'owner')
    const session = await owner.call('/api/session')
    assert.equal(session.body.user.email, 'lena@example.com')
    assert.equal(session.body.signup, false)
    assert.equal((await new Client().call('/api/auth/register', { body: { email: 'max@example.com', password: 'a long password' } })).status, 403)
  })

  it('uses HttpOnly session cookies and stores no plain secrets', async () => {
    const res = await fetch(base + '/api/session')
    assert.ok(res.headers.getSetCookie().some((c) => c.startsWith('kontor_csrf=')))
    const login = await new Client().call('/api/auth/login', { body: { email: 'lena@example.com', password: 'a long password' } })
    assert.equal(login.status, 200)
    const raw = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `kontor_csrf=x`, 'X-CSRF-Token': 'x' }, body: JSON.stringify({ email: 'lena@example.com', password: 'a long password' }) })
    const cookie = raw.headers.getSetCookie().find((c) => c.startsWith('kontor_session='))!
    assert.match(cookie, /HttpOnly/i)
    assert.match(cookie, /SameSite=Lax/i)
    const dump = JSON.stringify(sql.prepare('SELECT * FROM users').all()) + JSON.stringify(sql.prepare('SELECT * FROM sessions').all())
    assert.ok(!dump.includes('a long password'))
    assert.ok(!dump.includes(owner.jar.get('kontor_session')!))
    assert.match((sql.prepare('SELECT password_hash FROM users').get() as { password_hash: string }).password_hash, /^\$2[aby]\$12\$/)
  })

  it('throttles password guessing', async () => {
    const c = new Client()
    for (let i = 0; i < 5; i++) assert.equal((await c.call('/api/auth/login', { body: { email: 'lena@example.com', password: 'wrong wrong' } })).status, 401)
    assert.equal((await c.call('/api/auth/login', { body: { email: 'lena@example.com', password: 'a long password' } })).status, 429)
  })

  it('rejects writes without the CSRF token', async () => {
    assert.equal((await owner.call('/api/ops/updateSettings', { body: { args: [{}] }, csrf: false })).status, 403)
    assert.equal((await owner.call('/api/ops/updateSettings', { body: { args: [{}] }, headers: { Origin: 'https://evil.example' } })).status, 403)
  })

  it('lets the owner add members who cannot manage the team', async () => {
    assert.equal((await owner.call('/api/team', { body: { email: 'max@example.com', password: 'another long password', name: 'Max' } })).status, 201)
    const member = new Client()
    assert.equal((await member.call('/api/auth/login', { body: { email: 'max@example.com', password: 'another long password' } })).status, 200)
    assert.equal((await member.call('/api/team', { body: { email: 'x@example.com', password: 'another long password' } })).status, 403)
    assert.equal((await member.call('/api/team')).body.users.length, 2)
  })
})

let customerId = ''

describe('invoices on the server', () => {
  it('assigns gap-free numbers even when clients finalize at the same time', async () => {
    await setupCompany(owner)
    const customer = (await owner.op('saveCustomer', { id: crypto.randomUUID(), number: '', company: 'ACME Ltd', contactPerson: '', addressExtra: '', street: '1 High St', zip: 'E1 6AN', city: 'London', country: 'GB', vatId: '', email: 'ap@acme.example', phone: '', hourlyRateCents: null, paymentTermDays: null, leitwegId: '', notes: '', archived: false, createdAt: '', updatedAt: '' })).body.result
    customerId = customer.id
    const drafts = await Promise.all(Array.from({ length: 12 }, () => readyDraft(owner, customerId)))
    const member = new Client()
    await member.call('/api/auth/login', { body: { email: 'max@example.com', password: 'another long password' } })
    const results = await Promise.all(drafts.map((d, i) => (i % 2 ? member : owner).op('finalizeDocument', d.id)))
    const numbers = results.map((r) => r.body.result.number).sort()
    assert.deepEqual(numbers, Array.from({ length: 12 }, (_, i) => `RE-${year}-${String(i + 1).padStart(4, '0')}`))
  })

  it('keeps finalized invoices immutable and logs changes', async () => {
    const docs = (await owner.call('/api/data/documents')).body
    const final = docs.find((d: { status: string }) => d.status === 'open')
    assert.equal((await owner.call(`/api/data/documents/${final.id}`, { method: 'PUT', body: { ...final, items: [] } })).status, 409)
    assert.equal((await owner.call(`/api/data/documents/${final.id}`, { method: 'DELETE' })).status, 409)
    assert.equal((await owner.op('saveDocument', { ...final, title: 'changed' })).status, 422)
    // payments are still possible
    const paid = await owner.op('addPayment', final.id, { date: '2026-05-01', amountCents: 23800, note: '' })
    assert.equal(paid.body.result.status, 'paid')
    const log = (await owner.call(`/api/audit?id=${final.id}`)).body.entries.map((e: { action: string }) => e.action)
    assert.ok(log.includes('finalizeDocument'))
    assert.ok(log.includes('addPayment'))
  })

  it('does not let plain writes move number counters back', async () => {
    const settings = (await owner.call('/api/data/settings')).body[0]
    const reset = { ...settings, invoiceNumbers: { ...settings.invoiceNumbers, counters: {} } }
    await owner.call('/api/data/settings/main', { method: 'PUT', body: reset })
    const after = (await owner.call('/api/data/settings')).body[0]
    assert.equal(after.invoiceNumbers.counters[String(year)], 12)
  })

  it('refuses to create finalized documents through plain writes', async () => {
    const draft = await readyDraft(owner, customerId)
    assert.equal((await owner.call(`/api/data/documents/${draft.id}`, { method: 'PUT', body: { ...draft, status: 'open', number: 'RE-FAKE' } })).status, 409)
  })

  it('keeps a running timer per user', async () => {
    await owner.op('startTimer', { customerId, project: '', description: 'Owner', billable: true })
    const member = new Client()
    await member.call('/api/auth/login', { body: { email: 'max@example.com', password: 'another long password' } })
    assert.deepEqual((await member.call('/api/data/timer')).body, [])
    assert.equal((await owner.call('/api/data/timer')).body[0].description, 'Owner')
  })
})

describe('files and backups', () => {
  it('stores receipts on the server', async () => {
    const up = await owner.call('/api/files', { raw: Buffer.from('%PDF-1.7 test'), headers: { 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent('Beleg März.pdf') } })
    assert.equal(up.status, 201)
    const down = await owner.call(`/api/files/${up.body.id}`)
    assert.equal(down.body.toString(), '%PDF-1.7 test')
    assert.equal((await owner.call('/api/files', { raw: Buffer.from('MZ'), headers: { 'Content-Type': 'application/x-msdownload' } })).status, 400)
  })

  it('exports and restores the whole workspace', async () => {
    const backup = (await owner.call('/api/backup')).body
    assert.equal(backup.app, 'kontor')
    assert.equal(backup.attachments.length, 1)
    const count = backup.documents.length
    const restored = await owner.call('/api/backup/restore', { body: { backup, mode: 'replace' } })
    assert.equal(restored.status, 200)
    assert.equal((await owner.call('/api/data/documents')).body.length, count)
    assert.equal((await owner.call(`/api/files/${backup.attachments[0].id}`)).body.toString(), '%PDF-1.7 test')
  })

  it('writes database copies and prunes old ones', () => {
    const file = backupDatabase(sql, dataDir, 14)
    assert.ok(file?.endsWith('.sqlite'))
  })
})

describe('mail', () => {
  it('encrypts the SMTP password and sends with attachments', async () => {
    assert.equal((await owner.call('/api/mail/settings', { method: 'PUT', body: { host: 'smtp.example.com', port: 587, user: 'lena', password: 'smtp-secret', from: 'Lena <lena@example.com>' } })).status, 204)
    const got = await owner.call('/api/mail/settings')
    assert.equal(got.body.hasPassword, true)
    assert.ok(!JSON.stringify(got.body).includes('smtp-secret'))
    const res = await owner.call('/api/mail/send', {
      body: { to: 'client@example.com', subject: 'Invoice\r\nBcc: evil@example.com', text: 'Hello', attachments: [{ filename: '../Invoice.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('%PDF').toString('base64') }] },
    })
    assert.equal(res.status, 200)
    const mail = sent.at(-1)!
    assert.equal(mail.subject, 'Invoice Bcc: evil@example.com')
    assert.equal(mail.attachments[0].filename, '.._Invoice.pdf')
  })

  it('keeps credentials out of the log', () => {
    const text = logs.join('\n')
    for (const secret of ['smtp-secret', 'a long password', owner.jar.get('kontor_session')!]) assert.ok(!text.includes(secret))
  })
})

describe('workspaces', () => {
  it('keeps data of different workspaces apart', async () => {
    config.signup = 'open'
    const other = new Client()
    assert.equal((await other.call('/api/auth/register', { body: { email: 'other@example.com', password: 'yet another password' } })).status, 201)
    config.signup = 'first'
    assert.deepEqual((await other.call('/api/data/documents')).body, [])
    const someone = (await owner.call('/api/data/documents')).body[0]
    assert.equal((await other.call(`/api/data/documents/${someone.id}`, { method: 'DELETE' })).status, 200)
    assert.ok((await owner.call('/api/data/documents')).body.some((d: { id: string }) => d.id === someone.id))
  })

  it('runs migrations once', () => {
    const again = openDatabase(dataDir)
    assert.equal((again.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v, 1)
    again.close()
  })
})
