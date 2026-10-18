import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import {
  cancelInvoice,
  createDraft,
  duplicateDocument,
  emptyCustomer,
  finalizeDocument,
  getSettings,
  invoiceTimeEntries,
  newLineItem,
  saveCustomer,
  saveDocument,
  updateSettings,
} from '../repo'
import { calculateTotals } from '../calc'
import type { TimeEntry } from '../types'

async function setupCompany() {
  const s = await getSettings()
  await updateSettings({
    company: { ...s.company, name: 'Muster Design', street: 'Hauptstr. 1', zip: '10115', city: 'Berlin', taxNumber: '27/123/45678' },
  })
}

async function customer() {
  return saveCustomer({ ...emptyCustomer(), company: 'ACME GmbH', street: 'Weg 2', zip: '20095', city: 'Hamburg', hourlyRateCents: 9000 })
}

async function readyDraft(customerId: string) {
  const s = await getSettings()
  const doc = await createDraft('invoice', { customerId })
  doc.items = [newLineItem(s, { title: 'Beratung', quantity: 2, unitPriceCents: 10000 })]
  await saveDocument(doc)
  return doc
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  await setupCompany()
})

describe('finalizeDocument', () => {
  it('assigns consecutive numbers only on finalization', async () => {
    const c = await customer()
    const a = await readyDraft(c.id)
    const b = await readyDraft(c.id)
    await readyDraft(c.id) // stays a draft and must not consume a number
    const year = new Date().getFullYear()
    expect((await finalizeDocument(b.id)).number).toBe(`RE-${year}-0001`)
    expect((await finalizeDocument(a.id)).number).toBe(`RE-${year}-0002`)
  })

  it('freezes seller data and locks the invoice', async () => {
    const c = await customer()
    const draft = await readyDraft(c.id)
    const final = await finalizeDocument(draft.id)
    await updateSettings({ company: { ...(await getSettings()).company, name: 'Neuer Name' } })
    const stored = await db.documents.get(draft.id)
    expect(stored?.seller?.name).toBe('Muster Design')
    await expect(saveDocument({ ...final, title: 'geändert' })).rejects.toThrow()
  })

  it('refuses invoices with missing mandatory data', async () => {
    const doc = await createDraft('invoice')
    await expect(finalizeDocument(doc.id)).rejects.toThrow(/Pflichtangaben/)
  })
})

describe('cancelInvoice', () => {
  it('creates a mirrored cancellation with its own number', async () => {
    const c = await customer()
    const draft = await readyDraft(c.id)
    const original = await finalizeDocument(draft.id)
    const storno = await cancelInvoice(original.id)
    expect(storno.kind).toBe('cancellation')
    expect(storno.cancelsNumber).toBe(original.number)
    expect(storno.number).not.toBe(original.number)
    expect(calculateTotals(storno.items).grossCents).toBe(-calculateTotals(original.items).grossCents)
    expect((await db.documents.get(original.id))?.status).toBe('cancelled')
    await expect(cancelInvoice(original.id)).rejects.toThrow()
  })
})

describe('invoiceTimeEntries', () => {
  it('turns unbilled entries into positions and links them', async () => {
    const c = await customer()
    const entry = (start: string, end: string, description: string): TimeEntry => ({
      id: crypto.randomUUID(),
      customerId: c.id,
      project: 'Website',
      description,
      details: '',
      start,
      end,
      billable: true,
      rateCents: null,
      invoiceId: null,
      createdAt: start,
      updatedAt: start,
    })
    const entries = [
      entry('2026-03-02T08:00:00.000Z', '2026-03-02T09:30:00.000Z', 'Konzept'),
      entry('2026-03-03T08:00:00.000Z', '2026-03-03T08:45:00.000Z', 'Umsetzung'),
    ]
    await db.timeEntries.bulkPut(entries)
    const doc = await invoiceTimeEntries(c.id, entries.map((e) => e.id))
    expect(doc.items.map((i) => [i.title, i.quantity, i.unitPriceCents])).toEqual([
      ['Konzept', 1.5, 9000],
      ['Umsetzung', 0.75, 9000],
    ])
    expect(doc.serviceFrom).toBe('2026-03-02')
    const linked = await db.timeEntries.where('invoiceId').equals(doc.id).count()
    expect(linked).toBe(2)
    await expect(invoiceTimeEntries(c.id, entries.map((e) => e.id))).rejects.toThrow()
  })
})

describe('duplicateDocument', () => {
  it('creates an unnumbered draft', async () => {
    const c = await customer()
    const final = await finalizeDocument((await readyDraft(c.id)).id)
    const copy = await duplicateDocument(final.id)
    expect(copy.status).toBe('draft')
    expect(copy.number).toBeNull()
    expect(copy.items).toHaveLength(1)
    expect(copy.items[0].id).not.toBe(final.items[0].id)
  })
})
