import { calculateTotals, minutesToHours } from './calc'
import { addDays, durationMinutes, formatDate, parseISODate, today, toISODate } from './dates'
import { db, now, uid } from './db'
import {
  customerName,
  defaultSettings,
  emptyRecipient,
  recipientFromCustomer,
  TAX_NOTES,
} from './defaults'
import { formatMoney } from './money'
import { takeNextNumber } from './numbering'
import type {
  Customer,
  DocumentKind,
  InvoiceDocument,
  LineItem,
  RunningTimer,
  Settings,
  TimeEntry,
} from './types'
import { hasBlockingIssues, suggestTaxMode, validateInvoice } from './validation'

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('main')
  if (s) return { ...defaultSettings(), ...s }
  const fresh = defaultSettings()
  await db.settings.put(fresh)
  return fresh
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings()
  await db.settings.put({ ...current, ...patch, id: 'main', updatedAt: now() })
}

// Customers

export function emptyCustomer(): Customer {
  return {
    id: uid(),
    number: '',
    company: '',
    contactPerson: '',
    addressExtra: '',
    street: '',
    zip: '',
    city: '',
    country: 'DE',
    vatId: '',
    email: '',
    phone: '',
    hourlyRateCents: null,
    paymentTermDays: null,
    leitwegId: '',
    notes: '',
    archived: false,
    createdAt: now(),
    updatedAt: now(),
  }
}

export async function saveCustomer(c: Customer): Promise<Customer> {
  let number = c.number
  if (!number) {
    const all = await db.customers.toArray()
    const max = all.reduce((m, x) => Math.max(m, Number(x.number.replace(/\D/g, '')) || 0), 10000)
    number = `K${max + 1}`
  }
  const saved = { ...c, number, updatedAt: now() }
  await db.customers.put(saved)
  return saved
}

/** Customers with finalized documents are only archived so the history stays intact. */
export async function deleteCustomer(id: string): Promise<'deleted' | 'archived'> {
  return db.transaction('rw', db.customers, db.documents, db.timeEntries, db.timer, async () => {
    const docs = await db.documents.where('customerId').equals(id).toArray()
    const billedEntries = await db.timeEntries.where('customerId').equals(id).filter((e) => !!e.invoiceId).count()
    if (docs.some((d) => d.status !== 'draft') || billedEntries > 0) {
      await db.customers.update(id, { archived: true, updatedAt: now() })
      return 'archived'
    }
    await db.documents.bulkDelete(docs.map((d) => d.id))
    await db.timeEntries.where('customerId').equals(id).delete()
    const timer = await db.timer.get('timer')
    if (timer?.customerId === id) await db.timer.delete('timer')
    await db.customers.delete(id)
    return 'deleted'
  })
}

// Documents

export async function createDraft(
  kind: DocumentKind,
  options: { customerId?: string | null; items?: LineItem[] } = {},
): Promise<InvoiceDocument> {
  const settings = await getSettings()
  const customer = options.customerId ? await db.customers.get(options.customerId) : undefined
  const recipient = customer ? recipientFromCustomer(customer) : emptyRecipient()
  const d = settings.defaults
  const issueDate = today()
  const term = customer?.paymentTermDays ?? d.paymentTermDays
  const taxMode = suggestTaxMode(settings.smallBusiness, settings.company.country, recipient)

  const doc: InvoiceDocument = {
    id: uid(),
    kind,
    status: 'draft',
    number: null,
    customerId: customer?.id ?? null,
    recipient,
    title: kind === 'quote' ? 'Angebot' : 'Rechnung',
    issueDate,
    serviceFrom: issueDate,
    serviceTo: '',
    dueDate: addDays(issueDate, term),
    validUntil: addDays(issueDate, 30),
    items: options.items ?? [],
    introText:
      kind === 'quote'
        ? 'Vielen Dank für Ihre Anfrage. Gerne unterbreite ich Ihnen folgendes Angebot:'
        : d.introText,
    closingText:
      kind === 'quote'
        ? 'Das Angebot ist gültig bis zum {Gültig bis}. Ich freue mich auf Ihre Rückmeldung.'
        : d.closingText,
    footerText: d.footerText,
    taxMode,
    taxNote: taxMode === 'smallBusiness' ? settings.smallBusinessNote : TAX_NOTES[taxMode],
    currency: d.currency,
    layout: d.layout,
    accentColor: d.accentColor,
    buyerReference: '',
    seller: null,
    sellerLogo: null,
    cancelsId: null,
    cancelsNumber: null,
    cancelledById: null,
    sourceQuoteId: null,
    paidAt: null,
    finalizedAt: null,
    createdAt: now(),
    updatedAt: now(),
  }
  await db.documents.put(doc)
  return doc
}

