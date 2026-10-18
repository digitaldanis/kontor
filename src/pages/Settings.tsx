import { updateSettings } from '../lib/actions'
import { t, uiLanguage, uiLocale } from '../lib/i18n'
import {
  BellRing,
  Building2,
  Mail,
  UserCog,
  Check,
  Database,
  Download,
  FileSpreadsheet,
  Hash,
  Image,
  Landmark,
  Palette,
  Percent,
  ReceiptText,
  Upload,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useFeedback } from '../components/feedback'
import {
  AccentPicker,
  BankFields,
  CompanyFields,
  ContactFields,
  LayoutPicker,
  LogoField,
  TaxFields,
} from '../components/SettingsFields'
import { Button, Field, MoneyInput, NumberInput, PageHeader, Segmented, SelectField, TextAreaField, TextField, Toggle } from '../components/ui'
import { LanguageSwitch } from '../components/LanguageSwitch'
import { AccountSettings, SmtpSettings, TeamSettings } from '../components/AccountSettings'
import { MAIL_PLACEHOLDERS, MAIL_TEMPLATE_LABELS } from '../lib/mailTemplates'
import { api } from '../lib/api'
import { downloadFile, invoicesToCsv, parseBackup, type Backup } from '../lib/backup'
import { deleteLegacyBrowserData, readLegacyBrowserData } from '../lib/legacyImport'
import { invalidate } from '../lib/remote'
import { useSession } from '../lib/session'
import { today } from '../lib/dates'
import { db } from '../lib/db'
import { TAX_RATES, UNITS } from '../lib/defaults'
import { useDocumentTitle, useSettings } from '../lib/hooks'
import { peekNextNumber, validatePattern } from '../lib/numbering'
import { PLACEHOLDERS } from '../lib/repo'
import type { Language, MailTemplateKey, Settings } from '../lib/types'
import { docText } from '../lib/docText'

const SECTIONS = [
  { id: 'firma', label: t('Firma'), icon: Building2 },
  { id: 'logo', label: t('Logo'), icon: Image },
  { id: 'bank', label: t('Bank & Kontakt'), icon: Landmark },
  { id: 'steuern', label: t('Steuern'), icon: Percent },
  { id: 'rechnung', label: t('Rechnungsvorgaben'), icon: ReceiptText },
  { id: 'nummern', label: t('Nummernkreise'), icon: Hash },
  { id: 'mahnwesen', label: t('Mahnwesen'), icon: BellRing },
  { id: 'layout', label: t('Layout & Farbe'), icon: Palette },
  { id: 'email', label: t('E-Mail-Vorlagen'), icon: Mail },
  { id: 'konto', label: t('Konto & Team'), icon: UserCog },
  { id: 'daten', label: t('Daten'), icon: Database },
]

async function persist(next: Settings) {
  const toSave = { ...next }
  const current = await db.settings.get('main')
  // keep the stored pattern while the edited one is invalid
  if (validatePattern(toSave.invoiceNumbers.pattern)) toSave.invoiceNumbers = current?.invoiceNumbers ?? toSave.invoiceNumbers
  if (validatePattern(toSave.quoteNumbers.pattern)) toSave.quoteNumbers = current?.quoteNumbers ?? toSave.quoteNumbers
  // counters may have advanced in another tab or through "Startnummer"
  if (current) {
    toSave.invoiceNumbers = { ...toSave.invoiceNumbers, counters: current.invoiceNumbers.counters }
    toSave.quoteNumbers = { ...toSave.quoteNumbers, counters: current.quoteNumbers.counters }
  }
  await updateSettings(toSave)
}

