import { useEffect, useSyncExternalStore } from 'react'
import { api, onUnauthorized } from './api'
import { connectEvents, disconnectEvents, invalidate } from './remote'

export interface SessionUser {
  id: string
  email: string
  name: string
  role: 'owner' | 'member'
}

export interface SessionState {
  loading: boolean
  user: SessionUser | null
  signup: boolean
  firstRun: boolean
}

let state: SessionState = { loading: true, user: null, signup: false, firstRun: false }
const listeners = new Set<() => void>()

function set(next: Partial<SessionState>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

export async function refreshSession(): Promise<SessionState> {
  try {
    const s = await api<{ user: SessionUser | null; signup: boolean; firstRun: boolean }>('/api/session')
    set({ loading: false, ...s })
    if (s.user) connectEvents()
  } catch {
    set({ loading: false, user: null })
  }
  return state
}

export async function login(email: string, password: string): Promise<void> {
  const { user } = await api<{ user: SessionUser }>('/api/auth/login', { body: { email, password } })
  invalidate('all')
  set({ user })
  connectEvents()
}

export async function register(email: string, password: string, name: string): Promise<void> {
  const { user } = await api<{ user: SessionUser }>('/api/auth/register', { body: { email, password, name } })
  invalidate('all')
  set({ user, firstRun: false })
  connectEvents()
}

export async function logout(): Promise<void> {
  await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => undefined)
  disconnectEvents()
  set({ user: null })
  void refreshSession()
}

onUnauthorized(() => {
  if (state.user) {
    disconnectEvents()
    set({ user: null })
  }
})

export function useSession(): SessionState {
  const s = useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => state,
  )
  useEffect(() => {
    if (s.loading) void refreshSession()
  }, [s.loading])
  return s
}
