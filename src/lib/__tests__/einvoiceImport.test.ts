// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { blankDocument, emptyCompany, emptyRecipient } from '../defaults'
import { buildCii } from '../einvoice'
import { extractXmlFromPdf, parseEInvoice } from '../einvoiceImport'
import { buildInvoiceView } from '../invoiceView'
import { defaultSettings } from '../defaults'
import { renderInvoicePdf } from '../pdf'

const seller = { ...emptyCompany(), name: 'Hosting Nord GmbH', street: 'A 1', zip: '10115', city: 'Berlin', vatId: 'DE111222333', email: 'r@example.de', iban: 'DE89370400440532013000' }
const doc = blankDocument({
  id: 'x', status: 'open', number: 'HN-4711', issueDate: '2026-04-03', serviceFrom: '2026-04-01', dueDate: '2026-04-17',
  recipient: { ...emptyRecipient(), company: 'Studio Nordlicht', street: 'K 21', zip: '10435', city: 'Berlin' },
  items: [
    { id: '1', title: 'Webhosting April', description: '', quantity: 1, unit: 'Monat', unitPriceCents: 2000, taxRate: 19, discountPercent: 0 },
    { id: '2', title: 'Handbuch', description: '', quantity: 1, unit: 'Stk.', unitPriceCents: 1000, taxRate: 7, discountPercent: 0 },
  ],
})

const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>U-1</cbc:ID><cbc:IssueDate>2026-05-02</cbc:IssueDate><cbc:DueDate>2026-05-16</cbc:DueDate><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>DE999</cbc:CompanyID></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>Druckerei Süd</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">19.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">100.00</cbc:TaxableAmount><cac:TaxCategory><cbc:Percent>19</cbc:Percent></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">119.00</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="EUR">119.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cac:Item><cbc:Name>Flyer</cbc:Name></cac:Item></cac:InvoiceLine>
</ubl:Invoice>`

describe('e-invoice import', () => {
  it('reads an XRechnung in CII syntax', () => {
    const inv = parseEInvoice(buildCii(doc, seller, 'xrechnung'))
    expect(inv).toMatchObject({ format: 'CII', number: 'HN-4711', issueDate: '2026-04-03', dueDate: '2026-04-17', sellerName: 'Hosting Nord GmbH', sellerVatId: 'DE111222333', netCents: 3000, taxCents: 450, grossCents: 3450, taxRate: 19, description: 'Webhosting April' })
  })

  it('reads UBL', () => {
    expect(parseEInvoice(UBL)).toMatchObject({ format: 'UBL', number: 'U-1', sellerName: 'Druckerei Süd', sellerVatId: 'DE999', grossCents: 11900, taxCents: 1900, taxRate: 19, description: 'Flyer', dueDate: '2026-05-16' })
  })

  it('reads credit notes as negative amounts', () => {
    expect(parseEInvoice(buildCii({ ...doc, kind: 'creditNote', creditsNumber: 'X' }, seller, 'facturx')).grossCents).toBe(-3450)
  })

  it('rejects other XML', () => {
    expect(() => parseEInvoice('<foo/>')).toThrow(/erkannt/)
    expect(() => parseEInvoice('kein xml')).toThrow()
  })

  it('extracts the XML from a ZUGFeRD PDF', async () => {
    const xml = buildCii(doc, seller, 'facturx')
    const settings = { ...defaultSettings(), company: seller }
    const pdf = await renderInvoicePdf(buildInvoiceView(doc, settings), { xml })
    expect(await extractXmlFromPdf(pdf)).toBe(xml)
    expect(await extractXmlFromPdf(await renderInvoicePdf(buildInvoiceView(doc, settings)))).toBeNull()
  })
})
