import Dexie, { type EntityTable } from 'dexie'
import { normalizeDocument, normalizeSettings } from './migrate'
import type { Attachment, CatalogItem, Customer, Expense, InvoiceDocument, Project, RecurringInvoice, Reminder, RunningTimer, Settings, TimeEntry } from './types'

export class KontorDB extends Dexie {
  settings!: EntityTable<Settings, 'id'>
  customers!: EntityTable<Customer, 'id'>
  documents!: EntityTable<InvoiceDocument, 'id'>
  timeEntries!: EntityTable<TimeEntry, 'id'>
  timer!: EntityTable<RunningTimer, 'id'>
  reminders!: EntityTable<Reminder, 'id'>
  catalog!: EntityTable<CatalogItem, 'id'>
  recurring!: EntityTable<RecurringInvoice, 'id'>
  expenses!: EntityTable<Expense, 'id'>
  attachments!: EntityTable<Attachment, 'id'>
  projects!: EntityTable<Project, 'id'>

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
    this.version(3).stores({
      reminders: 'id, invoiceId, customerId, issueDate',
    })
    // Catalog, recurring invoices, expenses and projects
    this.version(4)
      .stores({
        catalog: 'id, name',
        recurring: 'id, customerId, nextRun',
        expenses: 'id, date, category',
        attachments: 'id',
        projects: 'id, customerId, [customerId+name]',
      })
      .upgrade(async (tx) => {
        // existing project names in time entries become projects without budget
        const entries = (await tx.table('timeEntries').toArray()) as TimeEntry[]
        const seen = new Set<string>()
        const projects: Project[] = []
        for (const e of entries) {
          const name = e.project?.trim()
          if (!name || seen.has(`${e.customerId}|${name}`)) continue
          seen.add(`${e.customerId}|${name}`)
          const stamp = new Date().toISOString()
          projects.push({ id: crypto.randomUUID(), customerId: e.customerId, name, budgetMinutes: null, budgetCents: null, archived: false, createdAt: stamp, updatedAt: stamp })
        }
        await tx.table('projects').bulkPut(projects)
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
