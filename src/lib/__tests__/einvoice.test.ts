import { describe, expect, it } from 'vitest'
import { blankDocument, emptyCompany, emptyRecipient } from '../defaults'
import { buildCii } from '../einvoice'
import type { InvoiceDocument } from '../types'

const seller = { ...emptyCompany(), name: 'Studio Nordlicht', street: 'Kastanienallee 21', zip: '10435', city: 'Berlin', taxNumber: '30/245/67890', vatId: 'DE298765432', email: 'hallo@example.de', phone: '030 123', iban: 'DE89370400440532013000' }

const doc: InvoiceDocument = blankDocument({
  id: 'x', kind: 'invoice', status: 'open', number: 'RE-2026-0007', customerId: null,
  recipient: { ...emptyRecipient(), company: 'Kunde GmbH', street: 'B 2', zip: '20095', city: 'Hamburg', email: 'k@example.de' },
  title: 'Rechnung', issueDate: '2026-05-01', serviceFrom: '2026-04-01', serviceTo: '2026-04-30', dueDate: '2026-05-15', validUntil: '',
  items: [
    { id: '1', title: 'Beratung & Konzept', description: '', quantity: 3.25, unit: 'Std.', unitPriceCents: 9500, taxRate: 19, discountPercent: 10 },
    { id: '2', title: 'Fachbuch', description: '', quantity: 2, unit: 'Stk.', unitPriceCents: 1999, taxRate: 7, discountPercent: 0 },
  ],
  introText: '', closingText: '', footerText: '', taxMode: 'standard', taxNote: '', currency: 'EUR', layout: 'modern',
  accentColor: '#000',
})

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

describe('buildCii extended', () => {
  it('writes the invoice discount per VAT category', () => {
    const xml = buildCii({ ...doc, discount: { type: 'percent', value: 10 } }, seller, 'xrechnung')
    // 277,88 → 27,79 discount; 39,98 → 4,00 discount
    expect(xml).toContain('<ram:ActualAmount>27.79</ram:ActualAmount>')
    expect(xml).toContain('<ram:ActualAmount>4.00</ram:ActualAmount>')
    expect(xml).toContain('<ram:LineTotalAmount>317.86</ram:LineTotalAmount><ram:AllowanceTotalAmount>31.79</ram:AllowanceTotalAmount><ram:TaxBasisTotalAmount>286.07</ram:TaxBasisTotalAmount>')
    // (277,88 − 27,79) × 19 % = 47,52; (39,98 − 4,00) × 7 % = 2,52
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">50.04</ram:TaxTotalAmount>')
    expect(xml).toContain('<ram:GrandTotalAmount>336.11</ram:GrandTotalAmount>')
  })

  it('exports a final invoice with prepaid amount', () => {
    const xml = buildCii(
      {
        ...doc,
        billingType: 'final',
        deductions: [{ invoiceId: 'a', number: 'RE-2026-0003', issueDate: '2026-03-01', groups: [{ rate: 19, netCents: 10000, taxCents: 1900 }] }],
      },
      seller,
      'xrechnung',
    )
    expect(xml).toContain('<ram:GrandTotalAmount>373.46</ram:GrandTotalAmount><ram:TotalPrepaidAmount>119.00</ram:TotalPrepaidAmount><ram:DuePayableAmount>254.46</ram:DuePayableAmount>')
    expect(xml).toContain('verrechnete Abschläge: RE-2026-0003')
  })

  it('exports a credit note with a reference to the invoice', () => {
    const xml = buildCii({ ...doc, kind: 'creditNote', number: 'GS-2026-0001', creditsNumber: 'RE-2026-0007' }, seller, 'xrechnung', { referenceDate: '2026-05-01' })
    expect(xml).toContain('<ram:TypeCode>381</ram:TypeCode>')
    expect(xml).toContain('<ram:GrandTotalAmount>373.46</ram:GrandTotalAmount>')
    expect(xml).toContain('<ram:IssuerAssignedID>RE-2026-0007</ram:IssuerAssignedID><ram:FormattedIssueDateTime><qdt:DateTimeString format="102">20260501</qdt:DateTimeString></ram:FormattedIssueDateTime>')
  })

  it('marks down payment invoices', () => {
    expect(buildCii({ ...doc, billingType: 'downPayment' }, seller, 'xrechnung')).toContain('<ram:TypeCode>326</ram:TypeCode>')
  })
})
