import { beforeEach, describe, expect, it } from 'vitest'
import { db, setDatabase } from '../db'
import { memoryDatabase } from '../store'
import {
  addPayment,
  cancelInvoice,
  createCreditNote,
  createDraft,
  deductionFor,
  duplicateDocument,
  emptyCustomer,
  finalizeDocument,
  getSettings,
  invoiceTimeEntries,
  newLineItem,
  openDownPayments,
  removePayment,
  saveCustomer,
  saveDocument,
  updateSettings,
} from '../repo'
import { calculateTotals, documentTotals } from '../calc'
import { amountDue, displayStatus, netOf } from '../status'
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
  setDatabase(memoryDatabase())
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

describe('backup', () => {
  it('restores everything from a JSON backup', async () => {
    const { createBackup, parseBackup, restoreBackup } = await import('../backup')
    const c = await customer()
    await finalizeDocument((await readyDraft(c.id)).id)
    const json = JSON.stringify(await createBackup())
    setDatabase(memoryDatabase())
    await restoreBackup(parseBackup(json))
    expect(await db.customers.count()).toBe(1)
    expect((await db.documents.toArray())[0].number).toMatch(/^RE-/)
    expect((await getSettings()).company.name).toBe('Muster Design')
  })

  it('rejects foreign files', async () => {
    const { parseBackup } = await import('../backup')
    expect(() => parseBackup('{"foo":1}')).toThrow(/Kontor/)
    expect(() => parseBackup('kein json')).toThrow()
  })
})

describe('payments', () => {
  it('tracks partial payments and the remaining amount', async () => {
    const c = await customer()
    const inv = await finalizeDocument((await readyDraft(c.id)).id)
    // 2 × 100 € + 19 % = 238 €
    let doc = await addPayment(inv.id, { date: '2026-03-01', amountCents: 10000, note: 'Anzahlung' })
    expect(doc.status).toBe('open')
    expect(amountDue(doc)).toBe(13800)
    expect(displayStatus(doc, '2000-01-01')).toBe('partial')

    doc = await addPayment(inv.id, { date: '2026-03-15', amountCents: 13800, note: '' })
    expect(doc.status).toBe('paid')
    expect(doc.paidAt).toBe('2026-03-15')
    expect(amountDue(doc)).toBe(0)

    await removePayment(inv.id, doc.payments[1].id)
    const back = await db.documents.get(inv.id)
    expect(back?.status).toBe('open')
    expect(back?.paidAt).toBeNull()
    expect(amountDue(back!)).toBe(13800)
  })

  it('rejects payments on drafts and invalid amounts', async () => {
    const c = await customer()
    const draft = await readyDraft(c.id)
    await expect(addPayment(draft.id, { date: '2026-03-01', amountCents: 100, note: '' })).rejects.toThrow()
    const inv = await finalizeDocument(draft.id)
    await expect(addPayment(inv.id, { date: '2026-03-01', amountCents: 0, note: '' })).rejects.toThrow()
  })
})

