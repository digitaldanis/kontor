import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import express, { type NextFunction, type Request, type Response } from 'express'
import { parseBackup } from '../../src/lib/backup'
import { db, setDatabase } from '../../src/lib/db'
import { today } from '../../src/lib/dates'
import { runRecurring } from '../../src/lib/recurring'
import { COLLECTIONS, type CollectionName } from '../../src/lib/store'
import type { Config, SmtpConfig } from './config'
import { decrypt, encrypt, hashPassword, hashToken, newToken, verifyPassword } from './crypto'
import { EventHub } from './events'
import { parseAddresses, smtpSender, validAddress, type MailSender } from './mail'
import { AUDITED_OPS, OPS, toJson } from './ops'
import { audit, Forbidden, inTransaction, serialize, workspaceDatabase, type Context } from './workspace'
import { exportWorkspace, restoreWorkspace } from './transfer'

export interface User {
  id: string
  workspace_id: string
  email: string
  name: string
  role: 'owner' | 'member'
  password_hash: string
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: User
    tokenHash?: string
  }
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

let dummy: Promise<string> | null = null
const dummyHash = () => (dummy ??= hashPassword(newToken()))

const SESSION_COOKIE = 'kontor_session'
const CSRF_COOKIE = 'kontor_csrf'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export interface AppOptions {
  config: Config
  sql: DatabaseSync
  sendMail?: MailSender
  log?: (line: string) => void
}

