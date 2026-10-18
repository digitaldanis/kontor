import { useSearchParams } from 'react-router-dom'
import { useLiveQuery } from './live'
import { useEffect, useState } from 'react'
import { db } from './db'
import { normalizeSettings } from './migrate'
import { projectUsage } from './projects'
import type { Settings } from './types'

export function useSettings(): Settings | undefined {
  return useLiveQuery(async () => {
    return normalizeSettings(await db.settings.get('main'))
  })
}

export function useTimer() {
  return useLiveQuery(() => db.timer.get('timer'), [], undefined)
}

export function useCustomers(includeArchived = false) {
  return useLiveQuery(async () => {
    const all = await db.customers.toArray()
    return all
      .filter((c) => includeArchived || !c.archived)
      .sort((a, b) => (a.company || a.contactPerson).localeCompare(b.company || b.contactPerson, 'de'))
  }, [includeArchived])
}

/** Re-renders every second while `active` is true. */
export function useNow(active = true, interval = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(t)
  }, [active, interval])
  return now
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Kontor` : 'Kontor'
  }, [title])
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setMatch(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return match
}

/** Runs `open` once when the URL carries ?neu=…, e.g. from the quick search, then drops the parameter. */
export function useNewParam(open: (value: string) => void, ready = true) {
  const [params, setParams] = useSearchParams()
  const value = params.get('neu')
  useEffect(() => {
    if (!value || !ready) return
    open(value)
    const next = new URLSearchParams(params)
    next.delete('neu')
    setParams(next, { replace: true })
    // only react to the parameter itself
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ready])
}

/** Projects of all customers that are at or above the warning threshold. */
export function useBudgetWarnings() {
  const settings = useSettings()
  return useLiveQuery(async () => {
    if (!settings) return []
    const [projects, entries, customers] = await Promise.all([db.projects.filter((p) => !p.archived && (!!p.budgetMinutes || !!p.budgetCents)).toArray(), db.timeEntries.toArray(), db.customers.toArray()])
    const byId = new Map(customers.map((c) => [c.id, c]))
    return projects
      .map((p) => ({ project: p, customer: byId.get(p.customerId), usage: projectUsage(p, entries, byId.get(p.customerId), settings) }))
      .filter((x) => x.usage.state === 'warning' || x.usage.state === 'over')
      .sort((a, b) => b.usage.ratio - a.usage.ratio)
  }, [settings?.timeRounding.minutes, settings?.timeRounding.mode, settings?.defaults.hourlyRateCents])
}
