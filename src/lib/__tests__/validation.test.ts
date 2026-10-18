import { describe, expect, it } from 'vitest'
import { emptyCompany, emptyRecipient } from '../defaults'
import type { InvoiceDocument } from '../types'
import { isPlausibleIban, suggestTaxMode, validateInvoice } from '../validation'

const seller = { ...emptyCompany(), name: 'Muster', street: 'A 1', zip: '10115', city: 'Berlin', taxNumber: '1', vatId: 'DE123456789' }

function doc(partial: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    id: 'x', kind: 'invoice', status: 'draft', number: null, customerId: null,
    recipient: { ...emptyRecipient(), company: 'Kunde GmbH', street: 'B 2', zip: '20095', city: 'Hamburg' },
    title: 'Rechnung', issueDate: '2026-05-01', serviceFrom: '2026-04-30', serviceTo: '', dueDate: '2026-05-15', validUntil: '',
    items: [{ id: '1', title: 'Beratung', description: '', quantity: 3, unit: 'Std.', unitPriceCents: 10000, taxRate: 19, discountPercent: 0 }],
    introText: '', closingText: '', footerText: '', taxMode: 'standard', taxNote: '', currency: 'EUR', layout: 'modern',
    accentColor: '#000', buyerReference: '', seller: null, sellerLogo: null, cancelsId: null, cancelsNumber: null,
    cancelledById: null, sourceQuoteId: null, paidAt: null, finalizedAt: null, createdAt: '', updatedAt: '',
    ...partial,
  }
}

const errors = (d: InvoiceDocument, s = seller) => validateInvoice(d, s).filter((i) => i.level === 'error').map((i) => i.field)

describe('validateInvoice', () => {
  it('accepts a complete invoice', () => {
    expect(errors(doc())).toEqual([])
  })

  it('requires seller tax identification', () => {
    expect(errors(doc(), { ...seller, taxNumber: '', vatId: '' })).toContain('seller.tax')
  })

  it('requires a service date', () => {
    expect(errors(doc({ serviceFrom: '' }))).toContain('serviceFrom')
  })

  it('allows missing recipient for small invoices up to 250 €', () => {
    const small = doc({ recipient: emptyRecipient(), items: [{ ...doc().items[0], quantity: 1, unitPriceCents: 21000 }] })
    expect(errors(small)).toEqual([])
    const big = doc({ recipient: emptyRecipient() })
    expect(errors(big)).toContain('recipient.address')
  })

  it('needs both VAT IDs and a note for reverse charge', () => {
    const rc = doc({ taxMode: 'reverseCharge', recipient: { ...doc().recipient, country: 'AT' } })
    expect(errors(rc)).toEqual(expect.arrayContaining(['recipient.vatId', 'taxNote']))
    expect(errors(rc, { ...seller, vatId: '' })).toContain('seller.vatId')
    const ok = doc({ taxMode: 'reverseCharge', taxNote: 'Reverse Charge', recipient: { ...doc().recipient, country: 'AT', vatId: 'ATU12345678' } })
    expect(errors(ok)).toEqual([])
  })
})

describe('suggestTaxMode', () => {
  it('picks the usual mode by country', () => {
    expect(suggestTaxMode(true, 'DE', { country: 'AT', vatId: 'ATU1' })).toBe('smallBusiness')
    expect(suggestTaxMode(false, 'DE', { country: 'DE', vatId: '' })).toBe('standard')
    expect(suggestTaxMode(false, 'DE', { country: 'FR', vatId: 'FR123' })).toBe('reverseCharge')
    expect(suggestTaxMode(false, 'DE', { country: 'FR', vatId: '' })).toBe('standard')
    expect(suggestTaxMode(false, 'DE', { country: 'CH', vatId: '' })).toBe('thirdCountry')
  })
})

describe('isPlausibleIban', () => {
  it('checks the mod-97 checksum', () => {
    expect(isPlausibleIban('DE89 3704 0044 0532 0130 00')).toBe(true)
    expect(isPlausibleIban('DE89 3704 0044 0532 0130 01')).toBe(false)
  })
})
