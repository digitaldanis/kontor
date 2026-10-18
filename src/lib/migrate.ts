import { calculateTotals } from './calc'
import { blankDocument, defaultSettings } from './defaults'
import type { InvoiceDocument, Settings } from './types'

/**
 * Brings a stored document up to the current shape. Used by the Dexie
 * upgrade, by backup imports and for records that arrive via sync from
 * an older client.
 */
export function normalizeDocument(raw: Partial<InvoiceDocument> & { id: string }): InvoiceDocument {
  const doc = blankDocument({ ...raw })
  for (const key of ['creditNotes', 'deductions', 'payments'] as const) {
    if (!Array.isArray(doc[key])) doc[key] = []
  }
  // Version 1 only knew "paid" with a date. Keep the full amount as one payment.
  if (raw.payments === undefined && doc.kind === 'invoice' && doc.status === 'paid' && doc.paidAt) {
    doc.payments = [
      {
        id: `${doc.id}-p1`,
        date: doc.paidAt.slice(0, 10),
        amountCents: calculateTotals(doc.items, doc.taxMode).grossCents,
        note: '',
      },
    ]
  }
  return doc
}

export function normalizeSettings(raw: Partial<Settings> | undefined | null): Settings {
  const base = defaultSettings()
  if (!raw) return base
  return {
    ...base,
    ...raw,
    defaults: { ...base.defaults, ...raw.defaults },
    company: { ...base.company, ...raw.company },
    dunning: { ...base.dunning, ...raw.dunning },
    timeRounding: { ...base.timeRounding, ...raw.timeRounding },
    id: 'main',
  }
}
