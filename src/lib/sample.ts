import { addDays, today } from './dates'
import { blankDocument, emptyRecipient } from './defaults'
import type { InvoiceDocument, LayoutId, Settings } from './types'

/** A representative invoice used for layout previews in the settings. */
export function sampleDocument(settings: Settings, layout?: LayoutId): InvoiceDocument {
  const d = today()
  const rate = settings.smallBusiness ? 0 : settings.defaults.taxRate
  return blankDocument({
    id: 'sample',
    kind: 'invoice',
    status: 'draft',
    number: null,
    customerId: null,
    recipient: { ...emptyRecipient(), company: 'Example Ltd', contactPerson: 'Jane Doe', street: 'Musterweg 12', zip: '20095', city: 'Hamburg' },
    issueDate: d,
    serviceFrom: addDays(d, -30),
    serviceTo: addDays(d, -1),
    dueDate: addDays(d, settings.defaults.paymentTermDays),
    validUntil: '',
    items: [
      { id: '1', title: 'Concept and workshop', description: 'Requirements gathered on site', quantity: 6, unit: 'Std.', unitPriceCents: settings.defaults.hourlyRateCents, taxRate: rate, discountPercent: 0 },
      { id: '2', title: 'Implementation', description: 'Design and development of the home page', quantity: 14.5, unit: 'Std.', unitPriceCents: settings.defaults.hourlyRateCents, taxRate: rate, discountPercent: 0 },
      { id: '3', title: 'Hosting', description: '', quantity: 1, unit: 'Monat', unitPriceCents: 1900, taxRate: rate, discountPercent: 0 },
    ],
    introText: settings.texts[settings.documentLanguage].intro,
    closingText: settings.texts[settings.documentLanguage].closing,
    language: settings.documentLanguage,
    title: settings.documentLanguage === 'en' ? 'Invoice' : 'Rechnung',
    footerText: settings.defaults.footerText,
    taxMode: settings.smallBusiness ? 'smallBusiness' : 'standard',
    taxNote: settings.smallBusiness ? settings.texts[settings.documentLanguage].smallBusinessNote : '',
    currency: settings.defaults.currency,
    layout: layout ?? settings.defaults.layout,
    accentColor: settings.defaults.accentColor,
  })
}