describe('credit notes', () => {
  it('uses its own number range and reduces the amount due', async () => {
    const c = await customer()
    const inv = await finalizeDocument((await readyDraft(c.id)).id)
    const draft = await createCreditNote(inv.id, 'partial')
    draft.items = [{ ...draft.items[0], quantity: 0.5 }]
    await saveDocument(draft)
    const credit = await finalizeDocument(draft.id)
    const year = new Date().getFullYear()
    expect(credit.number).toBe(`GS-${year}-0001`)
    expect(credit.creditsNumber).toBe(inv.number)
    expect(documentTotals(credit).grossCents).toBe(5950)
    // credit notes count as negative revenue
    expect(netOf(credit)).toBe(-5000)

    const original = await db.documents.get(inv.id)
    expect(original?.creditNotes).toHaveLength(1)
    expect(amountDue(original!)).toBe(23800 - 5950)
    // the invoice number range is untouched
    expect((await getSettings()).invoiceNumbers.counters[String(year)]).toBe(1)
  })

  it('settles the invoice with a full credit note and refuses more', async () => {
    const c = await customer()
    const inv = await finalizeDocument((await readyDraft(c.id)).id)
    const full = await finalizeDocument((await createCreditNote(inv.id, 'full')).id)
    expect(documentTotals(full).grossCents).toBe(23800)
    const original = await db.documents.get(inv.id)
    expect(original?.status).toBe('paid')
    expect(displayStatus(original!)).toBe('settled')
    await expect(createCreditNote(inv.id)).rejects.toThrow(/vollständig/)
    await expect(cancelInvoice(inv.id)).rejects.toThrow(/Gutschriften/)
  })

  it('credits only the remainder after a partial credit', async () => {
    const c = await customer()
    const inv = await finalizeDocument((await readyDraft(c.id)).id)
    const partial = await createCreditNote(inv.id, 'partial')
    partial.items = [{ ...partial.items[0], quantity: 1 }]
    await saveDocument(partial)
    await finalizeDocument(partial.id)
    const rest = await createCreditNote(inv.id, 'full')
    expect(documentTotals(rest).grossCents).toBe(11900)
    await finalizeDocument(rest.id)
    expect(amountDue((await db.documents.get(inv.id))!)).toBe(0)
  })

  it('applies a percentage invoice discount to a partial credit', async () => {
    const c = await customer()
    const draft = await readyDraft(c.id)
    await saveDocument({ ...draft, discount: { type: 'percent', value: 10 } })
    const inv = await finalizeDocument(draft.id)
    const partial = await createCreditNote(inv.id, 'partial')
    partial.items = [{ ...partial.items[0], quantity: 1 }]
    await saveDocument(partial)
    const credit = await finalizeDocument(partial.id)
    // 100 € − 10 % + 19 % = 107,10 €
    expect(documentTotals(credit).grossCents).toBe(10710)
    expect(amountDue((await db.documents.get(inv.id))!)).toBe(21420 - 10710)
  })

  it('cannot credit more than the invoice', async () => {
    const c = await customer()
    const inv = await finalizeDocument((await readyDraft(c.id)).id)
    const draft = await createCreditNote(inv.id, 'partial')
    draft.items = [{ ...draft.items[0], quantity: 3 }]
    await saveDocument(draft)
    await expect(finalizeDocument(draft.id)).rejects.toThrow(/übersteigt/)
  })
})

describe('down payments', () => {
  it('deducts a down payment in the final invoice', async () => {
    const c = await customer()
    const s = await getSettings()
    const dp = await createDraft('invoice', { customerId: c.id, billingType: 'downPayment' })
    dp.items = [newLineItem(s, { title: 'Abschlag 30 %', quantity: 1, unitPriceCents: 30000 })]
    await saveDocument(dp)
    const down = await finalizeDocument(dp.id)
    await addPayment(down.id, { date: '2026-02-01', amountCents: 35700, note: '' })

    expect((await openDownPayments(c.id)).map((d) => d.id)).toEqual([down.id])

    const fin = await createDraft('invoice', { customerId: c.id, billingType: 'final' })
    fin.items = [newLineItem(s, { title: 'Gesamtleistung', quantity: 10, unitPriceCents: 10000 })]
    fin.deductions = [deductionFor(down)]
    await saveDocument(fin)
    const final = await finalizeDocument(fin.id)

    const t = documentTotals(final)
    expect(t.grossCents).toBe(119000)
    expect(t.dueCents).toBe(83300)
    expect(amountDue(final)).toBe(83300)
    // revenue is not counted twice
    expect(netOf(down) + netOf(final)).toBe(100000)
    expect((await db.documents.get(down.id))?.settledById).toBe(final.id)
    expect(await openDownPayments(c.id)).toEqual([])
    await expect(cancelInvoice(down.id)).rejects.toThrow(/verrechnet/)

    // cancelling the final invoice releases the down payment again
    const storno = await cancelInvoice(final.id)
    expect(documentTotals(storno).dueCents).toBe(-83300)
    expect((await db.documents.get(down.id))?.settledById).toBeNull()
  })
})
