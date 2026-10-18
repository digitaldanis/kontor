import type { Expense } from './types'

export interface ImportedInvoice {
  format: 'CII' | 'UBL'
  number: string
  issueDate: string
  dueDate: string
  sellerName: string
  sellerVatId: string
  currency: string
  netCents: number
  taxCents: number
  grossCents: number
  dueCents: number
  /** Most significant VAT rate, used as the expense rate. */
  taxRate: number
  description: string
}

function cents(text: string | null | undefined): number {
  const n = Number((text ?? '').trim())
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

function date(text: string | null | undefined): string {
  const t = (text ?? '').trim()
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : ''
}

function local(el: Element): string {
  return (el.localName || el.nodeName).replace(/^.*:/, '')
}

function deep(root: Element | Document, name: string): Element[] {
  const out: Element[] = []
  const walk = (el: Element) => {
    for (const c of Array.from(el.children)) {
      if (local(c) === name) out.push(c)
      walk(c)
    }
  }
  if ('documentElement' in root) {
    if (local(root.documentElement) === name) out.push(root.documentElement)
    walk(root.documentElement)
  } else walk(root)
  return out
}

function text(root: Element | Document | undefined, name: string): string {
  return root ? (deep(root, name)[0]?.textContent ?? '').trim() : ''
}

function child(root: Element | undefined, name: string): Element | undefined {
  return root ? Array.from(root.children).find((c) => local(c) === name) : undefined
}

export function parseEInvoice(xml: string): ImportedInvoice {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Die Datei ist kein gültiges XML.')
  const root = doc.documentElement
  const name = local(root)
  if (name === 'CrossIndustryInvoice') return parseCii(doc)
  if (name === 'Invoice' || name === 'CreditNote') return parseUbl(doc, name === 'CreditNote')
  throw new Error('Keine XRechnung bzw. ZUGFeRD-Rechnung erkannt (CII oder UBL).')
}

function mainRate(entries: { rate: number; base: number }[]): number {
  return [...entries].sort((a, b) => b.base - a.base)[0]?.rate ?? 0
}

function parseCii(doc: Document): ImportedInvoice {
  const exchanged = deep(doc, 'ExchangedDocument')[0]
  const settlement = deep(doc, 'ApplicableHeaderTradeSettlement')[0]
  const sums = deep(settlement ?? doc, 'SpecifiedTradeSettlementHeaderMonetarySummation')[0]
  const seller = deep(doc, 'SellerTradeParty')[0]
  const taxes = settlement ? Array.from(settlement.children).filter((c) => local(c) === 'ApplicableTradeTax') : []
  const vat = seller ? deep(seller, 'SpecifiedTaxRegistration').map((r) => child(r, 'ID')).find((id) => id?.getAttribute('schemeID') === 'VA') : undefined
  const credit = text(exchanged, 'TypeCode') === '381'
  const sign = credit ? -1 : 1
  const firstItem = deep(doc, 'SpecifiedTradeProduct')[0]
  return {
    format: 'CII',
    number: child(exchanged, 'ID')?.textContent?.trim() ?? '',
    issueDate: date(text(child(exchanged, 'IssueDateTime'), 'DateTimeString')),
    dueDate: date(text(deep(doc, 'DueDateDateTime')[0], 'DateTimeString')),
    sellerName: child(seller, 'Name')?.textContent?.trim() ?? '',
    sellerVatId: vat?.textContent?.trim() ?? '',
    currency: text(settlement, 'InvoiceCurrencyCode') || 'EUR',
    netCents: sign * cents(text(sums, 'TaxBasisTotalAmount')),
    taxCents: sign * cents(text(sums, 'TaxTotalAmount')),
    grossCents: sign * cents(text(sums, 'GrandTotalAmount')),
    dueCents: sign * cents(text(sums, 'DuePayableAmount') || text(sums, 'GrandTotalAmount')),
    taxRate: mainRate(taxes.map((t) => ({ rate: Number(text(t, 'RateApplicablePercent') || 0), base: cents(text(t, 'BasisAmount')) }))),
    description: child(firstItem, 'Name')?.textContent?.trim() ?? '',
  }
}

function parseUbl(doc: Document, credit: boolean): ImportedInvoice {
  const root = doc.documentElement
  const top = (name: string) => child(root, name)?.textContent?.trim() ?? ''
  const supplier = child(child(root, 'AccountingSupplierParty'), 'Party')
  const totals = child(root, 'LegalMonetaryTotal')
  const taxTotal = child(root, 'TaxTotal')
  const subtotals = taxTotal ? Array.from(taxTotal.children).filter((c) => local(c) === 'TaxSubtotal') : []
  const sign = credit ? -1 : 1
  const line = child(root, credit ? 'CreditNoteLine' : 'InvoiceLine')
  const legal = child(child(supplier, 'PartyLegalEntity'), 'RegistrationName')?.textContent?.trim()
  const vatScheme = supplier ? Array.from(supplier.children).filter((c) => local(c) === 'PartyTaxScheme') : []
  return {
    format: 'UBL',
    number: top('ID'),
    issueDate: date(top('IssueDate')),
    dueDate: date(top('DueDate')),
    sellerName: legal || text(child(supplier, 'PartyName'), 'Name'),
    sellerVatId: vatScheme.map((s) => child(s, 'CompanyID')?.textContent?.trim() ?? '').find(Boolean) ?? '',
    currency: top('DocumentCurrencyCode') || 'EUR',
    netCents: sign * cents(child(totals, 'TaxExclusiveAmount')?.textContent),
    taxCents: sign * cents(child(taxTotal, 'TaxAmount')?.textContent),
    grossCents: sign * cents(child(totals, 'TaxInclusiveAmount')?.textContent),
    dueCents: sign * cents(child(totals, 'PayableAmount')?.textContent),
    taxRate: mainRate(subtotals.map((t) => ({ rate: Number(text(child(t, 'TaxCategory'), 'Percent') || 0), base: cents(child(t, 'TaxableAmount')?.textContent) }))),
    description: text(child(line, 'Item'), 'Name'),
  }
}

/** Reads the embedded factur-x.xml / zugferd-invoice.xml / xrechnung.xml from a hybrid PDF. */
export async function extractXmlFromPdf(bytes: Uint8Array): Promise<string | null> {
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, decodePDFRawStream } = await import('pdf-lib')
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const names = pdf.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
  const embedded = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict)
  const list = embedded?.lookupMaybe(PDFName.of('Names'), PDFArray)
  if (!list) return null
  for (let i = 1; i < list.size(); i += 2) {
    const spec = list.lookupMaybe(i, PDFDict)
    const ef = spec?.lookupMaybe(PDFName.of('EF'), PDFDict)
    const stream = ef?.lookup(PDFName.of('F')) ?? ef?.lookup(PDFName.of('UF'))
    if (!(stream instanceof PDFRawStream)) continue
    const content = new TextDecoder().decode(decodePDFRawStream(stream).decode())
    if (content.includes('CrossIndustryInvoice') || content.includes('urn:oasis:names:specification:ubl')) return content
  }
  return null
}

export function importedToExpense(inv: ImportedInvoice, base: Expense): Expense {
  return {
    ...base,
    date: inv.issueDate || base.date,
    vendor: inv.sellerName,
    invoiceNumber: inv.number,
    description: inv.description,
    grossCents: inv.grossCents,
    vatCents: inv.taxCents,
    taxRate: inv.taxRate,
    currency: inv.currency,
    paidAt: null,
    notes: [inv.sellerVatId && `USt-IdNr. ${inv.sellerVatId}`, inv.dueDate && `fällig ${inv.dueDate}`, `Import ${inv.format}`].filter(Boolean).join(' · '),
  }
}
