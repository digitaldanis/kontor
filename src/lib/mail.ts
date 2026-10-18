import { blobToDataUrl, downloadFile } from './backup'
import { documentTotals } from './calc'
import { formatDocDate, formatDocMoney } from './docText'
import { reminderTotal } from './dunning'
import { buildXml, renderPdf, renderReminderPdf } from './exporters'
import { docTitleLabel, sellerFor } from './invoiceView'
import { fillTemplate, templateFor } from './mailTemplates'
import { api, getConnection } from './server'
import type { InvoiceDocument, MailTemplateKey, Reminder, Settings } from './types'

export interface MailAttachment {
  filename: string
  contentType: string
  bytes: Uint8Array | string
}

export interface MailDraft {
  to: string
  cc: string
  subject: string
  body: string
}

export function templateKey(doc: InvoiceDocument): MailTemplateKey {
  if (doc.kind === 'quote') return 'quote'
  if (doc.kind === 'creditNote' || doc.kind === 'cancellation') return 'creditNote'
  return 'invoice'
}

export function composeMail(doc: InvoiceDocument, settings: Settings, reminder?: Reminder): MailDraft {
  const lang = doc.language ?? 'de'
  const seller = sellerFor(doc, settings).seller
  const key = reminder ? 'reminder' : templateKey(doc)
  const t = templateFor(key, lang, settings.mailTemplates)
  const amount = reminder ? reminderTotal(reminder) : documentTotals(doc).dueCents
  const values: Record<string, string> = {
    Dokument: reminder ? reminder.title : docTitleLabel(doc),
    Dokumentnummer: doc.number ?? '',
    Kunde: doc.recipient.company || doc.recipient.contactPerson,
    Ansprechpartner: doc.recipient.contactPerson || (lang === 'en' ? 'Sir or Madam' : 'zusammen'),
    Gesamtbetrag: formatDocMoney(amount, doc.currency, lang),
    Fälligkeitsdatum: formatDocDate(reminder ? reminder.deadline : doc.dueDate || doc.validUntil, lang),
    Firma: seller.name,
    Absender: seller.owner || seller.name,
  }
  return { to: doc.recipient.email, cc: '', subject: fillTemplate(t.subject, values), body: fillTemplate(t.body, values) }
}

export type AttachmentChoice = 'pdf' | 'zugferd' | 'xrechnung'

export async function buildAttachments(doc: InvoiceDocument, settings: Settings, choice: AttachmentChoice, reminder?: Reminder): Promise<MailAttachment[]> {
  if (reminder) {
    const { bytes, filename } = await renderReminderPdf(reminder, doc, settings)
    return [{ filename, contentType: 'application/pdf', bytes }]
  }
  const { bytes, filename } = await renderPdf(doc, settings, choice === 'zugferd')
  const files: MailAttachment[] = [{ filename, contentType: 'application/pdf', bytes }]
  if (choice === 'xrechnung') files.push({ filename: filename.replace(/\.pdf$/, '-XRechnung.xml'), contentType: 'application/xml', bytes: await buildXml(doc, settings, 'xrechnung') })
  return files
}

export async function serverMailReady(): Promise<boolean> {
  if (!getConnection()?.token) return false
  try {
    const s = await api<{ configured: boolean; serverDefault: boolean }>('/api/mail/settings')
    return s.configured || s.serverDefault
  } catch {
    return false
  }
}

async function toBase64(bytes: Uint8Array | string, type: string): Promise<string> {
  const blob = new Blob([typeof bytes === 'string' ? bytes : (bytes as BlobPart)], { type })
  return (await blobToDataUrl(blob, type)).split(',')[1] ?? ''
}

export async function sendViaServer(draft: MailDraft, attachments: MailAttachment[], replyTo?: string): Promise<void> {
  await api('/api/mail/send', {
    body: {
      to: draft.to,
      cc: draft.cc,
      replyTo,
      subject: draft.subject,
      text: draft.body,
      attachments: await Promise.all(attachments.map(async (a) => ({ filename: a.filename, contentType: a.contentType, contentBase64: await toBase64(a.bytes, a.contentType) }))),
    },
  })
}

export function mailtoUrl(draft: MailDraft): string {
  const params = new URLSearchParams()
  if (draft.cc) params.set('cc', draft.cc)
  params.set('subject', draft.subject)
  params.set('body', draft.body)
  return `mailto:${encodeURIComponent(draft.to)}?${params.toString().replace(/\+/g, '%20')}`
}

/** Without a server: download the files and open the mail program, the user attaches them. */
export function sendViaMailto(draft: MailDraft, attachments: MailAttachment[]) {
  for (const a of attachments) downloadFile(a.filename, a.bytes as BlobPart, a.contentType)
  window.location.href = mailtoUrl(draft)
}