export function newLineItem(settings: Settings, partial: Partial<LineItem> = {}): LineItem {
  return {
    id: uid(),
    title: '',
    description: '',
    quantity: 1,
    unit: settings.defaults.unit,
    unitPriceCents: 0,
    taxRate: settings.smallBusiness ? 0 : settings.defaults.taxRate,
    discountPercent: 0,
    ...partial,
  }
}

export async function saveDocument(doc: InvoiceDocument): Promise<void> {
  const stored = await db.documents.get(doc.id)
  if (stored && stored.status !== 'draft') {
    throw new Error('Abgeschlossene Dokumente können nicht mehr geändert werden.')
  }
  await db.documents.put({ ...doc, updatedAt: now() })
}

/**
 * Assigns the next number, freezes the seller data and locks the document.
 * Runs in a single transaction so two tabs can never get the same number.
 */
export async function finalizeDocument(id: string): Promise<InvoiceDocument> {
  return db.transaction('rw', db.settings, db.documents, async () => {
    const settings = await getSettings()
    const doc = await db.documents.get(id)
    if (!doc) throw new Error('Dokument nicht gefunden.')
    if (doc.status !== 'draft') throw new Error('Dokument ist bereits abgeschlossen.')

    const issues = validateInvoice(doc, settings.company)
    if (hasBlockingIssues(issues)) throw new Error('Es fehlen noch Pflichtangaben.')

    const isQuote = doc.kind === 'quote'
    let seq = isQuote ? settings.quoteNumbers : settings.invoiceNumbers
    const date = parseISODate(doc.issueDate)
    let number: string
    // Skip numbers that already exist, e.g. after an import or a pattern change.
    for (;;) {
      const next = takeNextNumber(seq, date)
      seq = next.sequence
      number = next.number
      const clash = await db.documents.where('number').equals(number).count()
      if (!clash) break
    }

    const finalized: InvoiceDocument = {
      ...doc,
      number,
      status: isQuote ? 'sent' : 'open',
      seller: { ...settings.company },
      sellerLogo: settings.logo,
      finalizedAt: now(),
      updatedAt: now(),
    }
    await db.documents.put(finalized)
    await db.settings.put({
      ...settings,
      ...(isQuote ? { quoteNumbers: seq } : { invoiceNumbers: seq }),
      updatedAt: now(),
    })
    return finalized
  })
}

