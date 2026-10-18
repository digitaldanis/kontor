import { documentTotals, type Totals } from './calc'
import { countryName } from './countries'
import { docText, formatDocDate, formatDocMoney, formatDocNumber, formatDocPeriod, type DocText } from './docText'
import { resolvePlaceholders } from './repo'
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
  detail?: string
}

export interface ViewLabels {
  pos: string
  item: string
  quantity: string
  unitPrice: string
  discount: string
  vat: string
  total: string
  noItems: string
  page: (n: number, of: number) => string
  draft: string
}

export interface InvoiceView {
  lang: string
  labels: ViewLabels
  /** "amount" hides quantity and price columns, used for reminders. */
  columns: 'full' | 'amount'
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

export function recipientLines(r: Recipient, sellerCountry: string, lang: InvoiceDocument['language'] = 'de'): string[] {
  const lines = [r.company, r.contactPerson && r.company ? r.contactPerson : r.company ? '' : r.contactPerson, r.addressExtra, r.street, [r.zip, r.city].filter(Boolean).join(' ')]
  if (r.country && r.country !== sellerCountry) lines.push(countryName(r.country, lang).toUpperCase())
  return lines.filter((l) => l && l.trim())
}

export function docTitleLabel(doc: Pick<InvoiceDocument, 'kind' | 'billingType' | 'language'>): string {
  const t = docText(doc.language)
  if (doc.kind === 'quote') return t.quote
  if (doc.kind === 'cancellation') return t.cancellation
  if (doc.kind === 'creditNote') return t.creditNote
  if (doc.billingType === 'downPayment') return t.downPayment
  if (doc.billingType === 'final') return t.finalInvoice
  return t.invoice
}

export function viewLabels(t: DocText): ViewLabels {
  return { pos: t.pos, item: t.item, quantity: t.quantity, unitPrice: t.unitPrice, discount: t.discount, vat: t.vat, total: t.total, noItems: t.noItems, page: t.page, draft: t.draft }
}

export function footerColumns(seller: Company, t: DocText): string[][] {
  const cityLine = [seller.zip, seller.city].filter(Boolean).join(' ')
  return [
    [seller.name, seller.owner && seller.owner !== seller.name ? seller.owner : '', seller.addressExtra, seller.street, cityLine],
    [seller.phone && `${t.phone} ${seller.phone}`, seller.email, seller.website],
    [seller.bankName, seller.iban && `IBAN ${formatIban(seller.iban)}`, seller.bic && `BIC ${seller.bic}`, seller.accountHolder && seller.accountHolder !== seller.name ? `${t.holder} ${seller.accountHolder}` : ''],
    [seller.taxNumber && `${t.taxNumber} ${seller.taxNumber}`, seller.vatId && `${t.vatId} ${seller.vatId}`, seller.registerInfo],
  ]
    .map((col) => col.filter((l): l is string => !!l && !!l.trim()))
    .filter((col) => col.length)
}

export function senderLine(seller: Company): string {
  return [seller.name, seller.street, [seller.zip, seller.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
}

export function buildInvoiceView(doc: InvoiceDocument, settings: Settings): InvoiceView {
  const { seller, logo } = sellerFor(doc, settings)
  const lang = doc.language ?? 'de'
  const t = docText(lang)
  const totals = documentTotals(doc)
  const money = (c: number) => formatDocMoney(c, doc.currency, lang)
  const num = (n: number, max = 2) => formatDocNumber(n, lang, max)
  const isQuote = doc.kind === 'quote'
  const label = docTitleLabel(doc)

  const meta: ViewRow[] = []
  meta.push({ label: isQuote ? t.quoteNo : doc.kind === 'creditNote' ? t.creditNoteNo : t.invoiceNo, value: doc.number ?? t.draft, strong: true })
  meta.push({ label: isQuote ? t.date : t.invoiceDate, value: formatDocDate(doc.issueDate, lang) })
  if (doc.serviceFrom) {
    const period = doc.serviceTo && doc.serviceTo !== doc.serviceFrom
    meta.push({ label: period ? t.servicePeriod : t.serviceDate, value: formatDocPeriod(doc.serviceFrom, doc.serviceTo, lang) })
  }
  if (doc.kind === 'invoice' && doc.dueDate) meta.push({ label: t.dueDate, value: formatDocDate(doc.dueDate, lang) })
  if (isQuote && doc.validUntil) meta.push({ label: t.validUntil, value: formatDocDate(doc.validUntil, lang) })
  if (doc.cancelsNumber) meta.push({ label: t.cancels, value: doc.cancelsNumber })
  if (doc.creditsNumber) meta.push({ label: t.credits, value: doc.creditsNumber })
  if (doc.buyerReference) meta.push({ label: t.yourReference, value: doc.buyerReference })
  if (doc.recipient.vatId) meta.push({ label: t.yourVatId, value: doc.recipient.vatId })
  if (doc.taxMode === 'reverseCharge' || doc.taxMode === 'intraCommunitySupply') {
    if (seller.vatId) meta.push({ label: t.ourVatId, value: seller.vatId })
  }

  const rates = new Set(doc.items.map((i) => i.taxRate))
  const standard = doc.taxMode === 'standard'
  const showTaxColumn = standard && rates.size > 1
  const showDiscount = doc.items.some((i) => i.discountPercent > 0)

  const items: ViewItem[] = doc.items.map((item, i) => ({
    pos: i + 1,
    title: item.title,
    description: item.description,
    quantity: num(item.quantity, 3),
    unit: item.unit,
    unitPrice: money(item.unitPriceCents),
    discount: item.discountPercent ? `${num(item.discountPercent)} %` : '',
    taxRate: `${num(standard ? item.taxRate : 0)} %`,
    total: money(totals.lines[i].netCents),
  }))

  const rows: ViewRow[] = []
  const discountLabel = doc.discount?.type === 'percent' ? `${t.lessDiscount} ${num(doc.discount.value)} %` : t.lessDiscount
  const hasPrepaid = totals.prepaidCents !== 0
  if (totals.allowanceCents) {
    rows.push({ label: t.subtotal, value: money(totals.lineNetCents) })
    rows.push({ label: discountLabel, value: money(-totals.allowanceCents) })
  }
  if (standard) {
    rows.push({ label: t.netTotal, value: money(totals.netCents) })
    for (const g of totals.groups) {
      rows.push({
        label: totals.groups.length > 1 ? t.vatOn(num(g.rate), money(g.netCents)) : t.plusVat(num(g.rate)),
        value: money(g.taxCents),
      })
    }
  } else if (doc.taxMode !== 'smallBusiness') {
    rows.push({ label: t.netTotal, value: money(totals.netCents) })
    rows.push({ label: t.vatZero, value: money(0) })
  }
  rows.push({ label: t.grandTotal, value: money(totals.grossCents), strong: !hasPrepaid })
  if (hasPrepaid) {
    for (const d of doc.deductions) {
      const net = d.groups.reduce((s, g) => s + g.netCents, 0)
      const tax = d.groups.reduce((s, g) => s + g.taxCents, 0)
      rows.push({ label: t.lessDownPayment(d.number, formatDocDate(d.issueDate, lang)), value: money(-(net + tax)), detail: standard ? t.downPaymentDetail(money(net), money(tax)) : undefined })
    }
    rows.push({ label: t.amountDue, value: money(totals.dueCents), strong: true })
  }

  return {
    lang,
    labels: viewLabels(t),
    columns: 'full',
    layout: doc.layout,
    accent: doc.accentColor || settings.defaults.accentColor,
    label,
    title: doc.title || label,
    seller,
    logo,
    senderLine: senderLine(seller),
    recipientLines: recipientLines(doc.recipient, seller.country, lang),
    meta,
    intro: resolvePlaceholders(doc.introText, doc),
    closing: resolvePlaceholders(doc.closingText, doc),
    items,
    showDiscount,
    showTaxColumn,
    totals: rows,
    taxNote: doc.taxNote,
    footerColumns: footerColumns(seller, t),
    footerText: doc.footerText,
    isDraft: doc.status === 'draft',
    raw: totals,
  }
}
