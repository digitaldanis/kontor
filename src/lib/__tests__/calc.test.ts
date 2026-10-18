import { describe, expect, it } from 'vitest'
import { calculateTotals, lineTotal } from '../calc'
import type { LineItem } from '../types'

function item(partial: Partial<LineItem>): LineItem {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'Position',
    description: '',
    quantity: 1,
    unit: 'Stk.',
    unitPriceCents: 0,
    taxRate: 19,
    discountPercent: 0,
    ...partial,
  }
}

describe('lineTotal', () => {
  it('multiplies quantity and unit price', () => {
    expect(lineTotal(item({ quantity: 3, unitPriceCents: 1999 })).netCents).toBe(5997)
  })

  it('handles fractional hours', () => {
    // 1,25 h × 85,00 € = 106,25 €
    expect(lineTotal(item({ quantity: 1.25, unitPriceCents: 8500 })).netCents).toBe(10625)
    // 0,33 h × 95,00 € = 31,35 €
    expect(lineTotal(item({ quantity: 0.33, unitPriceCents: 9500 })).netCents).toBe(3135)
  })

  it('rounds half away from zero', () => {
    // 0,5 × 0,01 € = 0,005 € -> 0,01 €
    expect(lineTotal(item({ quantity: 0.5, unitPriceCents: 1 })).netCents).toBe(1)
    expect(lineTotal(item({ quantity: -0.5, unitPriceCents: 1 })).netCents).toBe(-1)
  })

  it('applies a percentage discount', () => {
    const t = lineTotal(item({ quantity: 2, unitPriceCents: 4999, discountPercent: 10 }))
    expect(t.grossListCents).toBe(9998)
    expect(t.netCents).toBe(8998)
    expect(t.discountCents).toBe(1000)
  })

  it('avoids floating point drift', () => {
    expect(lineTotal(item({ quantity: 0.1, unitPriceCents: 30 })).netCents).toBe(3)
    expect(lineTotal(item({ quantity: 1.005, unitPriceCents: 100000 })).netCents).toBe(100500)
  })
})

describe('calculateTotals', () => {
  it('groups tax by rate', () => {
    const totals = calculateTotals([
      item({ quantity: 1, unitPriceCents: 10000, taxRate: 19 }),
      item({ quantity: 2, unitPriceCents: 1250, taxRate: 7 }),
      item({ quantity: 1, unitPriceCents: 5000, taxRate: 19 }),
    ])
    expect(totals.groups).toEqual([
      { rate: 19, netCents: 15000, taxCents: 2850, allowanceCents: 0 },
      { rate: 7, netCents: 2500, taxCents: 175, allowanceCents: 0 },
    ])
    expect(totals.netCents).toBe(17500)
    expect(totals.taxCents).toBe(3025)
    expect(totals.grossCents).toBe(20525)
  })

  it('rounds 7 % VAT on the group sum, not per line', () => {
    const totals = calculateTotals([
      item({ quantity: 1, unitPriceCents: 107, taxRate: 7 }),
      item({ quantity: 1, unitPriceCents: 107, taxRate: 7 }),
      item({ quantity: 1, unitPriceCents: 107, taxRate: 7 }),
    ])
    // 3,21 € × 7 % = 0,2247 € -> 0,22 € (per line would give 3 × 0,07 = 0,21 €)
    expect(totals.taxCents).toBe(22)
  })

  it('charges no VAT for small businesses or reverse charge', () => {
    const items = [item({ quantity: 1, unitPriceCents: 10000, taxRate: 19 })]
    for (const mode of ['smallBusiness', 'reverseCharge', 'thirdCountry', 'intraCommunitySupply'] as const) {
      const t = calculateTotals(items, mode)
      expect(t.taxCents).toBe(0)
      expect(t.grossCents).toBe(10000)
      expect(t.groups).toEqual([{ rate: 0, netCents: 10000, taxCents: 0, allowanceCents: 0 }])
    }
  })

  it('mirrors a cancellation exactly', () => {
    const original = [
      item({ quantity: 3.5, unitPriceCents: 7333, taxRate: 19 }),
      item({ quantity: 1, unitPriceCents: 1999, taxRate: 7, discountPercent: 15 }),
    ]
    const reversed = original.map((i) => ({ ...i, quantity: -i.quantity }))
    const a = calculateTotals(original)
    const b = calculateTotals(reversed)
    expect(b.grossCents).toBe(-a.grossCents)
    expect(b.taxCents).toBe(-a.taxCents)
  })

  it('handles an empty invoice', () => {
    const t = calculateTotals([])
    expect(t.grossCents).toBe(0)
    expect(t.groups).toEqual([])
  })
})

