import type { DocumentTexts, Language, TaxMode } from './types'

/** Labels printed on documents. The customer gets the document in their language. */
export interface DocText {
  locale: string
  invoice: string
  downPayment: string
  finalInvoice: string
  cancellation: string
  creditNote: string
  quote: string
  reminder: string
  invoiceNo: string
  quoteNo: string
  creditNoteNo: string
  date: string
  invoiceDate: string
  serviceDate: string
  servicePeriod: string
  dueDate: string
  validUntil: string
  cancels: string
  credits: string
  yourReference: string
  yourVatId: string
  ourVatId: string
  pos: string
  item: string
  quantity: string
  unitPrice: string
  discount: string
  vat: string
  total: string
  noItems: string
  subtotal: string
  netTotal: string
  lessDiscount: string
  plusVat: (rate: string) => string
  vatOn: (rate: string, base: string) => string
  vatZero: string
  grandTotal: string
  lessDownPayment: (number: string, date: string) => string
  downPaymentDetail: (net: string, tax: string) => string
  amountDue: string
  page: (n: number, of: number) => string
  draft: string
  phone: string
  holder: string
  taxNumber: string
  vatId: string
  paymentTerms: (date: string) => string
  dueImmediately: string
  creditTerms: string
  taxNotes: Record<TaxMode, string>
}

const de: DocText = {
  locale: 'de-DE',
  invoice: 'Rechnung',
  downPayment: 'Abschlagsrechnung',
  finalInvoice: 'Schlussrechnung',
  cancellation: 'Stornorechnung',
  creditNote: 'Gutschrift',
  quote: 'Angebot',
  reminder: 'Zahlungserinnerung',
  invoiceNo: 'Rechnungsnr.',
  quoteNo: 'Angebotsnr.',
  creditNoteNo: 'Gutschriftsnr.',
  date: 'Datum',
  invoiceDate: 'Rechnungsdatum',
  serviceDate: 'Leistungsdatum',
  servicePeriod: 'Leistungszeitraum',
  dueDate: 'Fällig am',
  validUntil: 'Gültig bis',
  cancels: 'Storno zu',
  credits: 'Korrektur zu',
  yourReference: 'Ihre Referenz',
  yourVatId: 'Ihre USt-IdNr.',
  ourVatId: 'Unsere USt-IdNr.',
  pos: 'Pos.',
  item: 'Leistung',
  quantity: 'Menge',
  unitPrice: 'Einzelpreis',
  discount: 'Rabatt',
  vat: 'USt',
  total: 'Gesamt',
  noItems: 'Noch keine Positionen',
  subtotal: 'Summe Positionen',
  netTotal: 'Summe netto',
  lessDiscount: 'abzgl. Rabatt',
  plusVat: (rate) => `zzgl. ${rate} % USt`,
  vatOn: (rate, base) => `USt ${rate} % auf ${base}`,
  vatZero: 'USt 0 %',
  grandTotal: 'Gesamtbetrag',
  lessDownPayment: (number, date) => `abzgl. Abschlag ${number} vom ${date}`,
  downPaymentDetail: (net, tax) => `netto ${net}, USt ${tax}`,
  amountDue: 'Zu zahlen',
  page: (n, of) => `Seite ${n} von ${of}`,
  draft: 'Entwurf',
  phone: 'Tel.',
  holder: 'Inhaber',
  taxNumber: 'St.-Nr.',
  vatId: 'USt-IdNr.',
  paymentTerms: (date) => `Zahlbar ohne Abzug bis ${date}`,
  dueImmediately: 'Sofort fällig',
  creditTerms: 'Gutschrift',
  taxNotes: {
    standard: '',
    smallBusiness: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
    reverseCharge: 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge) gemäß § 13b UStG bzw. Art. 196 MwStSystRL.',
    intraCommunitySupply: 'Steuerfreie innergemeinschaftliche Lieferung gemäß § 4 Nr. 1b i. V. m. § 6a UStG.',
    thirdCountry: 'Nicht im Inland steuerbare Leistung (Leistungsort im Drittland gemäß § 3a Abs. 2 UStG).',
  },
}

