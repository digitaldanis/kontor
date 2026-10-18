import { db, now, uid } from './db'
import { divRound, formatAmount, toScaled } from './money'
import { sumBuckets, vatEntries, type Taxation } from './tax'
import type { Attachment, Expense, InvoiceDocument } from './types'

export const EXPENSE_CATEGORIES = [
  'Software & Abos',
  'Hardware & Büro',
  'Telefon & Internet',
  'Reisekosten',
  'Fahrzeug',
  'Bewirtung',
  'Fortbildung',
  'Werbung & Marketing',
  'Miete & Raumkosten',
  'Versicherungen & Beiträge',
  'Fremdleistungen',
  'Bank & Gebühren',
  'Sonstiges',
]

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const ATTACHMENT_TYPES = /^(image\/(png|jpe?g|webp|heic|gif)|application\/pdf|application\/xml|text\/xml)$/

/** Input VAT contained in a gross amount, commercially rounded. */
export function vatFromGross(grossCents: number, rate: number): number {
  if (!rate) return 0
  const scaled = toScaled(rate, 2)
  const net = divRound(BigInt(grossCents) * 10000n, 10000n + scaled)
  return grossCents - Number(net)
}

export function expenseNet(e: Pick<Expense, 'grossCents' | 'vatCents'>): number {
  return e.grossCents - e.vatCents
}

export function emptyExpense(partial: Partial<Expense> = {}): Expense {
  const today = new Date()
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return {
    id: uid(),
    date,
    vendor: '',
    description: '',
    category: 'Sonstiges',
    grossCents: 0,
    taxRate: 19,
    vatCents: 0,
    currency: 'EUR',
    paidAt: date,
    invoiceNumber: '',
    attachmentId: null,
    notes: '',
    createdAt: now(),
    updatedAt: now(),
    ...partial,
  }
}

export async function saveExpense(e: Expense): Promise<Expense> {
  if (!e.date) throw new Error('Bitte das Belegdatum angeben.')
  if (!e.grossCents) throw new Error('Bitte einen Betrag angeben.')
  if (Math.abs(e.vatCents) > Math.abs(e.grossCents)) throw new Error('Die Vorsteuer ist höher als der Bruttobetrag.')
  const saved = { ...e, vendor: e.vendor.trim(), updatedAt: now() }
  await db.expenses.put(saved)
  return saved
}

/** Deletes an expense with its receipt and returns both for undo. */
export async function deleteExpense(id: string): Promise<{ expense?: Expense; attachment?: Attachment }> {
  return db.transaction('rw', db.expenses, db.attachments, async () => {
    const expense = await db.expenses.get(id)
    const attachment = expense?.attachmentId ? await db.attachments.get(expense.attachmentId) : undefined
    await db.expenses.delete(id)
    if (attachment) await db.attachments.delete(attachment.id)
    return { expense, attachment }
  })
}

export function checkAttachment(file: { name: string; type: string; size: number }): string | null {
  const type = file.type || (file.name.toLowerCase().endsWith('.xml') ? 'application/xml' : '')
  if (!ATTACHMENT_TYPES.test(type)) return 'Bitte ein Bild, ein PDF oder eine XML-Datei wählen.'
  if (file.size > MAX_ATTACHMENT_BYTES) return 'Die Datei ist größer als 10 MB.'
  return null
}

export async function storeAttachment(file: File): Promise<Attachment> {
  const error = checkAttachment(file)
  if (error) throw new Error(error)
  const att: Attachment = { id: uid(), name: file.name, mime: file.type || 'application/xml', size: file.size, data: file, createdAt: now() }
  await db.attachments.put(att)
  return att
}

function csvCell(value: string | number): string {
  const s = String(value)
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function expensesToCsv(list: Expense[]): string {
  const header = ['Datum', 'Bezahlt am', 'Lieferant', 'Belegnummer', 'Beschreibung', 'Kategorie', 'Brutto', 'Steuersatz', 'Vorsteuer', 'Netto', 'Währung', 'Beleg']
  const rows = [...list]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => [e.date, e.paidAt ?? '', e.vendor, e.invoiceNumber, e.description, e.category, formatAmount(e.grossCents), String(e.taxRate).replace('.', ','), formatAmount(e.vatCents), formatAmount(expenseNet(e)), e.currency, e.attachmentId ? 'ja' : 'nein'])
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')
}

