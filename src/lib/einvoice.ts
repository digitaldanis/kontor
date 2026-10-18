import { calculateTotals, lineTotal } from './calc'
import { formatDate } from './dates'
import type { Company, InvoiceDocument, TaxMode } from './types'

/**
 * UN/CEFACT Cross Industry Invoice (CII) according to EN 16931.
 * "xrechnung" adds the German CIUS identifier, "facturx" is the
 * EN 16931 profile used for ZUGFeRD 2.x / Factur-X hybrid PDFs.
 */
export type EInvoiceProfile = 'xrechnung' | 'facturx'

const GUIDELINES: Record<EInvoiceProfile, string> = {
  xrechnung: 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
  facturx: 'urn:cen.eu:en16931:2017',
}

const UNIT_CODES: Record<string, string> = {
  'Std.': 'HUR',
  Std: 'HUR',
  h: 'HUR',
  Stunde: 'HUR',
  Stunden: 'HUR',
  Tag: 'DAY',
  Tage: 'DAY',
  'Stk.': 'H87',
  Stück: 'H87',
  Pauschal: 'LS',
  Monat: 'MON',
  km: 'KMT',
  kg: 'KGM',
  Seite: 'C62',
  Lizenz: 'C62',
}

interface Category {
  code: string
  reasonCode?: string
  reason?: string
}

function category(mode: TaxMode, rate: number, note: string): Category {
  switch (mode) {
    case 'smallBusiness':
      return { code: 'E', reason: note || 'Kleinunternehmer gemäß § 19 UStG' }
    case 'reverseCharge':
      return { code: 'AE', reasonCode: 'VATEX-EU-AE', reason: note || 'Reverse charge' }
    case 'intraCommunitySupply':
      return { code: 'K', reasonCode: 'VATEX-EU-IC', reason: note || 'Intra-Community supply' }
    case 'thirdCountry':
      return { code: 'O', reasonCode: 'VATEX-EU-O', reason: note || 'Not subject to VAT' }
    default:
      return rate > 0 ? { code: 'S' } : { code: 'Z' }
  }
}

function esc(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string)
}

function amount(cents: number): string {
  return (cents / 100).toFixed(2)
}

function qty(n: number): string {
  return String(Math.round(n * 10000) / 10000)
}

function date102(iso: string): string {
  return `<udt:DateTimeString format="102">${iso.replace(/-/g, '')}</udt:DateTimeString>`
}

function rateStr(n: number): string {
  return String(Math.round(n * 100) / 100)
}

function tag(name: string, content: string | undefined | null, attrs = ''): string {
  if (content === undefined || content === null || content === '') return ''
  return `<${name}${attrs ? ' ' + attrs : ''}>${content}</${name}>`
}

function address(a: { street: string; zip: string; city: string; country: string; addressExtra?: string }) {
  return `<ram:PostalTradeAddress>${tag('ram:PostcodeCode', esc(a.zip))}${tag('ram:LineOne', esc(a.street))}${tag('ram:LineTwo', esc(a.addressExtra ?? ''))}${tag('ram:CityName', esc(a.city))}<ram:CountryID>${esc(a.country || 'DE')}</ram:CountryID></ram:PostalTradeAddress>`
}

export interface EInvoiceIssue {
  message: string
}

/** Additional checks for the e-invoice on top of the § 14 UStG validation. */
export function eInvoiceIssues(doc: InvoiceDocument, seller: Company, profile: EInvoiceProfile): EInvoiceIssue[] {
  const issues: EInvoiceIssue[] = []
  if (doc.status === 'draft') issues.push({ message: 'Die Rechnung muss zuerst abgeschlossen werden (Rechnungsnummer).' })
  if (!seller.email) issues.push({ message: 'Deine E-Mail-Adresse fehlt (elektronische Adresse des Verkäufers, BT-34).' })
  if (profile === 'xrechnung') {
    if (!doc.recipient.email) issues.push({ message: 'E-Mail des Empfängers fehlt (elektronische Adresse des Käufers, BT-49).' })
    if (!seller.phone) issues.push({ message: 'Deine Telefonnummer fehlt (Kontakt des Verkäufers, BT-42).' })
    if (!doc.recipient.leitwegId && !doc.buyerReference) issues.push({ message: 'Keine Leitweg-ID oder Käuferreferenz angegeben (BT-10). Für öffentliche Auftraggeber ist die Leitweg-ID Pflicht; sonst wird „n/a“ eingetragen.' })
  }
  if (!seller.iban) issues.push({ message: 'Keine IBAN hinterlegt – die Zahlungsart wird ohne Kontoverbindung exportiert.' })
  if (doc.kind === 'quote') issues.push({ message: 'Angebote können nicht als E-Rechnung exportiert werden.' })
  return issues
}

