import { addDays, today } from './dates'
import { emptyRecipient, TAX_NOTES } from './defaults'
import type { InvoiceDocument, LayoutId, Settings } from './types'

/** A representative invoice used for layout previews in the settings. */
export function sampleDocument(settings: Settings, layout?: LayoutId): InvoiceDocument {
  const d = today()
  const rate = settings.smallBusiness ? 0 : settings.defaults.taxRate
  return {
    id: 'sample',
    kind: 'invoice',
    status: 'draft',
    number: null,
    customerId: null,
    recipient: { ...emptyRecipient(), company: 'Beispiel GmbH', contactPerson: 'Frau Erika Mustermann', street: 'Musterweg 12', zip: '20095', city: 'Hamburg' },
    title: 'Rechnung',
    issueDate: d,
    serviceFrom: addDays(d, -30),
    serviceTo: addDays(d, -1),
    dueDate: addDays(d, settings.defaults.paymentTermDays),
    validUntil: '',
    items: [
      { id: '1', title: 'Konzeption und Workshop', description: 'Abstimmung der Anforderungen vor Ort', quantity: 6, unit: 'Std.', unitPriceCents: settings.defaults.hourlyRateCents, taxRate: rate, discountPercent: 0 },
      { id: '2', title: 'Umsetzung', description: 'Design und Entwicklung der Startseite', quantity: 14.5, unit: 'Std.', unitPriceCents: settings.defaults.hourlyRateCents, taxRate: rate, discountPercent: 0 },
      { id: '3', title: 'Hosting', description: '', quantity: 1, unit: 'Monat', unitPriceCents: 1900, taxRate: rate, discountPercent: 0 },
    ],
    introText: settings.defaults.introText,
    closingText: settings.defaults.closingText,
    footerText: settings.defaults.footerText,
    taxMode: settings.smallBusiness ? 'smallBusiness' : 'standard',
    taxNote: settings.smallBusiness ? settings.smallBusinessNote || TAX_NOTES.smallBusiness : '',
    currency: settings.defaults.currency,
    layout: layout ?? settings.defaults.layout,
    accentColor: settings.defaults.accentColor,
    buyerReference: '',
    seller: null,
    sellerLogo: null,
    cancelsId: null,
    cancelsNumber: null,
    cancelledById: null,
    sourceQuoteId: null,
    paidAt: null,
    finalizedAt: null,
    createdAt: '',
    updatedAt: '',
  }
}
