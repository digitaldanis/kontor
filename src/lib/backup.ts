import { documentTotals } from './calc'
import { db } from './db'
import { recipientName } from './defaults'
import { normalizeDocument, normalizeSettings } from './migrate'
import { formatAmount } from './money'
import { displayStatus, STATUS_LABELS, documentLabel } from './status'
import type { Attachment, CatalogItem, Customer, Expense, InvoiceDocument, Project, RecurringInvoice, Reminder, RunningTimer, Settings, TimeEntry } from './types'

/** Attachments are stored as data URLs in the JSON file. */
export interface SerializedAttachment extends Omit<Attachment, 'data'> {
  dataUrl: string
}

export interface Backup {
  app: 'kontor'
  version: 3
  exportedAt: string
  settings: Settings | null
  customers: Customer[]
  documents: InvoiceDocument[]
  timeEntries: TimeEntry[]
  timer: RunningTimer | null
  reminders: Reminder[]
  catalog: CatalogItem[]
  recurring: RecurringInvoice[]
  expenses: Expense[]
  projects: Project[]
  attachments: SerializedAttachment[]
}

export async function blobToDataUrl(blob: Blob, mime = blob.type): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${mime || 'application/octet-stream'};base64,${btoa(bin)}`
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, base64 = ''] = dataUrl.split(',')
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream'
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

export async function createBackup(): Promise<Backup> {
  const [settings, customers, documents, timeEntries, timer, reminders, catalog, recurring, expenses, projects, attachments] = await Promise.all([
    db.settings.get('main'),
    db.customers.toArray(),
    db.documents.toArray(),
    db.timeEntries.toArray(),
    db.timer.get('timer'),
    db.reminders.toArray(),
    db.catalog.toArray(),
    db.recurring.toArray(),
    db.expenses.toArray(),
    db.projects.toArray(),
    db.attachments.toArray(),
  ])
  return {
    app: 'kontor',
    version: 3,
    exportedAt: new Date().toISOString(),
    settings: settings ?? null,
    customers,
    documents,
    timeEntries,
    timer: timer ?? null,
    reminders,
    catalog,
    recurring,
    expenses,
    projects,
    attachments: await Promise.all(attachments.map(async ({ data, ...a }) => ({ ...a, dataUrl: await blobToDataUrl(data, a.mime) }))),
  }
}

const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

export function parseBackup(text: string): Backup {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.')
  }
  const b = data as Partial<Backup> & { version?: number }
  if (!b || b.app !== 'kontor' || !Array.isArray(b.documents) || !Array.isArray(b.customers)) {
    throw new Error('Das ist keine Kontor-Sicherung.')
  }
  const version = Number(b.version)
  if (![1, 2, 3].includes(version)) throw new Error(`Sicherungsversion ${b.version} wird nicht unterstützt.`)
  return {
    app: 'kontor',
    version: 3,
    exportedAt: b.exportedAt ?? '',
    settings: b.settings ? normalizeSettings(b.settings) : null,
    customers: b.customers,
    documents: b.documents.map(normalizeDocument),
    timeEntries: list<TimeEntry>(b.timeEntries),
    timer: b.timer ?? null,
    reminders: list<Reminder>(b.reminders),
    catalog: list<CatalogItem>(b.catalog),
    recurring: list<RecurringInvoice>(b.recurring),
    expenses: list<Expense>(b.expenses),
    projects: list<Project>(b.projects),
    attachments: list<SerializedAttachment>(b.attachments),
  }
}

function allTables() {
  return [db.settings, db.customers, db.documents, db.timeEntries, db.timer, db.reminders, db.catalog, db.recurring, db.expenses, db.projects, db.attachments]
}

/** Replaces all local data with the backup. */
export async function restoreBackup(b: Backup): Promise<void> {
  const attachments: Attachment[] = b.attachments.map(({ dataUrl, ...a }) => ({ ...a, data: dataUrlToBlob(dataUrl) }))
  await db.transaction('rw', allTables(), async () => {
    await Promise.all(allTables().map((t) => t.clear()))
    if (b.settings) await db.settings.put(b.settings)
    await db.customers.bulkPut(b.customers)
    await db.documents.bulkPut(b.documents)
    await db.timeEntries.bulkPut(b.timeEntries)
    if (b.timer) await db.timer.put(b.timer)
    await db.reminders.bulkPut(b.reminders)
    await db.catalog.bulkPut(b.catalog)
    await db.recurring.bulkPut(b.recurring)
    await db.expenses.bulkPut(b.expenses)
    await db.projects.bulkPut(b.projects)
    await db.attachments.bulkPut(attachments)
  })
}

export async function wipeAll(): Promise<void> {
  await db.transaction('rw', allTables(), async () => {
    await Promise.all(allTables().map((t) => t.clear()))
  })
}

function csvCell(value: string | number): string {
  const s = String(value)
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Semicolon separated with decimal comma, which is what German Excel expects. */
export function invoicesToCsv(docs: InvoiceDocument[], customers: Customer[]): string {
  const byId = new Map(customers.map((c) => [c.id, c]))
  const header = ['Nummer', 'Art', 'Status', 'Rechnungsdatum', 'Leistung von', 'Leistung bis', 'Fällig', 'Bezahlt am', 'Kundennr.', 'Empfänger', 'USt-IdNr. Empfänger', 'Land', 'Steuerfall', 'Netto', 'USt', 'Brutto', 'Abschläge', 'Währung', 'Bezug']
  const rows = docs
    .filter((d) => d.status !== 'draft' && d.kind !== 'quote')
    .sort((a, b) => (a.number ?? '').localeCompare(b.number ?? '', 'de', { numeric: true }))
    .map((d) => {
      const t = documentTotals(d)
      const sign = d.kind === 'creditNote' ? -1 : 1
      return [
        d.number ?? '',
        documentLabel(d),
        STATUS_LABELS[displayStatus(d)],
        d.issueDate,
        d.serviceFrom,
        d.serviceTo,
        d.dueDate,
        d.paidAt ?? '',
        (d.customerId && byId.get(d.customerId)?.number) || '',
        recipientName(d.recipient),
        d.recipient.vatId,
        d.recipient.country,
        d.taxMode,
        formatAmount(sign * t.netCents),
        formatAmount(sign * t.taxCents),
        formatAmount(sign * t.grossCents),
        formatAmount(sign * t.prepaidCents),
        d.currency,
        d.cancelsNumber ?? d.creditsNumber ?? '',
      ]
    })
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')
}

export function downloadFile(name: string, content: BlobPart, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
