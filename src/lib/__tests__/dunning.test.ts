import { describe, expect, it } from 'vitest'
import { blankDocument } from '../defaults'
import { daysInDefault, defaultDunning, defaultInterest, defaultInterestRate, draftReminder, nextLevel, nextReminderDate, reminderTotal } from '../dunning'
import type { Reminder } from '../types'

const invoice = blankDocument({
  id: 'inv',
  status: 'open',
  number: 'RE-2026-0010',
  issueDate: '2026-03-01',
  dueDate: '2026-03-15',
  recipient: { company: 'Kunde GmbH', contactPerson: '', addressExtra: '', street: 'A 1', zip: '1', city: 'B', country: 'DE', vatId: '', email: '', leitwegId: '' },
  items: [{ id: '1', title: 'Leistung', description: '', quantity: 1, unit: 'Stk.', unitPriceCents: 100000, taxRate: 19, discountPercent: 0 }],
})

describe('default interest (§ 288 BGB)', () => {
  it('adds 9 points for businesses and 5 for consumers', () => {
    expect(defaultInterestRate(1.27, false)).toBe(10.27)
    expect(defaultInterestRate(1.27, true)).toBe(6.27)
    expect(defaultInterestRate(-0.88, false)).toBe(8.12)
  })

  it('calculates per day on 365 days', () => {
    // 1.190,00 € × 10,27 % × 30 / 365 = 10,0449 € -> 10,04 €
    expect(defaultInterest(119000, 10.27, 30)).toBe(1004)
    expect(defaultInterest(119000, 10.27, 365)).toBe(12221)
    expect(defaultInterest(119000, 10.27, 0)).toBe(0)
    expect(defaultInterest(0, 10.27, 30)).toBe(0)
  })

  it('starts counting the day after the due date', () => {
    expect(daysInDefault('2026-03-15', '2026-03-15')).toBe(0)
    expect(daysInDefault('2026-03-15', '2026-03-16')).toBe(1)
    expect(daysInDefault('2026-03-15', '2026-04-14')).toBe(30)
  })
})

describe('reminder drafts', () => {
  const settings = { ...defaultDunning(), flatFeeB2B: true }

  it('starts with a fee-free payment reminder without interest', () => {
    const r = draftReminder({ invoice, reminders: [], settings, issueDate: '2026-03-25' })
    expect(r.level).toBe(0)
    expect(r.feeCents).toBe(0)
    expect(r.interestCents).toBe(0)
    expect(r.flatFeeCents).toBe(0)
    expect(r.deadline).toBe('2026-04-04')
    expect(reminderTotal(r)).toBe(119000)
  })

  it('adds fee, interest and the B2B flat fee to the first dunning letter', () => {
    const first = { ...draftReminder({ invoice, reminders: [], settings, issueDate: '2026-03-25' }), id: 'r0', createdAt: '' } as Reminder
    const r = draftReminder({ invoice, reminders: [first], settings, issueDate: '2026-04-14' })
    expect(r.level).toBe(1)
    expect(r.feeCents).toBe(500)
    expect(r.interestDays).toBe(30)
    expect(r.interestCents).toBe(1004)
    expect(r.flatFeeCents).toBe(4000)
    expect(reminderTotal(r)).toBe(119000 + 500 + 1004 + 4000)
  })

  it('carries earlier fees and claims the flat fee only once', () => {
    const steps: Reminder[] = [
      { ...draftReminder({ invoice, reminders: [], settings, issueDate: '2026-03-25' }), id: 'a', createdAt: '' },
    ]
    steps.push({ ...draftReminder({ invoice, reminders: steps, settings, issueDate: '2026-04-14' }), id: 'b', createdAt: '' })
    const r = draftReminder({ invoice, reminders: steps, settings, issueDate: '2026-05-08' })
    expect(r.level).toBe(2)
    expect(r.previousFeesCents).toBe(500)
    expect(r.feeCents).toBe(1000)
    expect(r.flatFeeCents).toBe(0)
    expect(nextLevel([...steps, { ...r, id: 'c', createdAt: '' }])).toBeNull()
  })

  it('uses the consumer rate and no flat fee for private customers', () => {
    const consumer = { ...invoice, recipient: { ...invoice.recipient, company: '', contactPerson: 'Erika Muster' } }
    const r = draftReminder({ invoice: consumer, reminders: [], settings, issueDate: '2026-04-14', level: 1 })
    expect(r.interestRatePercent).toBe(6.27)
    expect(r.flatFeeCents).toBe(0)
  })

  it('schedules the next step from the previous deadline', () => {
    expect(nextReminderDate(invoice, [], settings)).toBe('2026-03-22')
    const first = { ...draftReminder({ invoice, reminders: [], settings, issueDate: '2026-03-25' }), id: 'a', createdAt: '' }
    expect(nextReminderDate(invoice, [first], settings)).toBe('2026-04-18')
  })

  it('claims interest only on the amount still open', () => {
    const partly = { ...invoice, payments: [{ id: 'p', date: '2026-03-20', amountCents: 59500, note: '' }] }
    const r = draftReminder({ invoice: partly, reminders: [], settings, issueDate: '2026-04-14', level: 1 })
    expect(r.openCents).toBe(59500)
    expect(r.interestCents).toBe(defaultInterest(59500, 10.27, 30))
  })
})