describe('invoice discount', () => {
  const mixed = [
    item({ quantity: 1, unitPriceCents: 10000, taxRate: 19 }),
    item({ quantity: 1, unitPriceCents: 5000, taxRate: 7 }),
  ]

  it('applies a percentage per tax rate', () => {
    const t = calculateTotals(mixed, 'standard', { discount: { type: 'percent', value: 10 } })
    expect(t.lineNetCents).toBe(15000)
    expect(t.groups).toEqual([
      { rate: 19, netCents: 9000, taxCents: 1710, allowanceCents: 1000 },
      { rate: 7, netCents: 4500, taxCents: 315, allowanceCents: 500 },
    ])
    expect(t.allowanceCents).toBe(1500)
    expect(t.netCents).toBe(13500)
    expect(t.grossCents).toBe(15525)
  })

  it('distributes a fixed amount proportionally to the nets', () => {
    // 100 € on 150 € net: 66,67 € on the 19 % part, 33,33 € on the 7 % part
    const t = calculateTotals(mixed, 'standard', { discount: { type: 'amount', value: 10000 } })
    expect(t.groups.map((g) => g.allowanceCents)).toEqual([6667, 3333])
    expect(t.allowanceCents).toBe(10000)
    // 33,33 × 19 % = 6,33; 16,67 × 7 % = 1,17
    expect(t.taxCents).toBe(633 + 117)
  })

  it('never loses a cent when splitting', () => {
    const three = [
      item({ quantity: 1, unitPriceCents: 3333, taxRate: 19 }),
      item({ quantity: 1, unitPriceCents: 3333, taxRate: 7 }),
      item({ quantity: 1, unitPriceCents: 3334, taxRate: 0 }),
    ]
    for (const value of [1, 2, 100, 999, 3333, 9999]) {
      const t = calculateTotals(three, 'standard', { discount: { type: 'amount', value } })
      expect(t.groups.reduce((s, g) => s + g.allowanceCents, 0)).toBe(value)
    }
  })

  it('caps the amount at the invoice total', () => {
    const t = calculateTotals(mixed, 'standard', { discount: { type: 'amount', value: 99999 } })
    expect(t.netCents).toBe(0)
    expect(t.grossCents).toBe(0)
  })

  it('mirrors a fixed discount on a cancellation', () => {
    const discount = { type: 'amount' as const, value: 1234 }
    const a = calculateTotals(mixed, 'standard', { discount })
    const b = calculateTotals(mixed.map((i) => ({ ...i, quantity: -i.quantity })), 'standard', { discount })
    expect(b.groups.map((g) => g.allowanceCents)).toEqual(a.groups.map((g) => -g.allowanceCents))
    expect(b.grossCents).toBe(-a.grossCents)
  })

  it('applies to the single group without tax', () => {
    const t = calculateTotals(mixed, 'reverseCharge', { discount: { type: 'percent', value: 3 } })
    expect(t.groups).toEqual([{ rate: 0, netCents: 14550, taxCents: 0, allowanceCents: 450 }])
  })
})

describe('final invoice', () => {
  const work = [item({ quantity: 10, unitPriceCents: 10000, taxRate: 19 })]
  const downPayment = { invoiceId: 'a', number: 'RE-1', issueDate: '2026-01-10', groups: [{ rate: 19, netCents: 30000, taxCents: 5700 }] }

  it('deducts down payments with their tax', () => {
    const t = calculateTotals(work, 'standard', { deductions: [downPayment] })
    expect(t.grossCents).toBe(119000)
    expect(t.prepaidCents).toBe(35700)
    expect(t.dueCents).toBe(83300)
    expect(t.effectiveGroups).toEqual([{ rate: 19, netCents: 70000, taxCents: 13300, allowanceCents: 0 }])
  })

  it('keeps rates that only appear in a down payment', () => {
    const t = calculateTotals(work, 'standard', {
      deductions: [downPayment, { ...downPayment, invoiceId: 'b', groups: [{ rate: 7, netCents: 1000, taxCents: 70 }] }],
    })
    expect(t.effectiveGroups.map((g) => [g.rate, g.netCents, g.taxCents])).toEqual([
      [19, 70000, 13300],
      [7, -1000, -70],
    ])
    expect(t.dueCents).toBe(119000 - 35700 - 1070)
  })
})