/** Creates a finalized cancellation invoice with negated quantities. */
export async function cancelInvoice(id: string, releaseTime = true): Promise<InvoiceDocument> {
  const original = await db.documents.get(id)
  if (!original || original.kind !== 'invoice') throw new Error('Rechnung nicht gefunden.')
  if (original.status === 'draft') throw new Error('Entwürfe können einfach gelöscht werden.')
  if (original.status === 'cancelled') throw new Error('Diese Rechnung wurde bereits storniert.')

  const issueDate = today()
  const cancellation: InvoiceDocument = {
    ...structuredClone(original),
    id: uid(),
    kind: 'cancellation',
    status: 'draft',
    number: null,
    title: 'Stornorechnung',
    issueDate,
    dueDate: issueDate,
    items: original.items.map((i) => ({ ...i, id: uid(), quantity: -i.quantity, timeEntryIds: undefined })),
    introText: `Hiermit stornieren wir die Rechnung ${original.number} vom ${formatDate(original.issueDate)} vollständig.`,
    closingText: original.paidAt
      ? 'Der bereits gezahlte Betrag wird Ihnen erstattet.'
      : 'Die ursprüngliche Rechnung ist damit gegenstandslos. Bitte nicht überweisen.',
    cancelsId: original.id,
    cancelsNumber: original.number,
    cancelledById: null,
    paidAt: null,
    finalizedAt: null,
    createdAt: now(),
    updatedAt: now(),
  }
  await db.documents.put(cancellation)
  try {
    const finalized = await finalizeCancellation(cancellation, original)
    if (releaseTime) {
      await db.timeEntries.where('invoiceId').equals(original.id).modify({ invoiceId: null, updatedAt: now() })
    }
    return finalized
  } catch (e) {
    await db.documents.delete(cancellation.id)
    throw e
  }
}

async function finalizeCancellation(cancellation: InvoiceDocument, original: InvoiceDocument) {
  return db.transaction('rw', db.settings, db.documents, async () => {
    const settings = await getSettings()
    let seq = settings.invoiceNumbers
    let number: string
    for (;;) {
      const next = takeNextNumber(seq, parseISODate(cancellation.issueDate))
      seq = next.sequence
      number = next.number
      if (!(await db.documents.where('number').equals(number).count())) break
    }
    const finalized: InvoiceDocument = {
      ...cancellation,
      number,
      status: 'open',
      // the cancellation keeps the seller data of the original invoice
      seller: original.seller ?? settings.company,
      sellerLogo: original.sellerLogo ?? settings.logo,
      finalizedAt: now(),
    }
    await db.documents.put(finalized)
    await db.documents.update(original.id, { status: 'cancelled', cancelledById: finalized.id, updatedAt: now() })
    await db.settings.put({ ...settings, invoiceNumbers: seq, updatedAt: now() })
    return finalized
  })
}

export async function duplicateDocument(id: string, asKind?: DocumentKind): Promise<InvoiceDocument> {
  const src = await db.documents.get(id)
  if (!src) throw new Error('Dokument nicht gefunden.')
  const settings = await getSettings()
  const kind = asKind ?? (src.kind === 'cancellation' ? 'invoice' : src.kind)
  const issueDate = today()
  const customer = src.customerId ? await db.customers.get(src.customerId) : undefined
  const term = customer?.paymentTermDays ?? settings.defaults.paymentTermDays
  const copy: InvoiceDocument = {
    ...structuredClone(src),
    id: uid(),
    kind,
    status: 'draft',
    number: null,
    title: kind === 'quote' ? 'Angebot' : 'Rechnung',
    issueDate,
    serviceFrom: kind === 'quote' ? src.serviceFrom : issueDate,
    serviceTo: '',
    dueDate: addDays(issueDate, term),
    validUntil: addDays(issueDate, 30),
    items: src.items.map((i) => ({
      ...i,
      id: uid(),
      quantity: Math.abs(i.quantity),
      timeEntryIds: undefined,
    })),
    seller: null,
    sellerLogo: null,
    cancelsId: null,
    cancelsNumber: null,
    cancelledById: null,
    sourceQuoteId: src.kind === 'quote' && kind === 'invoice' ? src.id : null,
    paidAt: null,
    finalizedAt: null,
    createdAt: now(),
    updatedAt: now(),
  }
  if (kind === 'invoice' && src.kind === 'quote') {
    copy.introText = settings.defaults.introText
    copy.closingText = settings.defaults.closingText
  }
  await db.documents.put(copy)
  return copy
}

