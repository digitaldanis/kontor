import { describe, expect, it } from 'vitest'
import { normalizeDocument, normalizeSettings } from '../migrate'

describe('settings from earlier versions', () => {
  it('turns the single German text set into the German texts', () => {
    const legacy = {
      id: 'main',
      company: { name: 'Alt GmbH' },
      defaults: { paymentTermDays: 30, introText: 'Hallo alt', closingText: 'Tschüss alt' },
      smallBusinessNote: 'Kein Ausweis der USt (§ 19).',
      mailTemplates: { invoice: { subject: 'Rechnung {Dokumentnummer}', body: 'Text' } },
      dunning: { steps: [{ title: 'Erinnerung', afterDays: 5, feeCents: 0, text: 'Bitte zahlen' }] },
      invoiceNumbers: { pattern: 'RE-{0001}', counters: { all: 9 } },
    } as never
    const s = normalizeSettings(legacy)
    expect(s.texts.de.intro).toBe('Hallo alt')
    expect(s.texts.de.closing).toBe('Tschüss alt')
    expect(s.texts.de.smallBusinessNote).toBe('Kein Ausweis der USt (§ 19).')
    expect(s.texts.en.intro).toMatch(/^Thank you/)
    expect(s.documentLanguage).toBe('de')
    expect(s.mailTemplates.de.invoice.subject).toBe('Rechnung {Dokumentnummer}')
    expect(s.mailTemplates.en.invoice.subject).toContain('from')
    expect(s.dunning.steps[0]).toMatchObject({ afterDays: 5, title: { de: 'Erinnerung' }, text: { de: 'Bitte zahlen' } })
    expect(s.dunning.steps[0].text.en).toMatch(/remind/)
    expect(s.dunning.steps[1].feeCents).toBe(500)
    expect(s.defaults.paymentTermDays).toBe(30)
    expect('introText' in s.defaults).toBe(false)
    expect(s.invoiceNumbers.counters).toEqual({ all: 9 })
  })

  it('starts new installations in English', () => {
    const s = normalizeSettings(null)
    expect(s.documentLanguage).toBe('en')
    expect(s.texts.en.smallBusinessNote).toContain('§ 19 UStG')
  })
})

describe('documents from earlier versions', () => {
  it('keeps a paid invoice as one full payment', () => {
    const doc = normalizeDocument({
      id: 'x', kind: 'invoice', status: 'paid', paidAt: '2026-02-10', taxMode: 'standard',
      items: [{ id: '1', title: 'A', description: '', quantity: 2, unit: 'Std.', unitPriceCents: 10000, taxRate: 19, discountPercent: 0 }],
    } as never)
    expect(doc.payments).toEqual([{ id: 'x-p1', date: '2026-02-10', amountCents: 23800, note: '' }])
    expect(doc.billingType).toBe('regular')
    expect(doc.creditNotes).toEqual([])
  })
})
