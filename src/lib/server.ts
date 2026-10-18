/** Connection to the optional Kontor server. Stored per device, never synced or exported. */
export interface Connection {
  url: string
  token: string
  email: string
}

const KEY = 'kontor.server'

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage may be unavailable in private windows
  }
}

const listeners = new Set<() => void>()
let cached: Connection | null | undefined

export function getConnection(): Connection | null {
  if (cached === undefined) cached = typeof localStorage === 'undefined' ? null : read<Connection>(KEY)
  return cached
}

export function setConnection(c: Connection | null) {
  cached = c
  write(KEY, c)
  listeners.forEach((l) => l())
}

export function onConnectionChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function normalizeUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, '')
  if (u && !/^https?:\/\//.test(u)) u = `https://${u}`
  return u
}

export class ServerError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; connection?: Connection | null; base?: string } = {}): Promise<T> {
  const c = init.connection === undefined ? getConnection() : init.connection
  const base = init.base ?? c?.url
  if (!base) throw new ServerError(0, 'Kein Server verbunden.')
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(c?.token ? { Authorization: `Bearer ${c.token}` } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new ServerError(0, 'Der Server ist nicht erreichbar.')
  }
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Serverfehler (${res.status})`
    if (res.status === 401 && c?.token) setConnection({ ...c, token: '' })
    throw new ServerError(res.status, message)
  }
  return data as T
}

export interface Health {
  ok: boolean
  signup: boolean
  serverMail: boolean
}

export async function checkServer(url: string): Promise<Health> {
  const health = await api<Health>('/api/health', { base: normalizeUrl(url), connection: null })
  if (!health?.ok) throw new ServerError(0, 'Unter dieser Adresse läuft kein Kontor-Server.')
  return health
}

export async function login(url: string, email: string, password: string, register = false): Promise<Connection> {
  const base = normalizeUrl(url)
  const res = await api<{ token: string; email: string }>(register ? '/api/auth/register' : '/api/auth/login', { base, connection: null, body: { email, password } })
  const c = { url: base, token: res.token, email: res.email }
  setConnection(c)
  return c
}

export async function logout(): Promise<void> {
  const c = getConnection()
  if (c?.token) await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => undefined)
  setConnection(null)
}
