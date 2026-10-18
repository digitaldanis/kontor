import Dexie, { type EntityTable } from 'dexie'
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
  }
}

export const db = new KontorDB()

export function uid(): string {
  return crypto.randomUUID()
}

export function now(): string {
  return new Date().toISOString()
}
