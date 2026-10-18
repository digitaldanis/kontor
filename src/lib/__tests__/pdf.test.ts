import 'fake-indexeddb/auto'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { blankDocument, defaultSettings, emptyRecipient } from '../defaults'
import { draftReminder } from '../dunning'
import { buildInvoiceView, buildReminderView } from '../invoiceView'
import { renderInvoicePdf } from '../pdf'

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
