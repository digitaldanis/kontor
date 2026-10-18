import nodemailer from 'nodemailer'
import type { SmtpConfig } from './config.ts'

export interface OutgoingMail {
  from: string
  to: string[]
  cc: string[]
  bcc: string[]
  replyTo?: string
  subject: string
  text: string
  attachments: { filename: string; contentType: string; content: Buffer }[]
}

export type MailSender = (smtp: SmtpConfig, mail: OutgoingMail) => Promise<{ messageId: string }>

export const smtpSender: MailSender = async (smtp, mail) => {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    // never read local files or URLs referenced in a message
    disableFileAccess: true,
    disableUrlAccess: true,
  })
  try {
    const info = await transport.sendMail({ ...mail, to: mail.to, cc: mail.cc, bcc: mail.bcc })
    return { messageId: String(info.messageId ?? '') }
  } finally {
    transport.close()
  }
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/

export function parseAddresses(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,;]/) : []
  return list.map((v) => String(v).trim()).filter(Boolean)
}

export function validAddress(a: string): boolean {
  return a.length <= 254 && EMAIL.test(a)
}
