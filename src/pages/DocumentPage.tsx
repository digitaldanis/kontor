import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Copy,
  Download,
  FileCheck2,
  FileCode2,
  Info,
  Lock,
  Plus,
  Printer,
  Trash2,
  Undo2,
  UserPlus,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { StatusBadge } from '../components/DocumentsTable'
import { useFeedback } from '../components/feedback'
import { InvoicePreview, ScaledPage } from '../components/InvoicePreview'
import { AccentPicker } from '../components/SettingsFields'
import { Button, Dialog, Field, IconButton, MoneyInput, NumberInput, Segmented, SelectField, TextAreaField, TextField } from '../components/ui'
import { calculateTotals, lineTotal } from '../lib/calc'
import { COUNTRIES } from '../lib/countries'
import { addDays, daysBetween, formatDate, parseISODate, today } from '../lib/dates'
import { db } from '../lib/db'
import { customerName, recipientFromCustomer, recipientName, TAX_MODE_LABELS, TAX_NOTES, TAX_RATES, UNITS } from '../lib/defaults'
import { eInvoiceIssues, type EInvoiceProfile } from '../lib/einvoice'
import { downloadPdf, downloadXml, printDocument } from '../lib/exporters'
import { useCustomers, useDocumentTitle, useMediaQuery, useSettings } from '../lib/hooks'
import { buildInvoiceView, sellerFor } from '../lib/invoiceView'
import { formatMoney, formatNumber } from '../lib/money'
import { peekNextNumber } from '../lib/numbering'
import {
  cancelInvoice,
  deleteDraft,
  duplicateDocument,
  emptyCustomer,
  finalizeDocument,
  invoiceTimeEntries,
  newLineItem,
  releaseTimeEntries,
  saveCustomer,
  saveDocument,
  setPaid,
  setQuoteStatus,
} from '../lib/repo'
import { documentLabel, displayStatus } from '../lib/status'
import type { InvoiceDocument, LayoutId, LineItem, Settings, TaxMode } from '../lib/types'
import { hasBlockingIssues, validateInvoice, type Issue } from '../lib/validation'
import { NotFound } from './NotFound'
import './editor.css'

export function DocumentPage() {
  const { id = '' } = useParams()
  const settings = useSettings()
  const result = useLiveQuery(async () => ({ doc: (await db.documents.get(id)) ?? null }), [id])

  if (!result || !settings) return <div className="page" />
  if (!result.doc) return <NotFound />
  if (result.doc.status === 'draft') return <DraftEditor key={result.doc.id} initial={result.doc} settings={settings} />
  return <DocumentViewer doc={result.doc} settings={settings} />
}

function IssueList({ issues }: { issues: Issue[] }) {
  const icon = { error: XCircle, warning: AlertTriangle, info: Info }
  return (
    <ul className="issues">
      {issues.map((i, n) => {
        const Icon = icon[i.level]
        return (
          <li key={n} className={i.level}>
            <Icon size={16} aria-hidden />
            <span>{i.message}</span>
          </li>
        )
      })}
    </ul>
  )
}

function ComplianceCard({ issues }: { issues: Issue[] }) {
  const errors = issues.filter((i) => i.level === 'error')
  const rest = issues.filter((i) => i.level !== 'error')
  return (
    <section className={`card card-pad compliance ${errors.length ? 'has-errors' : 'ok'}`} aria-live="polite">
      <div className="row" style={{ marginBottom: issues.length ? 12 : 0 }}>
        {errors.length ? <AlertCircle size={20} color="var(--red)" aria-hidden /> : <CheckCircle2 size={20} color="var(--green)" aria-hidden />}
        <div>
          <strong>{errors.length ? `${errors.length} Pflichtangabe${errors.length > 1 ? 'n' : ''} fehlt` : 'Alle Pflichtangaben vorhanden'}</strong>
          <div className="small muted">Geprüft nach § 14 Abs. 4 UStG und Art. 226 MwStSystRL</div>
        </div>
      </div>
      {issues.length > 0 && <IssueList issues={[...errors, ...rest]} />}
    </section>
  )
}

