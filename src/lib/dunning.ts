import { addDays, daysBetween } from './dates'
import { divRound, toScaled } from './money'
import { amountDue, displayStatus } from './status'
import type { Customer, DunningLevel, DunningSettings, InvoiceDocument, Language, Reminder } from './types'

export const LEVEL_LABELS: Record<DunningLevel, string> = {
  0: 'Zahlungserinnerung',
  1: '1. Mahnung',
  2: '2. Mahnung',
}

export const LEVEL_LABELS_EN: Record<DunningLevel, string> = {
  0: 'Payment reminder',
  1: 'First reminder',
  2: 'Final reminder',
}

const EN_TEXTS: Record<DunningLevel, string> = {
  0: 'We would like to remind you that invoice {Rechnungsnummer} dated {Rechnungsdatum} was due for payment on {Fälligkeitsdatum}. This may simply have been overlooked. Please transfer the outstanding amount of {Gesamtforderung} by {Neue Frist}.\n\nIf you have already paid, please disregard this letter.',
  1: 'Unfortunately we have not yet received payment for invoice {Rechnungsnummer} dated {Rechnungsdatum}, despite our reminder. Please transfer the total of {Gesamtforderung} by {Neue Frist}.',
  2: 'Invoice {Rechnungsnummer} dated {Rechnungsdatum} remains unpaid. Please settle the total of {Gesamtforderung} by {Neue Frist} at the latest. After this date we will hand the claim over for collection without further notice.',
}

export function defaultDunning(): DunningSettings {
  return {
    steps: [
      {
        title: 'Zahlungserinnerung',
        afterDays: 7,
        feeCents: 0,
        text: 'sicher ist es Ihrer Aufmerksamkeit entgangen: Die Rechnung {Rechnungsnummer} vom {Rechnungsdatum} war am {Fälligkeitsdatum} fällig. Bitte überweisen Sie den offenen Betrag von {Gesamtforderung} bis zum {Neue Frist}.\n\nSollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.',
      },
      {
        title: '1. Mahnung',
        afterDays: 14,
        feeCents: 500,
        text: 'leider konnten wir trotz unserer Zahlungserinnerung noch keinen Zahlungseingang zur Rechnung {Rechnungsnummer} vom {Rechnungsdatum} feststellen. Bitte überweisen Sie den Gesamtbetrag von {Gesamtforderung} bis zum {Neue Frist}.',
      },
      {
        title: '2. Mahnung',
        afterDays: 14,
        feeCents: 1000,
        text: 'die Rechnung {Rechnungsnummer} vom {Rechnungsdatum} ist weiterhin offen. Bitte begleichen Sie den Gesamtbetrag von {Gesamtforderung} spätestens bis zum {Neue Frist}. Nach Ablauf dieser Frist geben wir die Forderung ohne weitere Ankündigung an ein Inkassounternehmen bzw. leiten das gerichtliche Mahnverfahren ein.',
      },
    ],
    deadlineDays: 10,
    baseRatePercent: 1.27,
    baseRateSince: '2025-07-01',
    chargeInterest: true,
    flatFeeB2B: false,
  }
}

export function reminderText(level: DunningLevel, lang: Language, settings: DunningSettings): string {
  return lang === 'en' ? EN_TEXTS[level] : settings.steps[level].text
}

export function reminderTitle(level: DunningLevel, lang: Language, settings: DunningSettings): string {
  return lang === 'en' ? LEVEL_LABELS_EN[level] : settings.steps[level].title || LEVEL_LABELS[level]
}

export function isConsumer(invoice: InvoiceDocument, customer?: Customer): boolean {
  if (customer?.customerType) return customer.customerType === 'consumer'
  return !invoice.recipient.company.trim()
}

/** Verzugszins nach § 288 BGB: Basiszinssatz plus 9 Prozentpunkte (B2B) bzw. 5 (Verbraucher). */
export function defaultInterestRate(baseRatePercent: number, consumer: boolean): number {
  return Math.round((baseRatePercent + (consumer ? 5 : 9)) * 100) / 100
}

/** Simple interest per day of default on a 365 day year, commercially rounded to cents. */
export function defaultInterest(openCents: number, ratePercent: number, days: number): number {
  if (openCents <= 0 || ratePercent <= 0 || days <= 0) return 0
  return Number(divRound(BigInt(openCents) * toScaled(ratePercent, 4) * BigInt(days), 1_000_000n * 365n))
}

/** Default starts the day after the due date, so the due date itself is not counted. */
export function daysInDefault(dueDate: string, until: string): number {
  return Math.max(0, daysBetween(dueDate, until))
}

export function lastReminder(reminders: Reminder[]): Reminder | undefined {
  return [...reminders].sort((a, b) => a.level - b.level || a.issueDate.localeCompare(b.issueDate)).pop()
}

export function nextLevel(reminders: Reminder[]): DunningLevel | null {
  const last = lastReminder(reminders)
  if (!last) return 0
  return last.level >= 2 ? null : ((last.level + 1) as DunningLevel)
}

/** Date from which the next reminder step is due according to the configured intervals. */
export function nextReminderDate(invoice: InvoiceDocument, reminders: Reminder[], settings: DunningSettings): string | null {
  const level = nextLevel(reminders)
  if (level === null) return null
  const last = lastReminder(reminders)
  const from = last ? last.deadline : invoice.dueDate
  return addDays(from, settings.steps[level].afterDays)
}

export interface ReminderDraftInput {
  invoice: InvoiceDocument
  reminders: Reminder[]
  settings: DunningSettings
  customer?: Customer
  issueDate: string
  level?: DunningLevel
  chargeInterest?: boolean
  includeFlatFee?: boolean
}

export function draftReminder(input: ReminderDraftInput): Omit<Reminder, 'id' | 'createdAt'> {
  const { invoice, reminders, settings, issueDate } = input
  const level = input.level ?? nextLevel(reminders) ?? 2
  const lang = invoice.language ?? 'de'
  const consumer = isConsumer(invoice, input.customer)
  const open = amountDue(invoice)
  const rate = defaultInterestRate(settings.baseRatePercent, consumer)
  const days = daysInDefault(invoice.dueDate, issueDate)
  const charge = input.chargeInterest ?? (settings.chargeInterest && level > 0)
  const previousFees = reminders.filter((r) => r.level < level).reduce((s, r) => s + r.feeCents, 0)
  const flatFeeAlready = reminders.some((r) => r.flatFeeCents > 0)
  const flat = !consumer && !flatFeeAlready && (input.includeFlatFee ?? (settings.flatFeeB2B && level > 0))
  return {
    invoiceId: invoice.id,
    customerId: invoice.customerId,
    level,
    title: reminderTitle(level, lang, settings),
    text: reminderText(level, lang, settings),
    issueDate,
    deadline: addDays(issueDate, settings.deadlineDays),
    openCents: open,
    feeCents: settings.steps[level].feeCents,
    previousFeesCents: previousFees,
    interestCents: charge ? defaultInterest(open, rate, days) : 0,
    interestRatePercent: rate,
    interestDays: charge ? days : 0,
    flatFeeCents: flat ? 4000 : 0,
    language: lang,
    sentAt: null,
  }
}

export function reminderTotal(r: Pick<Reminder, 'openCents' | 'feeCents' | 'previousFeesCents' | 'interestCents' | 'flatFeeCents'>): number {
  return r.openCents + r.feeCents + r.previousFeesCents + r.interestCents + r.flatFeeCents
}

export function isOverdue(invoice: InvoiceDocument, ref?: string): boolean {
  return displayStatus(invoice, ref) === 'overdue'
}
