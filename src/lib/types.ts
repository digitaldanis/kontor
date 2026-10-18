export type LayoutId = 'classic' | 'modern' | 'minimal'

export type TaxMode =
  | 'standard'
  | 'smallBusiness'
  | 'reverseCharge'
  | 'intraCommunitySupply'
  | 'thirdCountry'

export type DocumentKind = 'invoice' | 'cancellation' | 'quote'

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'cancelled'
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined'

export interface Address {
  street: string
  zip: string
  city: string
  country: string
}

export interface Company extends Address {
  name: string
  owner: string
  addressExtra: string
  vatId: string
  taxNumber: string
  email: string
  phone: string
  website: string
  bankName: string
  iban: string
  bic: string
  accountHolder: string
  registerInfo: string
}

export interface Logo {
  dataUrl: string
  mime: string
  // SVG logos are rasterized once so the PDF writer can embed them.
  pngDataUrl?: string
  width: number
  height: number
}

export interface InvoiceDefaults {
  paymentTermDays: number
  taxRate: number
  introText: string
  closingText: string
  footerText: string
  currency: string
  layout: LayoutId
  accentColor: string
  unit: string
  hourlyRateCents: number
}

export interface NumberSequence {
  pattern: string
  counters: Record<string, number>
}

export interface Settings {
  id: 'main'
  company: Company
  logo: Logo | null
  defaults: InvoiceDefaults
  invoiceNumbers: NumberSequence
  quoteNumbers: NumberSequence
  smallBusiness: boolean
  smallBusinessNote: string
  onboarded: boolean
  updatedAt: string
}

export interface Customer extends Address {
  id: string
  number: string
  company: string
  contactPerson: string
  addressExtra: string
  vatId: string
  email: string
  phone: string
  hourlyRateCents: number | null
  paymentTermDays: number | null
  leitwegId: string
  notes: string
  archived: boolean
  createdAt: string
  updatedAt: string
}

export interface Recipient extends Address {
  company: string
  contactPerson: string
  addressExtra: string
  vatId: string
  email: string
  leitwegId: string
}

export interface LineItem {
  id: string
  title: string
  description: string
  quantity: number
  unit: string
  unitPriceCents: number
  taxRate: number
  discountPercent: number
  serviceDate?: string
  timeEntryIds?: string[]
}

export interface InvoiceDocument {
  id: string
  kind: DocumentKind
  status: InvoiceStatus | QuoteStatus
  number: string | null
  customerId: string | null
  recipient: Recipient
  title: string
  issueDate: string
  serviceFrom: string
  serviceTo: string
  dueDate: string
  validUntil: string
  items: LineItem[]
  introText: string
  closingText: string
  footerText: string
  taxMode: TaxMode
  taxNote: string
  currency: string
  layout: LayoutId
  accentColor: string
  buyerReference: string
  // Frozen copy of the seller data at finalization.
  seller: Company | null
  sellerLogo: Logo | null
  cancelsId: string | null
  cancelsNumber: string | null
  cancelledById: string | null
  sourceQuoteId: string | null
  paidAt: string | null
  finalizedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TimeEntry {
  id: string
  customerId: string
  project: string
  description: string
  details: string
  start: string
  end: string
  billable: boolean
  rateCents: number | null
  invoiceId: string | null
  createdAt: string
  updatedAt: string
}

export interface RunningTimer {
  id: 'timer'
  customerId: string
  project: string
  description: string
  billable: boolean
  startedAt: string
}
