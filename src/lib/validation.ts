import { documentTotals } from './calc'
import { t } from './i18n'
import { isEU, looksLikeVatId, vatIdCountry } from './countries'
import type { Company, InvoiceDocument, Recipient, TaxMode } from './types'

export type IssueLevel = 'error' | 'warning' | 'info'

export interface Issue {
  level: IssueLevel
  field: string
  message: string
}

/** Kleinbetragsrechnung, § 33 UStDV. */
export const SMALL_INVOICE_LIMIT_CENTS = 25_000

export function suggestTaxMode(smallBusiness: boolean, sellerCountry: string, r: Pick<Recipient, 'country' | 'vatId'>): TaxMode {
  if (smallBusiness) return 'smallBusiness'
  if (!r.country || r.country === sellerCountry) return 'standard'
  if (isEU(r.country)) return r.vatId.trim() ? 'reverseCharge' : 'standard'
  return 'thirdCountry'
}

function blank(s: string | undefined | null) {
  return !s || !s.trim()
}

/**
 * Checks the mandatory contents of an invoice according to § 14 Abs. 4 UStG
 * and Art. 226 MwStSystRL. Errors block finalization, warnings don't.
 */
export function validateInvoice(doc: InvoiceDocument, seller: Company): Issue[] {
  const issues: Issue[] = []
  const add = (level: IssueLevel, field: string, message: string) => issues.push({ level, field, message })
  const totals = documentTotals(doc)
  const isQuote = doc.kind === 'quote'
  const small = Math.abs(totals.grossCents) <= SMALL_INVOICE_LIMIT_CENTS && doc.taxMode === 'standard'
  const r = doc.recipient
  const crossBorder = doc.taxMode === 'reverseCharge' || doc.taxMode === 'intraCommunitySupply'

  if (blank(seller.name)) add('error', 'seller.name', t('Dein Firmenname fehlt (Einstellungen → Firma).'))
  if (blank(seller.street) || blank(seller.zip) || blank(seller.city))
    add('error', 'seller.address', t('Deine vollständige Anschrift fehlt (Einstellungen → Firma).'))
  if (!isQuote && blank(seller.taxNumber) && blank(seller.vatId))
    add('error', 'seller.tax', t('Steuernummer oder USt-IdNr. fehlt (Einstellungen → Firma).'))
  if (crossBorder && blank(seller.vatId))
    add('error', 'seller.vatId', t('Für Rechnungen ins EU-Ausland brauchst du eine eigene USt-IdNr.'))

  const hasName = !blank(r.company) || !blank(r.contactPerson)
  const hasAddress = !blank(r.street) && !blank(r.zip) && !blank(r.city)
  if (!hasName || !hasAddress) {
    if (small && !isQuote) {
      add('info', 'recipient', t('Kleinbetragsrechnung bis 250 € brutto: Empfängerangaben sind nicht zwingend (§ 33 UStDV).'))
    } else {
      if (!hasName) add('error', 'recipient.name', t('Name oder Firma des Empfängers fehlt.'))
      if (!hasAddress) add('error', 'recipient.address', t('Vollständige Anschrift des Empfängers fehlt (Straße, PLZ, Ort).'))
    }
  }

  if (blank(doc.issueDate)) add('error', 'issueDate', t('Rechnungsdatum fehlt.'))
  if (!isQuote && blank(doc.serviceFrom))
    add('error', 'serviceFrom', t('Leistungsdatum oder Leistungszeitraum fehlt (§ 14 Abs. 4 Nr. 6 UStG).'))
  if (!blank(doc.serviceFrom) && !blank(doc.serviceTo) && doc.serviceTo < doc.serviceFrom)
    add('error', 'serviceTo', t('Das Ende des Leistungszeitraums liegt vor dem Beginn.'))
  if (!isQuote && doc.kind === 'invoice' && !blank(doc.dueDate) && doc.dueDate < doc.issueDate)
    add('warning', 'dueDate', t('Das Fälligkeitsdatum liegt vor dem Rechnungsdatum.'))

  if (doc.items.length === 0) add('error', 'items', t('Füge mindestens eine Position hinzu.'))
  doc.items.forEach((item, i) => {
    if (blank(item.title)) add('error', `items.${i}.title`, t('Position {n}: Art der Leistung fehlt.', { n: i + 1 }))
    if (!item.quantity) add('error', `items.${i}.quantity`, t('Position {n}: Menge fehlt.', { n: i + 1 }))
    if (!item.unitPriceCents) add('warning', `items.${i}.price`, t('Position {n}: Einzelpreis ist 0 €.', { n: i + 1 }))
    if (doc.taxMode === 'standard' && !item.taxRate)
      add('warning', `items.${i}.taxRate`, t('Position {n}: 0 % USt – prüfe, ob ein Befreiungshinweis nötig ist.', { n: i + 1 }))
  })

  if (doc.discount?.type === 'percent' && (doc.discount.value < 0 || doc.discount.value > 100))
    add('error', 'discount', t('Der Rabatt muss zwischen 0 und 100 % liegen.'))
  if (doc.discount?.type === 'amount' && doc.discount.value > Math.abs(totals.lineNetCents))
    add('warning', 'discount', t('Der Rabatt ist höher als die Summe der Positionen.'))
  if (doc.kind === 'invoice' && doc.billingType === 'final' && !doc.deductions.length)
    add('info', 'deductions', t('Schlussrechnung ohne verrechnete Abschläge – wähle unten die Abschlagsrechnungen aus.'))
  if (doc.kind === 'creditNote' && !doc.creditsId)
    add('error', 'creditsId', t('Eine Gutschrift braucht die Rechnung, auf die sie sich bezieht.'))

  if (doc.taxMode !== 'standard' && blank(doc.taxNote))
    add('error', 'taxNote', t('Bei steuerfreien bzw. nicht steuerbaren Umsätzen ist ein Hinweis auf den Grund Pflicht.'))

  if (crossBorder) {
    if (blank(r.vatId)) add('error', 'recipient.vatId', t('Für Reverse Charge ist die USt-IdNr. des Empfängers Pflicht.'))
    else if (!looksLikeVatId(r.vatId)) add('warning', 'recipient.vatId', t('Die USt-IdNr. des Empfängers sieht ungewöhnlich aus.'))
    if (!isEU(r.country) || r.country === seller.country)
      add('warning', 'recipient.country', t('Reverse Charge gilt nur für Empfänger in einem anderen EU-Mitgliedstaat.'))
    if (!blank(r.vatId) && looksLikeVatId(r.vatId) && vatIdCountry(r.vatId) !== r.country)
      add('warning', 'recipient.vatId', t('Länderkennung der USt-IdNr. passt nicht zum Land des Empfängers.'))
  }
  if (doc.taxMode === 'thirdCountry' && isEU(r.country))
    add('warning', 'recipient.country', t('Der Empfänger sitzt in der EU – „Drittland“ passt hier vermutlich nicht.'))
  if (doc.taxMode === 'standard' && r.country && r.country !== seller.country && isEU(r.country) && !blank(r.vatId))
    add('info', 'taxMode', t('Unternehmer im EU-Ausland mit USt-IdNr.: Für B2B-Dienstleistungen gilt meist Reverse Charge.'))
  if (doc.taxMode === 'standard' && r.country && !isEU(r.country))
    add('info', 'taxMode', t('Empfänger außerhalb der EU: Für B2B-Leistungen ist meist „Drittland“ richtig.'))

  if (!isQuote && doc.kind === 'invoice' && doc.taxMode !== 'smallBusiness' && !blank(r.company) && r.country === 'DE')
    add('info', 'einvoice', t('Inländische B2B-Rechnung: Seit 2025 müssen Unternehmen E-Rechnungen empfangen können. Exportiere bei Bedarf zusätzlich als E-Rechnung (XML).'))

  if (!blank(seller.iban) && !isPlausibleIban(seller.iban))
    add('warning', 'seller.iban', t('Deine IBAN scheint ungültig zu sein (Prüfziffer).'))

  return issues
}

export function hasBlockingIssues(issues: Issue[]): boolean {
  return issues.some((i) => i.level === 'error')
}

export function isPlausibleIban(input: string): boolean {
  const iban = input.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch
    for (const digit of v) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder === 1
}

export function formatIban(input: string): string {
  return input.replace(/\s/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim()
}
