/** Thin client for the Kontor API: same-origin cookies, CSRF header, readable errors. */

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const clientId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random())

const unauthorized = new Set<() => void>()

export function onUnauthorized(fn: () => void): () => void {
  unauthorized.add(fn)
  return () => unauthorized.delete(fn)
}

function csrfToken(): string {
  const m = /(?:^|;\s*)kontor_csrf=([^;]+)/.exec(typeof document === 'undefined' ? '' : document.cookie)
  return m ? decodeURIComponent(m[1]) : ''
}

export async function request(path: string, init: { method?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}): Promise<Response> {
  const method = init.method ?? (init.body !== undefined || init.raw !== undefined ? 'POST' : 'GET')
  const headers: Record<string, string> = { 'X-Client-Id': clientId, ...init.headers }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken()
  let res: Response
  try {
    res = await fetch(path, { method, headers, credentials: 'same-origin', body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined) })
  } catch {
    throw new ApiError(0, 'Der Server ist nicht erreichbar.')
  }
  if (!res.ok) {
    let message = `Serverfehler (${res.status})`
    try {
      message = ((await res.json()) as { error?: string }).error ?? message
    } catch {
      // not JSON
    }
    if (res.status === 401) unauthorized.forEach((fn) => fn())
    throw new ApiError(res.status, message)
  }
  return res
}

export async function api<T>(path: string, init: Parameters<typeof request>[1] = {}): Promise<T> {
  const res = await request(path, init)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/** Undoes the server's JSON encoding of binary values. */
export function revive<T>(value: T): T {
  if (Array.isArray(value)) return value.map(revive) as T
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>
    if (typeof v.$bytes === 'string' && Object.keys(v).length === 1) {
      const bin = atob(v.$bytes)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return new Blob([bytes]) as T
    }
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) out[k] = revive(x)
    return out as T
  }
  return value
}