export function buildCii(doc: InvoiceDocument, sellerInput: Company, profile: EInvoiceProfile): string {
  const seller = sellerInput
  const r = doc.recipient
  const isCredit = doc.kind === 'cancellation'
  const sign = isCredit ? -1 : 1
  const items = doc.items.map((i) => ({ ...i, quantity: i.quantity * sign }))
  const totals = calculateTotals(items, doc.taxMode)
  const currency = doc.currency || 'EUR'
  const chargeTax = doc.taxMode === 'standard'

  const lines = items
    .map((item, idx) => {
      const lt = lineTotal(item)
      const rate = chargeTax ? item.taxRate : 0
      const cat = category(doc.taxMode, rate, doc.taxNote)
      const allowance = lt.discountCents
        ? `<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator><ram:CalculationPercent>${rateStr(item.discountPercent)}</ram:CalculationPercent><ram:BasisAmount>${amount(lt.grossListCents)}</ram:BasisAmount><ram:ActualAmount>${amount(lt.discountCents)}</ram:ActualAmount><ram:Reason>Rabatt</ram:Reason></ram:SpecifiedTradeAllowanceCharge>`
        : ''
      return `<ram:IncludedSupplyChainTradeLineItem>
<ram:AssociatedDocumentLineDocument><ram:LineID>${idx + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
<ram:SpecifiedTradeProduct><ram:Name>${esc(item.title || 'Leistung')}</ram:Name>${tag('ram:Description', esc(item.description))}</ram:SpecifiedTradeProduct>
<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${amount(item.unitPriceCents)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${UNIT_CODES[item.unit] ?? 'C62'}">${qty(item.quantity)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
<ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${cat.code}</ram:CategoryCode>${cat.code === 'O' ? '' : `<ram:RateApplicablePercent>${rateStr(rate)}</ram:RateApplicablePercent>`}</ram:ApplicableTradeTax>${allowance}<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amount(lt.netCents)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement>
</ram:IncludedSupplyChainTradeLineItem>`
    })
    .join('\n')

  const taxes = totals.groups
    .map((g) => {
      const cat = category(doc.taxMode, g.rate, doc.taxNote)
      return `<ram:ApplicableTradeTax><ram:CalculatedAmount>${amount(g.taxCents)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>${tag('ram:ExemptionReason', cat.reason && esc(cat.reason))}<ram:BasisAmount>${amount(g.netCents)}</ram:BasisAmount><ram:CategoryCode>${cat.code}</ram:CategoryCode>${tag('ram:ExemptionReasonCode', cat.reasonCode)}<ram:RateApplicablePercent>${rateStr(g.rate)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`
    })
    .join('')

  // BR-CO-26 needs some seller identifier; fall back to the tax number when no VAT ID is sent
  const sendsVatId = !!seller.vatId && doc.taxMode !== 'thirdCountry'
  const sellerId = sendsVatId ? '' : seller.taxNumber || seller.vatId
  const sellerTax = [
    sendsVatId ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(seller.vatId.replace(/\s/g, ''))}</ram:ID></ram:SpecifiedTaxRegistration>` : '',
    seller.taxNumber ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${esc(seller.taxNumber)}</ram:ID></ram:SpecifiedTaxRegistration>` : '',
  ].join('')

  const sellerContact =
    seller.phone || seller.email
      ? `<ram:DefinedTradeContact><ram:PersonName>${esc(seller.owner || seller.name)}</ram:PersonName>${seller.phone ? `<ram:TelephoneUniversalCommunication><ram:CompleteNumber>${esc(seller.phone)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>` : ''}${seller.email ? `<ram:EmailURIUniversalCommunication><ram:URIID>${esc(seller.email)}</ram:URIID></ram:EmailURIUniversalCommunication>` : ''}</ram:DefinedTradeContact>`
      : ''

  const buyerName = r.company || r.contactPerson || 'Unbekannt'
  const buyerContact = r.company && r.contactPerson ? `<ram:DefinedTradeContact><ram:PersonName>${esc(r.contactPerson)}</ram:PersonName></ram:DefinedTradeContact>` : ''
  const buyerReference = r.leitwegId || doc.buyerReference || (profile === 'xrechnung' ? 'n/a' : '')

  const singleDate = doc.serviceFrom && (!doc.serviceTo || doc.serviceTo === doc.serviceFrom)
  const delivery = singleDate
    ? `<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime>${date102(doc.serviceFrom)}</ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>`
    : ''
  const period =
    doc.serviceFrom && doc.serviceTo && doc.serviceTo !== doc.serviceFrom
      ? `<ram:BillingSpecifiedPeriod><ram:StartDateTime>${date102(doc.serviceFrom)}</ram:StartDateTime><ram:EndDateTime>${date102(doc.serviceTo)}</ram:EndDateTime></ram:BillingSpecifiedPeriod>`
      : ''

  const iban = seller.iban.replace(/\s/g, '')
  const paymentMeans = iban
    ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:Information>SEPA-Überweisung</ram:Information><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${esc(iban)}</ram:IBANID>${tag('ram:AccountName', esc(seller.accountHolder || seller.name))}</ram:PayeePartyCreditorFinancialAccount>${seller.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${esc(seller.bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}</ram:SpecifiedTradeSettlementPaymentMeans>`
    : `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>1</ram:TypeCode></ram:SpecifiedTradeSettlementPaymentMeans>`

  const terms =
    doc.kind === 'invoice' && doc.dueDate
      ? `<ram:SpecifiedTradePaymentTerms><ram:Description>Zahlbar ohne Abzug bis ${formatDate(doc.dueDate)}</ram:Description><ram:DueDateDateTime>${date102(doc.dueDate)}</ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>`
      : `<ram:SpecifiedTradePaymentTerms><ram:Description>${isCredit ? 'Gutschrift' : 'Sofort fällig'}</ram:Description></ram:SpecifiedTradePaymentTerms>`

  const notes = [doc.taxNote, doc.cancelsNumber ? `Stornorechnung zu ${doc.cancelsNumber}` : '', seller.registerInfo]
    .filter(Boolean)
    .map((n) => `<ram:IncludedNote><ram:Content>${esc(n)}</ram:Content></ram:IncludedNote>`)
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
<rsm:ExchangedDocumentContext>
${profile === 'xrechnung' ? '<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>' : ''}<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${GUIDELINES[profile]}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
</rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument>
<ram:ID>${esc(doc.number ?? 'ENTWURF')}</ram:ID>
<ram:TypeCode>${isCredit ? '381' : '380'}</ram:TypeCode>
<ram:IssueDateTime>${date102(doc.issueDate)}</ram:IssueDateTime>
${notes}
</rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
${lines}
<ram:ApplicableHeaderTradeAgreement>
${tag('ram:BuyerReference', esc(buyerReference))}
<ram:SellerTradeParty>${sellerId ? `<ram:ID>${esc(sellerId)}</ram:ID>` : ''}<ram:Name>${esc(seller.name)}</ram:Name>${sellerContact}${address(seller)}${seller.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(seller.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}${sellerTax}</ram:SellerTradeParty>
<ram:BuyerTradeParty><ram:Name>${esc(buyerName)}</ram:Name>${buyerContact}${address(r)}${r.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(r.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}${r.vatId ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(r.vatId.replace(/\s/g, ''))}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}</ram:BuyerTradeParty>
</ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeDelivery>${delivery}</ram:ApplicableHeaderTradeDelivery>
<ram:ApplicableHeaderTradeSettlement>
${tag('ram:PaymentReference', esc(doc.number ?? ''))}
<ram:InvoiceCurrencyCode>${currency}</ram:InvoiceCurrencyCode>
${paymentMeans}
${taxes}
${period}
${terms}
<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>${amount(totals.netCents)}</ram:LineTotalAmount><ram:TaxBasisTotalAmount>${amount(totals.netCents)}</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="${currency}">${amount(totals.taxCents)}</ram:TaxTotalAmount><ram:GrandTotalAmount>${amount(totals.grossCents)}</ram:GrandTotalAmount><ram:DuePayableAmount>${amount(totals.grossCents)}</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>
${doc.cancelsNumber ? `<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${esc(doc.cancelsNumber)}</ram:IssuerAssignedID></ram:InvoiceReferencedDocument>` : ''}
</ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`.replace(/\n\n+/g, '\n')
}
