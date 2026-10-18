import { describe, expect, it } from 'vitest'
import { blankDocument } from '../defaults'
import { sumBuckets, vatEntries } from '../tax'
import type { InvoiceDocument } from '../types'

const invoice = (partial: Partial<InvoiceDocument>) =>
  blankDocument({
    id: crypto.randomUUID(),
    status: 'open',
    number: 'RE-1',
    issueDate: '2026-03-20',
    items: [{ id: '1', title: 'Leistung', description: '', quantity: 1, unit: 'Stk.', unitPriceCents: 100000, taxRate: 19, discountPercent: 0 }],
    ...partial,
  })

describe('VAT by taxation method', () => {
  it('counts accrual by invoice date', () => {
    const e = vatEntries([invoice({})], 'accrual')
    expect(e[0].date).toBe('2026-03-20')
    expect(sumBuckets(e)).toMatchObject([{ rate: 19, netCents: 100000, taxCents: 19000 }])
  })

  it('counts cash by payment date and splits partial payments', () => {
    const doc = invoice({
      payments: [
        { id: 'a', date: '2026-04-02', amountCents: 59500, note: '' },
        { id: 'b', date: '2026-05-10', amountCents: 59500, note: '' },
      ],
    })
    const e = vatEntries([doc], 'cash')
    expect(e.map((x) => x.date)).toEqual(['2026-04-02', '2026-05-10'])
    expect(e[0].buckets[0]).toMatchObject({ netCents: 50000, taxCents: 9500 })
    expect(sumBuckets(e)).toMatchObject([{ netCents: 100000, taxCents: 19000 }])
  })

  it('ignores unpaid invoices and their cancellation under cash accounting', () => {
    const doc = invoice({ status: 'cancelled' })
    const storno = invoice({ kind: 'cancellation', cancelsId: doc.id, issueDate: '2026-04-01', items: doc.items.map((i) => ({ ...i, quantity: -1 })) })
    expect(vatEntries([doc, storno], 'cash')).toEqual([])
    expect(sumBuckets(vatEntries([doc, storno], 'accrual'))).toEqual([])
  })

  it('reduces cash VAT by a credit note on a paid invoice', () => {
    const doc = invoice({ status: 'paid', payments: [{ id: 'a', date: '2026-04-02', amountCents: 119000, note: '' }] })
    const credit = invoice({ kind: 'creditNote', creditsId: doc.id, issueDate: '2026-04-15', items: [{ ...doc.items[0], unitPriceCents: 20000 }] })
    const total = sumBuckets(vatEntries([doc, credit], 'cash'))
    expect(total).toMatchObject([{ netCents: 80000, taxCents: 15200 }])
  })

  it('counts only the remainder of a final invoice', () => {
    const final = invoice({
      billingType: 'final',
      deductions: [{ invoiceId: 'x', number: 'RE-0', issueDate: '2026-01-01', groups: [{ rate: 19, netCents: 30000, taxCents: 5700 }] }],
      payments: [{ id: 'a', date: '2026-04-02', amountCents: 83300, note: '' }],
    })
    expect(sumBuckets(vatEntries([final], 'accrual'))).toMatchObject([{ netCents: 70000, taxCents: 13300 }])
    expect(sumBuckets(vatEntries([final], 'cash'))).toMatchObject([{ netCents: 70000, taxCents: 13300 }])
  })
})