export function SettingsPage() {
  useDocumentTitle(t('Einstellungen'))
  const stored = useSettings()
  const [draft, setDraft] = useState<Settings | null>(null)
  const [saved, setSaved] = useState(true)
  const [textLang, setTextLang] = useState<Language>(uiLanguage())
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (stored && !draft) setDraft(stored)
  }, [stored, draft])

  const patternErrors = draft
    ? { invoice: validatePattern(draft.invoiceNumbers.pattern), quote: validatePattern(draft.quoteNumbers.pattern) }
    : { invoice: null, quote: null }

  const latest = useRef<Settings | null>(null)
  latest.current = draft

  const update = (patch: Partial<Settings>) => {
    if (!latest.current) return
    const next = { ...latest.current, ...patch }
    latest.current = next
    setDraft(next)
    setSaved(false)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => persist(next).then(() => setSaved(true)), 450)
  }

  useEffect(() => () => clearTimeout(timer.current), [])

  const { hash } = useLocation()
  const ready = !!draft
  useEffect(() => {
    if (ready && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [hash, ready])

  if (!draft) return <div className="page" />
  const d = draft.defaults
  const setDefaults = (patch: Partial<Settings['defaults']>) => update({ defaults: { ...d, ...patch } })
  const setTexts = (patch: Partial<Settings['texts']['en']>) => update({ texts: { ...draft.texts, [textLang]: { ...draft.texts[textLang], ...patch } } })
  const setMail = (key: MailTemplateKey, patch: Partial<Settings['mailTemplates']['en']['invoice']>) =>
    update({ mailTemplates: { ...draft.mailTemplates, [textLang]: { ...draft.mailTemplates[textLang], [key]: { ...draft.mailTemplates[textLang][key], ...patch } } } })

  return (
    <div className="page">
      <PageHeader
        title={t('Einstellungen')}
        subtitle={t('Deine Firmendaten und Vorgaben für jede neue Rechnung.')}
        actions={
          <div className="row wrap">
          <LanguageSwitch />
          <span className="row small muted" aria-live="polite" style={{ height: 36 }}>
            {saved ? (
              <>
                <Check size={16} color="var(--green)" aria-hidden /> {t('Automatisch gespeichert')}
              </>
            ) : (
              t('Speichert …')
            )}
          </span>
          </div>
        }
      />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('Abschnitte')}>
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#/einstellungen`} onClick={(e) => {
              e.preventDefault()
              document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}>
              <s.icon size={17} aria-hidden />
              {s.label}
            </a>
          ))}
        </nav>

        <div className="stack">
          <section id="firma" className="card card-pad anchor-target">
            <div className="form-section">
              <h3>{t('Firma')}</h3>
              <p className="muted">{t('Name und Anschrift erscheinen als Absender auf jeder Rechnung.')}</p>
              <CompanyFields value={draft.company} onChange={(company) => update({ company })} />
            </div>
          </section>

          <section id="logo" className="card card-pad anchor-target">
            <div className="form-section">
              <h3>{t('Logo')}</h3>
              <p className="muted">{t('Wird oben auf deinen Rechnungen und in der Seitenleiste angezeigt.')}</p>
              <LogoField logo={draft.logo} onChange={(logo) => update({ logo })} />
            </div>
          </section>

          <section id="bank" className="card card-pad anchor-target">
            <div className="form-section">
              <h3>{t('Bankverbindung')}</h3>
              <p className="muted">{t('Steht in der Fußzeile, damit deine Kunden wissen, wohin sie überweisen.')}</p>
              <BankFields value={draft.company} onChange={(company) => update({ company })} />
            </div>
            <div className="form-section">
              <h3>{t('Kontakt')}</h3>
              <p className="muted">{t('Optional, erscheint ebenfalls in der Fußzeile.')}</p>
              <ContactFields value={draft.company} onChange={(company) => update({ company })} />
            </div>
          </section>

          <section id="steuern" className="card card-pad anchor-target">
            <div className="form-section">
              <h3>{t('Steuerliche Angaben')}</h3>
              <p className="muted">{t('Auf jeder Rechnung muss deine Steuernummer oder USt-IdNr. stehen (§ 14 Abs. 4 Nr. 2 UStG).')}</p>
              <TaxFields value={draft.company} onChange={(company) => update({ company })} />
            </div>
            <div className="form-section stack-sm">
              <Toggle
                checked={draft.smallBusiness}
                onChange={(smallBusiness) => update({ smallBusiness, defaults: { ...d, taxRate: smallBusiness ? 0 : d.taxRate || 19 } })}
                label={t('Kleinunternehmerregelung (§ 19 UStG)')}
                description={t('Rechnungen ohne Umsatzsteuer, mit Hinweis auf die Steuerbefreiung.')}
              />
              {draft.smallBusiness && (
                <>
                  <TextLanguageSwitch value={textLang} onChange={setTextLang} />
                  <TextAreaField
                    label={t('Hinweistext auf der Rechnung')}
                    value={draft.texts[textLang].smallBusinessNote}
                    onChange={(smallBusinessNote) => setTexts({ smallBusinessNote })}
                    rows={2}
                    hint={t('Standard: „{p0}“', { p0: docText(textLang).taxNotes.smallBusiness })}
                  />
                </>
              )}
            </div>
            <div className="form-section stack-sm">
              <h3>{t('Versteuerung')}</h3>
              <p className="muted">{t('Bestimmt, wann Umsätze in der USt-Übersicht zählen. Die Ist-Versteuerung muss beim Finanzamt beantragt sein (§ 20 UStG).')}</p>
              <Segmented
                label={t('Versteuerung')}
                value={draft.taxation}
                onChange={(taxation) => update({ taxation })}
                options={[
                  { value: 'accrual', label: t('Soll – nach Rechnungsdatum') },
                  { value: 'cash', label: t('Ist – nach Zahlungseingang') },
                ]}
              />
            </div>
          </section>

          <section id="rechnung" className="card card-pad anchor-target">
            <div className="form-section">
              <h3>{t('Vorgaben für neue Rechnungen')}</h3>
              <p className="muted">{t('Diese Werte stehen automatisch in jeder neuen Rechnung und lassen sich dort anpassen.')}</p>
              <div className="form-grid">
                <Field className="span-2" label={t('Zahlungsziel')}>
                  <NumberInput value={d.paymentTermDays} onChange={(n) => setDefaults({ paymentTermDays: Math.max(0, Math.round(n)) })} suffix={t('Tage')} maxFraction={0} aria-label={t('Zahlungsziel in Tagen')} />
                </Field>
                <SelectField className="span-2" label={t('Standard-Steuersatz')} value={String(d.taxRate)} onChange={(v) => setDefaults({ taxRate: Number(v) })} disabled={draft.smallBusiness}>
                  {TAX_RATES.map((r) => (
                    <option key={r} value={r}>
                      {r} %
                    </option>
                  ))}
                </SelectField>
                <SelectField className="span-2" label={t('Währung')} value={d.currency} onChange={(currency) => setDefaults({ currency })}>
                  {['EUR', 'CHF', 'USD', 'GBP'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </SelectField>
                <Field className="span-2" label={t('Standard-Stundensatz')}>
                  <MoneyInput value={d.hourlyRateCents} onChange={(v) => setDefaults({ hourlyRateCents: v ?? 0 })} aria-label={t('Standard-Stundensatz')} />
                </Field>
                <SelectField className="span-2" label={t('Standard-Einheit')} value={d.unit} onChange={(unit) => setDefaults({ unit })}>
                  {UNITS.map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </SelectField>
                <SelectField
                  className="span-3"
                  label={t('Zeitrundung beim Abrechnen')}
                  value={String(draft.timeRounding.minutes)}
                  onChange={(v) => update({ timeRounding: { ...draft.timeRounding, minutes: Number(v) } })}
                  hint={t('Gilt je Zeiteintrag, wenn Zeiten in eine Rechnung übernommen werden.')}
                >
                  <option value="0">{t('Minutengenau')}</option>
                  {[5, 6, 10, 15, 30, 60].map((m) => (
                    <option key={m} value={m}>
                      {m === 60 ? t('Volle Stunde') : t('{p0} Minuten', { p0: m })}
                    </option>
                  ))}
                </SelectField>
                <SelectField className="span-3" label={t('Rundungsart')} value={draft.timeRounding.mode} onChange={(mode) => update({ timeRounding: { ...draft.timeRounding, mode: mode as 'up' | 'nearest' } })} disabled={!draft.timeRounding.minutes}>
                  <option value="up">{t('Aufrunden')}</option>
                  <option value="nearest">{t('Kaufmännisch runden')}</option>
                </SelectField>
                <SelectField className="span-3" label={t('Standard-Dokumentsprache')} value={draft.documentLanguage} onChange={(v) => update({ documentLanguage: v as Language })} hint={t('Kunden können eine eigene Sprache haben.')}>
                  <option value="en">English</option>
                  <option value="de">Deutsch</option>
                </SelectField>
                <div className="span-3" style={{ alignSelf: 'end' }}>
                  <TextLanguageSwitch value={textLang} onChange={setTextLang} />
                </div>
                <TextAreaField className="span-6" label={t('Einleitungstext')} value={draft.texts[textLang].intro} onChange={(intro) => setTexts({ intro })} rows={3} />
                <TextAreaField
                  className="span-6"
                  label={t('Schlusstext')}
                  value={draft.texts[textLang].closing}
                  onChange={(closing) => setTexts({ closing })}
                  rows={4}
                  hint={<>{t('Platzhalter:')} {PLACEHOLDERS.map((p) => <code key={p} className="kbd" style={{ marginRight: 4 }}>{`{${p}}`}</code>)}</>}
                />
                <TextAreaField className="span-6" label={t('Zusätzliche Fußzeile')} value={d.footerText} onChange={(footerText) => setDefaults({ footerText })} rows={2} hint={t('Optional, z. B. Geschäftsführung oder Hinweise. Firmen- und Bankdaten werden automatisch ergänzt.')} />
              </div>
            </div>
          </section>

          <section id="nummern" className="card card-pad anchor-target">
            <div className="form-section">
              <h3>{t('Nummernkreise')}</h3>
              <p className="muted">
                {t('Rechnungsnummern werden erst beim Abschließen vergeben – fortlaufend und lückenlos. Platzhalter:')} <code className="kbd">{t('{YYYY}')}</code> {t('Jahr,')} <code className="kbd">{t('{YY}')}</code>,{' '}
                <code className="kbd">{t('{MM}')}</code> {t('Monat,')} <code className="kbd">{'{0001}'}</code> {t('Zähler mit Stellen.')}
              </p>
              <div className="form-grid">
                <TextField
                  className="span-3"
                  label={t('Rechnungen')}
                  value={draft.invoiceNumbers.pattern}
                  onChange={(pattern) => update({ invoiceNumbers: { ...draft.invoiceNumbers, pattern } })}
                  error={patternErrors.invoice}
                  hint={!patternErrors.invoice && t('Nächste Nummer: {p0}', { p0: peekNextNumber(draft.invoiceNumbers, new Date(today())) })}
                  spellCheck={false}
                />
                <TextField
                  className="span-3"
                  label={t('Angebote')}
                  value={draft.quoteNumbers.pattern}
                  onChange={(pattern) => update({ quoteNumbers: { ...draft.quoteNumbers, pattern } })}
                  error={patternErrors.quote}
                  hint={!patternErrors.quote && t('Nächste Nummer: {p0}', { p0: peekNextNumber(draft.quoteNumbers, new Date(today())) })}
                  spellCheck={false}
                />
              </div>
              <StartNumber settings={stored ?? draft} />
            </div>
          </section>

          <section id="mahnwesen" className="card card-pad anchor-target">
            <div className="form-section">
              <h3>{t('Mahnwesen')}</h3>
              <p className="muted">{t('Fristen, Gebühren und Texte für Zahlungserinnerung und Mahnungen. Die Tage zählen ab Fälligkeit bzw. ab Ablauf der vorherigen Frist.')}</p>
              <TextLanguageSwitch value={textLang} onChange={setTextLang} />
              <div className="stack" style={{ marginTop: 14 }}>
                {draft.dunning.steps.map((step, i) => {
                  const setStep = (patch: Partial<typeof step>) => {
                    const steps = draft.dunning.steps.map((x, j) => (j === i ? { ...x, ...patch } : x)) as Settings['dunning']['steps']
                    update({ dunning: { ...draft.dunning, steps } })
                  }
                  return (
                    <div key={i} className="form-grid dunning-step">
                      <TextField className="span-2" label={t('Stufe {p0}', { p0: i + 1 })} value={step.title[textLang]} onChange={(title) => setStep({ title: { ...step.title, [textLang]: title } })} />
                      <Field className="span-2" label={i === 0 ? t('Tage nach Fälligkeit') : t('Tage nach letzter Frist')}>
                        <NumberInput value={step.afterDays} onChange={(n) => setStep({ afterDays: Math.max(0, Math.round(n)) })} suffix={t('Tage')} maxFraction={0} aria-label={t('Abstand Stufe {p0}', { p0: i + 1 })} />
                      </Field>
                      <Field className="span-2" label={t('Gebühr')}>
                        <MoneyInput value={step.feeCents} onChange={(v) => setStep({ feeCents: v ?? 0 })} aria-label={t('Gebühr Stufe {p0}', { p0: i + 1 })} />
                      </Field>
                      <TextAreaField className="span-6" label={t('Text')} value={step.text[textLang]} onChange={(text) => setStep({ text: { ...step.text, [textLang]: text } })} rows={3} />
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="form-section">
              <h3>{t('Verzugszinsen')}</h3>
              <p className="muted">
                {t('Basiszinssatz nach § 247 BGB – die Bundesbank passt ihn zum 1. Januar und 1. Juli an. Verzugszins: Basiszins + 9 Prozentpunkte gegenüber Unternehmen, + 5 gegenüber Verbrauchern.')}
              </p>
              <div className="form-grid">
                <Field className="span-2" label={t('Basiszinssatz')}>
                  <NumberInput value={draft.dunning.baseRatePercent} onChange={(baseRatePercent) => update({ dunning: { ...draft.dunning, baseRatePercent } })} suffix="%" maxFraction={2} aria-label={t('Basiszinssatz')} />
                </Field>
                <TextField className="span-2" label={t('Gültig seit')} type="date" value={draft.dunning.baseRateSince} onChange={(baseRateSince) => update({ dunning: { ...draft.dunning, baseRateSince } })} />
                <Field className="span-2" label={t('Neue Zahlungsfrist')}>
                  <NumberInput value={draft.dunning.deadlineDays} onChange={(n) => update({ dunning: { ...draft.dunning, deadlineDays: Math.max(1, Math.round(n)) } })} suffix={t('Tage')} maxFraction={0} aria-label={t('Neue Zahlungsfrist')} />
                </Field>
              </div>
              <div className="stack-sm" style={{ marginTop: 14 }}>
                <Toggle checked={draft.dunning.chargeInterest} onChange={(chargeInterest) => update({ dunning: { ...draft.dunning, chargeInterest } })} label={t('Verzugszinsen ab der 1. Mahnung vorschlagen')} />
                <Toggle checked={draft.dunning.flatFeeB2B} onChange={(flatFeeB2B) => update({ dunning: { ...draft.dunning, flatFeeB2B } })} label={t('Verzugspauschale 40 € bei Unternehmen vorschlagen')} description={t('§ 288 Abs. 5 BGB, einmal je Forderung.')} />
              </div>
            </div>
          </section>

          <section id="layout" className="card card-pad anchor-target">
            <div className="form-section">
              <h3>{t('Standard-Layout')}</h3>
              <p className="muted">{t('Gilt für neue Rechnungen. Jede Rechnung kann ein eigenes Layout bekommen.')}</p>
              <LayoutPicker settings={draft} value={d.layout} onChange={(layout) => setDefaults({ layout })} accent={d.accentColor} />
            </div>
            <div className="form-section">
              <h3>{t('Akzentfarbe')}</h3>
              <p className="muted">{t('Für Überschriften, Linien und Hervorhebungen auf der Rechnung.')}</p>
              <AccentPicker value={d.accentColor} onChange={(accentColor) => setDefaults({ accentColor })} />
            </div>
          </section>

          <section id="email" className="card card-pad anchor-target">
            <div className="form-section">
              <h3>{t('E-Mail-Vorlagen')}</h3>
              <p className="muted">
                {t('Betreff und Text beim Versand. Platzhalter:')} {MAIL_PLACEHOLDERS.map((p) => <code key={p} className="kbd" style={{ marginRight: 4 }}>{`{${p}}`}</code>)} {t('Die Vorlage folgt der Sprache des Dokuments.')}
              </p>
              <TextLanguageSwitch value={textLang} onChange={setTextLang} />
              <div className="stack" style={{ marginTop: 14 }}>
                {(Object.keys(MAIL_TEMPLATE_LABELS) as MailTemplateKey[]).map((key) => (
                  <div key={key} className="form-grid dunning-step">
                    <TextField className="span-6" label={t('{p0}: Betreff', { p0: t(MAIL_TEMPLATE_LABELS[key]) })} value={draft.mailTemplates[textLang][key].subject} onChange={(subject) => setMail(key, { subject })} />
                    <TextAreaField className="span-6" label={t('Text')} value={draft.mailTemplates[textLang][key].body} onChange={(body) => setMail(key, { body })} rows={5} />
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section id="konto" className="card card-pad anchor-target">
            <AccountSettings />
            <TeamSettings />
            <SmtpSettings />
          </section>

          <DataSection />
        </div>
      </div>
    </div>
  )
}

function StartNumber({ settings }: { settings: Settings }) {
  const { confirm, run } = useFeedback()
  const [value, setValue] = useState(1)
  const key = settings.invoiceNumbers.pattern.includes('{YYYY}') || settings.invoiceNumbers.pattern.includes('{YY}') ? String(new Date().getFullYear()) : 'all'
  const current = settings.invoiceNumbers.counters[key] ?? 0
  if (validatePattern(settings.invoiceNumbers.pattern) || settings.invoiceNumbers.pattern.includes('{MM}')) return null

  return (
    <details style={{ marginTop: 18 }}>
      <summary className="small" style={{ cursor: 'pointer', color: 'var(--accent)' }}>
        {t('Von einem anderen Programm gewechselt? Startnummer festlegen')}
      </summary>
      <div className="row wrap" style={{ marginTop: 12, alignItems: 'flex-end' }}>
        <Field label={t('Nächste Rechnung erhält Zähler')}>
          <NumberInput value={Math.max(value, current + 1)} onChange={(n) => setValue(Math.round(n))} maxFraction={0} style={{ width: 120 }} aria-label={t('Nächster Zähler')} />
        </Field>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const next = Math.max(value, current + 1)
            const ok = await confirm({
              title: t('Startnummer übernehmen?'),
              message: t('Die nächste Rechnung erhält den Zähler {p0}. Der Zähler kann danach nur weiter steigen, damit keine Nummer doppelt vergeben wird.', { p0: next }),
              confirmLabel: t('Übernehmen'),
            })
            if (!ok) return
            run(async () => {
              const s = await db.settings.get('main')
              if (!s) return
              await updateSettings({ invoiceNumbers: { ...s.invoiceNumbers, counters: { ...s.invoiceNumbers.counters, [key]: next - 1 } } })
            }, t('Startnummer gespeichert'))
          }}
        >
          {t('Übernehmen')}
        </button>
      </div>
      <p className="hint small faint" style={{ marginTop: 8 }}>
        {t('Aktueller Zählerstand:')} {current}{t('. Ein Zurücksetzen ist bewusst nicht möglich.')}
      </p>
    </details>
  )
}

function DataSection() {
  const { confirm, run, toast } = useFeedback()
  const { user } = useSession()
  const owner = user?.role === 'owner'
  const file = useRef<HTMLInputElement>(null)
  const [legacy, setLegacy] = useState<Backup | null>(null)
  const [backups, setBackups] = useState<{ files: { name: string; size: number; at: string }[]; keepDays: number; intervalHours: number } | null>(null)
  const [audit, setAudit] = useState<{ at: string; action: string; collection: string | null; summary: string; email: string | null }[] | null>(null)

  useEffect(() => {
    void readLegacyBrowserData()
      .then(setLegacy)
      .catch(() => undefined)
    if (owner) void api<NonNullable<typeof backups>>('/api/backups').then(setBackups).catch(() => undefined)
  }, [owner])

  const restore = async (backup: Backup, mode: 'replace' | 'merge') => {
    await api('/api/backup/restore', { body: { backup, mode } })
    invalidate('all')
  }

  const exportCsv = () =>
    run(async () => {
      const [docs, customers] = await Promise.all([db.documents.toArray(), db.customers.toArray()])
      if (!docs.some((d) => d.status !== 'draft' && d.kind !== 'quote')) {
        toast(t('Noch keine abgeschlossenen Rechnungen vorhanden.'), 'error')
        return
      }
      downloadFile(`kontor-invoices-${today()}.csv`, invoicesToCsv(docs, customers), 'text/csv;charset=utf-8')
    })

  const importJson = async (f: File | undefined) => {
    if (!f) return
    await run(async () => {
      const backup = parseBackup(await f.text())
      const ok = await confirm({
        title: t('Sicherung wiederherstellen?'),
        message: t('Alle Daten im Arbeitsbereich werden durch die Sicherung vom {p0} ersetzt ({p1} Kunden, {p2} Dokumente, {p3} Zeiteinträge). Der Vorgang wird protokolliert.', { p0: backup.exportedAt ? new Date(backup.exportedAt).toLocaleString(uiLocale()) : '–', p1: backup.customers.length, p2: backup.documents.length, p3: backup.timeEntries.length }),
        confirmLabel: t('Wiederherstellen'),
        danger: true,
      })
      if (!ok) return
      await restore(backup, 'replace')
      toast(t('Sicherung wiederhergestellt'))
    })
  }

  const importLegacy = async () => {
    if (!legacy) return
    const ok = await confirm({
      title: t('Daten aus diesem Browser übernehmen?'),
      message: t('{p1} Kunden, {p2} Dokumente und {p3} Zeiteinträge aus der früheren, rein lokalen Version werden auf den Server übertragen und mit den vorhandenen Daten zusammengeführt.', { p1: legacy.customers.length, p2: legacy.documents.length, p3: legacy.timeEntries.length }),
      confirmLabel: t('Übernehmen'),
    })
    if (!ok) return
    const done = await run(async () => {
      await restore(legacy, 'merge')
      return true
    }, t('Daten übernommen'))
    if (done && (await confirm({ title: t('Lokale Kopie löschen?'), message: t('Die Daten liegen jetzt auf dem Server. Die alte Kopie in diesem Browser wird nicht mehr gebraucht.'), confirmLabel: t('Löschen') }))) {
      await deleteLegacyBrowserData()
      setLegacy(null)
    }
  }

  return (
    <section id="daten" className="card card-pad anchor-target">
      <div className="form-section">
        <h3>{t('Daten & Sicherung')}</h3>
        <p className="muted">
          {t('Alle Daten liegen auf deinem Kontor-Server; der Browser speichert nichts. Der Server legt automatisch Sicherungen der Datenbank an. Zusätzlich kannst du jederzeit eine vollständige Sicherung als Datei herunterladen. Rechnungen musst du 8 Jahre aufbewahren (GoBD).')}
        </p>
        <div className="row wrap">
          <a className="btn primary" href="/api/backup" download>
            <Download size={17} aria-hidden /> {t('Sicherung herunterladen')}
          </a>
          {owner && (
            <button type="button" className="btn" onClick={() => file.current?.click()}>
              <Upload size={17} aria-hidden /> {t('Sicherung einspielen')}
            </button>
          )}
          <button type="button" className="btn" onClick={exportCsv}>
            <FileSpreadsheet size={17} aria-hidden /> {t('Rechnungen als CSV')}
          </button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => {
            void importJson(e.target.files?.[0])
            e.target.value = ''
          }} />
        </div>
        {backups && (
          <p className="small muted" style={{ marginTop: 12 }}>
            {backups.files.length
              ? t('Letzte automatische Sicherung: {p0} · {p1} Sicherungen, aufbewahrt {p2} Tage.', { p0: new Date(backups.files[0].at).toLocaleString(uiLocale()), p1: backups.files.length, p2: backups.keepDays })
              : backups.intervalHours
                ? t('Die erste automatische Sicherung entsteht beim nächsten Serverstart.')
                : t('Automatische Sicherungen sind abgeschaltet (BACKUP_INTERVAL_HOURS=0).')}
          </p>
        )}
      </div>
      {legacy && owner && (
        <div className="form-section">
          <h3>{t('Daten aus diesem Browser übernehmen')}</h3>
          <p className="muted">{t('In diesem Browser liegen noch Daten der früheren, rein lokalen Version von Kontor. Übertrage sie einmalig auf den Server.')}</p>
          <button type="button" className="btn primary" onClick={importLegacy}>
            <Upload size={17} aria-hidden /> {t('Jetzt übernehmen')}
          </button>
        </div>
      )}
      <div className="form-section">
        <h3>{t('Protokoll')}</h3>
        <p className="muted">{t('Abschlüsse, Zahlungen, Änderungen an Rechnungen und Einstellungen werden auf dem Server protokolliert.')}</p>
        {audit ? (
          <ul className="list audit-list">
            {audit.map((a, i) => (
              <li key={i} className="list-item">
                <span className="grow">
                  <span className="title" style={{ display: 'block' }}>
                    {a.action}
                    {a.collection ? ` · ${a.collection}` : ''} {a.summary}
                  </span>
                  <span className="sub">
                    {new Date(a.at).toLocaleString(uiLocale())}
                    {a.email ? ` · ${a.email}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Button size="sm" onClick={() => run(async () => setAudit((await api<{ entries: NonNullable<typeof audit> }>('/api/audit?limit=100')).entries))}>
            {t('Protokoll anzeigen')}
          </Button>
        )}
      </div>
    </section>
  )
}

/** Picks which language's texts are being edited. */
function TextLanguageSwitch({ value, onChange }: { value: Language; onChange: (l: Language) => void }) {
  return (
    <Segmented<Language>
      label={t('Sprache der Texte')}
      value={value}
      onChange={onChange}
      options={[
        { value: 'en', label: t('Texte auf Englisch') },
        { value: 'de', label: t('Texte auf Deutsch') },
      ]}
    />
  )
}
