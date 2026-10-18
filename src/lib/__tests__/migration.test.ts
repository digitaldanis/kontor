import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { KontorDB } from '../db'

const NAME = 'kontor-migration-test'

// The schema and record shape as shipped in version 1
async function seedVersion1() {
  const old = new Dexie(NAME)
  old.version(1).stores({
    settings: 'id',
    customers: 'id, company, number, archived',
    documents: 'id, kind, status, number, customerId, issueDate, cancelsId',
    timeEntries: 'id, customerId, start, invoiceId, project',
    timer: 'id',
  })
  await old.open()
  const base = {
    kind: 'invoice', customerId: 'c1', title: 'Rechnung', issueDate: '2026-02-01', serviceFrom: '2026-01-31', serviceTo: '', dueDate: '2026-02-15', validUntil: '',
    recipient: { company: 'Kunde GmbH', contactPerson: '', addressExtra: '', street: 'Weg 1', zip: '20095', city: 'Hamburg', country: 'DE', vatId: '', email: '', leitwegId: '' },
    items: [{ id: 'i1', title: 'Beratung', description: '', quantity: 2, unit: 'Std.', unitPriceCents: 10000, taxRate: 19, discountPercent: 0 }],
    introText: '', closingText: '', footerText: '', taxMode: 'standard', taxNote: '', currency: 'EUR', layout: 'modern', accentColor: '#0a66d8', buyerReference: '',
    seller: null, sellerLogo: null, cancelsId: null, cancelsNumber: null, cancelledById: null, sourceQuoteId: null, finalizedAt: '2026-02-01T10:00:00.000Z', createdAt: '', updatedAt: '',
  }
  await old.table('documents').bulkPut([
    { ...base, id: 'paid', status: 'paid', number: 'RE-2026-0001', paidAt: '2026-02-10' },
    { ...base, id: 'open', status: 'open', number: 'RE-2026-0002', paidAt: null },
    { ...base, id: 'draft', status: 'draft', number: null, paidAt: null },
  ])
  await old.table('settings').put({
    id: 'main', company: { name: 'Alt GmbH' }, logo: null, defaults: { paymentTermDays: 30 },
    invoiceNumbers: { pattern: 'RE-{YYYY}-{0001}', counters: { 2026: 2 } }, quoteNumbers: { pattern: 'AN-{YYYY}-{0001}', counters: {} },
    smallBusiness: false, smallBusinessNote: '', onboarded: true, updatedAt: '',
  })
  await old.table('timeEntries').bulkPut([
    { id: 't1', customerId: 'c1', project: 'Website', description: 'a', details: '', start: '2026-01-05T08:00:00.000Z', end: '2026-01-05T10:00:00.000Z', billable: true, rateCents: null, invoiceId: null, createdAt: '', updatedAt: '' },
    { id: 't2', customerId: 'c1', project: 'Website', description: 'b', details: '', start: '2026-01-06T08:00:00.000Z', end: '2026-01-06T09:00:00.000Z', billable: true, rateCents: null, invoiceId: null, createdAt: '', updatedAt: '' },
    { id: 't3', customerId: 'c1', project: '', description: 'c', details: '', start: '2026-01-07T08:00:00.000Z', end: '2026-01-07T09:00:00.000Z', billable: true, rateCents: null, invoiceId: null, createdAt: '', updatedAt: '' },
  ])
  old.close()
}

let db: KontorDB | undefined

afterEach(async () => {
  db?.close()
  await Dexie.delete(NAME)
})

describe('database migration', () => {
  it('upgrades version 1 data without losing anything', async () => {
    await seedVersion1()
    db = new KontorDB(NAME)
    await db.open()

    const paid = await db.documents.get('paid')
    expect(paid?.number).toBe('RE-2026-0001')
    expect(paid?.status).toBe('paid')
    expect(paid?.payments).toEqual([{ id: 'paid-p1', date: '2026-02-10', amountCents: 23800, note: '' }])
    expect(paid?.discount).toBeNull()
    expect(paid?.billingType).toBe('regular')
    expect(paid?.creditNotes).toEqual([])
    expect(paid?.language).toBe('de')

    const open = await db.documents.get('open')
    expect(open?.payments).toEqual([])
    expect(open?.items[0].unitPriceCents).toBe(10000)

    const settings = await db.settings.get('main')
    expect(settings?.company.name).toBe('Alt GmbH')
    expect(settings?.invoiceNumbers.counters).toEqual({ 2026: 2 })
    expect(settings?.defaults.paymentTermDays).toBe(30)
    expect(settings?.creditNoteNumbers.pattern).toBe('GS-{YYYY}-{0001}')

    expect(await db.timeEntries.count()).toBe(3)
    const projects = await db.projects.toArray()
    expect(projects.map((p) => [p.customerId, p.name, p.budgetMinutes])).toEqual([['c1', 'Website', null]])
    expect(await db.catalog.count()).toBe(0)
  })
})
