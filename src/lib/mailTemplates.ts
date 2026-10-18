import type { Language, MailTemplate, MailTemplateKey } from './types'

export const MAIL_TEMPLATE_LABELS: Record<MailTemplateKey, string> = {
  invoice: 'Rechnung',
  quote: 'Angebot',
  creditNote: 'Gutschrift',
  reminder: 'Zahlungserinnerung und Mahnung',
}

export const MAIL_PLACEHOLDERS = ['Dokument', 'Dokumentnummer', 'Kunde', 'Ansprechpartner', 'Gesamtbetrag', 'Fälligkeitsdatum', 'Firma', 'Absender']

export function defaultMailTemplates(): Record<MailTemplateKey, MailTemplate> {
  return {
    invoice: {
      subject: '{Dokument} {Dokumentnummer} von {Firma}',
      body: 'Guten Tag {Ansprechpartner},\n\nanbei erhalten Sie die {Dokument} {Dokumentnummer} über {Gesamtbetrag}, zahlbar bis zum {Fälligkeitsdatum}.\n\nVielen Dank für die gute Zusammenarbeit.\n\nViele Grüße\n{Absender}',
    },
    quote: {
      subject: 'Angebot {Dokumentnummer} von {Firma}',
      body: 'Guten Tag {Ansprechpartner},\n\nvielen Dank für Ihre Anfrage. Anbei erhalten Sie unser Angebot {Dokumentnummer} über {Gesamtbetrag}.\n\nBei Fragen melden Sie sich gern.\n\nViele Grüße\n{Absender}',
    },
    creditNote: {
      subject: 'Gutschrift {Dokumentnummer} von {Firma}',
      body: 'Guten Tag {Ansprechpartner},\n\nanbei erhalten Sie die Gutschrift {Dokumentnummer} über {Gesamtbetrag}.\n\nViele Grüße\n{Absender}',
    },
    reminder: {
      subject: '{Dokument} zur Rechnung {Dokumentnummer}',
      body: 'Guten Tag {Ansprechpartner},\n\nanbei erhalten Sie unsere {Dokument} zur Rechnung {Dokumentnummer}. Der offene Betrag beläuft sich auf {Gesamtbetrag}.\n\nSollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos.\n\nViele Grüße\n{Absender}',
    },
  }
}

const EN: Record<MailTemplateKey, MailTemplate> = {
  invoice: {
    subject: '{Dokument} {Dokumentnummer} from {Firma}',
    body: 'Hello {Ansprechpartner},\n\nplease find attached {Dokument} {Dokumentnummer} for {Gesamtbetrag}, payable by {Fälligkeitsdatum}.\n\nThank you for your business.\n\nBest regards\n{Absender}',
  },
  quote: {
    subject: 'Quotation {Dokumentnummer} from {Firma}',
    body: 'Hello {Ansprechpartner},\n\nthank you for your enquiry. Please find attached our quotation {Dokumentnummer} for {Gesamtbetrag}.\n\nBest regards\n{Absender}',
  },
  creditNote: {
    subject: 'Credit note {Dokumentnummer} from {Firma}',
    body: 'Hello {Ansprechpartner},\n\nplease find attached credit note {Dokumentnummer} for {Gesamtbetrag}.\n\nBest regards\n{Absender}',
  },
  reminder: {
    subject: '{Dokument} for invoice {Dokumentnummer}',
    body: 'Hello {Ansprechpartner},\n\nplease find attached our {Dokument} for invoice {Dokumentnummer}. The amount outstanding is {Gesamtbetrag}.\n\nIf your payment has crossed with this message, please disregard it.\n\nBest regards\n{Absender}',
  },
}

/** German templates are editable in the settings; English ones are built in. */
export function templateFor(key: MailTemplateKey, lang: Language, custom: Record<MailTemplateKey, MailTemplate>): MailTemplate {
  return lang === 'en' ? EN[key] : custom[key]
}

export function fillTemplate(text: string, values: Record<string, string>): string {
  return text.replace(/\{([^}]+)\}/g, (m, key: string) => values[key] ?? m)
}