function DraftEditor({ initial, settings }: { initial: InvoiceDocument; settings: Settings }) {
  const navigate = useNavigate()
  const { run, confirm, toast } = useFeedback()
  const customers = useCustomers()
  const [doc, setDoc] = useState(initial)
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit')
  const [finalizing, setFinalizing] = useState(false)
  const narrow = useMediaQuery('(max-width: 1180px)')
  const pending = useRef<InvoiceDocument | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const isQuote = doc.kind === 'quote'
  useDocumentTitle(`${documentLabel(doc)} (Entwurf)`)

  const unbilledCount = useLiveQuery(
    async () => (doc.customerId ? db.timeEntries.where('customerId').equals(doc.customerId).filter((e) => !e.invoiceId && e.billable).count() : 0),
    [doc.customerId],
  )

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const p = pending.current
    pending.current = null
    if (p) await saveDocument(p)
  }, [])

  useEffect(() => () => void flush().catch(() => undefined), [flush])

  const update = (patch: Partial<InvoiceDocument>) => {
    setDoc((d) => {
      const next = { ...d, ...patch }
      pending.current = next
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), 400)
      return next
    })
  }

  const setItems = (fn: (items: LineItem[]) => LineItem[]) => {
    setDoc((d) => {
      const next = { ...d, items: fn(d.items) }
      pending.current = next
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), 400)
      return next
    })
  }

  const issues = useMemo(() => validateInvoice(doc, settings.company), [doc, settings.company])
  const blocking = hasBlockingIssues(issues)
  const view = useMemo(() => buildInvoiceView(doc, settings), [doc, settings])
  const totals = view.raw

  const chooseCustomer = (customerId: string) => {
    if (!customerId) {
      update({ customerId: null })
      return
    }
    const c = customers?.find((x) => x.id === customerId)
    if (!c) return
    const recipient = recipientFromCustomer(c)
    const term = c.paymentTermDays ?? settings.defaults.paymentTermDays
    const mode = suggestMode(settings, recipient.country, recipient.vatId)
    update({ customerId, recipient, dueDate: addDays(doc.issueDate, term), ...taxModePatch(doc, mode, settings) })
  }

  const saveAsCustomer = () =>
    run(async () => {
      const r = doc.recipient
      if (!r.company && !r.contactPerson) throw new Error('Bitte zuerst Firma oder Name eintragen.')
      const c = await saveCustomer({ ...emptyCustomer(), ...r, phone: '' })
      update({ customerId: c.id })
    }, 'Als Kunde gespeichert')

  const importTime = async () => {
    if (!doc.customerId) return
    await flush()
    const entries = await db.timeEntries.where('customerId').equals(doc.customerId).filter((e) => !e.invoiceId && e.billable).toArray()
    const updated = await run(() => invoiceTimeEntries(doc.customerId!, entries.map((e) => e.id), 'entry', doc.id), `${entries.length} Zeiteinträge übernommen`)
    if (updated) setDoc(updated)
  }

  const removeItem = (item: LineItem) => {
    setItems((items) => items.filter((i) => i.id !== item.id))
    if (item.timeEntryIds?.length) {
      void flush().then(() => releaseTimeEntries(item.timeEntryIds!))
      toast('Zugehörige Zeiten sind wieder offen')
    }
  }

  const finalize = async () => {
    await flush()
    const result = await run(() => finalizeDocument(doc.id), isQuote ? 'Angebot abgeschlossen' : 'Rechnung abgeschlossen')
    setFinalizing(false)
    if (result) window.scrollTo({ top: 0 })
  }

  const remove = async () => {
    const ok = await confirm({ title: 'Entwurf löschen?', message: 'Der Entwurf wird entfernt. Übernommene Zeiten werden wieder als offen markiert.', confirmLabel: 'Löschen', danger: true })
    if (!ok) return
    clearTimeout(timer.current)
    pending.current = null
    await run(() => deleteDraft(doc.id), 'Entwurf gelöscht')
    navigate(isQuote ? '/rechnungen?art=angebote' : '/rechnungen')
  }

  const r = doc.recipient
  const setR = (patch: Partial<typeof r>) => {
    const recipient = { ...r, ...patch }
    const changes: Partial<InvoiceDocument> = { recipient }
    if ('country' in patch || 'vatId' in patch) Object.assign(changes, taxModePatch(doc, suggestMode(settings, recipient.country, recipient.vatId), settings))
    update(changes)
  }
  const period = !!doc.serviceTo
  const term = doc.dueDate ? daysBetween(doc.issueDate, doc.dueDate) : 0
  const nextNumber = peekNextNumber(isQuote ? settings.quoteNumbers : settings.invoiceNumbers, parseISODate(doc.issueDate))

  const preview = (
    <div className="editor-preview">
      <ScaledPage>
        <InvoicePreview view={view} />
      </ScaledPage>
    </div>
  )

  return (
    <div className="page wide">
      <header className="editor-header">
        <div style={{ minWidth: 0 }}>
          <Link to={isQuote ? '/rechnungen?art=angebote' : '/rechnungen'} className="back-link">
            <ChevronLeft size={16} aria-hidden /> {isQuote ? 'Angebote' : 'Rechnungen'}
          </Link>
          <h1>
            {doc.kind === 'cancellation' ? 'Stornorechnung' : isQuote ? 'Angebot' : doc.customerId ? 'Rechnung' : 'Schnellrechnung'}
            <span className="badge" style={{ marginLeft: 12, verticalAlign: 'middle' }}>
              Entwurf
            </span>
          </h1>
          <p className="subtitle muted small">Änderungen werden automatisch gespeichert. Die Nummer wird beim Abschließen vergeben.</p>
        </div>
        <div className="actions row wrap">
          <IconButton icon={Trash2} label="Entwurf löschen" danger onClick={remove} />
          <Button icon={Download} onClick={() => run(async () => { await flush(); await downloadPdf(doc, settings) })}>
            PDF-Vorschau
          </Button>
          <Button variant="primary" icon={FileCheck2} onClick={() => setFinalizing(true)} disabled={blocking} title={blocking ? 'Es fehlen noch Pflichtangaben' : undefined}>
            Abschließen
          </Button>
        </div>
      </header>

      {narrow && (
        <div className="toolbar">
          <Segmented
            label="Ansicht"
            value={mobileTab}
            onChange={setMobileTab}
            options={[
              { value: 'edit', label: 'Bearbeiten' },
              { value: 'preview', label: 'Vorschau' },
            ]}
          />
        </div>
      )}

      <div className="editor-layout">
        <div className="editor-form stack" hidden={narrow && mobileTab !== 'edit'}>
          <ComplianceCard issues={issues} />

          <section className="card card-pad">
            <div className="card-title-row">
              <h2>Empfänger</h2>
              {!doc.customerId && (r.company || r.contactPerson) && (
                <Button size="sm" variant="ghost" icon={UserPlus} onClick={saveAsCustomer}>
                  Als Kunde speichern
                </Button>
              )}
            </div>
            <div className="form-grid">
              <SelectField className="span-6" label="Kunde" value={doc.customerId ?? ''} onChange={chooseCustomer}>
                <option value="">Ohne Kunde – Empfänger frei eintragen</option>
                {customers?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {customerName(c)} ({c.number})
                  </option>
                ))}
              </SelectField>
              <TextField className="span-3" label="Firma" value={r.company} onChange={(company) => setR({ company })} />
              <TextField className="span-3" label="Ansprechpartner / Name" value={r.contactPerson} onChange={(contactPerson) => setR({ contactPerson })} />
              <TextField className="span-4" label="Straße und Hausnummer" value={r.street} onChange={(street) => setR({ street })} />
              <TextField className="span-2" label="Adresszusatz" value={r.addressExtra} onChange={(addressExtra) => setR({ addressExtra })} />
              <TextField className="span-2" label="PLZ" value={r.zip} onChange={(zip) => setR({ zip })} />
              <TextField className="span-2" label="Ort" value={r.city} onChange={(city) => setR({ city })} />
              <SelectField className="span-2" label="Land" value={r.country} onChange={(country) => setR({ country })}>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </SelectField>
              <TextField className="span-3" label="USt-IdNr. des Empfängers" value={r.vatId} onChange={(vatId) => setR({ vatId: vatId.toUpperCase() })} />
              <TextField className="span-3" label="E-Mail" type="email" value={r.email} onChange={(email) => setR({ email })} hint="Für den Versand und die E-Rechnung" />
            </div>
          </section>

          <section className="card card-pad">
            <h2 style={{ marginBottom: 14 }}>{isQuote ? 'Angebotsdaten' : 'Rechnungsdaten'}</h2>
            <div className="form-grid">
              <TextField className="span-2" label="Titel" value={doc.title} onChange={(title) => update({ title })} />
              <TextField
                className="span-2"
                label={isQuote ? 'Angebotsdatum' : 'Rechnungsdatum'}
                type="date"
                value={doc.issueDate}
                onChange={(issueDate) => update({ issueDate, dueDate: issueDate ? addDays(issueDate, Math.max(0, term)) : doc.dueDate })}
                hint={`Nummer wird: ${nextNumber}`}
              />
              {isQuote ? (
                <TextField className="span-2" label="Gültig bis" type="date" value={doc.validUntil} onChange={(validUntil) => update({ validUntil })} />
              ) : (
                <Field className="span-2" label="Zahlungsziel" hint={doc.dueDate ? `fällig am ${formatDate(doc.dueDate)}` : undefined}>
                  <NumberInput value={term} onChange={(n) => update({ dueDate: addDays(doc.issueDate, Math.max(0, Math.round(n))) })} suffix="Tage" maxFraction={0} aria-label="Zahlungsziel in Tagen" />
                </Field>
              )}
              <TextField className="span-2" label={period ? 'Leistung von' : 'Leistungsdatum'} type="date" value={doc.serviceFrom} onChange={(serviceFrom) => update({ serviceFrom })} />
              {period ? (
                <TextField className="span-2" label="Leistung bis" type="date" value={doc.serviceTo} onChange={(serviceTo) => update({ serviceTo })} />
              ) : (
                <div className="span-2" style={{ alignSelf: 'end' }}>
                  <Button size="sm" variant="ghost" onClick={() => update({ serviceTo: doc.serviceFrom || doc.issueDate })}>
                    Zeitraum angeben
                  </Button>
                </div>
              )}
              {period && (
                <div className="span-2" style={{ alignSelf: 'end' }}>
                  <Button size="sm" variant="ghost" onClick={() => update({ serviceTo: '' })}>
                    Einzelnes Datum
                  </Button>
                </div>
              )}
              <TextField className={period ? 'span-6' : 'span-2'} label="Ihre Referenz / Bestellnr." value={doc.buyerReference} onChange={(buyerReference) => update({ buyerReference })} placeholder="optional" />
              <SelectField className="span-3" label="Steuerfall" value={doc.taxMode} onChange={(m) => update(taxModePatch(doc, m as TaxMode, settings, true))}>
                {(Object.keys(TAX_MODE_LABELS) as TaxMode[]).map((m) => (
                  <option key={m} value={m}>
                    {TAX_MODE_LABELS[m]}
                  </option>
                ))}
              </SelectField>
              <SelectField className="span-3" label="Währung" value={doc.currency} onChange={(currency) => update({ currency })}>
                {['EUR', 'CHF', 'USD', 'GBP'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </SelectField>
              {doc.taxMode !== 'standard' && (
                <TextAreaField className="span-6" label="Hinweis zur Steuerbefreiung" value={doc.taxNote} onChange={(taxNote) => update({ taxNote })} rows={2} hint="Pflichtangabe – erscheint unter den Summen." />
              )}
            </div>
          </section>

          <section className="card card-pad">
            <div className="card-title-row">
              <h2>Positionen</h2>
              {!!unbilledCount && (
                <Button size="sm" icon={Clock} onClick={importTime}>
                  {unbilledCount} offene Zeiten übernehmen
                </Button>
              )}
            </div>
            <ItemsEditor doc={doc} setItems={setItems} onRemove={removeItem} settings={settings} />
            <div className="row wrap" style={{ marginTop: 12 }}>
              <Button icon={Plus} onClick={() => setItems((items) => [...items, newLineItem(settings, doc.customerId ? { unitPriceCents: 0 } : {})])}>
                Position hinzufügen
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  const c = customers?.find((x) => x.id === doc.customerId)
                  setItems((items) => [...items, newLineItem(settings, { unit: 'Std.', unitPriceCents: c?.hourlyRateCents ?? settings.defaults.hourlyRateCents })])
                }}
              >
                + Stunden
              </Button>
            </div>
            <div className="editor-totals">
              {view.totals.map((row) => (
                <div key={row.label} className={row.strong ? 'grand' : ''}>
                  <span>{row.label}</span>
                  <span className="tabular">{row.value}</span>
                </div>
              ))}
              {totals.discountCents > 0 && <div className="small faint">enthält {formatMoney(totals.discountCents, doc.currency)} Rabatt</div>}
            </div>
          </section>

          <section className="card card-pad">
            <h2 style={{ marginBottom: 14 }}>Texte</h2>
            <div className="stack-sm">
              <TextAreaField label="Einleitung" value={doc.introText} onChange={(introText) => update({ introText })} rows={3} />
              <TextAreaField label="Schlusstext" value={doc.closingText} onChange={(closingText) => update({ closingText })} rows={4} hint="Platzhalter wie {Fälligkeitsdatum} oder {Rechnungsnummer} werden automatisch ersetzt." />
              <TextAreaField label="Zusätzliche Fußzeile" value={doc.footerText} onChange={(footerText) => update({ footerText })} rows={2} />
            </div>
          </section>

          <section className="card card-pad">
            <h2 style={{ marginBottom: 14 }}>Darstellung</h2>
            <div className="stack-sm">
              <Segmented<LayoutId>
                label="Layout"
                value={doc.layout}
                onChange={(layout) => update({ layout })}
                options={[
                  { value: 'classic', label: 'Klassisch' },
                  { value: 'modern', label: 'Modern' },
                  { value: 'minimal', label: 'Minimal' },
                ]}
              />
              <AccentPicker value={doc.accentColor} onChange={(accentColor) => update({ accentColor })} />
            </div>
          </section>

          {narrow && (
            <Button variant="primary" size="lg" block icon={FileCheck2} onClick={() => setFinalizing(true)} disabled={blocking}>
              {blocking ? 'Pflichtangaben ergänzen' : 'Abschließen'}
            </Button>
          )}
        </div>

        {(!narrow || mobileTab === 'preview') && <aside className="editor-aside">{preview}</aside>}
      </div>

      <Dialog
        open={finalizing}
        onClose={() => setFinalizing(false)}
        title={isQuote ? 'Angebot abschließen?' : 'Rechnung abschließen?'}
        footer={
          <>
            <Button onClick={() => setFinalizing(false)}>Noch nicht</Button>
            <Button variant="primary" icon={Lock} onClick={finalize}>
              Abschließen als {nextNumber}
            </Button>
          </>
        }
      >
        <div className="stack-sm">
          <p>
            {isQuote ? 'Das Angebot' : 'Die Rechnung'} an <strong>{recipientName(doc.recipient)}</strong> über <strong>{formatMoney(totals.grossCents, doc.currency)}</strong> erhält die Nummer <strong>{nextNumber}</strong>.
          </p>
          {!isQuote && (
            <div className="callout info">
              <Lock size={18} aria-hidden />
              <span>
                Danach ist sie unveränderbar (GoBD). Korrekturen sind nur noch über eine Stornorechnung möglich. Deine Firmendaten werden mit dem heutigen Stand festgeschrieben.
              </span>
            </div>
          )}
          {issues.some((i) => i.level === 'warning') && (
            <>
              <strong className="small">Hinweise</strong>
              <IssueList issues={issues.filter((i) => i.level === 'warning')} />
            </>
          )}
        </div>
      </Dialog>
    </div>
  )
}