export interface Euer {
  incomeNetCents: number
  incomeVatCents: number
  expenseNetCents: number
  inputVatCents: number
  byCategory: { category: string; netCents: number }[]
  resultCents: number
}

/**
 * Simplified Einnahmen-Überschuss-Rechnung: income when paid, expenses when
 * paid. VAT is shown separately because collected VAT and input VAT are passed
 * through to the tax office. Small businesses count gross amounts.
 */
export function euer(docs: InvoiceDocument[], expenses: Expense[], from: string, to: string, smallBusiness: boolean): Euer {
  const income = sumBuckets(vatEntries(docs, 'cash').filter((e) => e.date >= from && e.date <= to))
  const incomeNet = income.reduce((s, b) => s + b.netCents, 0)
  const incomeVat = income.reduce((s, b) => s + b.taxCents, 0)
  const paid = expenses.filter((e) => !!e.paidAt && e.paidAt >= from && e.paidAt <= to)
  const cats = new Map<string, number>()
  let net = 0
  let vat = 0
  for (const e of paid) {
    const n = smallBusiness ? e.grossCents : expenseNet(e)
    net += n
    if (!smallBusiness) vat += e.vatCents
    cats.set(e.category, (cats.get(e.category) ?? 0) + n)
  }
  return {
    incomeNetCents: smallBusiness ? incomeNet + incomeVat : incomeNet,
    incomeVatCents: smallBusiness ? 0 : incomeVat,
    expenseNetCents: net,
    inputVatCents: vat,
    byCategory: [...cats].map(([category, netCents]) => ({ category, netCents })).sort((a, b) => b.netCents - a.netCents),
    resultCents: (smallBusiness ? incomeNet + incomeVat : incomeNet) - net,
  }
}

export interface VatReturn {
  /** Kennzahl -> amount; bases in whole euros as on the form, taxes in cents. */
  kz81: number
  kz81Tax: number
  kz86: number
  kz86Tax: number
  kz21: number
  kz41: number
  kz45: number
  otherRates: { rate: number; baseCents: number; taxCents: number }[]
  kz66: number
  kz83: number
}

const euros = (cents: number) => Math.trunc(cents / 100)

/** Figures for the German VAT return (USt-Voranmeldung) as an orientation. */
export function vatReturn(docs: InvoiceDocument[], expenses: Expense[], from: string, to: string, taxation: Taxation): VatReturn {
  const buckets = sumBuckets(vatEntries(docs, taxation).filter((e) => e.date >= from && e.date <= to))
  const get = (pred: (b: (typeof buckets)[number]) => boolean) => buckets.filter(pred)
  const sum = (list: typeof buckets, key: 'netCents' | 'taxCents') => list.reduce((s, b) => s + b[key], 0)
  const s19 = get((b) => b.taxMode === 'standard' && b.rate === 19)
  const s7 = get((b) => b.taxMode === 'standard' && b.rate === 7)
  const other = get((b) => b.taxMode === 'standard' && b.rate !== 19 && b.rate !== 7 && b.rate !== 0)
  const inputVat = expenses
    .filter((e) => {
      const d = taxation === 'cash' ? e.paidAt : e.date
      return !!d && d >= from && d <= to
    })
    .reduce((s, e) => s + e.vatCents, 0)
  const tax = sum(s19, 'taxCents') + sum(s7, 'taxCents') + sum(other, 'taxCents')
  return {
    kz81: euros(sum(s19, 'netCents')),
    kz81Tax: sum(s19, 'taxCents'),
    kz86: euros(sum(s7, 'netCents')),
    kz86Tax: sum(s7, 'taxCents'),
    kz21: euros(sum(get((b) => b.taxMode === 'reverseCharge'), 'netCents')),
    kz41: euros(sum(get((b) => b.taxMode === 'intraCommunitySupply'), 'netCents')),
    kz45: euros(sum(get((b) => b.taxMode === 'thirdCountry'), 'netCents')),
    otherRates: other.map((b) => ({ rate: b.rate, baseCents: b.netCents, taxCents: b.taxCents })),
    kz66: inputVat,
    kz83: tax - inputVat,
  }
}