const en: DocText = {
  locale: 'en-GB',
  invoice: 'Invoice',
  downPayment: 'Down payment invoice',
  finalInvoice: 'Final invoice',
  cancellation: 'Cancellation invoice',
  creditNote: 'Credit note',
  quote: 'Quotation',
  reminder: 'Payment reminder',
  invoiceNo: 'Invoice no.',
  quoteNo: 'Quotation no.',
  creditNoteNo: 'Credit note no.',
  date: 'Date',
  invoiceDate: 'Invoice date',
  serviceDate: 'Date of supply',
  servicePeriod: 'Service period',
  dueDate: 'Due date',
  validUntil: 'Valid until',
  cancels: 'Cancels',
  credits: 'Corrects',
  yourReference: 'Your reference',
  yourVatId: 'Your VAT ID',
  ourVatId: 'Our VAT ID',
  pos: 'No.',
  item: 'Description',
  quantity: 'Qty',
  unitPrice: 'Unit price',
  discount: 'Discount',
  vat: 'VAT',
  total: 'Amount',
  noItems: 'No items yet',
  subtotal: 'Subtotal',
  netTotal: 'Total net',
  lessDiscount: 'Less discount',
  plusVat: (rate) => `VAT ${rate} %`,
  vatOn: (rate, base) => `VAT ${rate} % on ${base}`,
  vatZero: 'VAT 0 %',
  grandTotal: 'Total',
  lessDownPayment: (number, date) => `Less down payment ${number} of ${date}`,
  downPaymentDetail: (net, tax) => `net ${net}, VAT ${tax}`,
  amountDue: 'Amount due',
  page: (n, of) => `Page ${n} of ${of}`,
  draft: 'Draft',
  phone: 'Phone',
  holder: 'Account holder',
  taxNumber: 'Tax no.',
  vatId: 'VAT ID',
  paymentTerms: (date) => `Payable without deduction by ${date}`,
  dueImmediately: 'Due immediately',
  creditTerms: 'Credit note',
  taxNotes: {
    standard: '',
    smallBusiness: 'No VAT is charged in accordance with § 19 UStG (small business regulation).',
    reverseCharge: 'Reverse charge: VAT is payable by the recipient of the service (Art. 196 EU VAT Directive, § 13b UStG).',
    intraCommunitySupply: 'VAT-exempt intra-Community supply (Art. 138 EU VAT Directive, § 4 No. 1b UStG).',
    thirdCountry: 'Not subject to German VAT, place of supply outside the EU (§ 3a (2) UStG).',
  },
}

export const DOC_TEXT: Record<Language, DocText> = { de, en }

export function docText(lang: Language | undefined): DocText {
  return DOC_TEXT[lang ?? 'de'] ?? de
}

/** Default intro and closing texts per language for new documents. */
export const DEFAULT_TEXTS: Record<Language, { intro: string; closing: string; quoteIntro: string; quoteClosing: string }> = {
  de: {
    intro: 'Vielen Dank für Ihren Auftrag. Für die erbrachten Leistungen erlaube ich mir, folgende Positionen in Rechnung zu stellen:',
    closing:
      'Bitte überweisen Sie den Rechnungsbetrag bis zum {Fälligkeitsdatum} unter Angabe der Rechnungsnummer {Rechnungsnummer} auf das unten genannte Konto.\n\nVielen Dank für die gute Zusammenarbeit.',
    quoteIntro: 'Vielen Dank für Ihre Anfrage. Gerne unterbreite ich Ihnen folgendes Angebot:',
    quoteClosing: 'Das Angebot ist gültig bis zum {Gültig bis}. Ich freue mich auf Ihre Rückmeldung.',
  },
  en: {
    intro: 'Thank you for your order. For the services provided, I am pleased to invoice the following items:',
    closing: 'Please transfer the total amount by {Fälligkeitsdatum}, quoting invoice number {Rechnungsnummer}, to the bank account below.\n\nThank you for working with me.',
    quoteIntro: 'Thank you for your enquiry. I am pleased to offer the following:',
    quoteClosing: 'This quotation is valid until {Gültig bis}. I look forward to hearing from you.',
  },
}

