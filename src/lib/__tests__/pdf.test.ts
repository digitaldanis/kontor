import 'fake-indexeddb/auto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { blankDocument, defaultSettings, emptyRecipient } from '../defaults'
import { buildCii } from '../einvoice'
import { draftReminder } from '../dunning'
import { buildInvoiceView, buildReminderView } from '../invoiceView'
import { renderInvoicePdf } from '../pdf'
import { testAssets } from './pdfAssets'

const settings = defaultSettings()
settings.company = { ...settings.company, name: 'Studio Nordlicht', street: 'Kastanienallee 21', zip: '10435', city: 'Berlin', taxNumber: '30/245/67890', email: 'hallo@example.de' }

const invoice = blankDocument({
  id: 'x',
  status: 'open',
  number: 'RE-2026-0001',
  issueDate: '2026-05-01',
  serviceFrom: '2026-04-30',
  dueDate: '2026-05-15',
  recipient: { ...emptyRecipient(), company: 'Kunde GmbH', street: 'Weg 1', zip: '20095', city: 'Hamburg' },
  items: [{ id: '1', title: 'Beratung – Konzept „Herbst“', description: 'Workshop', quantity: 2, unit: 'Std.', unitPriceCents: 9500, taxRate: 19, discountPercent: 0 }],
  discount: { type: 'percent', value: 5 },
})

describe('renderInvoicePdf', () => {
  it('renders an invoice in German and English', async () => {
    for (const language of ['de', 'en'] as const) {
      const bytes = await renderInvoicePdf(buildInvoiceView({ ...invoice, language }, settings))
      const pdf = await PDFDocument.load(bytes)
      expect(pdf.getPageCount()).toBe(1)
    }
  })

  it('renders a reminder', async () => {
    const reminder = { ...draftReminder({ invoice, reminders: [], settings: settings.dunning, issueDate: '2026-06-01', level: 1 }), id: 'r', createdAt: '' }
    const view = buildReminderView(reminder, invoice, settings)
    expect(view.items.map((i) => i.title)).toEqual(['Rechnung RE-2026-0001 vom 01.05.2026', 'Mahngebühr', 'Verzugszinsen'])
    const bytes = await renderInvoicePdf(view)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
  })
})

const assets = testAssets

// Set PDFA_OUT to a folder to keep the files, e.g. for veraPDF in CI.
const out = process.env.PDFA_OUT
const keep = (name: string, bytes: Uint8Array) => {
  if (!out) return
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, name), bytes)
}

describe('PDF/A-3', () => {
  it('embeds fonts, colour profile, XMP and the invoice XML', async () => {
    const seller = settings.company
    const xml = buildCii(invoice, seller, 'facturx')
    const bytes = await renderInvoicePdf(buildInvoiceView(invoice, settings), { xml, assets, date: new Date('2026-05-01T10:00:00.500Z') })
    keep('zugferd.pdf', bytes)
    const raw = new TextDecoder('latin1').decode(bytes)
    expect(raw).toContain('/FontFile2')
    expect(raw).not.toContain('/BaseFont /Helvetica')
    expect(raw).toContain('/GTS_PDFA1')
    expect(raw).toContain('<pdfaid:part>3</pdfaid:part>')
    expect(raw).toContain('<xmp:CreateDate>2026-05-01T10:00:00Z</xmp:CreateDate>')
    expect(raw).toContain('/AFRelationship /Alternative')
    expect(raw).toMatch(/\/ID \[ <[0-9a-f]{32}> <[0-9a-f]{32}> \]/)

    const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(pdf.getTitle()).toBe('Rechnung RE-2026-0001')
    expect(pdf.getCreationDate()?.toISOString()).toBe('2026-05-01T10:00:00.000Z')
  })

  it('keeps every page in PDF/A, also reminders and long invoices', async () => {
    const long = { ...invoice, items: Array.from({ length: 35 }, (_, i) => ({ ...invoice.items[0], id: String(i) })), language: 'en' as const }
    const bytes = await renderInvoicePdf(buildInvoiceView(long, settings), { assets })
    keep('long-en.pdf', bytes)
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1)
    const reminder = { ...draftReminder({ invoice, reminders: [], settings: settings.dunning, issueDate: '2026-06-01', level: 1 }), id: 'r', createdAt: '' }
    keep('reminder.pdf', await renderInvoicePdf(buildReminderView(reminder, invoice, settings), { assets }))
  })

  it('refuses a ZUGFeRD PDF without embedded fonts', async () => {
    await expect(renderInvoicePdf(buildInvoiceView(invoice, settings), { xml: '<x/>', assets: null })).rejects.toThrow(/Schriften/)
  })
})
