export type LayoutId = 'classic' | 'modern' | 'minimal'

export type TaxMode =
  | 'standard'
  | 'smallBusiness'
  | 'reverseCharge'
  | 'intraCommunitySupply'
  | 'thirdCountry'

export type DocumentKind = 'invoice' | 'cancellation' | 'quote' | 'creditNote'

/** Regular invoice, down payment / partial invoice or final invoice that deducts down payments. */
export type BillingType = 'regular' | 'downPayment' | 'final'

export type Language = 'de' | 'en'

export type CustomerType = 'business' | 'consumer'

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

export interface InvoiceDiscount {
  type: 'percent' | 'amount'
  /** Percent (e.g. 5) or cents, depending on the type. */
  value: number
}

export interface Payment {
  id: string
  date: string
  amountCents: number
  note: string
}

export interface DeductionGroup {
  rate: number
  netCents: number
  taxCents: number
}

/** A down payment invoice that is settled in a final invoice. */
export interface Deduction {
  invoiceId: string
  number: string
  issueDate: string
  groups: DeductionGroup[]
}

export interface CreditRef {
  id: string
  number: string
  issueDate: string
  grossCents: number
}

export type DunningLevel = 0 | 1 | 2

export interface DunningStep {
  title: string
  /** Days after the due date (first step) or after the previous deadline. */
  afterDays: number
  feeCents: number
  text: string
}

export interface DunningSettings {
  steps: [DunningStep, DunningStep, DunningStep]
  /** New payment deadline in days from the reminder date. */
  deadlineDays: number
  /** Basiszinssatz nach § 247 BGB in percent, entered by the user. */
  baseRatePercent: number
  baseRateSince: string
  chargeInterest: boolean
  /** 40 € flat fee for business customers, § 288 Abs. 5 BGB. */
  flatFeeB2B: boolean
}

export interface Reminder {
  id: string
  invoiceId: string
  customerId: string | null
  level: DunningLevel
  title: string
  text: string
  issueDate: string
  deadline: string
  openCents: number
  feeCents: number
  /** Fees of earlier reminders that are still claimed. */
  previousFeesCents: number
  interestCents: number
  interestRatePercent: number
  interestDays: number
  flatFeeCents: number
  language: Language
  sentAt: string | null
  createdAt: string
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
  creditNoteNumbers: NumberSequence
  smallBusiness: boolean
  smallBusinessNote: string
  /** Soll- (accrual, by invoice date) or Ist-Versteuerung (cash, by payment date). */
  taxation: 'accrual' | 'cash'
  dunning: DunningSettings
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
  customerType?: CustomerType
  language?: Language
  currency?: string
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
  /** Credit notes reference the corrected invoice here. */
  creditsId: string | null
  creditsNumber: string | null
  /** Finalized credit notes issued for this invoice. */
  creditNotes: CreditRef[]
  discount: InvoiceDiscount | null
  billingType: BillingType
  deductions: Deduction[]
  /** Set on a down payment invoice once a final invoice deducts it. */
  settledById: string | null
  payments: Payment[]
  language: Language
  recurringId: string | null
  sentAt: string | null
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

export interface CatalogItem {
  id: string
  name: string
  description: string
  unit: string
  priceCents: number
  taxRate: number
  archived: boolean
  createdAt: string
  updatedAt: string
}

export type RecurringInterval = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export interface RecurringTemplate {
  title: string
  items: LineItem[]
  introText: string
  closingText: string
  footerText: string
  currency: string
  language: Language
  layout: LayoutId
  accentColor: string
  buyerReference: string
  discount: InvoiceDiscount | null
}

export interface RecurringInvoice {
  id: string
  name: string
  customerId: string
  interval: RecurringInterval
  every: number
  startDate: string
  /** Number of drafts created so far; the next run is derived from start date and runs. */
  runs: number
  /** Date of the next draft. */
  nextRun: string
  endDate: string
  active: boolean
  template: RecurringTemplate
  lastRun: string | null
  lastDocumentId: string | null
  createdAt: string
  updatedAt: string
}

export interface Expense {
  id: string
  date: string
  vendor: string
  description: string
  category: string
  grossCents: number
  taxRate: number
  /** Input VAT (Vorsteuer), usually derived from gross and rate but editable. */
  vatCents: number
  currency: string
  paidAt: string | null
  invoiceNumber: string
  attachmentId: string | null
  notes: string
  createdAt: string
  updatedAt: string
}

export interface Attachment {
  id: string
  name: string
  mime: string
  size: number
  data: Blob
  createdAt: string
}

export interface Project {
  id: string
  customerId: string
  name: string
  budgetMinutes: number | null
  budgetCents: number | null
  archived: boolean
  createdAt: string
  updatedAt: string
}
