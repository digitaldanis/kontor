import { minutesToHours } from './calc'
import { durationMinutes } from './dates'
import { db, now, uid } from './db'
import type { Customer, Project, Settings, TimeEntry, TimeRounding } from './types'

export const BUDGET_WARNING = 0.8

/** Rounds a duration to the configured block, e.g. 15 minutes. */
export function roundMinutes(minutes: number, rounding: TimeRounding | undefined): number {
  const block = rounding?.minutes ?? 0
  if (!block || minutes <= 0) return minutes
  const blocks = rounding?.mode === 'nearest' ? Math.round(minutes / block) : Math.ceil(minutes / block)
  return Math.max(rounding?.mode === 'nearest' ? 0 : block, blocks * block)
}

export function billableMinutes(e: TimeEntry, rounding: TimeRounding | undefined): number {
  return roundMinutes(durationMinutes(e.start, e.end), rounding)
}

export type BudgetState = 'none' | 'ok' | 'warning' | 'over'

export interface ProjectUsage {
  minutes: number
  cents: number
  /** Share of the tighter budget, 0..n */
  ratio: number
  state: BudgetState
}

export function projectEntries(project: Pick<Project, 'customerId' | 'name'>, entries: TimeEntry[]): TimeEntry[] {
  return entries.filter((e) => e.customerId === project.customerId && e.project.trim() === project.name)
}

export function projectUsage(project: Project, entries: TimeEntry[], customer: Customer | undefined, settings: Settings): ProjectUsage {
  const own = projectEntries(project, entries)
  const minutes = own.reduce((s, e) => s + billableMinutes(e, settings.timeRounding), 0)
  const cents = own
    .filter((e) => e.billable)
    .reduce((s, e) => s + Math.round(minutesToHours(billableMinutes(e, settings.timeRounding)) * (e.rateCents ?? customer?.hourlyRateCents ?? settings.defaults.hourlyRateCents)), 0)
  const ratios = [project.budgetMinutes ? minutes / project.budgetMinutes : null, project.budgetCents ? cents / project.budgetCents : null].filter((r): r is number => r !== null)
  const ratio = ratios.length ? Math.max(...ratios) : 0
  const state: BudgetState = !ratios.length ? 'none' : ratio > 1 ? 'over' : ratio >= BUDGET_WARNING ? 'warning' : 'ok'
  return { minutes, cents, ratio, state }
}

export function emptyProject(customerId: string, name = ''): Project {
  return { id: uid(), customerId, name, budgetMinutes: null, budgetCents: null, archived: false, createdAt: now(), updatedAt: now() }
}

/** Keeps the project list in sync with names typed into time entries. */
export async function ensureProject(customerId: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed || !customerId) return
  const existing = await db.projects.where('[customerId+name]').equals([customerId, trimmed]).first()
  if (!existing) await db.projects.put(emptyProject(customerId, trimmed))
}

/** Saves a project; a rename is carried over to its time entries. */
export async function saveProject(project: Project): Promise<Project> {
  const name = project.name.trim()
  if (!name) throw new Error('Bitte einen Projektnamen angeben.')
  return db.transaction('rw', db.projects, db.timeEntries, async () => {
    const clash = await db.projects.where('[customerId+name]').equals([project.customerId, name]).first()
    if (clash && clash.id !== project.id) throw new Error('Diesen Projektnamen gibt es beim Kunden schon.')
    const before = await db.projects.get(project.id)
    if (before && before.name !== name) {
      await db.timeEntries
        .where('customerId')
        .equals(project.customerId)
        .filter((e) => e.project.trim() === before.name)
        .modify({ project: name, updatedAt: now() })
    }
    const saved = { ...project, name, updatedAt: now() }
    await db.projects.put(saved)
    return saved
  })
}
