import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { decrypt, encrypt } from '../src/crypto.ts'
import type { OutgoingMail } from '../src/mail.ts'
import { Store } from '../src/store.ts'

const sent: OutgoingMail[] = []
const logs: string[] = []
const store = new Store(':memory:')
const config = { ...loadConfig({ KONTOR_SECRET: 'test-secret', ALLOW_SIGNUP: 'first' }), dataDir: ':memory:' }
const app = createApp({
  config,
  store,
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
  server.close()
  store.close()
})

async function call(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(base + path, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

let token = ''

describe('accounts', () => {
  it('lets the first user register and then closes signup', async () => {
    assert.equal((await call('/api/health')).body.signup, true)
    const weak = await call('/api/auth/register', { body: { email: 'a@example.de', password: 'kurz' } })
    assert.equal(weak.status, 400)
    const ok = await call('/api/auth/register', { body: { email: 'Lena@Example.de', password: 'ein langes passwort' } })
    assert.equal(ok.status, 201)
    assert.equal(ok.body.email, 'lena@example.de')
    token = ok.body.token
    assert.equal((await call('/api/health')).body.signup, false)
    const second = await call('/api/auth/register', { body: { email: 'b@example.de', password: 'ein langes passwort' } })
    assert.equal(second.status, 403)
  })

  it('logs in with the right password only and throttles guessing', async () => {
    assert.equal((await call('/api/auth/login', { body: { email: 'lena@example.de', password: 'falsch falsch' } })).status, 401)
    const ok = await call('/api/auth/login', { body: { email: 'LENA@example.de', password: 'ein langes passwort' } })
    assert.equal(ok.status, 200)
    for (let i = 0; i < 5; i++) await call('/api/auth/login', { body: { email: 'x@example.de', password: 'nope nope nope' } })
    assert.equal((await call('/api/auth/login', { body: { email: 'x@example.de', password: 'nope nope nope' } })).status, 429)
  })

  it('rejects requests without a valid token', async () => {
    assert.equal((await call('/api/me')).status, 401)
    assert.equal((await call('/api/me', { token: 'erfunden' })).status, 401)
    assert.equal((await call('/api/me', { token })).body.email, 'lena@example.de')
  })

  it('never stores tokens or passwords in plain text', () => {
    const dump = JSON.stringify(store.db.prepare('SELECT * FROM users').all()) + JSON.stringify(store.db.prepare('SELECT * FROM sessions').all())
    assert.ok(!dump.includes('ein langes passwort'))
    assert.ok(!dump.includes(token))
  })
})

describe('sync', () => {
  it('stores changes per user with a cursor and tombstones', async () => {
    const push = await call('/api/sync', { token, body: { changes: [{ table: 'customers', id: 'c1', data: { id: 'c1', company: 'ACME' } }, { table: 'documents', id: 'd1', data: { id: 'd1' } }] } })
    assert.equal(push.body.cursor, 2)
    await call('/api/sync', { token, body: { changes: [{ table: 'documents', id: 'd1', data: null }] } })
    const all = await call('/api/sync?since=0', { token })
    assert.deepEqual(
      all.body.changes.map((c: { table: string; id: string; deleted: boolean; seq: number }) => [c.table, c.id, c.deleted, c.seq]),
      [['customers', 'c1', false, 1], ['documents', 'd1', true, 3]],
    )
    const later = await call('/api/sync?since=1', { token })
    assert.equal(later.body.changes.length, 1)
    assert.equal(later.body.cursor, 3)
  })

  it('refuses unknown tables', async () => {
    assert.equal((await call('/api/sync', { token, body: { changes: [{ table: 'users', id: 'x', data: {} }] } })).status, 400)
  })

  it('keeps data of different users apart', async () => {
    config.signup = 'open'
    const other = await call('/api/auth/register', { body: { email: 'max@example.de', password: 'noch ein passwort' } })
    config.signup = 'first'
    const pulled = await call('/api/sync?since=0', { token: other.body.token })
    assert.deepEqual(pulled.body.changes, [])
  })
})

describe('mail', () => {
  it('encrypts the SMTP password and never returns it', async () => {
    const put = await call('/api/mail/settings', { method: 'PUT', token, body: { host: 'smtp.example.de', port: 587, user: 'lena', password: 'smtp-geheim', from: 'Lena <lena@example.de>' } })
    assert.equal(put.status, 204)
    const got = await call('/api/mail/settings', { token })
    assert.equal(got.body.hasPassword, true)
    assert.ok(!JSON.stringify(got.body).includes('smtp-geheim'))
    const row = store.db.prepare('SELECT password_enc FROM smtp').get() as { password_enc: string }
    assert.notEqual(row.password_enc, 'smtp-geheim')
    assert.equal(decrypt(row.password_enc, 'test-secret'), 'smtp-geheim')
  })

  it('sends a mail with attachments', async () => {
    const res = await call('/api/mail/send', {
      token,
      body: { to: 'kunde@example.de', subject: 'Rechnung RE-1\r\nBcc: evil@example.de', text: 'Hallo', attachments: [{ filename: '../Rechnung.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('%PDF').toString('base64') }] },
    })
    assert.equal(res.status, 200)
    const mail = sent.at(-1)!
    assert.deepEqual(mail.to, ['kunde@example.de'])
    assert.equal(mail.subject, 'Rechnung RE-1 Bcc: evil@example.de')
    assert.equal(mail.attachments[0].filename, '.._Rechnung.pdf')
    assert.equal(mail.attachments[0].content.toString(), '%PDF')
    assert.equal(mail.from, 'Lena <lena@example.de>')
  })

  it('validates recipients', async () => {
    assert.equal((await call('/api/mail/send', { token, body: { to: 'kein-mail', subject: 'x', text: '' } })).status, 400)
  })

  it('keeps credentials out of the log', () => {
    const text = logs.join('\n')
    for (const secret of ['smtp-geheim', 'ein langes passwort', token]) assert.ok(!text.includes(secret))
    assert.ok(logs.some((l) => l.startsWith('POST /api/mail/send 200')))
  })
})

describe('crypto', () => {
  it('requires a secret for encryption', () => {
    assert.throws(() => encrypt('x', ''))
    assert.notEqual(encrypt('x', 's'), encrypt('x', 's'))
  })
})
