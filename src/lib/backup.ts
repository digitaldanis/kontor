import { documentTotals } from './calc'
import { db } from './db'
import { recipientName } from './defaults'
import { normalizeDocument, normalizeSettings } from './migrate'
import { formatAmount } from './money'
import { displayStatus, STATUS_LABELS, documentLabel } from './status'
import type { Customer, InvoiceDocument, RunningTimer, Settings, TimeEntry } from './types'

export interface Backup {
  app: 'kontor'
  version: 2
  exportedAt: string
  settings: Settings | null
  customers: Customer[]
  documents: InvoiceDocument[]
  timeEntries: TimeEntry[]
  timer: RunningTimer | null
}

export async function createBackup(): Promise<Backup> {
  const [settings, customers, documents, timeEntries, timer] = await Promise.all([
    db.settings.get('main'),
    db.customers.toArray(),
    db.documents.toArray(),
    db.timeEntries.toArray(),
    db.timer.get('timer'),
  ])
  return {
    app: 'kontor',
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: settings ?? null,
    customers,
    documents,
    timeEntries,
    timer: timer ?? null,
  }
}

export function parseBackup(text: string): Backup {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.')
  }
  const b = data as Partial<Backup>
  if (!b || b.app !== 'kontor' || !Array.isArray(b.documents) || !Array.isArray(b.customers)) {
    throw new Error('Das ist keine Kontor-Sicherung.')
  }
  const version = Number(b.version)
  if (version !== 1 && version !== 2) throw new Error(`Sicherungsversion ${b.version} wird nicht unterstützt.`)
  return {
    app: 'kontor',
    version: 2,
    exportedAt: b.exportedAt ?? '',
    settings: b.settings ? normalizeSettings(b.settings) : null,
    customers: b.customers,
    documents: b.documents.map(normalizeDocument),
    timeEntries: Array.isArray(b.timeEntries) ? b.timeEntries : [],
    timer: b.timer ?? null,
  }
}

/** Replaces all local data with the backup. */
export async function restoreBackup(b: Backup): Promise<void> {
  await db.transaction('rw', [db.settings, db.customers, db.documents, db.timeEntries, db.timer], async () => {
    await Promise.all([db.settings.clear(), db.customers.clear(), db.documents.clear(), db.timeEntries.clear(), db.timer.clear()])
    if (b.settings) await db.settings.put(b.settings)
    await db.customers.bulkPut(b.customers)
    await db.documents.bulkPut(b.documents)
    await db.timeEntries.bulkPut(b.timeEntries)
    if (b.timer) await db.timer.put(b.timer)
  })
}

export async function wipeAll(): Promise<void> {
  await db.transaction('rw', [db.settings, db.customers, db.documents, db.timeEntries, db.timer], async () => {
    await Promise.all([db.settings.clear(), db.customers.clear(), db.documents.clear(), db.timeEntries.clear(), db.timer.clear()])
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
