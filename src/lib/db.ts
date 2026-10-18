import Dexie, { type EntityTable } from 'dexie'
import { normalizeDocument, normalizeSettings } from './migrate'
import type { Customer, InvoiceDocument, RunningTimer, Settings, TimeEntry } from './types'

export class KontorDB extends Dexie {
  settings!: EntityTable<Settings, 'id'>
  customers!: EntityTable<Customer, 'id'>
  documents!: EntityTable<InvoiceDocument, 'id'>
  timeEntries!: EntityTable<TimeEntry, 'id'>
  timer!: EntityTable<RunningTimer, 'id'>

  constructor(name = 'kontor') {
    super(name)
    this.version(1).stores({
      settings: 'id',
      customers: 'id, company, number, archived',
      documents: 'id, kind, status, number, customerId, issueDate, cancelsId',
      timeEntries: 'id, customerId, start, invoiceId, project',
      timer: 'id',
    })
    // Payments, invoice discounts, credit notes and down payments
    this.version(2)
      .stores({
        documents: 'id, kind, status, number, customerId, issueDate, cancelsId, creditsId, recurringId',
      })
      .upgrade(async (tx) => {
        await tx
          .table('documents')
          .toCollection()
          .modify((doc: InvoiceDocument) => {
            Object.assign(doc, normalizeDocument(doc))
          })
        const settings = await tx.table('settings').get('main')
        if (settings) await tx.table('settings').put(normalizeSettings(settings))
      })
  }
}

export const db = new KontorDB()

export function uid(): string {
  return crypto.randomUUID()
}

export function now(): string {
  return new Date().toISOString()
}
