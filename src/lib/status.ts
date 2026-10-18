import { documentTotals } from './calc'
import { today } from './dates'
import type { InvoiceDocument } from './types'

export type DisplayStatus =
  | 'draft'
  | 'open'
  | 'partial'
  | 'overdue'
  | 'paid'
  | 'settled'
  | 'cancelled'
  | 'cancellation'
  | 'creditNote'
  | 'sent'
  | 'accepted'
  | 'declined'

export const STATUS_LABELS: Record<DisplayStatus, string> = {
  draft: 'Entwurf',
  open: 'Offen',
  partial: 'Teilbezahlt',
  overdue: 'Überfällig',
  paid: 'Bezahlt',
  settled: 'Ausgeglichen',
  cancelled: 'Storniert',
  cancellation: 'Storno',
  creditNote: 'Gutschrift',
  sent: 'Versendet',
  accepted: 'Angenommen',
  declined: 'Abgelehnt',
}

export function displayStatus(doc: InvoiceDocument, ref = today()): DisplayStatus {
  if (doc.kind === 'cancellation') return doc.status === 'draft' ? 'draft' : 'cancellation'
  if (doc.kind === 'creditNote') return doc.status === 'draft' ? 'draft' : 'creditNote'
  if (doc.kind === 'quote') return doc.status as DisplayStatus
  if (doc.status === 'open' && doc.dueDate && doc.dueDate < ref) return 'overdue'
  if (doc.status === 'open' && paidOf(doc) > 0) return 'partial'
  if (doc.status === 'paid' && !paidOf(doc) && doc.creditNotes?.length) return 'settled'
  return doc.status as DisplayStatus
}

export function isFinal(doc: InvoiceDocument): boolean {
  return doc.status !== 'draft'
}

export function isInvoiceLike(doc: InvoiceDocument): boolean {
  return doc.kind === 'invoice' || doc.kind === 'cancellation' || doc.kind === 'creditNote'
}

/** Finalized invoices, cancellations and credit notes count towards revenue; drafts and quotes don't. */
export function countsAsRevenue(doc: InvoiceDocument): boolean {
  return doc.status !== 'draft' && isInvoiceLike(doc)
}

export function isOutstanding(doc: InvoiceDocument): boolean {
  return doc.kind === 'invoice' && doc.status === 'open'
}

/** Credit notes reduce revenue, their stored amounts are positive. */
export function signOf(doc: Pick<InvoiceDocument, 'kind'>): 1 | -1 {
  return doc.kind === 'creditNote' ? -1 : 1
}

/** Signed document total as shown in lists. */
export function grossOf(doc: InvoiceDocument): number {
  return signOf(doc) * documentTotals(doc).grossCents
}

/** Signed net revenue; a final invoice only adds what the down payments didn't cover. */
export function netOf(doc: InvoiceDocument): number {
  const t = documentTotals(doc)
  return signOf(doc) * t.effectiveGroups.reduce((s, g) => s + g.netCents, 0)
}

export function paidOf(doc: InvoiceDocument): number {
  return (doc.payments ?? []).reduce((s, p) => s + p.amountCents, 0)
}

export function creditedOf(doc: InvoiceDocument): number {
  return (doc.creditNotes ?? []).reduce((s, c) => s + c.grossCents, 0)
}

/** What the customer still owes on an invoice. */
export function amountDue(doc: InvoiceDocument): number {
  if (doc.kind !== 'invoice' || doc.status === 'draft' || doc.status === 'cancelled') return 0
  return documentTotals(doc).dueCents - creditedOf(doc) - paidOf(doc)
}

export function documentLabel(doc: Pick<InvoiceDocument, 'kind' | 'billingType'>): string {
  if (doc.kind === 'quote') return 'Angebot'
  if (doc.kind === 'cancellation') return 'Stornorechnung'
  if (doc.kind === 'creditNote') return 'Gutschrift'
  if (doc.billingType === 'downPayment') return 'Abschlagsrechnung'
  if (doc.billingType === 'final') return 'Schlussrechnung'
  return 'Rechnung'
}