function suggestMode(settings: Settings, country: string, vatId: string): TaxMode {
  if (settings.smallBusiness) return 'smallBusiness'
  if (!country || country === settings.company.country) return 'standard'
  const eu = COUNTRIES.find((c) => c.code === country)?.eu
  if (eu) return vatId.trim() ? 'reverseCharge' : 'standard'
  return 'thirdCountry'
}

/** Switches the tax mode and swaps the note if it still is one of the defaults. */
function taxModePatch(doc: InvoiceDocument, mode: TaxMode, settings: Settings, force = false): Partial<InvoiceDocument> {
  if (mode === doc.taxMode && !force) return {}
  const defaults = [...Object.values(TAX_NOTES), settings.smallBusinessNote]
  const keepNote = doc.taxNote && !defaults.includes(doc.taxNote)
  const note = mode === 'smallBusiness' ? settings.smallBusinessNote || TAX_NOTES.smallBusiness : TAX_NOTES[mode]
  return { taxMode: mode, taxNote: keepNote ? doc.taxNote : note }
}

function ItemsEditor({
  doc,
  setItems,
  onRemove,
  settings,
}: {
  doc: InvoiceDocument
  setItems: (fn: (items: LineItem[]) => LineItem[]) => void
  onRemove: (item: LineItem) => void
  settings: Settings
}) {
  const standard = doc.taxMode === 'standard'
  const patch = (id: string, p: Partial<LineItem>) => setItems((items) => items.map((i) => (i.id === id ? { ...i, ...p } : i)))
  const move = (idx: number, dir: -1 | 1) =>
    setItems((items) => {
      const next = [...items]
      const [it] = next.splice(idx, 1)
      next.splice(idx + dir, 0, it)
      return next
    })
  const currencySymbol = doc.currency === 'EUR' ? '€' : doc.currency

  if (!doc.items.length) {
    return <p className="muted small items-empty">Noch keine Positionen. Füge Leistungen hinzu oder übernimm erfasste Zeiten.</p>
  }

  return (
    <ol className="items" aria-label="Positionen">
      <datalist id="units">
        {UNITS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      {doc.items.map((item, idx) => {
        const total = lineTotal(item)
        return (
          <li key={item.id} className="item">
            <div className="item-pos" aria-hidden>
              {idx + 1}
            </div>
            <div className="item-main">
              <input className="input item-title" value={item.title} onChange={(e) => patch(item.id, { title: e.target.value })} placeholder="Bezeichnung der Leistung" aria-label={`Position ${idx + 1}: Bezeichnung`} />
              <textarea className="textarea item-desc" value={item.description} onChange={(e) => patch(item.id, { description: e.target.value })} placeholder="Beschreibung (optional)" rows={item.description.split('\n').length > 1 ? Math.min(6, item.description.split('\n').length) : 1} aria-label={`Position ${idx + 1}: Beschreibung`} />
              <div className="item-fields">
                <label className="item-field qty">
                  <span>Menge</span>
                  <NumberInput value={item.quantity} onChange={(quantity) => patch(item.id, { quantity })} aria-label="Menge" />
                </label>
                <label className="item-field unit">
                  <span>Einheit</span>
                  <input className="input" list="units" value={item.unit} onChange={(e) => patch(item.id, { unit: e.target.value })} aria-label="Einheit" />
                </label>
                <label className="item-field price">
                  <span>Einzelpreis</span>
                  <MoneyInput value={item.unitPriceCents} onChange={(v) => patch(item.id, { unitPriceCents: v ?? 0 })} currencySymbol={currencySymbol} aria-label="Einzelpreis netto" />
                </label>
                {standard && (
                  <label className="item-field tax">
                    <span>USt</span>
                    <select className="select" value={item.taxRate} onChange={(e) => patch(item.id, { taxRate: Number(e.target.value) })} aria-label="Steuersatz">
                      {[...new Set([...TAX_RATES, item.taxRate, settings.defaults.taxRate])].sort((a, b) => b - a).map((r) => (
                        <option key={r} value={r}>
                          {formatNumber(r)} %
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="item-field discount">
                  <span>Rabatt</span>
                  <NumberInput value={item.discountPercent} onChange={(n) => patch(item.id, { discountPercent: Math.min(100, Math.max(0, n)) })} suffix="%" maxFraction={2} aria-label="Rabatt in Prozent" />
                </label>
                <div className="item-field total">
                  <span>Gesamt</span>
                  <strong className="tabular">{formatMoney(total.netCents, doc.currency)}</strong>
                </div>
              </div>
              {item.timeEntryIds?.length ? (
                <div className="small faint row" style={{ gap: 6 }}>
                  <Clock size={13} aria-hidden /> aus {item.timeEntryIds.length} Zeiteintrag{item.timeEntryIds.length > 1 ? 'en' : ''}
                </div>
              ) : null}
            </div>
            <div className="item-actions">
              <IconButton icon={ArrowUp} label="Nach oben" onClick={() => move(idx, -1)} disabled={idx === 0} size={16} />
              <IconButton icon={ArrowDown} label="Nach unten" onClick={() => move(idx, 1)} disabled={idx === doc.items.length - 1} size={16} />
              <IconButton
                icon={Copy}
                label="Duplizieren"
                size={16}
                onClick={() =>
                  setItems((items) => {
                    const next = [...items]
                    next.splice(idx + 1, 0, { ...item, id: crypto.randomUUID(), timeEntryIds: undefined })
                    return next
                  })
                }
              />
              <IconButton icon={Trash2} label="Entfernen" danger size={16} onClick={() => onRemove(item)} />
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function DocumentViewer({ doc, settings }: { doc: InvoiceDocument; settings: Settings }) {
  const navigate = useNavigate()
  const { run, confirm } = useFeedback()
  const [payOpen, setPayOpen] = useState(false)
  const [paidAt, setPaidAt] = useState(today())
  const [eOpen, setEOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const view = useMemo(() => buildInvoiceView(doc, settings), [doc, settings])
  const totals = calculateTotals(doc.items, doc.taxMode)
  const status = displayStatus(doc)
  const isQuote = doc.kind === 'quote'
  const label = documentLabel(doc)
  useDocumentTitle(`${label} ${doc.number}`)

  const related = useLiveQuery(async () => {
    const [cancelledBy, cancels, timeCount, source] = await Promise.all([
      doc.cancelledById ? db.documents.get(doc.cancelledById) : undefined,
      doc.cancelsId ? db.documents.get(doc.cancelsId) : undefined,
      db.timeEntries.where('invoiceId').equals(doc.id).count(),
      doc.sourceQuoteId ? db.documents.get(doc.sourceQuoteId) : undefined,
    ])
    const invoicesFromQuote = isQuote ? await db.documents.filter((d) => d.sourceQuoteId === doc.id).toArray() : []
    return { cancelledBy, cancels, timeCount, source, invoicesFromQuote }
  }, [doc.id, doc.cancelledById, doc.cancelsId])

  const pdf = async (withXml = false) => {
    setBusy(true)
    await run(() => downloadPdf(doc, settings, withXml))
    setBusy(false)
  }

  const duplicate = async (asKind?: 'invoice') => {
    const copy = await run(() => duplicateDocument(doc.id, asKind), asKind ? 'Rechnung aus Angebot erstellt' : 'Kopie als Entwurf erstellt')
    if (copy) navigate(`/rechnungen/${copy.id}`)
  }

  const cancel = async (correct: boolean) => {
    const storno = await run(() => cancelInvoice(doc.id), 'Stornorechnung erstellt')
    setCancelOpen(false)
    if (!storno) return
    if (correct) {
      const copy = await run(() => duplicateDocument(doc.id))
      if (copy) navigate(`/rechnungen/${copy.id}`)
    } else navigate(`/rechnungen/${storno.id}`)
  }

  const seller = sellerFor(doc, settings).seller

  return (
    <div className="page wide">
      <header className="editor-header">
        <div style={{ minWidth: 0 }}>
          <Link to={isQuote ? '/rechnungen?art=angebote' : '/rechnungen'} className="back-link">
            <ChevronLeft size={16} aria-hidden /> {isQuote ? 'Angebote' : 'Rechnungen'}
          </Link>
          <h1>
            {label} {doc.number}
            <span style={{ marginLeft: 12, verticalAlign: 'middle', display: 'inline-block' }}>
              <StatusBadge doc={doc} />
            </span>
          </h1>
          <p className="subtitle muted">
            {recipientName(doc.recipient)} · {formatMoney(totals.grossCents, doc.currency)} · {formatDate(doc.issueDate)}
          </p>
        </div>
        <div className="actions row wrap">
          <Button icon={Printer} onClick={printDocument}>
            Drucken
          </Button>
          {!isQuote && (
            <Button icon={FileCode2} onClick={() => setEOpen(true)}>
              E-Rechnung
            </Button>
          )}
          <Button variant="primary" icon={Download} onClick={() => pdf(false)} disabled={busy}>
            PDF
          </Button>
        </div>
      </header>

      <div className="editor-layout viewer">
        <div className="editor-form stack">
          {doc.kind === 'invoice' && (status === 'open' || status === 'overdue') && (
            <section className={`card card-pad ${status === 'overdue' ? 'overdue-card' : ''}`}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                {status === 'overdue' ? <AlertTriangle size={20} color="var(--red)" aria-hidden /> : <Clock size={20} color="var(--accent)" aria-hidden />}
                <div className="grow" style={{ flex: 1 }}>
                  <strong>{status === 'overdue' ? `Seit ${daysBetween(doc.dueDate, today())} Tagen überfällig` : `Fällig am ${formatDate(doc.dueDate)}`}</strong>
                  <p className="small muted">{status === 'overdue' ? 'Zeit für eine freundliche Zahlungserinnerung.' : daysBetween(today(), doc.dueDate) === 0 ? 'Heute fällig.' : `Noch ${daysBetween(today(), doc.dueDate)} Tage bis zur Fälligkeit.`}</p>
                </div>
              </div>
              <Button variant="success" icon={CheckCircle2} block style={{ marginTop: 14 }} onClick={() => setPayOpen(true)}>
                Als bezahlt markieren
              </Button>
            </section>
          )}

          {doc.status === 'paid' && (
            <section className="card card-pad">
              <div className="row">
                <CheckCircle2 size={20} color="var(--green)" aria-hidden />
                <div className="grow" style={{ flex: 1 }}>
                  <strong>Bezahlt am {formatDate(doc.paidAt)}</strong>
                </div>
                <Button size="sm" variant="ghost" icon={Undo2} onClick={() => run(() => setPaid(doc.id, null), 'Zahlung zurückgesetzt')}>
                  Zurücksetzen
                </Button>
              </div>
            </section>
          )}

          {isQuote && (
            <section className="card card-pad stack-sm">
              <strong>Wie hat der Kunde entschieden?</strong>
              <Segmented
                label="Angebotsstatus"
                value={doc.status as 'sent' | 'accepted' | 'declined'}
                onChange={(s) => run(() => setQuoteStatus(doc.id, s))}
                options={[
                  { value: 'sent', label: 'Offen' },
                  { value: 'accepted', label: 'Angenommen' },
                  { value: 'declined', label: 'Abgelehnt' },
                ]}
              />
              <Button variant="primary" icon={FileCheck2} onClick={() => duplicate('invoice')}>
                In Rechnung umwandeln
              </Button>
              {related?.invoicesFromQuote.map((d) => (
                <Link key={d.id} to={`/rechnungen/${d.id}`} className="small">
                  → Rechnung {d.number ?? '(Entwurf)'}
                </Link>
              ))}
            </section>
          )}

          <section className="card card-pad stack-sm">
            <h3>Details</h3>
            <dl className="details-list">
              <dt>Empfänger</dt>
              <dd>{recipientName(doc.recipient)}</dd>
              <dt>Netto</dt>
              <dd className="tabular">{formatMoney(totals.netCents, doc.currency)}</dd>
              <dt>Umsatzsteuer</dt>
              <dd className="tabular">{formatMoney(totals.taxCents, doc.currency)}</dd>
              <dt>Brutto</dt>
              <dd className="tabular">
                <strong>{formatMoney(totals.grossCents, doc.currency)}</strong>
              </dd>
              <dt>Steuerfall</dt>
              <dd>{TAX_MODE_LABELS[doc.taxMode]}</dd>
              <dt>Abgeschlossen</dt>
              <dd>{doc.finalizedAt ? new Date(doc.finalizedAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '–'}</dd>
              {!!related?.timeCount && (
                <>
                  <dt>Zeiten</dt>
                  <dd>{related.timeCount} Einträge abgerechnet</dd>
                </>
              )}
            </dl>
            {doc.customerId && (
              <Link to={`/kunden/${doc.customerId}`} className="small">
                Zum Kunden
              </Link>
            )}
            {related?.cancelledBy && (
              <div className="callout warning small">
                <Ban size={16} aria-hidden />
                <span>
                  Storniert durch <Link to={`/rechnungen/${related.cancelledBy.id}`}>{related.cancelledBy.number}</Link>
                </span>
              </div>
            )}
            {related?.cancels && (
              <div className="callout small">
                <Info size={16} aria-hidden />
                <span>
                  Storniert die Rechnung <Link to={`/rechnungen/${related.cancels.id}`}>{related.cancels.number}</Link>
                </span>
              </div>
            )}
            {related?.source && (
              <div className="small muted">
                Aus Angebot <Link to={`/rechnungen/${related.source.id}`}>{related.source.number}</Link>
              </div>
            )}
          </section>

          <section className="card card-pad stack-sm">
            <h3>Weitere Aktionen</h3>
            <div className="row wrap">
              <Button icon={Copy} onClick={() => duplicate()}>
                Duplizieren
              </Button>
              {doc.kind === 'invoice' && doc.status !== 'cancelled' && (
                <Button variant="danger" icon={Ban} onClick={() => setCancelOpen(true)}>
                  Stornieren
                </Button>
              )}
              {isQuote && (
                <Button
                  variant="danger"
                  icon={Trash2}
                  onClick={async () => {
                    if (!(await confirm({ title: 'Angebot löschen?', message: 'Angebote unterliegen nicht der Aufbewahrungspflicht wie Rechnungen und können gelöscht werden.', confirmLabel: 'Löschen', danger: true }))) return
                    await run(() => db.documents.delete(doc.id), 'Angebot gelöscht')
                    navigate('/rechnungen?art=angebote')
                  }}
                >
                  Löschen
                </Button>
              )}
            </div>
            {!isQuote && (
              <p className="small faint">
                <Lock size={12} aria-hidden /> Abgeschlossene Rechnungen sind nicht mehr änderbar. Für Korrekturen erstellst du eine Stornorechnung.
              </p>
            )}
          </section>
        </div>

        <aside className="editor-aside">
          <div className="editor-preview print-area">
            <ScaledPage>
              <InvoicePreview view={view} />
            </ScaledPage>
          </div>
        </aside>
      </div>

      <Dialog
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title="Zahlung erfassen"
        description={`${formatMoney(totals.grossCents, doc.currency)} von ${recipientName(doc.recipient)}`}
        footer={
          <>
            <Button onClick={() => setPayOpen(false)}>Abbrechen</Button>
            <Button
              variant="success"
              onClick={async () => {
                await run(() => setPaid(doc.id, paidAt || today()), 'Als bezahlt markiert')
                setPayOpen(false)
              }}
            >
              Bezahlt
            </Button>
          </>
        }
      >
        <TextField label="Zahlungseingang am" type="date" value={paidAt} onChange={setPaidAt} max={today()} />
      </Dialog>

      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Rechnung ${doc.number} stornieren?`}
        description="Es wird eine Stornorechnung mit eigener Nummer und negativen Beträgen erstellt. Die Original-Rechnung bleibt erhalten und wird als storniert markiert."
        footer={
          <>
            <Button onClick={() => setCancelOpen(false)}>Abbrechen</Button>
            <Button variant="danger" onClick={() => cancel(false)}>
              Nur stornieren
            </Button>
            <Button variant="primary" onClick={() => cancel(true)}>
              Stornieren und korrigieren
            </Button>
          </>
        }
      >
        <p className="small muted">„Stornieren und korrigieren“ legt zusätzlich eine Kopie als neuen Entwurf an, den du anpassen kannst. Bereits abgerechnete Zeiten werden wieder freigegeben.</p>
      </Dialog>

      <EInvoiceDialog open={eOpen} onClose={() => setEOpen(false)} doc={doc} settings={settings} seller={seller} onPdf={() => pdf(true)} />
    </div>
  )
}

function EInvoiceDialog({
  open,
  onClose,
  doc,
  settings,
  seller,
  onPdf,
}: {
  open: boolean
  onClose: () => void
  doc: InvoiceDocument
  settings: Settings
  seller: Settings['company']
  onPdf: () => void
}) {
  const [profile, setProfile] = useState<EInvoiceProfile>('facturx')
  const issues = eInvoiceIssues(doc, seller, profile)
  const { run } = useFeedback()
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="E-Rechnung exportieren"
      description="Strukturierte Rechnungsdaten nach EN 16931 – seit 2025 im inländischen B2B-Bereich relevant."
      footer={
        <>
          <Button onClick={onClose}>Schließen</Button>
          {profile === 'facturx' ? (
            <>
              <Button icon={FileCode2} onClick={() => run(async () => downloadXml(doc, settings, 'facturx'))}>
                Nur XML (CII)
              </Button>
              <Button variant="primary" icon={Download} onClick={onPdf}>
                ZUGFeRD-PDF
              </Button>
            </>
          ) : (
            <Button variant="primary" icon={Download} onClick={() => run(async () => downloadXml(doc, settings, 'xrechnung'))}>
              XRechnung (XML)
            </Button>
          )}
        </>
      }
    >
      <div className="stack-sm">
        <Segmented
          label="Format"
          value={profile}
          onChange={setProfile}
          options={[
            { value: 'facturx', label: 'ZUGFeRD / Factur-X' },
            { value: 'xrechnung', label: 'XRechnung' },
          ]}
        />
        <p className="small muted">
          {profile === 'facturx'
            ? 'PDF mit eingebetteter XML-Datei (factur-x.xml, Profil EN 16931). Für Menschen lesbar, für Buchhaltungssoftware auswertbar.'
            : 'Reines XML im CII-Format nach XRechnung 3.0 – Standard für öffentliche Auftraggeber.'}
        </p>
        <div className="callout warning small">
          <AlertTriangle size={16} aria-hidden />
          <span>
            <strong>Experimentell:</strong> Der Export folgt EN 16931, wurde aber nicht offiziell zertifiziert. Das PDF ist kein validiertes PDF/A-3. Prüfe die Datei vor dem Versand z. B. mit dem KoSIT-Validator oder dem Prüfwerkzeug deines Empfängers.
          </span>
        </div>
        {issues.length > 0 && <IssueList issues={issues.map((i) => ({ level: 'warning', field: '', message: i.message }))} />}
      </div>
    </Dialog>
  )
}