export async function deleteDraft(id: string): Promise<void> {
  await db.transaction('rw', db.documents, db.timeEntries, async () => {
    const doc = await db.documents.get(id)
    if (!doc) return
    if (doc.status !== 'draft') throw new Error('Nur Entwürfe können gelöscht werden.')
    await db.timeEntries.where('invoiceId').equals(id).modify({ invoiceId: null, updatedAt: now() })
    await db.documents.delete(id)
  })
}

export async function setPaid(id: string, paidAt: string | null): Promise<void> {
  const doc = await db.documents.get(id)
  if (!doc || doc.status === 'draft' || doc.status === 'cancelled') return
  await db.documents.update(id, { status: paidAt ? 'paid' : 'open', paidAt, updatedAt: now() })
}

export async function setQuoteStatus(id: string, status: 'sent' | 'accepted' | 'declined'): Promise<void> {
  await db.documents.update(id, { status, updatedAt: now() })
}

// Time tracking

export async function startTimer(t: Omit<RunningTimer, 'id' | 'startedAt'>): Promise<void> {
  const running = await db.timer.get('timer')
  if (running) await stopTimer()
  await db.timer.put({ ...t, id: 'timer', startedAt: now() })
}

export async function updateTimer(patch: Partial<Omit<RunningTimer, 'id'>>): Promise<void> {
  await db.timer.update('timer', patch)
}

export async function stopTimer(): Promise<TimeEntry | null> {
  return db.transaction('rw', db.timer, db.timeEntries, async () => {
    const t = await db.timer.get('timer')
    if (!t) return null
    await db.timer.delete('timer')
    const end = now()
    if (durationMinutes(t.startedAt, end) < 1) return null
    const entry: TimeEntry = {
      id: uid(),
      customerId: t.customerId,
      project: t.project,
      description: t.description || 'Arbeitszeit',
      details: '',
      start: t.startedAt,
      end,
      billable: t.billable,
      rateCents: null,
      invoiceId: null,
      createdAt: now(),
      updatedAt: now(),
    }
    await db.timeEntries.put(entry)
    return entry
  })
}

export async function discardTimer(): Promise<void> {
  await db.timer.delete('timer')
}

export async function saveTimeEntry(e: TimeEntry): Promise<void> {
  await db.timeEntries.put({ ...e, updatedAt: now() })
}

export async function deleteTimeEntry(id: string): Promise<void> {
  const e = await db.timeEntries.get(id)
  if (e?.invoiceId) {
    const doc = await db.documents.get(e.invoiceId)
    if (doc && doc.status !== 'draft') throw new Error('Bereits abgerechnete Einträge können nicht gelöscht werden.')
  }
  await db.timeEntries.delete(id)
}

export function entryRate(e: TimeEntry, customer: Customer | undefined, settings: Settings): number {
  return e.rateCents ?? customer?.hourlyRateCents ?? settings.defaults.hourlyRateCents
}

export type TimeGrouping = 'entry' | 'project' | 'day'

