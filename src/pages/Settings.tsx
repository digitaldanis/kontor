import {
  Building2,
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
  Trash2,
  Upload,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { Field, MoneyInput, NumberInput, PageHeader, Segmented, SelectField, TextAreaField, TextField, Toggle } from '../components/ui'
import { createBackup, downloadFile, invoicesToCsv, parseBackup, restoreBackup, wipeAll } from '../lib/backup'
import { today } from '../lib/dates'
import { db } from '../lib/db'
import { TAX_NOTES, TAX_RATES, UNITS } from '../lib/defaults'
import { useDocumentTitle, useSettings } from '../lib/hooks'
import { peekNextNumber, validatePattern } from '../lib/numbering'
import { PLACEHOLDERS, updateSettings } from '../lib/repo'
import type { Settings } from '../lib/types'

const SECTIONS = [
  { id: 'firma', label: 'Firma', icon: Building2 },
  { id: 'logo', label: 'Logo', icon: Image },
  { id: 'bank', label: 'Bank & Kontakt', icon: Landmark },
  { id: 'steuern', label: 'Steuern', icon: Percent },
  { id: 'rechnung', label: 'Rechnungsvorgaben', icon: ReceiptText },
  { id: 'nummern', label: 'Nummernkreise', icon: Hash },
  { id: 'layout', label: 'Layout & Farbe', icon: Palette },
  { id: 'daten', label: 'Daten', icon: Database },
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
  useDocumentTitle('Einstellungen')
  const stored = useSettings()
  const [draft, setDraft] = useState<Settings | null>(null)
  const [saved, setSaved] = useState(true)
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

  if (!draft) return <div className="page" />
  const d = draft.defaults
  const setDefaults = (patch: Partial<Settings['defaults']>) => update({ defaults: { ...d, ...patch } })

  return (
    <div className="page">
      <PageHeader
        title="Einstellungen"
        subtitle="Deine Firmendaten und Vorgaben für jede neue Rechnung."
        actions={
          <span className="row small muted" aria-live="polite" style={{ height: 36 }}>
            {saved ? (
              <>
                <Check size={16} color="var(--green)" aria-hidden /> Automatisch gespeichert
              </>
            ) : (
              'Speichert …'
            )}
          </span>
        }
      />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Abschnitte">
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
              <h3>Firma</h3>
              <p className="muted">Name und Anschrift erscheinen als Absender auf jeder Rechnung.</p>
              <CompanyFields value={draft.company} onChange={(company) => update({ company })} />
            </div>
          </section>

          <section id="logo" className="card card-pad anchor-target">
            <div className="form-section">
              <h3>Logo</h3>
              <p className="muted">Wird oben auf deinen Rechnungen und in der Seitenleiste angezeigt.</p>
              <LogoField logo={draft.logo} onChange={(logo) => update({ logo })} />
            </div>
          </section>

          <section id="bank" className="card card-pad anchor-target">
            <div className="form-section">
              <h3>Bankverbindung</h3>
              <p className="muted">Steht in der Fußzeile, damit deine Kunden wissen, wohin sie überweisen.</p>
              <BankFields value={draft.company} onChange={(company) => update({ company })} />
            </div>
            <div className="form-section">
              <h3>Kontakt</h3>
              <p className="muted">Optional, erscheint ebenfalls in der Fußzeile.</p>
              <ContactFields value={draft.company} onChange={(company) => update({ company })} />
            </div>
          </section>

          <section id="steuern" className="card card-pad anchor-target">
            <div className="form-section">
              <h3>Steuerliche Angaben</h3>
              <p className="muted">Auf jeder Rechnung muss deine Steuernummer oder USt-IdNr. stehen (§ 14 Abs. 4 Nr. 2 UStG).</p>
              <TaxFields value={draft.company} onChange={(company) => update({ company })} />
            </div>
            <div className="form-section stack-sm">
              <Toggle
                checked={draft.smallBusiness}
                onChange={(smallBusiness) => update({ smallBusiness, defaults: { ...d, taxRate: smallBusiness ? 0 : d.taxRate || 19 } })}
                label="Kleinunternehmerregelung (§ 19 UStG)"
                description="Rechnungen ohne Umsatzsteuer, mit Hinweis auf die Steuerbefreiung."
              />
              {draft.smallBusiness && (
                <TextAreaField
                  label="Hinweistext auf der Rechnung"
                  value={draft.smallBusinessNote}
                  onChange={(smallBusinessNote) => update({ smallBusinessNote })}
                  rows={2}
                  hint={`Standard: „${TAX_NOTES.smallBusiness}“`}
                />
              )}
            </div>
            <div className="form-section stack-sm">
              <h3>Versteuerung</h3>
              <p className="muted">Bestimmt, wann Umsätze in der USt-Übersicht zählen. Die Ist-Versteuerung muss beim Finanzamt beantragt sein (§ 20 UStG).</p>
              <Segmented
                label="Versteuerung"
                value={draft.taxation}
                onChange={(taxation) => update({ taxation })}
                options={[
                  { value: 'accrual', label: 'Soll – nach Rechnungsdatum' },
                  { value: 'cash', label: 'Ist – nach Zahlungseingang' },
                ]}
              />
            </div>
          </section>

          <section id="rechnung" className="card card-pad anchor-target">
            <div className="form-section">
              <h3>Vorgaben für neue Rechnungen</h3>
              <p className="muted">Diese Werte stehen automatisch in jeder neuen Rechnung und lassen sich dort anpassen.</p>
              <div className="form-grid">
                <Field className="span-2" label="Zahlungsziel">
                  <NumberInput value={d.paymentTermDays} onChange={(n) => setDefaults({ paymentTermDays: Math.max(0, Math.round(n)) })} suffix="Tage" maxFraction={0} aria-label="Zahlungsziel in Tagen" />
                </Field>
                <SelectField className="span-2" label="Standard-Steuersatz" value={String(d.taxRate)} onChange={(v) => setDefaults({ taxRate: Number(v) })} disabled={draft.smallBusiness}>
                  {TAX_RATES.map((r) => (
                    <option key={r} value={r}>
                      {r} %
                    </option>
                  ))}
                </SelectField>
                <SelectField className="span-2" label="Währung" value={d.currency} onChange={(currency) => setDefaults({ currency })}>
                  {['EUR', 'CHF', 'USD', 'GBP'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </SelectField>
                <Field className="span-2" label="Standard-Stundensatz">
                  <MoneyInput value={d.hourlyRateCents} onChange={(v) => setDefaults({ hourlyRateCents: v ?? 0 })} aria-label="Standard-Stundensatz" />
                </Field>
                <SelectField className="span-2" label="Standard-Einheit" value={d.unit} onChange={(unit) => setDefaults({ unit })}>
                  {UNITS.map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </SelectField>
                <TextAreaField className="span-6" label="Einleitungstext" value={d.introText} onChange={(introText) => setDefaults({ introText })} rows={3} />
                <TextAreaField
                  className="span-6"
                  label="Schlusstext"
                  value={d.closingText}
                  onChange={(closingText) => setDefaults({ closingText })}
                  rows={4}
                  hint={<>Platzhalter: {PLACEHOLDERS.map((p) => <code key={p} className="kbd" style={{ marginRight: 4 }}>{`{${p}}`}</code>)}</>}
                />
                <TextAreaField className="span-6" label="Zusätzliche Fußzeile" value={d.footerText} onChange={(footerText) => setDefaults({ footerText })} rows={2} hint="Optional, z. B. Geschäftsführung oder Hinweise. Firmen- und Bankdaten werden automatisch ergänzt." />
              </div>
            </div>
          </section>

          <section id="nummern" className="card card-pad anchor-target">
            <div className="form-section">
              <h3>Nummernkreise</h3>
              <p className="muted">
                Rechnungsnummern werden erst beim Abschließen vergeben – fortlaufend und lückenlos. Platzhalter: <code className="kbd">{'{YYYY}'}</code> Jahr, <code className="kbd">{'{YY}'}</code>,{' '}
                <code className="kbd">{'{MM}'}</code> Monat, <code className="kbd">{'{0001}'}</code> Zähler mit Stellen.
              </p>
              <div className="form-grid">
                <TextField
                  className="span-3"
                  label="Rechnungen"
                  value={draft.invoiceNumbers.pattern}
                  onChange={(pattern) => update({ invoiceNumbers: { ...draft.invoiceNumbers, pattern } })}
                  error={patternErrors.invoice}
                  hint={!patternErrors.invoice && `Nächste Nummer: ${peekNextNumber(draft.invoiceNumbers, new Date(today()))}`}
                  spellCheck={false}
                />
                <TextField
                  className="span-3"
                  label="Angebote"
                  value={draft.quoteNumbers.pattern}
                  onChange={(pattern) => update({ quoteNumbers: { ...draft.quoteNumbers, pattern } })}
                  error={patternErrors.quote}
                  hint={!patternErrors.quote && `Nächste Nummer: ${peekNextNumber(draft.quoteNumbers, new Date(today()))}`}
                  spellCheck={false}
                />
              </div>
              <StartNumber settings={stored ?? draft} />
            </div>
          </section>

          <section id="layout" className="card card-pad anchor-target">
            <div className="form-section">
              <h3>Standard-Layout</h3>
              <p className="muted">Gilt für neue Rechnungen. Jede Rechnung kann ein eigenes Layout bekommen.</p>
              <LayoutPicker settings={draft} value={d.layout} onChange={(layout) => setDefaults({ layout })} accent={d.accentColor} />
            </div>
            <div className="form-section">
              <h3>Akzentfarbe</h3>
              <p className="muted">Für Überschriften, Linien und Hervorhebungen auf der Rechnung.</p>
              <AccentPicker value={d.accentColor} onChange={(accentColor) => setDefaults({ accentColor })} />
            </div>
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
        Von einem anderen Programm gewechselt? Startnummer festlegen
      </summary>
      <div className="row wrap" style={{ marginTop: 12, alignItems: 'flex-end' }}>
        <Field label="Nächste Rechnung erhält Zähler">
          <NumberInput value={Math.max(value, current + 1)} onChange={(n) => setValue(Math.round(n))} maxFraction={0} style={{ width: 120 }} aria-label="Nächster Zähler" />
        </Field>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const next = Math.max(value, current + 1)
            const ok = await confirm({
              title: 'Startnummer übernehmen?',
              message: `Die nächste Rechnung erhält den Zähler ${next}. Der Zähler kann danach nur weiter steigen, damit keine Nummer doppelt vergeben wird.`,
              confirmLabel: 'Übernehmen',
            })
            if (!ok) return
            run(async () => {
              const s = await db.settings.get('main')
              if (!s) return
              await updateSettings({ invoiceNumbers: { ...s.invoiceNumbers, counters: { ...s.invoiceNumbers.counters, [key]: next - 1 } } })
            }, 'Startnummer gespeichert')
          }}
        >
          Übernehmen
        </button>
      </div>
      <p className="hint small faint" style={{ marginTop: 8 }}>
        Aktueller Zählerstand: {current}. Ein Zurücksetzen ist bewusst nicht möglich.
      </p>
    </details>
  )
}

function DataSection() {
  const { confirm, run, toast } = useFeedback()
  const navigate = useNavigate()
  const file = useRef<HTMLInputElement>(null)

  const exportJson = () =>
    run(async () => {
      const b = await createBackup()
      downloadFile(`kontor-sicherung-${today()}.json`, JSON.stringify(b, null, 2), 'application/json')
    }, 'Sicherung heruntergeladen')

  const exportCsv = () =>
    run(async () => {
      const [docs, customers] = await Promise.all([db.documents.toArray(), db.customers.toArray()])
      if (!docs.some((d) => d.status !== 'draft' && d.kind !== 'quote')) {
        toast('Noch keine abgeschlossenen Rechnungen vorhanden.', 'error')
        return
      }
      downloadFile(`kontor-rechnungen-${today()}.csv`, invoicesToCsv(docs, customers), 'text/csv;charset=utf-8')
    })

  const importJson = async (f: File | undefined) => {
    if (!f) return
    await run(async () => {
      const backup = parseBackup(await f.text())
      const ok = await confirm({
        title: 'Sicherung wiederherstellen?',
        message: `Alle aktuellen Daten in diesem Browser werden durch die Sicherung vom ${backup.exportedAt ? new Date(backup.exportedAt).toLocaleString('de-DE') : 'unbekannten Datum'} ersetzt (${backup.customers.length} Kunden, ${backup.documents.length} Dokumente, ${backup.timeEntries.length} Zeiteinträge).`,
        confirmLabel: 'Wiederherstellen',
        danger: true,
      })
      if (!ok) return
      await restoreBackup(backup)
      toast('Sicherung wiederhergestellt')
      window.location.reload()
    })
  }

  return (
    <section id="daten" className="card card-pad anchor-target">
      <div className="form-section">
        <h3>Daten & Sicherung</h3>
        <p className="muted">
          Kontor speichert alles lokal in diesem Browser – ohne Server und ohne Konto. Lade regelmäßig eine Sicherung herunter, damit nichts verloren geht. Rechnungen musst du 8 Jahre aufbewahren (GoBD).
        </p>
        <div className="row wrap">
          <button type="button" className="btn primary" onClick={exportJson}>
            <Download size={17} aria-hidden /> Sicherung herunterladen
          </button>
          <button type="button" className="btn" onClick={() => file.current?.click()}>
            <Upload size={17} aria-hidden /> Sicherung einspielen
          </button>
          <button type="button" className="btn" onClick={exportCsv}>
            <FileSpreadsheet size={17} aria-hidden /> Rechnungen als CSV
          </button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => {
            importJson(e.target.files?.[0])
            e.target.value = ''
          }} />
        </div>
      </div>
      <div className="form-section">
        <h3>Alles löschen</h3>
        <p className="muted">Entfernt alle Kunden, Rechnungen, Zeiten und Einstellungen aus diesem Browser.</p>
        <button
          type="button"
          className="btn danger"
          onClick={async () => {
            const ok = await confirm({
              title: 'Wirklich alle Daten löschen?',
              message: 'Das lässt sich nicht rückgängig machen. Lade vorher eine Sicherung herunter, wenn du die Daten noch brauchst.',
              confirmLabel: 'Alles löschen',
              danger: true,
            })
            if (!ok) return
            await run(wipeAll)
            navigate('/willkommen')
            window.location.reload()
          }}
        >
          <Trash2 size={17} aria-hidden /> Alle Daten löschen
        </button>
      </div>
    </section>
  )
}
