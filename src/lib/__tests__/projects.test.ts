import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { defaultSettings } from '../defaults'
import { emptyProject, ensureProject, projectUsage, roundMinutes, saveProject } from '../projects'
import type { TimeEntry } from '../types'

const entry = (minutes: number, project = 'Website', billable = true): TimeEntry => {
  const start = new Date('2026-03-02T08:00:00.000Z')
  return {
    id: crypto.randomUUID(), customerId: 'c', project, description: 'x', details: '', start: start.toISOString(),
    end: new Date(start.getTime() + minutes * 60_000).toISOString(), billable, rateCents: null, invoiceId: null, createdAt: '', updatedAt: '',
  }
}

describe('time rounding', () => {
  it('rounds up to blocks', () => {
    expect(roundMinutes(1, { minutes: 15, mode: 'up' })).toBe(15)
    expect(roundMinutes(15, { minutes: 15, mode: 'up' })).toBe(15)
    expect(roundMinutes(16, { minutes: 15, mode: 'up' })).toBe(30)
  })

  it('rounds to the nearest block', () => {
    expect(roundMinutes(7, { minutes: 15, mode: 'nearest' })).toBe(0)
    expect(roundMinutes(8, { minutes: 15, mode: 'nearest' })).toBe(15)
    expect(roundMinutes(52, { minutes: 6, mode: 'nearest' })).toBe(54)
  })

  it('keeps exact minutes without rounding', () => {
    expect(roundMinutes(37, { minutes: 0, mode: 'up' })).toBe(37)
  })
})

describe('project budgets', () => {
  const settings = { ...defaultSettings(), timeRounding: { minutes: 15, mode: 'up' as const } }
  const customer = { hourlyRateCents: 10000 } as never

  it('sums rounded time and value of the project only', () => {
    const p = { ...emptyProject('c', 'Website'), budgetMinutes: 600 }
    const usage = projectUsage(p, [entry(50), entry(70), entry(30, 'Anderes'), entry(10, 'Website', false)], customer, settings)
    // 60 + 75 + 15 minutes
    expect(usage.minutes).toBe(150)
    // only billable: 2,25 h × 100 €
    expect(usage.cents).toBe(22500)
    expect(usage.state).toBe('ok')
  })

  it('warns from 80 % and flags overruns of either budget', () => {
    const p = { ...emptyProject('c', 'Website'), budgetMinutes: 600, budgetCents: 50000 }
    expect(projectUsage(p, [entry(240)], customer, settings).state).toBe('warning')
    expect(projectUsage(p, [entry(301)], customer, settings).state).toBe('over')
    expect(projectUsage({ ...p, budgetMinutes: null, budgetCents: null }, [entry(301)], customer, settings).state).toBe('none')
  })
})

describe('project records', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('creates projects once and renames time entries along', async () => {
    await ensureProject('c', 'Website')
    await ensureProject('c', ' Website ')
    expect(await db.projects.count()).toBe(1)
    const e = entry(60)
    await db.timeEntries.put(e)
    const p = (await db.projects.toArray())[0]
    await saveProject({ ...p, name: 'Relaunch' })
    expect((await db.timeEntries.get(e.id))?.project).toBe('Relaunch')
    await ensureProject('c', 'Shop')
    const shop = (await db.projects.toArray()).find((x) => x.name === 'Shop')!
    await expect(saveProject({ ...shop, name: 'Relaunch' })).rejects.toThrow(/schon/)
  })
})