export function createApp({ config, sql, sendMail = smtpSender, log = (l) => console.log(l) }: AppOptions) {
  const app = express()
  const events = new EventHub()
  app.disable('x-powered-by')
  app.set('trust proxy', 'loopback')

  const setCookie = (res: Response, name: string, value: string, opts: { httpOnly: boolean; maxAge: number }) => {
    res.cookie(name, value, { httpOnly: opts.httpOnly, sameSite: 'lax', secure: config.secureCookies, path: '/', maxAge: opts.maxAge })
  }

  // Only method, path and status are logged – never bodies, cookies or headers.
  app.use((req, res, next) => {
    const started = Date.now()
    res.on('finish', () => log(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Date.now() - started}ms`))
    next()
  })

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    next()
  })

  // CSRF: double-submit cookie plus a same-origin check for every state-changing request.
  app.use('/api', (req, res, next) => {
    const c = cookies(req)
    if (!c[CSRF_COOKIE]) setCookie(res, CSRF_COOKIE, newToken(), { httpOnly: false, maxAge: 365 * 86_400_000 })
    if (SAFE_METHODS.has(req.method)) return next()
    const origin = req.headers.origin
    if (origin && new URL(origin).host !== req.headers.host) return next(new HttpError(403, 'Ungültige Herkunft der Anfrage.'))
    const header = req.headers['x-csrf-token']
    if (!c[CSRF_COOKIE] || header !== c[CSRF_COOKIE]) return next(new HttpError(403, 'Sicherheitsprüfung fehlgeschlagen. Bitte die Seite neu laden.'))
    next()
  })

  app.post('/api/files', express.raw({ type: () => true, limit: '12mb' }))
  app.use('/api', express.json({ limit: `${config.maxBodyMb}mb` }))

  const failed = new Map<string, { count: number; until: number }>()
  const throttle = (key: string) => {
    const entry = failed.get(key)
    if (entry && entry.count >= 5 && entry.until > Date.now()) throw new HttpError(429, 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.')
  }
  const fail = (key: string) => {
    const entry = failed.get(key)
    const fresh = !entry || entry.until < Date.now()
    failed.set(key, { count: fresh ? 1 : entry.count + 1, until: Date.now() + 15 * 60_000 })
  }

  const userCount = () => Number((sql.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n)
  const signupOpen = () => config.signup === 'open' || (config.signup === 'first' && userCount() === 0)

  const startSession = (res: Response, userId: string) => {
    const token = newToken()
    const nowIso = new Date().toISOString()
    const expires = new Date(Date.now() + config.sessionDays * 86_400_000).toISOString()
    sql.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(hashToken(token), userId, nowIso, expires)
    setCookie(res, SESSION_COOKIE, token, { httpOnly: true, maxAge: config.sessionDays * 86_400_000 })
  }

  const sessionUser = (req: Request) => {
    const token = cookies(req)[SESSION_COOKIE]
    const hash = token ? hashToken(token) : ''
    const user = hash
      ? (sql.prepare('SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?').get(hash, new Date().toISOString()) as User | undefined)
      : undefined
    return { user, hash }
  }

  const auth = (req: Request, _res: Response, next: NextFunction) => {
    const { user, hash } = sessionUser(req)
    if (!user) return next(new HttpError(401, 'Bitte melde dich an.'))
    req.user = user
    req.tokenHash = hash
    next()
  }

  const ownerOnly = (req: Request, _res: Response, next: NextFunction) => {
    if (req.user?.role !== 'owner') return next(new HttpError(403, 'Nur der Inhaber des Kontos darf das.'))
    next()
  }

  const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, role: u.role })

  const checkPassword = (password: string) => {
    if (password.length < 10) throw new HttpError(400, 'Das Passwort braucht mindestens 10 Zeichen.')
    if (Buffer.byteLength(password) > 72) throw new HttpError(400, 'Das Passwort darf höchstens 72 Bytes lang sein.')
  }

  /** Runs `fn` with the shared domain store bound to the user's workspace, one request at a time. */
  const withStore = <R>(req: Request, trusted: boolean, fn: (ctx: Context) => Promise<R>, opts: { restoring?: boolean } = {}) =>
    serialize(async () => {
      const ctx: Context = { workspaceId: req.user!.workspace_id, userId: req.user!.id, trusted, restoring: opts.restoring, changed: new Set() }
      setDatabase(workspaceDatabase(sql, ctx))
      const result = await inTransaction(sql, () => fn(ctx))
      if (ctx.changed.size) events.publish(ctx.workspaceId, [...ctx.changed], String(req.headers['x-client-id'] ?? ''))
      return { result, changed: [...ctx.changed] }
    })

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, app: 'kontor' })
  })

  app.get('/api/session', (req, res) => {
    const { user } = sessionUser(req)
    if (!user) return void res.json({ user: null, signup: signupOpen(), firstRun: userCount() === 0 })
    res.json({ user: publicUser(user), signup: signupOpen(), firstRun: false })
  })

  app.post('/api/auth/register', async (req, res) => {
    const key = `register|${req.ip}`
    throttle(key)
    if (!signupOpen()) throw new HttpError(403, 'Neue Konten legt der Inhaber unter Einstellungen → Team an.')
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    const password = String(req.body?.password ?? '')
    const name = String(req.body?.name ?? '').trim().slice(0, 120)
    if (!validAddress(email)) throw new HttpError(400, 'Bitte eine gültige E-Mail-Adresse angeben.')
    checkPassword(password)
    if (sql.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      fail(key)
      throw new HttpError(409, 'Für diese E-Mail-Adresse gibt es bereits ein Konto.')
    }
    const hash = await hashPassword(password)
    const workspaceId = crypto.randomUUID()
    const userId = crypto.randomUUID()
    const nowIso = new Date().toISOString()
    await serialize(async () => {
      sql.prepare('INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)').run(workspaceId, '', nowIso)
      sql.prepare('INSERT INTO users (id, workspace_id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(userId, workspaceId, email, name, hash, 'owner', nowIso)
      audit(sql, { workspaceId, userId }, 'register', null, null, email)
    })
    startSession(res, userId)
    res.status(201).json({ user: { id: userId, email, name, role: 'owner' } })
  })

  app.post('/api/auth/login', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    const password = String(req.body?.password ?? '')
    const key = `login|${req.ip}|${email}`
    throttle(key)
    const user = sql.prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined
    // compare against a dummy hash for unknown users so timing doesn't reveal accounts
    const ok = await verifyPassword(password, user?.password_hash ?? (await dummyHash()))
    if (!user || !ok) {
      fail(key)
      throw new HttpError(401, 'E-Mail oder Passwort stimmen nicht.')
    }
    failed.delete(key)
    startSession(res, user.id)
    res.json({ user: publicUser(user) })
  })

  app.post('/api/auth/logout', auth, (req, res) => {
    sql.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.tokenHash!)
    res.clearCookie(SESSION_COOKIE, { path: '/' })
    res.status(204).end()
  })

  app.post('/api/auth/password', auth, async (req, res) => {
    const key = `password|${req.user!.id}`
    throttle(key)
    const current = String(req.body?.current ?? '')
    const next = String(req.body?.next ?? '')
    if (!(await verifyPassword(current, req.user!.password_hash))) {
      fail(key)
      throw new HttpError(400, 'Das aktuelle Passwort stimmt nicht.')
    }
    checkPassword(next)
    sql.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(next), req.user!.id)
    // sign out other sessions
    sql.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(req.user!.id, req.tokenHash!)
    res.status(204).end()
  })

  app.get('/api/team', auth, (req, res) => {
    const users = sql.prepare('SELECT id, email, name, role, created_at FROM users WHERE workspace_id = ? ORDER BY created_at').all(req.user!.workspace_id)
    res.json({ users })
  })

  app.post('/api/team', auth, ownerOnly, async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    const password = String(req.body?.password ?? '')
    const name = String(req.body?.name ?? '').trim().slice(0, 120)
    if (!validAddress(email)) throw new HttpError(400, 'Bitte eine gültige E-Mail-Adresse angeben.')
    checkPassword(password)
    if (sql.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Für diese E-Mail-Adresse gibt es bereits ein Konto.')
    const id = crypto.randomUUID()
    sql.prepare('INSERT INTO users (id, workspace_id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, req.user!.workspace_id, email, name, await hashPassword(password), 'member', new Date().toISOString())
    audit(sql, { workspaceId: req.user!.workspace_id, userId: req.user!.id }, 'add member', null, id, email)
    res.status(201).json({ id, email, name, role: 'member' })
  })

  app.delete('/api/team/:id', auth, ownerOnly, (req, res) => {
    const target = sql.prepare('SELECT * FROM users WHERE id = ? AND workspace_id = ?').get(String(req.params.id), req.user!.workspace_id) as User | undefined
    if (!target) throw new HttpError(404, 'Nicht gefunden.')
    if (target.role === 'owner') throw new HttpError(400, 'Der Inhaber kann nicht entfernt werden.')
    sql.prepare('DELETE FROM users WHERE id = ?').run(target.id)
    audit(sql, { workspaceId: req.user!.workspace_id, userId: req.user!.id }, 'remove member', null, target.id, target.email)
    res.status(204).end()
  })

  const collection = (name: string): CollectionName => {
    if (!(COLLECTIONS as readonly string[]).includes(name)) throw new HttpError(404, 'Unbekannte Datenart.')
    return name as CollectionName
  }

  app.get('/api/data/:collection', auth, async (req, res) => {
    const name = collection(String(req.params.collection))
    const { result } = await withStore(req, false, async () => db.table(name).toArray())
    res.json(toJson(name === 'attachments' ? (result as { data?: unknown }[]).map(({ data: _d, ...meta }) => meta) : result))
  })

  app.put('/api/data/:collection/:id', auth, async (req, res) => {
    const name = collection(String(req.params.collection))
    if (name === 'attachments') throw new HttpError(400, 'Dateien bitte über /api/files hochladen.')
    const record = req.body
    if (!record || typeof record !== 'object' || record.id !== String(req.params.id)) throw new HttpError(400, 'Ungültiger Datensatz.')
    const out = await withStore(req, false, async () => {
      await db.table(name).put(record as never)
      return db.table(name).get(record.id)
    })
    res.json(out)
  })

  app.delete('/api/data/:collection/:id', auth, async (req, res) => {
    const name = collection(String(req.params.collection))
    const out = await withStore(req, false, async () => {
      await db.table(name).delete(String(req.params.id))
    })
    res.json({ changed: out.changed })
  })

  app.post('/api/files', auth, async (req, res) => {
    const body = req.body as Buffer
    if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, 'Leere Datei.')
    const mime = String(req.headers['content-type'] ?? 'application/octet-stream').split(';')[0]
    if (!/^(image\/(png|jpe?g|webp|heic|gif)|application\/pdf|application\/xml|text\/xml)$/.test(mime)) throw new HttpError(400, 'Bitte ein Bild, ein PDF oder eine XML-Datei wählen.')
    const name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'beleg')).replace(/[\\/\r\n]+/g, '_').slice(0, 200)
    const id = String(req.headers['x-file-id'] ?? '') || crypto.randomUUID()
    const meta = { id, name, mime, size: body.length, createdAt: new Date().toISOString() }
    const out = await withStore(req, true, async () => {
      await db.attachments.put({ ...meta, data: new Uint8Array(body) as unknown as Blob })
      return meta
    })
    res.status(201).json(out.result)
  })

  app.get('/api/files/:id', auth, async (req, res) => {
    const row = await serialize(async () => sql.prepare('SELECT name, mime, data FROM files WHERE workspace_id = ? AND id = ?').get(req.user!.workspace_id, String(req.params.id)) as { name: string; mime: string; data: Uint8Array } | undefined)
    if (!row) throw new HttpError(404, 'Der Beleg wurde nicht gefunden.')
    res.setHeader('Content-Type', row.mime)
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.name)}`)
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'")
    res.send(Buffer.from(row.data))
  })

  app.post('/api/ops/:name', auth, async (req, res) => {
    const name = String(req.params.name)
    const op = OPS[name]
    if (!op) throw new HttpError(404, 'Unbekannte Aktion.')
    const args = Array.isArray(req.body?.args) ? req.body.args : []
    const out = await withStore(req, true, async (ctx) => {
      const result = await (op as (...a: unknown[]) => Promise<unknown>)(...args)
      if (AUDITED_OPS.has(name)) audit(sql, ctx, name, null, typeof args[0] === 'string' ? args[0] : null)
      return result
    })
    res.json({ result: toJson(out.result ?? null), changed: out.changed })
  })

  app.get('/api/events', auth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()
    res.write('retry: 3000\n\n')
    events.subscribe(req.user!.workspace_id, String(req.query.client ?? ''), res)
  })

  app.get('/api/audit', auth, (req, res) => {
    const recordId = req.query.id ? String(req.query.id) : null
    const limit = Math.min(500, Number(req.query.limit ?? 100) || 100)
    const rows = sql
      .prepare(
        `SELECT a.at, a.action, a.collection, a.record_id AS recordId, a.summary, users.email
         FROM audit_log a LEFT JOIN users ON users.id = a.user_id
         WHERE a.workspace_id = ? AND (? IS NULL OR a.record_id = ?)
         ORDER BY a.id DESC LIMIT ?`,
      )
      .all(req.user!.workspace_id, recordId, recordId, limit)
    res.json({ entries: rows })
  })

  app.get('/api/backup', auth, async (req, res) => {
    const backup = await serialize(async () => exportWorkspace(sql, req.user!.workspace_id))
    res.setHeader('Content-Disposition', `attachment; filename="kontor-backup-${today()}.json"`)
    res.json(backup)
  })

  app.post('/api/backup/restore', auth, ownerOnly, async (req, res) => {
    const mode = req.body?.mode === 'merge' ? 'merge' : 'replace'
    const backup = parseBackup(JSON.stringify(req.body?.backup ?? null))
    const out = await withStore(
      req,
      true,
      async (ctx) => {
        await restoreWorkspace(sql, ctx, backup, mode)
        audit(sql, ctx, `restore ${mode}`, null, null, `${backup.documents.length} documents, ${backup.customers.length} customers`)
        return { documents: backup.documents.length, customers: backup.customers.length }
      },
      { restoring: true },
    )
    res.json(out.result)
  })

  app.get('/api/backups', auth, ownerOnly, (_req, res) => {
    const dir = join(config.dataDir, 'backups')
    const files = existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith('.sqlite'))
          .map((f) => ({ name: f, size: statSync(join(dir, f)).size, at: statSync(join(dir, f)).mtime.toISOString() }))
          .sort((a, b) => b.at.localeCompare(a.at))
      : []
    res.json({ files, keepDays: config.backupKeepDays, intervalHours: config.backupIntervalHours })
  })

  const smtpFor = (workspaceId: string): SmtpConfig | null => {
    const row = sql.prepare('SELECT * FROM smtp WHERE workspace_id = ?').get(workspaceId) as
      | { host: string; port: number; secure: number; username: string; password_enc: string; from_address: string }
      | undefined
    if (row) return { host: row.host, port: Number(row.port), secure: !!row.secure, user: row.username, password: row.password_enc ? decrypt(row.password_enc, config.secret) : '', from: row.from_address }
    return config.smtp
  }

  app.get('/api/mail/settings', auth, (req, res) => {
    const row = sql.prepare('SELECT host, port, secure, username, password_enc, from_address FROM smtp WHERE workspace_id = ?').get(req.user!.workspace_id) as
      | { host: string; port: number; secure: number; username: string; password_enc: string; from_address: string }
      | undefined
    res.json({
      configured: !!row,
      serverDefault: !!config.smtp,
      host: row?.host ?? '',
      port: row?.port ?? 587,
      secure: !!row?.secure,
      user: row?.username ?? '',
      from: row?.from_address ?? '',
      hasPassword: !!row?.password_enc,
      canStorePassword: !!config.secret,
    })
  })

  app.put('/api/mail/settings', auth, ownerOnly, (req, res) => {
    const b = req.body ?? {}
    const host = String(b.host ?? '').trim()
    const port = Number(b.port ?? 587)
    const from = String(b.from ?? '').trim()
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, 'Bitte Server und Port angeben.')
    if (!validAddress(from.replace(/^.*<(.+)>$/, '$1'))) throw new HttpError(400, 'Bitte eine gültige Absenderadresse angeben.')
    const existing = sql.prepare('SELECT password_enc FROM smtp WHERE workspace_id = ?').get(req.user!.workspace_id) as { password_enc: string } | undefined
    const password = typeof b.password === 'string' && b.password ? encrypt(b.password, config.secret) : (existing?.password_enc ?? '')
    sql
      .prepare(
        `INSERT INTO smtp (workspace_id, host, port, secure, username, password_enc, from_address) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (workspace_id) DO UPDATE SET host = excluded.host, port = excluded.port, secure = excluded.secure, username = excluded.username, password_enc = excluded.password_enc, from_address = excluded.from_address`,
      )
      .run(req.user!.workspace_id, host, port, b.secure ? 1 : 0, String(b.user ?? '').trim(), password, from)
    audit(sql, { workspaceId: req.user!.workspace_id, userId: req.user!.id }, 'smtp settings', null, null, host)
    res.status(204).end()
  })

  app.delete('/api/mail/settings', auth, ownerOnly, (req, res) => {
    sql.prepare('DELETE FROM smtp WHERE workspace_id = ?').run(req.user!.workspace_id)
    res.status(204).end()
  })

  app.post('/api/mail/send', auth, async (req, res) => {
    const smtp = smtpFor(req.user!.workspace_id)
    if (!smtp) throw new HttpError(409, 'Es ist noch kein SMTP-Server eingerichtet.')
    const b = req.body ?? {}
    const to = parseAddresses(b.to)
    const cc = parseAddresses(b.cc)
    const bcc = parseAddresses(b.bcc)
    const all = [...to, ...cc, ...bcc]
    if (!to.length || all.some((a) => !validAddress(a)) || all.length > 20) throw new HttpError(400, 'Bitte gültige Empfängeradressen angeben.')
    const subject = String(b.subject ?? '').replace(/[\r\n]+/g, ' ').slice(0, 300)
    const text = String(b.text ?? '').slice(0, 50_000)
    if (!subject) throw new HttpError(400, 'Der Betreff fehlt.')
    const attachments = (Array.isArray(b.attachments) ? b.attachments : []).slice(0, 10).map((a: { filename?: unknown; contentType?: unknown; contentBase64?: unknown }) => ({
      filename: String(a.filename ?? 'anhang').replace(/[\\/\r\n]+/g, '_').slice(0, 120),
      contentType: String(a.contentType ?? 'application/octet-stream'),
      content: Buffer.from(String(a.contentBase64 ?? ''), 'base64'),
    }))
    const replyTo = typeof b.replyTo === 'string' && validAddress(b.replyTo) ? b.replyTo : undefined
    try {
      const info = await sendMail(smtp, { from: smtp.from, to, cc, bcc, replyTo, subject, text, attachments })
      audit(sql, { workspaceId: req.user!.workspace_id, userId: req.user!.id }, 'mail', null, typeof b.documentId === 'string' ? b.documentId : null, `${subject} → ${to.join(', ')}`)
      res.json({ ok: true, messageId: info.messageId })
    } catch (e) {
      // the SMTP error can name the server, never the credentials
      const message = e instanceof Error ? e.message.replace(/(pass(word)?|auth)[^\s]*/gi, '***') : 'unbekannt'
      throw new HttpError(502, `Versand fehlgeschlagen: ${message}`)
    }
  })

  if (config.staticDir && existsSync(config.staticDir)) {
    const root = resolve(config.staticDir)
    app.use(express.static(root, { index: 'index.html', maxAge: '1h', setHeaders: (res, path) => (path.endsWith('sw.js') || path.endsWith('.html')) && res.setHeader('Cache-Control', 'no-cache') }))
  }

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Nicht gefunden.')))

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError || err instanceof Forbidden) return void res.status(err.status).json({ error: err.message })
    const status = typeof err === 'object' && err && 'status' in err ? Number((err as { status: number }).status) : 0
    if (status === 413) return void res.status(413).json({ error: 'Die Anfrage ist zu groß.' })
    if (status === 400) return void res.status(400).json({ error: 'Ungültige Anfrage.' })
    // domain errors from the shared code carry a user-facing message
    if (err instanceof Error && !status) return void res.status(422).json({ error: err.message })
    log(`error ${err instanceof Error ? err.name : 'unknown'}`)
    res.status(500).json({ error: 'Interner Fehler.' })
  })

  /** Recurring invoices become drafts on their due date, for every workspace. */
  const runSchedules = async () => {
    const workspaces = sql.prepare('SELECT workspaces.id, users.id AS owner FROM workspaces JOIN users ON users.workspace_id = workspaces.id AND users.role = ?').all('owner') as { id: string; owner: string }[]
    for (const ws of workspaces) {
      await serialize(async () => {
        const ctx: Context = { workspaceId: ws.id, userId: ws.owner, trusted: true, changed: new Set() }
        setDatabase(workspaceDatabase(sql, ctx))
        await inTransaction(sql, () => runRecurring(today()))
        if (ctx.changed.size) events.publish(ws.id, [...ctx.changed], '')
      }).catch((e) => log(`recurring failed ${e instanceof Error ? e.name : ''}`))
    }
  }

  return { app, events, runSchedules }
}
