import { beforeEach, describe, expect, it } from 'vitest'
import { db, setDatabase } from '../db'
import { memoryDatabase } from '../store'
import { addMonths, dueRuns, fillPeriod, newRecurring, runDate, runPeriod, runRecurring, saveRecurring } from '../recurring'
import { emptyCustomer, getSettings, newLineItem, saveCustomer } from '../repo'

beforeEach(async () => {
  setDatabase(memoryDatabase())
})

const template = {
  title: 'Rechnung', items: [], introText: '', closingText: '', footerText: '', currency: 'EUR', language: 'de' as const, layout: 'modern' as const, accentColor: '#000', buyerReference: '', discount: null,
}

describe('schedule', () => {
  it('clamps month ends without drifting', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    const rec = { startDate: '2026-01-31', interval: 'monthly' as const, every: 1 }
    expect([0, 1, 2, 3].map((n) => runDate(rec, n))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })

  it('supports weeks, quarters and years', () => {
    expect(runDate({ startDate: '2026-01-05', interval: 'weekly', every: 2 }, 3)).toBe('2026-02-16')
    expect(runDate({ startDate: '2026-01-01', interval: 'quarterly', every: 1 }, 2)).toBe('2026-07-01')
    expect(runDate({ startDate: '2024-02-29', interval: 'yearly', every: 1 }, 1)).toBe('2025-02-28')
  })

  it('bills the period up to the next run', () => {
    expect(runPeriod({ startDate: '2026-03-01', interval: 'monthly', every: 1 }, 0)).toEqual({ from: '2026-03-01', to: '2026-03-31' })
  })

  it('catches up missed runs but respects the end date', () => {
    const rec = { ...newRecurring('c', template, '2026-01-01'), endDate: '2026-03-15' }
    expect(dueRuns(rec, '2026-06-01')).toEqual([0, 1, 2])
    expect(dueRuns({ ...rec, active: false }, '2026-06-01')).toEqual([])
  })

  it('fills period placeholders', () => {
    expect(fillPeriod('Wartung {Monat} {Jahr} ({Quartal})', '2026-04-01', '2026-04-30')).toBe('Wartung April 2026 (Q2)')
    expect(fillPeriod('Hosting {Monat}', '2026-04-01', '2026-04-30', 'en')).toBe('Hosting April')
  })
})

describe('runRecurring', () => {
  it('creates one draft per due period and advances the schedule', async () => {
    const s = await getSettings()
    const c = await saveCustomer({ ...emptyCustomer(), company: 'ACME GmbH', street: 'W 1', zip: '1', city: 'X' })
    await saveRecurring({ ...newRecurring(c.id, { ...template, items: [newLineItem(s, { title: 'Wartung {Monat}', unitPriceCents: 4900 })] }, '2026-01-01') })
    const drafts = await runRecurring('2026-02-10')
    expect(drafts.map((d) => [d.items[0].title, d.serviceFrom, d.serviceTo, d.status])).toEqual([
      ['Wartung Januar', '2026-01-01', '2026-01-31', 'draft'],
      ['Wartung Februar', '2026-02-01', '2026-02-28', 'draft'],
    ])
    const rec = (await db.recurring.toArray())[0]
    expect(rec.runs).toBe(2)
    expect(rec.nextRun).toBe('2026-03-01')
    expect(await runRecurring('2026-02-10')).toEqual([])
  })
})
