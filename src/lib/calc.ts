import { divRound, toScaled } from './money'
import type { Deduction, InvoiceDiscount, InvoiceDocument, LineItem, TaxMode } from './types'

export interface LineTotal {
  id: string
  grossListCents: number
  discountCents: number
  netCents: number
}

export interface TaxGroup {
  rate: number
  /** Taxable amount after the invoice discount (BT-116). */
  netCents: number
  taxCents: number
  /** Share of the invoice discount in this group. */
  allowanceCents: number
}

export interface Totals {
  lines: LineTotal[]
  groups: TaxGroup[]
  /** Sum of all line nets (BT-106). */
  lineNetCents: number
  /** Invoice level discount (BT-107). */
  allowanceCents: number
  /** Taxable amount (BT-109). */
  netCents: number
  taxCents: number
  grossCents: number
  /** Sum of line discounts, for display only. */
  discountCents: number
  /** Down payments deducted in a final invoice (BT-113). */
  prepaidCents: number
  dueCents: number
  /** Net and tax per rate after deducting down payments, i.e. what this document adds to the VAT return. */
  effectiveGroups: TaxGroup[]
}

export interface TotalsOptions {
  discount?: InvoiceDiscount | null
  deductions?: Deduction[]
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
export function calculateTotals(items: LineItem[], mode: TaxMode = 'standard', options: TotalsOptions = {}): Totals {
  const lines = items.map(lineTotal)
  const byRate = new Map<number, bigint>()
  const chargeTax = taxRateApplies(mode)

  items.forEach((item, i) => {
    const rate = chargeTax ? item.taxRate || 0 : 0
    byRate.set(rate, (byRate.get(rate) ?? 0n) + BigInt(lines[i].netCents))
  })

  const sorted = [...byRate.entries()].sort((a, b) => b[0] - a[0])
  const allowances = allocateDiscount(
    sorted.map(([, net]) => net),
    options.discount ?? null,
  )

  const groups: TaxGroup[] = sorted.map(([rate, lineNet], i) => {
    const net = lineNet - allowances[i]
    return {
      rate,
      netCents: Number(net),
      taxCents: Number(divRound(net * toScaled(rate, 2), 10000n)),
      allowanceCents: Number(allowances[i]),
    }
  })

  const lineNetCents = lines.reduce((s, l) => s + l.netCents, 0)
  const netCents = groups.reduce((s, g) => s + g.netCents, 0)
  const taxCents = groups.reduce((s, g) => s + g.taxCents, 0)
  const grossCents = netCents + taxCents

  const deducted = new Map<number, { net: number; tax: number }>()
  for (const d of options.deductions ?? []) {
    for (const g of d.groups) {
      const rate = chargeTax ? g.rate : 0
      const cur = deducted.get(rate) ?? { net: 0, tax: 0 }
      deducted.set(rate, { net: cur.net + g.netCents, tax: cur.tax + g.taxCents })
    }
  }
  const prepaidCents = [...deducted.values()].reduce((s, d) => s + d.net + d.tax, 0)
  const effectiveRates = new Set([...groups.map((g) => g.rate), ...deducted.keys()])
  const effectiveGroups: TaxGroup[] = [...effectiveRates]
    .sort((a, b) => b - a)
    .map((rate) => {
      const g = groups.find((x) => x.rate === rate)
      const d = deducted.get(rate) ?? { net: 0, tax: 0 }
      return { rate, netCents: (g?.netCents ?? 0) - d.net, taxCents: (g?.taxCents ?? 0) - d.tax, allowanceCents: g?.allowanceCents ?? 0 }
    })

  return {
    lines,
    groups,
    lineNetCents,
    allowanceCents: lineNetCents - netCents,
    netCents,
    taxCents,
    grossCents,
    discountCents: lines.reduce((s, l) => s + l.discountCents, 0),
    prepaidCents,
    dueCents: grossCents - prepaidCents,
    effectiveGroups,
  }
}

/**
 * Splits an invoice discount across the tax groups. Percentages are applied
 * per group; a fixed amount is distributed proportionally to the group nets
 * with the largest remainder method, so the parts always add up exactly.
 */
export function allocateDiscount(nets: bigint[], discount: InvoiceDiscount | null): bigint[] {
  const zero = nets.map(() => 0n)
  if (!discount || !discount.value || !nets.length) return zero
  const total = nets.reduce((s, n) => s + n, 0n)
  if (total === 0n) return zero

  if (discount.type === 'percent') {
    const pct = toScaled(clamp(discount.value, 0, 100), 2)
    return nets.map((n) => divRound(n * pct, 10000n))
  }

  // the amount follows the sign of the invoice, so a mirrored cancellation stays exact
  const abs = total < 0n ? -total : total
  let amount = BigInt(Math.round(Math.abs(discount.value)))
  if (amount > abs) amount = abs
  if (total < 0n) amount = -amount

  const parts = nets.map((n) => (amount * n) / total)
  let rest = amount - parts.reduce((s, p) => s + p, 0n)
  const order = nets
    .map((n, i) => {
      const r = (amount * n) % total
      return { i, rem: r < 0n ? -r : r }
    })
    .sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i))
  const step = rest < 0n ? -1n : 1n
  for (const { i } of order) {
    if (rest === 0n) break
    parts[i] += step
    rest -= step
  }
  return parts
}

export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

type TotalsSource = Pick<InvoiceDocument, 'items' | 'taxMode'> & Partial<Pick<InvoiceDocument, 'discount' | 'deductions'>>

export function documentTotals(doc: TotalsSource): Totals {
  return calculateTotals(doc.items, doc.taxMode, { discount: doc.discount, deductions: doc.deductions })
}
