import { divRound, toScaled } from './money'
import type { LineItem, TaxMode } from './types'

export interface LineTotal {
  id: string
  grossListCents: number
  discountCents: number
  netCents: number
}

export interface TaxGroup {
  rate: number
  netCents: number
  taxCents: number
}

export interface Totals {
  lines: LineTotal[]
  groups: TaxGroup[]
  netCents: number
  taxCents: number
  grossCents: number
  discountCents: number
}

/** Line net = quantity × unit price − discount, rounded to whole cents. */
export function lineTotal(item: Pick<LineItem, 'id' | 'quantity' | 'unitPriceCents' | 'discountPercent'>): LineTotal {
  const qty = toScaled(item.quantity || 0, 3)
  const price = BigInt(Math.round(item.unitPriceCents || 0))
  const discount = toScaled(clamp(item.discountPercent || 0, 0, 100), 2)

  const list = divRound(qty * price, 1000n)
  const net = divRound(qty * price * (10000n - discount), 1000n * 10000n)
  return {
    id: item.id,
    grossListCents: Number(list),
    discountCents: Number(list - net),
    netCents: Number(net),
  }
}

export function taxRateApplies(mode: TaxMode): boolean {
  return mode === 'standard'
}

/**
 * Totals are calculated per tax rate on the summed net amounts, which is
 * the usual approach for German invoices and what EN 16931 expects
 * (BT-116/BT-117 per VAT category).
 */
export function calculateTotals(items: LineItem[], mode: TaxMode = 'standard'): Totals {
  const lines = items.map(lineTotal)
  const byRate = new Map<number, bigint>()
  const chargeTax = taxRateApplies(mode)

  items.forEach((item, i) => {
    const rate = chargeTax ? item.taxRate || 0 : 0
    byRate.set(rate, (byRate.get(rate) ?? 0n) + BigInt(lines[i].netCents))
  })

  const groups: TaxGroup[] = [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, net]) => ({
      rate,
      netCents: Number(net),
      taxCents: Number(divRound(net * toScaled(rate, 2), 10000n)),
    }))

  const netCents = groups.reduce((s, g) => s + g.netCents, 0)
  const taxCents = groups.reduce((s, g) => s + g.taxCents, 0)
  return {
    lines,
    groups,
    netCents,
    taxCents,
    grossCents: netCents + taxCents,
    discountCents: lines.reduce((s, l) => s + l.discountCents, 0),
  }
}

export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}
