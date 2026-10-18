import { documentTotals } from './calc'
import { TAX_MODE_LABELS } from './defaults'
import { formatNumber } from './money'
import { countsAsRevenue, paidOf, signOf } from './status'
import type { InvoiceDocument, TaxMode } from './types'

export type Taxation = 'accrual' | 'cash'

export interface VatBucket {
  key: string
  label: string
  taxMode: TaxMode
  rate: number
  netCents: number
  taxCents: number
}

export interface VatEntry {
  date: string
  doc: InvoiceDocument
  buckets: VatBucket[]
}

function bucketKey(mode: TaxMode, rate: number) {
  return mode === 'standard' ? `s${rate}` : mode
}

function bucketLabel(mode: TaxMode, rate: number) {
  return mode === 'standard' ? `${formatNumber(rate)} % USt` : TAX_MODE_LABELS[mode]
}

function scaled(doc: InvoiceDocument, factorNum: number, factorDen: number): VatBucket[] {
  const t = documentTotals(doc)
  const sign = signOf(doc)
  return t.effectiveGroups.map((g) => ({
    key: bucketKey(doc.taxMode, g.rate),
    label: bucketLabel(doc.taxMode, g.rate),
    taxMode: doc.taxMode,
    rate: g.rate,
    netCents: factorDen ? Math.round((sign * g.netCents * factorNum) / factorDen) : 0,
    taxCents: factorDen ? Math.round((sign * g.taxCents * factorNum) / factorDen) : 0,
  }))
}

/**
 * Turns documents into dated VAT entries. With accrual accounting every
 * finalized document counts on its issue date. With cash accounting each
 * payment counts on its date, with net and tax split in proportion to the
 * invoice; cancellations and credit notes count as far as the corrected
 * invoice had been paid.
 */
export function vatEntries(docs: InvoiceDocument[], taxation: Taxation): VatEntry[] {
  const relevant = docs.filter(countsAsRevenue)
  if (taxation === 'accrual') return relevant.map((doc) => ({ date: doc.issueDate, doc, buckets: scaled(doc, 1, 1) }))

  const byId = new Map(docs.map((d) => [d.id, d]))
  const entries: VatEntry[] = []
  for (const doc of relevant) {
    if (doc.kind === 'invoice') {
      const base = documentTotals(doc).dueCents
      for (const p of doc.payments ?? []) entries.push({ date: p.date, doc, buckets: scaled(doc, p.amountCents, base) })
      continue
    }
    const original = byId.get(doc.cancelsId ?? doc.creditsId ?? '')
    if (!original) continue
    const due = documentTotals(original).dueCents
    const paid = Math.min(paidOf(original), due)
    if (paid > 0) entries.push({ date: doc.issueDate, doc, buckets: scaled(doc, paid, due) })
  }
  return entries
}

export function sumBuckets(entries: VatEntry[]): VatBucket[] {
  const map = new Map<string, VatBucket>()
  for (const e of entries) {
    for (const b of e.buckets) {
      const cur = map.get(b.key) ?? { ...b, netCents: 0, taxCents: 0 }
      cur.netCents += b.netCents
      cur.taxCents += b.taxCents
      map.set(b.key, cur)
    }
  }
  return [...map.values()].filter((b) => b.netCents || b.taxCents).sort((a, b) => b.taxCents - a.taxCents || b.rate - a.rate)
}

export function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to
}
