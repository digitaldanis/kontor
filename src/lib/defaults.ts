import { defaultDunning } from './dunning'
import type { Company, Customer, InvoiceDocument, Recipient, Settings, TaxMode } from './types'

export const TAX_NOTES: Record<TaxMode, string> = {
  standard: '',
  smallBusiness: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
  reverseCharge:
    'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge) gemäß § 13b UStG bzw. Art. 196 MwStSystRL.',
  intraCommunitySupply: 'Steuerfreie innergemeinschaftliche Lieferung gemäß § 4 Nr. 1b i. V. m. § 6a UStG.',
  thirdCountry: 'Nicht im Inland steuerbare Leistung (Leistungsort im Drittland gemäß § 3a Abs. 2 UStG).',
}

export const TAX_MODE_LABELS: Record<TaxMode, string> = {
  standard: 'Regelbesteuerung',
  smallBusiness: 'Kleinunternehmer (§ 19 UStG)',
  reverseCharge: 'Reverse Charge (EU, B2B)',
  intraCommunitySupply: 'Innergemeinschaftliche Lieferung',
  thirdCountry: 'Drittland (nicht steuerbar)',
}

export const ACCENT_COLORS = ['#0a66d8', '#1f8a5b', '#8e44ad', '#d35400', '#c0392b', '#1d1d1f', '#00838f', '#b8860b']

export const UNITS = ['Std.', 'Tag', 'Stk.', 'Pauschal', 'Monat', 'km', 'Seite', 'Lizenz']

export const TAX_RATES = [19, 7, 0]

export const CURRENCIES = ['EUR', 'CHF', 'USD', 'GBP']

export function emptyCompany(): Company {
  return {
    name: '',
    owner: '',
    addressExtra: '',
    street: '',
    zip: '',
    city: '',
    country: 'DE',
    vatId: '',
    taxNumber: '',
    email: '',
    phone: '',
    website: '',
    bankName: '',
    iban: '',
    bic: '',
    accountHolder: '',
    registerInfo: '',
  }
}

export function defaultSettings(): Settings {
  return {
    id: 'main',
    company: emptyCompany(),
    logo: null,
    defaults: {
      paymentTermDays: 14,
      taxRate: 19,
      introText: 'Vielen Dank für Ihren Auftrag. Für die erbrachten Leistungen erlaube ich mir, folgende Positionen in Rechnung zu stellen:',
      closingText:
        'Bitte überweisen Sie den Rechnungsbetrag bis zum {Fälligkeitsdatum} unter Angabe der Rechnungsnummer {Rechnungsnummer} auf das unten genannte Konto.\n\nVielen Dank für die gute Zusammenarbeit.',
      footerText: '',
      currency: 'EUR',
      layout: 'modern',
      accentColor: ACCENT_COLORS[0],
      unit: 'Std.',
      hourlyRateCents: 8500,
    },
    invoiceNumbers: { pattern: 'RE-{YYYY}-{0001}', counters: {} },
    quoteNumbers: { pattern: 'AN-{YYYY}-{0001}', counters: {} },
    creditNoteNumbers: { pattern: 'GS-{YYYY}-{0001}', counters: {} },
    smallBusiness: false,
    taxation: 'accrual',
    dunning: defaultDunning(),
    timeRounding: { minutes: 0, mode: 'up' },
    smallBusinessNote: TAX_NOTES.smallBusiness,
    onboarded: false,
    updatedAt: new Date().toISOString(),
  }
}

/** A document with every field set to its neutral value. */
export function blankDocument(partial: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    id: '',
    kind: 'invoice',
    status: 'draft',
    number: null,
    customerId: null,
    recipient: emptyRecipient(),
    title: 'Rechnung',
    issueDate: '',
    serviceFrom: '',
    serviceTo: '',
    dueDate: '',
    validUntil: '',
    items: [],
    introText: '',
    closingText: '',
    footerText: '',
    taxMode: 'standard',
    taxNote: '',
    currency: 'EUR',
    layout: 'modern',
    accentColor: ACCENT_COLORS[0],
    buyerReference: '',
    seller: null,
    sellerLogo: null,
    cancelsId: null,
    cancelsNumber: null,
    cancelledById: null,
    sourceQuoteId: null,
    creditsId: null,
    creditsNumber: null,
    creditNotes: [],
    discount: null,
    billingType: 'regular',
    deductions: [],
    settledById: null,
    payments: [],
    language: 'de',
    recurringId: null,
    sentAt: null,
    paidAt: null,
    finalizedAt: null,
    createdAt: '',
    updatedAt: '',
    ...partial,
  }
}

export function emptyRecipient(): Recipient {
  return {
    company: '',
    contactPerson: '',
    addressExtra: '',
    street: '',
    zip: '',
    city: '',
    country: 'DE',
    vatId: '',
    email: '',
    leitwegId: '',
  }
}

export function recipientFromCustomer(c: Customer): Recipient {
  return {
    company: c.company,
    contactPerson: c.contactPerson,
    addressExtra: c.addressExtra,
    street: c.street,
    zip: c.zip,
    city: c.city,
    country: c.country,
    vatId: c.vatId,
    email: c.email,
    leitwegId: c.leitwegId,
  }
}

export function recipientName(r: Pick<Recipient, 'company' | 'contactPerson'>): string {
  return r.company || r.contactPerson || 'Ohne Empfänger'
}

export function customerName(c: Pick<Customer, 'company' | 'contactPerson'>): string {
  return c.company || c.contactPerson || 'Unbenannter Kunde'
}
