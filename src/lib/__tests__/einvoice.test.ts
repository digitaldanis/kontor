import { describe, expect, it } from 'vitest'
import { emptyCompany, emptyRecipient } from '../defaults'
import { buildCii } from '../einvoice'
import type { InvoiceDocument } from '../types'

const seller = { ...emptyCompany(), name: 'Studio Nordlicht', street: 'Kastanienallee 21', zip: '10435', city: 'Berlin', taxNumber: '30/245/67890', vatId: 'DE298765432', email: 'hallo@example.de', phone: '030 123', iban: 'DE89370400440532013000' }

const doc: InvoiceDocument = {
  id: 'x', kind: 'invoice', status: 'open', number: 'RE-2026-0007', customerId: null,
  recipient: { ...emptyRecipient(), company: 'Kunde GmbH', street: 'B 2', zip: '20095', city: 'Hamburg', email: 'k@example.de' },
  title: 'Rechnung', issueDate: '2026-05-01', serviceFrom: '2026-04-01', serviceTo: '2026-04-30', dueDate: '2026-05-15', validUntil: '',
  items: [
    { id: '1', title: 'Beratung & Konzept', description: '', quantity: 3.25, unit: 'Std.', unitPriceCents: 9500, taxRate: 19, discountPercent: 10 },
    { id: '2', title: 'Fachbuch', description: '', quantity: 2, unit: 'Stk.', unitPriceCents: 1999, taxRate: 7, discountPercent: 0 },
  ],
  introText: '', closingText: '', footerText: '', taxMode: 'standard', taxNote: '', currency: 'EUR', layout: 'modern',
  accentColor: '#000', buyerReference: '', seller: null, sellerLogo: null, cancelsId: null, cancelsNumber: null,
  cancelledById: null, sourceQuoteId: null, paidAt: null, finalizedAt: null, createdAt: '', updatedAt: '',
}

describe('buildCii', () => {
  const xml = buildCii(doc, seller, 'xrechnung')

  it('declares the XRechnung guideline', () => {
    expect(xml).toContain('urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0')
  })

  it('writes totals matching the internal calculation', () => {
    // 3,25 × 95 € − 10 % = 277,88 €; 2 × 19,99 € = 39,98 €
    expect(xml).toContain('<ram:LineTotalAmount>277.88</ram:LineTotalAmount>')
    expect(xml).toContain('<ram:TaxBasisTotalAmount>317.86</ram:TaxBasisTotalAmount>')
    // 277,88 × 19 % = 52,80 €; 39,98 × 7 % = 2,80 €
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">55.60</ram:TaxTotalAmount>')
    expect(xml).toContain('<ram:GrandTotalAmount>373.46</ram:GrandTotalAmount>')
  })

  it('escapes XML characters and maps units', () => {
    expect(xml).toContain('Beratung &amp; Konzept')
    expect(xml).toContain('unitCode="HUR"')
  })

  it('uses category AE for reverse charge', () => {
    const rc = buildCii({ ...doc, taxMode: 'reverseCharge', taxNote: 'Reverse Charge' }, seller, 'xrechnung')
    expect(rc).toContain('<ram:CategoryCode>AE</ram:CategoryCode>')
    expect(rc).toContain('VATEX-EU-AE')
    expect(rc).toContain('<ram:TaxTotalAmount currencyID="EUR">0.00</ram:TaxTotalAmount>')
  })

  it('exports cancellations as credit note with positive amounts', () => {
    const storno = buildCii({ ...doc, kind: 'cancellation', cancelsNumber: 'RE-2026-0006', items: doc.items.map((i) => ({ ...i, quantity: -i.quantity })) }, seller, 'xrechnung')
    expect(storno).toContain('<ram:TypeCode>381</ram:TypeCode>')
    expect(storno).toContain('<ram:GrandTotalAmount>373.46</ram:GrandTotalAmount>')
    expect(storno).toContain('<ram:IssuerAssignedID>RE-2026-0006</ram:IssuerAssignedID>')
  })
})
