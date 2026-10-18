import { calculateTotals } from './calc'
import { blankDocument, defaultSettings } from './defaults'
import type { InvoiceDocument, Settings } from './types'

/**
 * Brings a stored document up to the current shape. Used by the Dexie
 * upgrade, by backup imports and for records that arrive via sync from
 * an older client.
 */
export function normalizeDocument(raw: Partial<InvoiceDocument> & { id: string }): InvoiceDocument {
  const doc = blankDocument({ ...raw })
  for (const key of ['creditNotes', 'deductions', 'payments'] as const) {
    if (!Array.isArray(doc[key])) doc[key] = []
  }
  // Version 1 only knew "paid" with a date. Keep the full amount as one payment.
  if (raw.payments === undefined && doc.kind === 'invoice' && doc.status === 'paid' && doc.paidAt) {
    doc.payments = [
      {
        id: `${doc.id}-p1`,
        date: doc.paidAt.slice(0, 10),
        amountCents: calculateTotals(doc.items, doc.taxMode).grossCents,
        note: '',
      },
    ]
  }
  return doc
}

type Legacy = {
  defaults?: { introText?: string; closingText?: string }
  smallBusinessNote?: string
  mailTemplates?: Record<string, unknown>
  dunning?: { steps?: { title?: unknown; text?: unknown }[] }
}

/** Earlier versions kept a single, German set of texts; they become the German texts now. */
function upgradeTexts(raw: Partial<Settings> & Legacy, base: Settings): Pick<Settings, 'texts' | 'mailTemplates' | 'dunning' | 'documentLanguage'> {
  const legacy = !raw.texts && (raw.defaults?.introText !== undefined || raw.smallBusinessNote !== undefined)
  const texts = { de: { ...base.texts.de, ...raw.texts?.de }, en: { ...base.texts.en, ...raw.texts?.en } }
  if (legacy) {
    if (raw.defaults?.introText) texts.de.intro = raw.defaults.introText
    if (raw.defaults?.closingText) texts.de.closing = raw.defaults.closingText
    if (raw.smallBusinessNote) texts.de.smallBusinessNote = raw.smallBusinessNote
  }
  const mail = raw.mailTemplates as Record<string, unknown> | undefined
  const flat = mail && 'invoice' in mail
  const mailTemplates = {
    de: { ...base.mailTemplates.de, ...((flat ? mail : mail?.de) as object) },
    en: { ...base.mailTemplates.en, ...((flat ? {} : mail?.en) as object) },
  } as Settings['mailTemplates']
  const dunning = { ...base.dunning, ...raw.dunning } as Settings['dunning']
  dunning.steps = base.dunning.steps.map((step, i) => {
    const old = raw.dunning?.steps?.[i] as (Partial<typeof step> & { title?: unknown; text?: unknown }) | undefined
    if (!old) return step
    const pick = (v: unknown, fallback: Record<'de' | 'en', string>) => (typeof v === 'string' ? { ...fallback, de: v } : { ...fallback, ...(v as object) })
    return { ...step, ...old, title: pick(old.title, step.title), text: pick(old.text, step.text) }
  }) as Settings['dunning']['steps']
  return { texts, mailTemplates, dunning, documentLanguage: raw.documentLanguage ?? (legacy ? 'de' : base.documentLanguage) }
}

export function normalizeSettings(raw: Partial<Settings> | undefined | null): Settings {
  const base = defaultSettings()
  if (!raw) return base
  const { introText: _i, closingText: _c, ...defaults } = { ...base.defaults, ...raw.defaults } as Settings['defaults'] & { introText?: string; closingText?: string }
  const { smallBusinessNote: _s, ...rest } = raw as Partial<Settings> & Legacy
  return {
    ...base,
    ...rest,
    defaults,
    company: { ...base.company, ...raw.company },
    timeRounding: { ...base.timeRounding, ...raw.timeRounding },
    ...upgradeTexts(raw, base),
    id: 'main',
  }
}
