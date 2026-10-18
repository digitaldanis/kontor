import { describe, expect, it } from 'vitest'
import { blankDocument } from '../defaults'
import { checkAttachment, emptyExpense, euer, expensesToCsv, vatFromGross, vatReturn } from '../expenses'
import type { InvoiceDocument } from '../types'

describe('input VAT', () => {
  it('extracts VAT from gross amounts', () => {
    expect(vatFromGross(11900, 19)).toBe(1900)
    expect(vatFromGross(10700, 7)).toBe(700)
    // 9,99 € brutto bei 19 %: netto 8,39 €
    expect(vatFromGross(999, 19)).toBe(160)
    expect(vatFromGross(999, 0)).toBe(0)
  })
})

const inv = (partial: Partial<InvoiceDocument>) =>
  blankDocument({
    id: crypto.randomUUID(),
    status: 'open',
    number: 'RE-1',
    issueDate: '2026-02-10',
    items: [{ id: '1', title: 'L', description: '', quantity: 1, unit: 'Stk.', unitPriceCents: 100000, taxRate: 19, discountPercent: 0 }],
    ...partial,
  })

const docs = [
  inv({ payments: [{ id: 'p', date: '2026-03-05', amountCents: 119000, note: '' }], status: 'paid' }),
  inv({ issueDate: '2026-03-12', items: [{ id: '2', title: 'Buch', description: '', quantity: 2, unit: 'Stk.', unitPriceCents: 1550, taxRate: 7, discountPercent: 0 }] }),
  inv({ issueDate: '2026-03-20', taxMode: 'reverseCharge', items: [{ id: '3', title: 'Beratung', description: '', quantity: 1, unit: 'Std.', unitPriceCents: 50099, taxRate: 19, discountPercent: 0 }] }),
  inv({ issueDate: '2026-03-21', taxMode: 'thirdCountry', items: [{ id: '4', title: 'Beratung', description: '', quantity: 1, unit: 'Std.', unitPriceCents: 20000, taxRate: 19, discountPercent: 0 }] }),
]
const expenses = [
  emptyExpense({ date: '2026-03-02', paidAt: '2026-03-02', grossCents: 11900, vatCents: 1900, category: 'Software & Abos' }),
  emptyExpense({ date: '2026-03-30', paidAt: '2026-04-02', grossCents: 5350, vatCents: 350, taxRate: 7, category: 'Fortbildung' }),
]

describe('VAT return figures', () => {
  it('fills the Kennzahlen by invoice date (Soll)', () => {
    const r = vatReturn(docs, expenses, '2026-03-01', '2026-03-31', 'accrual')
    expect(r.kz81).toBe(0)
    expect(r.kz86).toBe(31)
    expect(r.kz86Tax).toBe(217)
    expect(r.kz21).toBe(500)
    expect(r.kz45).toBe(200)
    expect(r.kz66).toBe(2250)
    expect(r.kz83).toBe(217 - 2250)
  })

  it('counts payments and paid expenses under Ist', () => {
    const r = vatReturn(docs, expenses, '2026-03-01', '2026-03-31', 'cash')
    expect(r.kz81).toBe(1000)
    expect(r.kz81Tax).toBe(19000)
    expect(r.kz86).toBe(0)
    expect(r.kz66).toBe(1900)
    expect(r.kz83).toBe(19000 - 1900)
  })
})

describe('EÜR', () => {
  it('counts what was paid in the period', () => {
    const r = euer(docs, expenses, '2026-01-01', '2026-03-31', false)
    expect(r.incomeNetCents).toBe(100000)
    expect(r.incomeVatCents).toBe(19000)
    expect(r.expenseNetCents).toBe(10000)
    expect(r.inputVatCents).toBe(1900)
    expect(r.resultCents).toBe(90000)
    expect(r.byCategory).toEqual([{ category: 'Software & Abos', netCents: 10000 }])
  })

  it('uses gross amounts for small businesses', () => {
    const r = euer(docs, expenses, '2026-01-01', '2026-12-31', true)
    expect(r.expenseNetCents).toBe(17250)
    expect(r.inputVatCents).toBe(0)
  })
})

describe('receipts', () => {
  it('accepts images, PDF and XML up to 10 MB', () => {
    expect(checkAttachment({ name: 'a.pdf', type: 'application/pdf', size: 1000 })).toBeNull()
    expect(checkAttachment({ name: 'x.xml', type: '', size: 1000 })).toBeNull()
    expect(checkAttachment({ name: 'a.exe', type: 'application/x-msdownload', size: 1 })).not.toBeNull()
    expect(checkAttachment({ name: 'a.jpg', type: 'image/jpeg', size: 11 * 1024 * 1024 })).not.toBeNull()
  })

  it('exports CSV for Excel', () => {
    const csv = expensesToCsv(expenses)
    expect(csv.split('\r\n')).toHaveLength(3)
    expect(csv).toContain('119,00;19;19,00;100,00')
  })
})