const dateFormats = new Map<string, Intl.DateTimeFormat>()
const moneyFormats = new Map<string, Intl.NumberFormat>()

export function formatDocDate(iso: string | null | undefined, lang: Language | undefined): string {
  if (!iso) return '–'
  const locale = docText(lang).locale
  let fmt = dateFormats.get(locale)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
    dateFormats.set(locale, fmt)
  }
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return fmt.format(new Date(y, (m || 1) - 1, d || 1, 12))
}

export function formatDocMoney(cents: number, currency: string, lang: Language | undefined): string {
  const locale = docText(lang).locale
  const key = `${locale}|${currency}`
  let fmt = moneyFormats.get(key)
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, { style: 'currency', currency })
    moneyFormats.set(key, fmt)
  }
  return fmt.format(cents / 100)
}

export function formatDocNumber(value: number, lang: Language | undefined, maxFraction = 2): string {
  return value.toLocaleString(docText(lang).locale, { maximumFractionDigits: maxFraction })
}

export function formatDocPeriod(from: string, to: string, lang: Language | undefined): string {
  if (!from && !to) return '–'
  if (!to || from === to) return formatDocDate(from || to, lang)
  return `${formatDocDate(from, lang)} – ${formatDocDate(to, lang)}`
}

export function defaultDocumentTexts(lang: Language): DocumentTexts {
  return { ...DEFAULT_TEXTS[lang], smallBusinessNote: DOC_TEXT[lang].taxNotes.smallBusiness }
}

/** Texts Kontor writes into generated documents, in the document's language. */
export const GENERATED = {
  de: {
    cancelIntro: (number: string, date: string) => `Hiermit stornieren wir die Rechnung ${number} vom ${date} vollständig.`,
    cancelRefund: 'Der bereits gezahlte Betrag wird Ihnen erstattet.',
    cancelVoid: 'Die ursprüngliche Rechnung ist damit gegenstandslos. Bitte nicht überweisen.',
    creditTitle: 'Rechnungskorrektur',
    creditIntro: (number: string, date: string) => `Zu unserer Rechnung ${number} vom ${date} schreiben wir Ihnen folgende Beträge gut:`,
    creditRefund: 'Den Betrag erstatten wir Ihnen auf Ihr Konto.',
    creditOffset: 'Der Betrag wird mit der offenen Rechnung verrechnet.',
    creditRemainder: (number: string) => `Gutschrift zu Rechnung ${number}`,
    remainder: 'Restbetrag',
    remainderRate: (rate: number) => `Restbetrag, ${rate} % USt`,
    work: 'Arbeitszeit',
    services: 'Leistungen',
    servicesOn: (date: string) => `Leistungen am ${date}`,
  },
  en: {
    cancelIntro: (number: string, date: string) => `We hereby cancel invoice ${number} of ${date} in full.`,
    cancelRefund: 'The amount already paid will be refunded to you.',
    cancelVoid: 'The original invoice is void. Please do not pay it.',
    creditTitle: 'Credit note',
    creditIntro: (number: string, date: string) => `With reference to our invoice ${number} of ${date}, we credit you the following amounts:`,
    creditRefund: 'We will refund the amount to your account.',
    creditOffset: 'The amount will be offset against the open invoice.',
    creditRemainder: (number: string) => `Credit for invoice ${number}`,
    remainder: 'Remaining amount',
    remainderRate: (rate: number) => `Remaining amount, ${rate} % VAT`,
    work: 'Work',
    services: 'Services',
    servicesOn: (date: string) => `Services on ${date}`,
  },
}
