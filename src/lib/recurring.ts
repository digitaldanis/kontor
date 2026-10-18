import { addDays, formatDate, parseISODate, toISODate } from './dates'
import { db, now, uid } from './db'
import { createDraft } from './repo'
import type { InvoiceDocument, RecurringInterval, RecurringInvoice, RecurringTemplate } from './types'

export const INTERVAL_LABELS: Record<RecurringInterval, string> = {
  weekly: 'Wöchentlich',
  monthly: 'Monatlich',
  quarterly: 'Quartalsweise',
  yearly: 'Jährlich',
}

export function intervalText(interval: RecurringInterval, every: number): string {
  if (every <= 1) return INTERVAL_LABELS[interval]
  const unit = { weekly: 'Wochen', monthly: 'Monate', quarterly: 'Quartale', yearly: 'Jahre' }[interval]
  return `Alle ${every} ${unit}`
}

/** Adds months and clamps to the last day, so the 31st becomes the 30th or 28th instead of spilling over. */
export function addMonths(iso: string, months: number): string {
  const d = parseISODate(iso)
  const day = d.getDate()
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1, 12)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(day, last))
  return toISODate(target)
}

/** Date of run number `n` (0-based), always counted from the start date to avoid drift. */
export function runDate(rec: Pick<RecurringInvoice, 'startDate' | 'interval' | 'every'>, n: number): string {
  const every = Math.max(1, Math.round(rec.every))
  if (rec.interval === 'weekly') return addDays(rec.startDate, 7 * every * n)
  const months = { monthly: 1, quarterly: 3, yearly: 12 }[rec.interval]
  return addMonths(rec.startDate, months * every * n)
}

/** The period a run bills: from its date up to the day before the next run. */
export function runPeriod(rec: Pick<RecurringInvoice, 'startDate' | 'interval' | 'every'>, n: number): { from: string; to: string } {
  return { from: runDate(rec, n), to: addDays(runDate(rec, n + 1), -1) }
}

/** Runs that are due up to `ref`, capped so a long pause doesn't flood the drafts. */
export function dueRuns(rec: RecurringInvoice, ref: string, max = 12): number[] {
  if (!rec.active) return []
  const result: number[] = []
  for (let n = rec.runs; result.length < max; n++) {
    const date = runDate(rec, n)
    if (date > ref || (rec.endDate && date > rec.endDate)) break
    result.push(n)
  }
  return result
}

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Replaces {Monat}, {Jahr}, {Quartal} and {Zeitraum} with values of the billed period. */
export function fillPeriod(text: string, from: string, to: string, lang: 'de' | 'en' = 'de'): string {
  const d = parseISODate(from)
  const values: Record<string, string> = {
    Monat: (lang === 'en' ? MONTHS_EN : MONTHS)[d.getMonth()],
    Jahr: String(d.getFullYear()),
    Quartal: `Q${Math.floor(d.getMonth() / 3) + 1}`,
    Zeitraum: `${formatDate(from)} – ${formatDate(to)}`,
  }
  return text.replace(/\{(Monat|Jahr|Quartal|Zeitraum)\}/g, (_, k: string) => values[k])
}

export function templateFromDocument(doc: InvoiceDocument): RecurringTemplate {
  return {
    title: doc.title,
    items: doc.items.map((i) => ({ ...i, id: uid(), timeEntryIds: undefined })),
    introText: doc.introText,
    closingText: doc.closingText,
    footerText: doc.footerText,
    currency: doc.currency,
    language: doc.language,
    layout: doc.layout,
    accentColor: doc.accentColor,
    buyerReference: doc.buyerReference,
    discount: doc.discount,
  }
}

export function newRecurring(customerId: string, template: RecurringTemplate, startDate: string): RecurringInvoice {
  return {
    id: uid(),
    name: (template.items[0]?.title || template.title || 'Serienrechnung').replace(/\s*\{[^}]+\}/g, ''),
    customerId,
    interval: 'monthly',
    every: 1,
    startDate,
    runs: 0,
    nextRun: startDate,
    endDate: '',
    active: true,
    template,
    lastRun: null,
    lastDocumentId: null,
    createdAt: now(),
    updatedAt: now(),
  }
}

export async function saveRecurring(rec: RecurringInvoice): Promise<RecurringInvoice> {
  if (!rec.customerId) throw new Error('Bitte einen Kunden wählen.')
  if (!rec.template.items.length) throw new Error('Die Vorlage braucht mindestens eine Position.')
  const saved = { ...rec, nextRun: runDate(rec, rec.runs), updatedAt: now() }
  await db.recurring.put(saved)
  return saved
}

/** Creates drafts for every due run. Returns the created drafts. */
export async function runRecurring(ref: string): Promise<InvoiceDocument[]> {
  const all = await db.recurring.toArray()
  const created: InvoiceDocument[] = []
  for (const rec of all) {
    const runs = dueRuns(rec, ref)
    if (!runs.length) continue
    // claim the runs first so a second tab doesn't create the same drafts
    const claimed = await db.transaction('rw', db.recurring, async () => {
      const fresh = await db.recurring.get(rec.id)
      if (!fresh || fresh.runs !== rec.runs) return false
      const next = rec.runs + runs.length
      const nextRun = runDate(rec, next)
      await db.recurring.update(rec.id, { runs: next, nextRun, lastRun: ref, active: !(rec.endDate && nextRun > rec.endDate), updatedAt: now() })
      return true
    })
    if (!claimed) continue
    const customer = await db.customers.get(rec.customerId)
    if (!customer) continue
    for (const n of runs) {
      const { from, to } = runPeriod(rec, n)
      const t = rec.template
      const lang = t.language ?? 'de'
      const draft = await createDraft('invoice', { customerId: rec.customerId })
      const doc: InvoiceDocument = {
        ...draft,
        title: t.title || draft.title,
        items: t.items.map((i) => ({ ...i, id: uid(), title: fillPeriod(i.title, from, to, lang), description: fillPeriod(i.description, from, to, lang) })),
        introText: fillPeriod(t.introText, from, to, lang),
        closingText: fillPeriod(t.closingText, from, to, lang),
        footerText: t.footerText,
        currency: t.currency,
        language: lang,
        layout: t.layout,
        accentColor: t.accentColor,
        buyerReference: t.buyerReference,
        discount: t.discount,
        serviceFrom: from,
        serviceTo: to,
        recurringId: rec.id,
      }
      await db.documents.put(doc)
      await db.recurring.update(rec.id, { lastDocumentId: doc.id })
      created.push(doc)
    }
  }
  return created
}
