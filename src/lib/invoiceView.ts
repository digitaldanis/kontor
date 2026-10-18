import { calculateTotals, type Totals } from './calc'
import { countryName } from './countries'
import { formatDate, formatPeriod } from './dates'
import { formatMoney, formatNumber } from './money'
import { resolvePlaceholders } from './repo'
import { documentLabel } from './status'
import type { Company, InvoiceDocument, LayoutId, Logo, Recipient, Settings } from './types'
import { formatIban } from './validation'

export interface ViewItem {
  pos: number
  title: string
  description: string
  quantity: string
  unit: string
  unitPrice: string
  discount: string
  taxRate: string
  total: string
}

export interface ViewRow {
  label: string
  value: string
  strong?: boolean
}

export interface InvoiceView {
  layout: LayoutId
  accent: string
  label: string
  title: string
  seller: Company
  logo: Logo | null
  senderLine: string
  recipientLines: string[]
  meta: ViewRow[]
  intro: string
  closing: string
  items: ViewItem[]
  showDiscount: boolean
  showTaxColumn: boolean
  totals: ViewRow[]
  taxNote: string
  footerColumns: string[][]
  footerText: string
  isDraft: boolean
  raw: Totals
}

export function sellerFor(doc: InvoiceDocument, settings: Settings): { seller: Company; logo: Logo | null } {
  if (doc.status !== 'draft' && doc.seller) return { seller: doc.seller, logo: doc.sellerLogo }
  return { seller: settings.company, logo: settings.logo }
}

export function recipientLines(r: Recipient, sellerCountry: string): string[] {
  const lines = [r.company, r.contactPerson && r.company ? r.contactPerson : r.company ? '' : r.contactPerson, r.addressExtra, r.street, [r.zip, r.city].filter(Boolean).join(' ')]
  if (r.country && r.country !== sellerCountry) lines.push(countryName(r.country).toUpperCase())
  return lines.filter((l) => l && l.trim())
}

export function buildInvoiceView(doc: InvoiceDocument, settings: Settings): InvoiceView {
  const { seller, logo } = sellerFor(doc, settings)
  const totals = calculateTotals(doc.items, doc.taxMode)
  const money = (c: number) => formatMoney(c, doc.currency)
  const isQuote = doc.kind === 'quote'
  const label = documentLabel(doc)

  const meta: ViewRow[] = []
  meta.push({ label: isQuote ? 'Angebotsnr.' : 'Rechnungsnr.', value: doc.number ?? 'Entwurf', strong: true })
  meta.push({ label: isQuote ? 'Datum' : 'Rechnungsdatum', value: formatDate(doc.issueDate) })
  if (doc.serviceFrom) {
    const period = doc.serviceTo && doc.serviceTo !== doc.serviceFrom
    meta.push({ label: period ? 'Leistungszeitraum' : 'Leistungsdatum', value: formatPeriod(doc.serviceFrom, doc.serviceTo) })
  }
  if (doc.kind === 'invoice' && doc.dueDate) meta.push({ label: 'Fällig am', value: formatDate(doc.dueDate) })
  if (isQuote && doc.validUntil) meta.push({ label: 'Gültig bis', value: formatDate(doc.validUntil) })
  if (doc.cancelsNumber) meta.push({ label: 'Storno zu', value: doc.cancelsNumber })
  if (doc.buyerReference) meta.push({ label: 'Ihre Referenz', value: doc.buyerReference })
  if (doc.recipient.vatId) meta.push({ label: 'Ihre USt-IdNr.', value: doc.recipient.vatId })
  if (doc.taxMode === 'reverseCharge' || doc.taxMode === 'intraCommunitySupply') {
    if (seller.vatId) meta.push({ label: 'Unsere USt-IdNr.', value: seller.vatId })
  }

  const rates = new Set(doc.items.map((i) => i.taxRate))
  const standard = doc.taxMode === 'standard'
  const showTaxColumn = standard && rates.size > 1
  const showDiscount = doc.items.some((i) => i.discountPercent > 0)

  const items: ViewItem[] = doc.items.map((item, i) => ({
    pos: i + 1,
    title: item.title,
    description: item.description,
    quantity: formatNumber(item.quantity, 3),
    unit: item.unit,
    unitPrice: money(item.unitPriceCents),
    discount: item.discountPercent ? `${formatNumber(item.discountPercent)} %` : '',
    taxRate: `${formatNumber(standard ? item.taxRate : 0)} %`,
    total: money(totals.lines[i].netCents),
  }))

  const rows: ViewRow[] = []
  if (standard) {
    rows.push({ label: 'Summe netto', value: money(totals.netCents) })
    for (const g of totals.groups) {
      rows.push({
        label: totals.groups.length > 1 ? `USt ${formatNumber(g.rate)} % auf ${money(g.netCents)}` : `zzgl. ${formatNumber(g.rate)} % USt`,
        value: money(g.taxCents),
      })
    }
    rows.push({ label: 'Gesamtbetrag', value: money(totals.grossCents), strong: true })
  } else if (doc.taxMode === 'smallBusiness') {
    rows.push({ label: 'Gesamtbetrag', value: money(totals.grossCents), strong: true })
  } else {
    rows.push({ label: 'Summe netto', value: money(totals.netCents) })
    rows.push({ label: 'USt 0 %', value: money(0) })
    rows.push({ label: 'Gesamtbetrag', value: money(totals.grossCents), strong: true })
  }

  const cityLine = [seller.zip, seller.city].filter(Boolean).join(' ')
  const footerColumns = [
    [seller.name, seller.owner && seller.owner !== seller.name ? seller.owner : '', seller.addressExtra, seller.street, cityLine],
    [seller.phone && `Tel. ${seller.phone}`, seller.email, seller.website],
    [seller.bankName, seller.iban && `IBAN ${formatIban(seller.iban)}`, seller.bic && `BIC ${seller.bic}`, seller.accountHolder && seller.accountHolder !== seller.name ? `Inhaber ${seller.accountHolder}` : ''],
    [seller.taxNumber && `St.-Nr. ${seller.taxNumber}`, seller.vatId && `USt-IdNr. ${seller.vatId}`, seller.registerInfo],
  ]
    .map((col) => col.filter((l): l is string => !!l && !!l.trim()))
    .filter((col) => col.length)

  return {
    layout: doc.layout,
    accent: doc.accentColor || settings.defaults.accentColor,
    label,
    title: doc.title || label,
    seller,
    logo,
    senderLine: [seller.name, seller.street, cityLine].filter(Boolean).join(' · '),
    recipientLines: recipientLines(doc.recipient, seller.country),
    meta,
    intro: resolvePlaceholders(doc.introText, doc),
    closing: resolvePlaceholders(doc.closingText, doc),
    items,
    showDiscount,
    showTaxColumn,
    totals: rows,
    taxNote: doc.taxNote,
    footerColumns,
    footerText: doc.footerText,
    isDraft: doc.status === 'draft',
    raw: totals,
  }
}
