import { t, uiLocale } from '../lib/i18n'
import { saveReminder } from '../lib/actions'
import { useLiveQuery } from '../lib/live'
import { BellRing, Download } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { addDays, formatDate, today } from '../lib/dates'
import { db } from '../lib/db'
import { draftReminder, LEVEL_LABELS, reminderText, reminderTitle, reminderTotal } from '../lib/dunning'
import { downloadReminderPdf } from '../lib/exporters'
import { useSettings } from '../lib/hooks'
import { buildReminderView } from '../lib/invoiceView'
import { formatMoney } from '../lib/money'
import { remindersFor } from '../lib/repo'
import type { DunningLevel, InvoiceDocument, Reminder } from '../lib/types'
import { useFeedback } from './feedback'
import { InvoicePreview, ScaledPage } from './InvoicePreview'
import { Button, Dialog, Field, MoneyInput, Segmented, TextAreaField, TextField, Toggle } from './ui'

/** Creates the next reminder for an overdue invoice, with live preview. */
export function ReminderDialog({ invoice, onClose, onSaved }: { invoice: InvoiceDocument | null; onClose: () => void; onSaved?: (r: Reminder) => void }) {
  const settings = useSettings()
  const { run } = useFeedback()
  const data = useLiveQuery(async () => {
    if (!invoice) return null
    const [reminders, customer] = await Promise.all([remindersFor(invoice.id), invoice.customerId ? db.customers.get(invoice.customerId) : undefined])
    return { reminders, customer }
  }, [invoice?.id])

  const [level, setLevel] = useState<DunningLevel>(0)
  const [issueDate, setIssueDate] = useState(today())
  const [deadline, setDeadline] = useState('')
  const [interest, setInterest] = useState(true)
  const [flatFee, setFlatFee] = useState(false)
  const [fee, setFee] = useState(0)
  const [text, setText] = useState('')

  const base = useMemo(() => {
    if (!invoice || !data || !settings) return null
    return draftReminder({ invoice, reminders: data.reminders, settings: settings.dunning, customer: data.customer, issueDate: today() })
  }, [invoice, data, settings])

  // reset the form whenever another invoice is opened
  useEffect(() => {
    if (!base || !settings) return
    setLevel(base.level)
    setIssueDate(base.issueDate)
    setDeadline(base.deadline)
    setInterest(base.interestCents > 0)
    setFlatFee(base.flatFeeCents > 0)
    setFee(base.feeCents)
    setText(base.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base?.invoiceId, base?.level])

  if (!invoice || !data || !settings || !base) return null
  const lang = invoice.language ?? 'de'
  const draft = draftReminder({
    invoice,
    reminders: data.reminders.filter((r) => r.level < level),
    settings: settings.dunning,
    customer: data.customer,
    issueDate,
    level,
    chargeInterest: interest,
    includeFlatFee: flatFee,
  })
  const reminder: Reminder = { ...draft, feeCents: fee, text, deadline: deadline || draft.deadline, id: 'preview', createdAt: '' }
  const view = buildReminderView(reminder, invoice, settings)
  const used = new Set(data.reminders.map((r) => r.level))

  const changeLevel = (l: DunningLevel) => {
    setLevel(l)
    setFee(settings.dunning.steps[l].feeCents)
    setText(reminderText(l, lang, settings.dunning))
    setInterest(settings.dunning.chargeInterest && l > 0)
    setFlatFee(settings.dunning.flatFeeB2B && l > 0)
  }

  const save = async (withPdf: boolean) => {
    const saved = await run(async () => {
      const { id: _id, createdAt: _c, ...rest } = reminder
      const r = await saveReminder({ ...rest, title: reminderTitle(level, lang, settings.dunning) })
      if (withPdf) await downloadReminderPdf(r, invoice, settings)
      return r
    }, t('{p0} gespeichert', { p0: LEVEL_LABELS[level] }))
    if (saved) {
      onSaved?.(saved)
      onClose()
    }
  }

  return (
    <Dialog
      open={!!invoice}
      onClose={onClose}
      wide
      title={t('{p0} zu {p1}', { p0: LEVEL_LABELS[level], p1: invoice.number })}
      description={t('{p0} · fällig seit {p1}', { p0: invoice.recipient.company || invoice.recipient.contactPerson, p1: formatDate(invoice.dueDate) })}
      footer={
        <>
          <span className="muted small" style={{ marginRight: 'auto', alignSelf: 'center' }}>
            {t('Gesamtforderung')} {formatMoney(reminderTotal(reminder), invoice.currency)}
          </span>
          <Button onClick={() => save(false)}>{t('Speichern')}</Button>
          <Button variant="primary" icon={Download} onClick={() => save(true)}>
            {t('Speichern und PDF')}
          </Button>
        </>
      }
    >
      <div className="reminder-grid">
        <div className="stack-sm">
          <Segmented<string>
            label={t('Mahnstufe')}
            value={String(level)}
            onChange={(v) => changeLevel(Number(v) as DunningLevel)}
            options={([0, 1, 2] as DunningLevel[]).map((l) => ({ value: String(l), label: `${t(LEVEL_LABELS[l])}${used.has(l) ? ' ✓' : ''}` }))}
          />
          <div className="form-grid">
            <TextField className="span-3" label={t('Datum')} type="date" value={issueDate} onChange={(d) => { setIssueDate(d); setDeadline(addDays(d, settings.dunning.deadlineDays)) }} />
            <TextField className="span-3" label={t('Neue Zahlungsfrist')} type="date" value={deadline} onChange={setDeadline} />
            <Field className="span-3" label={t('Mahngebühr')}>
              <MoneyInput value={fee} onChange={(v) => setFee(v ?? 0)} aria-label={t('Mahngebühr')} />
            </Field>
            <div className="span-3 small muted" style={{ alignSelf: 'end' }}>
              {t('Offen:')} <strong>{formatMoney(reminder.openCents, invoice.currency)}</strong>
              {reminder.previousFeesCents > 0 && <> {t('· frühere Gebühren')} {formatMoney(reminder.previousFeesCents, invoice.currency)}</>}
            </div>
          </div>
          <Toggle
            checked={interest}
            onChange={setInterest}
            label={t('Verzugszinsen berechnen')}
            description={t('{p0} % p. a. (Basiszins {p1} % + {p2} Punkte) für {p3} Tage = {p4}', { p0: reminder.interestRatePercent.toLocaleString(uiLocale()), p1: settings.dunning.baseRatePercent.toLocaleString(uiLocale()), p2: data.customer?.customerType === 'consumer' || !invoice.recipient.company ? '5' : '9', p3: draft.interestDays || 0, p4: formatMoney(reminder.interestCents, invoice.currency) })}
          />
          {!!invoice.recipient.company && (
            <Toggle checked={flatFee} onChange={setFlatFee} label={t('Verzugspauschale 40 €')} description={t('Nur gegenüber Unternehmen, einmal je Forderung (§ 288 Abs. 5 BGB).')} />
          )}
          <TextAreaField label={t('Text')} value={text} onChange={setText} rows={6} hint={t('Platzhalter: {Rechnungsnummer}, {Rechnungsdatum}, {Fälligkeitsdatum}, {Offener Betrag}, {Gesamtforderung}, {Neue Frist}')} />
          <p className="small faint">
            <BellRing size={12} aria-hidden /> {t('Verzugszinsen und Pauschale setzen voraus, dass der Kunde in Verzug ist – bei Verbrauchern z. B. erst 30 Tage nach Fälligkeit, wenn auf der Rechnung darauf hingewiesen wurde. Keine Rechtsberatung.')}
          </p>
        </div>
        <div className="reminder-preview">
          <ScaledPage>
            <InvoicePreview view={view} />
          </ScaledPage>
        </div>
      </div>
    </Dialog>
  )
}