/** Turns unbilled time entries into invoice positions and links them to a new draft. */
export async function invoiceTimeEntries(
  customerId: string,
  entryIds: string[],
  grouping: TimeGrouping = 'entry',
  targetDraftId?: string,
): Promise<InvoiceDocument> {
  const settings = await getSettings()
  const customer = await db.customers.get(customerId)
  if (!customer) throw new Error('Kunde nicht gefunden.')
  const entries = (await db.timeEntries.bulkGet(entryIds))
    .filter((e): e is TimeEntry => !!e && !e.invoiceId && e.billable)
    .sort((a, b) => a.start.localeCompare(b.start))
  if (!entries.length) throw new Error('Keine offenen, abrechenbaren Einträge ausgewählt.')

  const taxRate = settings.smallBusiness ? 0 : settings.defaults.taxRate
  const groups = new Map<string, TimeEntry[]>()
  for (const e of entries) {
    const key =
      grouping === 'entry' ? e.id : grouping === 'project' ? `${e.project}|${entryRate(e, customer, settings)}` : `${e.start.slice(0, 10)}|${entryRate(e, customer, settings)}`
    groups.set(key, [...(groups.get(key) ?? []), e])
  }

  const items: LineItem[] = [...groups.values()].map((group) => {
    const first = group[0]
    const minutes = group.reduce((s, e) => s + durationMinutes(e.start, e.end), 0)
    const date = toISODate(new Date(first.start))
    let title: string
    let description: string
    if (grouping === 'entry') {
      title = first.description
      description = [formatDate(date), first.project, first.details].filter(Boolean).join(' · ')
    } else {
      const last = toISODate(new Date(group[group.length - 1].start))
      title = grouping === 'project' ? first.project || 'Leistungen' : `Leistungen am ${formatDate(date)}`
      const period = date === last ? formatDate(date) : `${formatDate(date)} – ${formatDate(last)}`
      description = [period, ...group.map((e) => `${formatDate(e.start)}: ${e.description}${e.details ? ` (${e.details})` : ''}`)].join('\n')
    }
    return newLineItem(settings, {
      title,
      description,
      quantity: minutesToHours(minutes),
      unit: 'Std.',
      unitPriceCents: entryRate(first, customer, settings),
      taxRate,
      serviceDate: date,
      timeEntryIds: group.map((e) => e.id),
    })
  })

  const from = toISODate(new Date(entries[0].start))
  const to = toISODate(new Date(entries[entries.length - 1].start))

  let doc: InvoiceDocument
  if (targetDraftId) {
    const existing = await db.documents.get(targetDraftId)
    if (!existing || existing.status !== 'draft') throw new Error('Entwurf nicht gefunden.')
    doc = {
      ...existing,
      items: [...existing.items, ...items],
      serviceFrom: existing.serviceFrom && existing.serviceFrom < from ? existing.serviceFrom : from,
      serviceTo: [existing.serviceTo, to].sort().pop() ?? to,
    }
    await db.documents.put(doc)
  } else {
    doc = await createDraft('invoice', { customerId, items })
    doc = { ...doc, serviceFrom: from, serviceTo: from === to ? '' : to }
    await db.documents.put(doc)
  }
  await db.timeEntries.bulkUpdate(entries.map((e) => ({ key: e.id, changes: { invoiceId: doc.id, updatedAt: now() } })))
  return doc
}

/** Unlinks time entries when their position is removed from a draft. */
export async function releaseTimeEntries(ids: string[]): Promise<void> {
  if (!ids.length) return
  await db.timeEntries.bulkUpdate(ids.map((key) => ({ key, changes: { invoiceId: null, updatedAt: now() } })))
}

// Text placeholders

export function resolvePlaceholders(text: string, doc: InvoiceDocument): string {
  const totals = calculateTotals(doc.items, doc.taxMode)
  const term = doc.dueDate && doc.issueDate ? Math.round((parseISODate(doc.dueDate).getTime() - parseISODate(doc.issueDate).getTime()) / 86_400_000) : 0
  const values: Record<string, string> = {
    Rechnungsnummer: doc.number ?? '(wird beim Abschließen vergeben)',
    Angebotsnummer: doc.number ?? '(wird beim Abschließen vergeben)',
    Fälligkeitsdatum: formatDate(doc.dueDate),
    Zahlungsziel: String(term),
    Rechnungsdatum: formatDate(doc.issueDate),
    'Gültig bis': formatDate(doc.validUntil),
    Kunde: doc.recipient.company || doc.recipient.contactPerson,
    Ansprechpartner: doc.recipient.contactPerson,
    Gesamtbetrag: formatMoney(totals.grossCents, doc.currency),
  }
  return text.replace(/\{([^}]+)\}/g, (m, key: string) => values[key] ?? m)
}

export const PLACEHOLDERS = ['Rechnungsnummer', 'Fälligkeitsdatum', 'Zahlungsziel', 'Rechnungsdatum', 'Kunde', 'Ansprechpartner', 'Gesamtbetrag']

export { customerName }
