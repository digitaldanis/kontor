import { calculateTotals } from './calc'
import { today } from './dates'
import type { InvoiceDocument } from './types'

export type DisplayStatus = 'draft' | 'open' | 'overdue' | 'paid' | 'cancelled' | 'cancellation' | 'sent' | 'accepted' | 'declined'

export const STATUS_LABELS: Record<DisplayStatus, string> = {
  draft: 'Entwurf',
  open: 'Offen',
  overdue: 'Überfällig',
  paid: 'Bezahlt',
  cancelled: 'Storniert',
  cancellation: 'Storno',
  sent: 'Versendet',
  accepted: 'Angenommen',
  declined: 'Abgelehnt',
}

export function displayStatus(doc: InvoiceDocument, ref = today()): DisplayStatus {
  if (doc.kind === 'cancellation') return doc.status === 'draft' ? 'draft' : 'cancellation'
  if (doc.kind === 'quote') return doc.status as DisplayStatus
  if (doc.status === 'open' && doc.dueDate && doc.dueDate < ref) return 'overdue'
  return doc.status as DisplayStatus
}

export function isFinal(doc: InvoiceDocument): boolean {
  return doc.status !== 'draft'
}

/** Finalized invoices and cancellations count towards revenue; drafts and quotes don't. */
export function countsAsRevenue(doc: InvoiceDocument): boolean {
  return doc.status !== 'draft' && (doc.kind === 'invoice' || doc.kind === 'cancellation')
}

export function isOutstanding(doc: InvoiceDocument): boolean {
  return doc.kind === 'invoice' && doc.status === 'open'
}

export function grossOf(doc: InvoiceDocument): number {
  return calculateTotals(doc.items, doc.taxMode).grossCents
}

export function netOf(doc: InvoiceDocument): number {
  return calculateTotals(doc.items, doc.taxMode).netCents
}

export function documentLabel(doc: InvoiceDocument): string {
  if (doc.kind === 'quote') return 'Angebot'
  if (doc.kind === 'cancellation') return 'Stornorechnung'
  return 'Rechnung'
}
