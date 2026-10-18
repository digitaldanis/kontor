import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import type { Config, SmtpConfig } from './config.ts'
import { decrypt, encrypt, hashPassword, hashToken, newToken, verifyPassword } from './crypto.ts'
import { parseAddresses, smtpSender, validAddress, type MailSender } from './mail.ts'
import { Store, SYNC_TABLES, type User } from './store.ts'

declare module 'express-serve-static-core' {
  interface Request {
    user?: User
    tokenHash?: string
  }
}

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const MAX_CHANGES = 2000

export interface AppOptions {
  config: Config
  store: Store
  sendMail?: MailSender
  log?: (line: string) => void
}

export function createApp({ config, store, sendMail = smtpSender, log = (l) => console.log(l) }: AppOptions) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 'loopback')

  // Only method, path and status are logged – never bodies or headers.
  app.use((req, res, next) => {
    const started = Date.now()
    res.on('finish', () => log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`))
    next()
  })

  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin
    if (origin && (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      res.setHeader('Access-Control-Max-Age', '600')
    }
    if (req.method === 'OPTIONS') return void res.status(204).end()
    res.setHeader('Cache-Control', 'no-store')
    next()
  })

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

  const auth = (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    const user = token ? store.userBySession(hashToken(token)) : undefined
    if (!user) return next(new HttpError(401, 'Bitte neu anmelden.'))
    req.user = user
    req.tokenHash = hashToken(token)
    next()
  }

  const signupOpen = () => config.signup === 'open' || (config.signup === 'first' && store.userCount() === 0)

  const userSmtp = (userId: number): SmtpConfig | null => {
    const row = store.smtp(userId)
    if (row) {
      return { host: row.host, port: row.port, secure: !!row.secure, user: row.username, password: row.password_enc ? decrypt(row.password_enc, config.secret) : '', from: row.from_address }
    }
    return config.smtp
  }

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, app: 'kontor-server', signup: signupOpen(), serverMail: !!config.smtp })
  })

  app.post('/api/auth/register', async (req, res) => {
    if (!signupOpen()) throw new HttpError(403, 'Neue Konten sind auf diesem Server nicht freigeschaltet.')
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    const password = String(req.body?.password ?? '')
    if (!validAddress(email)) throw new HttpError(400, 'Bitte eine gültige E-Mail-Adresse angeben.')
    if (password.length < 10) throw new HttpError(400, 'Das Passwort braucht mindestens 10 Zeichen.')
    if (store.userByEmail(email)) throw new HttpError(409, 'Für diese E-Mail-Adresse gibt es bereits ein Konto.')
    const user = store.createUser(email, await hashPassword(password))
    const token = newToken()
    store.createSession(hashToken(token), user.id, config.sessionDays)
    res.status(201).json({ token, email: user.email })
  })

  app.post('/api/auth/login', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    const password = String(req.body?.password ?? '')
    const key = `${req.ip}|${email}`
    throttle(key)
    const user = store.userByEmail(email)
    const ok = user ? await verifyPassword(password, user.password_hash) : await verifyPassword(password, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')
    if (!user || !ok) {
      fail(key)
      throw new HttpError(401, 'E-Mail oder Passwort stimmen nicht.')
    }
    failed.delete(key)
    const token = newToken()
    store.createSession(hashToken(token), user.id, config.sessionDays)
    res.json({ token, email: user.email })
  })

  app.post('/api/auth/logout', auth, (req, res) => {
    store.deleteSession(req.tokenHash!)
    res.status(204).end()
  })

  app.get('/api/me', auth, (req, res) => {
    res.json({ email: req.user!.email, cursor: store.cursor(req.user!.id) })
  })

  app.get('/api/sync', auth, (req, res) => {
    const since = Math.max(0, Number(req.query.since ?? 0) || 0)
    const limit = Math.min(MAX_CHANGES, Math.max(1, Number(req.query.limit ?? 500) || 500))
    const changes = store.pull(req.user!.id, since, limit)
    const cursor = changes.length ? changes[changes.length - 1].seq : since
    res.json({ changes, cursor, more: changes.length === limit })
  })

  app.post('/api/sync', auth, (req, res) => {
    const changes = req.body?.changes
    if (!Array.isArray(changes) || changes.length > MAX_CHANGES) throw new HttpError(400, 'Ungültige Änderungsliste.')
    const clean = changes.map((c: { table?: unknown; id?: unknown; data?: unknown }) => {
      const table = String(c?.table ?? '')
      const id = String(c?.id ?? '')
      if (!(SYNC_TABLES as readonly string[]).includes(table) || !id || id.length > 200) throw new HttpError(400, `Unbekannter Datensatz: ${table}`)
      return { table, id, data: c.data ?? null }
    })
    const cursor = store.push(req.user!.id, clean)
    res.json({ cursor })
  })

  app.get('/api/mail/settings', auth, (req, res) => {
    const row = store.smtp(req.user!.id)
    res.json({
      configured: !!row,
      serverDefault: !!config.smtp,
      host: row?.host ?? '',
      port: row?.port ?? 587,
      secure: !!row?.secure,
      user: row?.username ?? '',
      from: row?.from_address ?? '',
      hasPassword: !!row?.password_enc,
    })
  })

  app.put('/api/mail/settings', auth, (req, res) => {
    const b = req.body ?? {}
    const host = String(b.host ?? '').trim()
    const port = Number(b.port ?? 587)
    const from = String(b.from ?? '').trim()
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, 'Bitte Server und Port angeben.')
    if (!validAddress(from.replace(/^.*<(.+)>$/, '$1'))) throw new HttpError(400, 'Bitte eine gültige Absenderadresse angeben.')
    const existing = store.smtp(req.user!.id)
    const password = typeof b.password === 'string' && b.password ? encrypt(b.password, config.secret) : (existing?.password_enc ?? '')
    store.saveSmtp(req.user!.id, { host, port, secure: b.secure ? 1 : 0, username: String(b.user ?? '').trim(), password_enc: password, from_address: from })
    res.status(204).end()
  })

  app.delete('/api/mail/settings', auth, (req, res) => {
    store.deleteSmtp(req.user!.id)
    res.status(204).end()
  })

  app.post('/api/mail/send', auth, async (req, res) => {
    const smtp = userSmtp(req.user!.id)
    if (!smtp) throw new HttpError(409, 'Für dein Konto ist noch kein SMTP-Server eingerichtet.')
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
      res.json({ ok: true, messageId: info.messageId })
    } catch (e) {
      // the SMTP error message can contain the server name but no credentials
      const message = e instanceof Error ? e.message.replace(/(pass(word)?|auth)[^\s]*/gi, '***') : 'unbekannt'
      throw new HttpError(502, `Versand fehlgeschlagen: ${message}`)
    }
  })

  if (config.staticDir && existsSync(config.staticDir)) {
    const root = resolve(config.staticDir)
    app.use(express.static(root, { index: 'index.html', maxAge: '1h', setHeaders: (res, path) => path.endsWith('sw.js') && res.setHeader('Cache-Control', 'no-cache') }))
  }

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Nicht gefunden.')))

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message })
    const status = typeof err === 'object' && err && 'status' in err ? Number((err as { status: number }).status) : 500
    if (status === 413) return void res.status(413).json({ error: 'Die Anfrage ist zu groß.' })
    if (status === 400) return void res.status(400).json({ error: 'Ungültige Anfrage.' })
    log(`error ${err instanceof Error ? err.name : 'unknown'}`)
    res.status(500).json({ error: 'Interner Fehler.' })
  })

  return app
}
