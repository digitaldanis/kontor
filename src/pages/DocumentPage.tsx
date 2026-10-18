import { t, uiLocale } from '../lib/i18n'
import { addPayment, cancelInvoice, createCreditNote, createDraft, deleteDraft, duplicateDocument, finalizeDocument, invoiceTimeEntries, releaseTimeEntries, removePayment, saveCatalogItem, saveCustomer, saveDocument, setQuoteStatus } from '../lib/actions'
import { useLiveQuery } from '../lib/live'
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  BellRing,
  BookmarkPlus,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Copy,
  Download,
  FileCheck2,
  FileCode2,
  Info,
  Lock,
  Mail,
  PackageSearch,
  Percent,
  Plus,
  Printer,
  ReceiptText,
  Repeat,
  Trash2,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CatalogPicker } from '../components/CatalogDialog'
import { RecurringDialog } from '../components/Recurring'
import { SendDialog } from '../components/SendDialog'
import { addMonths, newRecurring, templateFromDocument } from '../lib/recurring'
import { StatusBadge } from '../components/DocumentsTable'
import { catalogToLine, lineToCatalog } from '../lib/catalog'
import { useFeedback } from '../components/useFeedback'
import { InvoicePreview, ScaledPage } from '../components/InvoicePreview'
import { AccentPicker } from '../components/SettingsFields'
import { Button, Dialog, Field, IconButton, MoneyInput, NumberInput, Segmented, SelectField, TextAreaField, TextField } from '../components/ui'
import { documentTotals, lineTotal } from '../lib/calc'
import { COUNTRIES } from '../lib/countries'
import { addDays, daysBetween, formatDate, parseISODate, today } from '../lib/dates'
import { db } from '../lib/db'
import { CURRENCIES, customerName, recipientFromCustomer, recipientName, TAX_MODE_LABELS, TAX_RATES, UNITS } from '../lib/defaults'
import { eInvoiceIssues, type EInvoiceProfile } from '../lib/einvoice'
import { downloadPdf, downloadReminderPdf, downloadXml, printDocument } from '../lib/exporters'
import { LEVEL_LABELS, reminderTotal } from '../lib/dunning'
import { useCustomers, useDocumentTitle, useMediaQuery, useSettings } from '../lib/hooks'
import { buildInvoiceView, docTitleLabel, sellerFor } from '../lib/invoiceView'
import { DEFAULT_TEXTS, docText } from '../lib/docText'
import { formatMoney, formatNumber } from '../lib/money'
import { peekNextNumber } from '../lib/numbering'
import { creditableAmount, deductionFor, emptyCustomer, newLineItem, openDownPayments, remindersFor } from '../lib/repo'
import { amountDue, creditedOf, documentLabel, displayStatus, paidOf } from '../lib/status'
import type { BillingType, Deduction, InvoiceDiscount, InvoiceDocument, Language, LayoutId, LineItem, Payment, RecurringInvoice, Reminder, Settings, TaxMode } from '../lib/types'
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
          <strong>{errors.length ? t('{p0} Pflichtangabe{p1} fehlt', { p0: errors.length, p1: errors.length > 1 ? 'n' : '' }) : t('Alle Pflichtangaben vorhanden')}</strong>
          <div className="small muted">{t('Geprüft nach § 14 Abs. 4 UStG und Art. 226 MwStSystRL')}</div>
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
  const [picking, setPicking] = useState(false)
  const narrow = useMediaQuery('(max-width: 1180px)')
  const pending = useRef<InvoiceDocument | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const isQuote = doc.kind === 'quote'
  useDocumentTitle(t('{p0} (Entwurf)', { p0: documentLabel(doc) }))

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
    }, t('Als Kunde gespeichert'))

  const importTime = async () => {
    if (!doc.customerId) return
    await flush()
    const entries = await db.timeEntries.where('customerId').equals(doc.customerId).filter((e) => !e.invoiceId && e.billable).toArray()
    const updated = await run(() => invoiceTimeEntries(doc.customerId!, entries.map((e) => e.id), 'entry', doc.id), t('{p0} Zeiteinträge übernommen', { p0: entries.length }))
    if (updated) setDoc(updated)
  }

  const removeItem = (item: LineItem) => {
    setItems((items) => items.filter((i) => i.id !== item.id))
    if (item.timeEntryIds?.length) {
      void flush().then(() => releaseTimeEntries(item.timeEntryIds!))
      toast(t('Zugehörige Zeiten sind wieder offen'))
    }
  }

  const finalize = async () => {
    await flush()
    const result = await run(() => finalizeDocument(doc.id), t('{p0} abgeschlossen', { p0: documentLabel(doc) }))
    setFinalizing(false)
    if (result) window.scrollTo({ top: 0 })
  }

  const remove = async () => {
    const ok = await confirm({ title: t('Entwurf löschen?'), message: t('Der Entwurf wird entfernt. Übernommene Zeiten werden wieder als offen markiert.'), confirmLabel: t('Löschen'), danger: true })
    if (!ok) return
    clearTimeout(timer.current)
    pending.current = null
    await run(() => deleteDraft(doc.id), t('Entwurf gelöscht'))
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
  const nextNumber = peekNextNumber(isQuote ? settings.quoteNumbers : doc.kind === 'creditNote' ? settings.creditNoteNumbers : settings.invoiceNumbers, parseISODate(doc.issueDate))

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
            <ChevronLeft size={16} aria-hidden /> {isQuote ? t('Angebote') : t('Rechnungen')}
          </Link>
          <h1>
            {doc.kind === 'invoice' && doc.billingType === 'regular' && !doc.customerId ? t('Schnellrechnung') : documentLabel(doc)}
            <span className="badge" style={{ marginLeft: 12, verticalAlign: 'middle' }}>
              {t('Entwurf')}
            </span>
          </h1>
          <p className="subtitle muted small">{t('Änderungen werden automatisch gespeichert. Die Nummer wird beim Abschließen vergeben.')}</p>
        </div>
        <div className="actions row wrap">
          <IconButton icon={Trash2} label={t('Entwurf löschen')} danger onClick={remove} />
          <Button icon={Download} onClick={() => run(async () => { await flush(); await downloadPdf(doc, settings) })}>
            {t('PDF-Vorschau')}
          </Button>
          <Button variant="primary" icon={FileCheck2} onClick={() => setFinalizing(true)} disabled={blocking} title={blocking ? t('Es fehlen noch Pflichtangaben') : undefined}>
            {t('Abschließen')}
          </Button>
        </div>
      </header>

      {narrow && (
        <div className="toolbar">
          <Segmented
            label={t('Ansicht')}
            value={mobileTab}
            onChange={setMobileTab}
            options={[
              { value: 'edit', label: t('Bearbeiten') },
              { value: 'preview', label: t('Vorschau') },
            ]}
          />
        </div>
      )}

      <div className="editor-layout">
        <div className="editor-form stack" hidden={narrow && mobileTab !== 'edit'}>
          <ComplianceCard issues={issues} />

          <section className="card card-pad">
            <div className="card-title-row">
              <h2>{t('Empfänger')}</h2>
              {!doc.customerId && (r.company || r.contactPerson) && (
                <Button size="sm" variant="ghost" icon={UserPlus} onClick={saveAsCustomer}>
                  {t('Als Kunde speichern')}
                </Button>
              )}
            </div>
            <div className="form-grid">
              <SelectField className="span-6" label={t('Kunde')} value={doc.customerId ?? ''} onChange={chooseCustomer}>
                <option value="">{t('Ohne Kunde – Empfänger frei eintragen')}</option>
                {customers?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {customerName(c)} ({c.number})
                  </option>
                ))}
              </SelectField>
              <TextField className="span-3" label={t('Firma')} value={r.company} onChange={(company) => setR({ company })} />
              <TextField className="span-3" label={t('Ansprechpartner / Name')} value={r.contactPerson} onChange={(contactPerson) => setR({ contactPerson })} />
              <TextField className="span-4" label={t('Straße und Hausnummer')} value={r.street} onChange={(street) => setR({ street })} />
              <TextField className="span-2" label={t('Adresszusatz')} value={r.addressExtra} onChange={(addressExtra) => setR({ addressExtra })} />
              <TextField className="span-2" label={t('PLZ')} value={r.zip} onChange={(zip) => setR({ zip })} />
              <TextField className="span-2" label={t('Ort')} value={r.city} onChange={(city) => setR({ city })} />
              <SelectField className="span-2" label={t('Land')} value={r.country} onChange={(country) => setR({ country })}>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </SelectField>
              <TextField className="span-3" label={t('USt-IdNr. des Empfängers')} value={r.vatId} onChange={(vatId) => setR({ vatId: vatId.toUpperCase() })} />
              <TextField className="span-3" label={t('E-Mail')} type="email" value={r.email} onChange={(email) => setR({ email })} hint={t('Für den Versand und die E-Rechnung')} />
            </div>
          </section>

          {doc.kind === 'creditNote' && <CreditNoteInfo doc={doc} />}

          <section className="card card-pad">
            <h2 style={{ marginBottom: 14 }}>{isQuote ? t('Angebotsdaten') : doc.kind === 'creditNote' ? t('Gutschriftsdaten') : t('Rechnungsdaten')}</h2>
            {doc.kind === 'invoice' && (
              <div style={{ marginBottom: 16 }}>
                <Segmented<BillingType>
                  label={t('Rechnungsart')}
                  value={doc.billingType}
                  onChange={(billingType) => {
                    update({ billingType, deductions: billingType === 'final' ? doc.deductions : [], title: retitle(doc, billingType) })
                    if (billingType === 'final' && !doc.deductions.length)
                      void openDownPayments(doc.customerId, doc.id).then((list) => list.length && update({ deductions: list.map(deductionFor) }))
                  }}
                  options={[
                    { value: 'regular', label: t('Rechnung') },
                    { value: 'downPayment', label: t('Abschlag') },
                    { value: 'final', label: t('Schlussrechnung') },
                  ]}
                />
              </div>
            )}
            <div className="form-grid">
              <TextField className="span-2" label={t('Titel')} value={doc.title} onChange={(title) => update({ title })} />
              <TextField
                className="span-2"
                label={isQuote ? t('Angebotsdatum') : t('Rechnungsdatum')}
                type="date"
                value={doc.issueDate}
                onChange={(issueDate) => update({ issueDate, dueDate: issueDate ? addDays(issueDate, Math.max(0, term)) : doc.dueDate })}
                hint={t('Nummer wird: {p0}', { p0: nextNumber })}
              />
              {isQuote ? (
                <TextField className="span-2" label={t('Gültig bis')} type="date" value={doc.validUntil} onChange={(validUntil) => update({ validUntil })} />
              ) : (
                <Field className="span-2" label={t('Zahlungsziel')} hint={doc.dueDate ? t('fällig am {p0}', { p0: formatDate(doc.dueDate) }) : undefined}>
                  <NumberInput value={term} onChange={(n) => update({ dueDate: addDays(doc.issueDate, Math.max(0, Math.round(n))) })} suffix={t('Tage')} maxFraction={0} aria-label={t('Zahlungsziel in Tagen')} />
                </Field>
              )}
              <TextField className="span-2" label={period ? t('Leistung von') : t('Leistungsdatum')} type="date" value={doc.serviceFrom} onChange={(serviceFrom) => update({ serviceFrom })} />
              {period ? (
                <TextField className="span-2" label={t('Leistung bis')} type="date" value={doc.serviceTo} onChange={(serviceTo) => update({ serviceTo })} />
              ) : (
                <div className="span-2" style={{ alignSelf: 'end' }}>
                  <Button size="sm" variant="ghost" onClick={() => update({ serviceTo: doc.serviceFrom || doc.issueDate })}>
                    {t('Zeitraum angeben')}
                  </Button>
                </div>
              )}
              {period && (
                <div className="span-2" style={{ alignSelf: 'end' }}>
                  <Button size="sm" variant="ghost" onClick={() => update({ serviceTo: '' })}>
                    {t('Einzelnes Datum')}
                  </Button>
                </div>
              )}
              <TextField className={period ? 'span-6' : 'span-2'} label={t('Ihre Referenz / Bestellnr.')} value={doc.buyerReference} onChange={(buyerReference) => update({ buyerReference })} placeholder={t('optional')} />
              <SelectField className="span-2" label={t('Steuerfall')} value={doc.taxMode} onChange={(m) => update(taxModePatch(doc, m as TaxMode, settings, true))}>
                {(Object.keys(TAX_MODE_LABELS) as TaxMode[]).map((m) => (
                  <option key={m} value={m}>
                    {t(TAX_MODE_LABELS[m])}
                  </option>
                ))}
              </SelectField>
              <SelectField className="span-2" label={t('Währung')} value={doc.currency} onChange={(currency) => update({ currency })}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </SelectField>
              <SelectField className="span-2" label={t('Sprache')} value={doc.language} onChange={(language) => update(languagePatch(doc, language as Language, settings))}>
                <option value="de">{t('Deutsch')}</option>
                <option value="en">{t('English')}</option>
              </SelectField>
              {doc.taxMode !== 'standard' && (
                <TextAreaField className="span-6" label={t('Hinweis zur Steuerbefreiung')} value={doc.taxNote} onChange={(taxNote) => update({ taxNote })} rows={2} hint={t('Pflichtangabe – erscheint unter den Summen.')} />
              )}
            </div>
          </section>

          <section className="card card-pad">
            <div className="card-title-row">
              <h2>{t('Positionen')}</h2>
              {!!unbilledCount && (
                <Button size="sm" icon={Clock} onClick={importTime}>
                  {unbilledCount} {t('offene Zeiten übernehmen')}
                </Button>
              )}
            </div>
            <ItemsEditor doc={doc} setItems={setItems} onRemove={removeItem} settings={settings} />
            <div className="row wrap" style={{ marginTop: 12 }}>
              <Button icon={Plus} onClick={() => setItems((items) => [...items, newLineItem(settings, doc.customerId ? { unitPriceCents: 0 } : {})])}>
                {t('Position hinzufügen')}
              </Button>
              <Button icon={PackageSearch} onClick={() => setPicking(true)}>
                {t('Aus Leistungen')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  const c = customers?.find((x) => x.id === doc.customerId)
                  setItems((items) => [...items, newLineItem(settings, { unit: 'Std.', unitPriceCents: c?.hourlyRateCents ?? settings.defaults.hourlyRateCents })])
                }}
              >
                {t('+ Stunden')}
              </Button>
            </div>
            <DiscountEditor doc={doc} onChange={(discount) => update({ discount })} />
            {doc.kind === 'invoice' && doc.billingType === 'final' && <DeductionPicker doc={doc} onChange={(deductions) => update({ deductions })} />}
            <div className="editor-totals">
              {view.totals.map((row) => (
                <div key={row.label} className={row.strong ? 'grand' : ''}>
                  <span>
                    {row.label}
                    {row.detail && <small className="faint" style={{ display: 'block' }}>{row.detail}</small>}
                  </span>
                  <span className="tabular">{row.value}</span>
                </div>
              ))}
              {totals.discountCents > 0 && <div className="small faint">{t('enthält')} {formatMoney(totals.discountCents, doc.currency)} {t('Positionsrabatt')}</div>}
            </div>
          </section>

          <section className="card card-pad">
            <h2 style={{ marginBottom: 14 }}>{t('Texte')}</h2>
            <div className="stack-sm">
              <TextAreaField label={t('Einleitung')} value={doc.introText} onChange={(introText) => update({ introText })} rows={3} />
              <TextAreaField label={t('Schlusstext')} value={doc.closingText} onChange={(closingText) => update({ closingText })} rows={4} hint={t('Platzhalter wie {Fälligkeitsdatum} oder {Rechnungsnummer} werden automatisch ersetzt.')} />
              <TextAreaField label={t('Zusätzliche Fußzeile')} value={doc.footerText} onChange={(footerText) => update({ footerText })} rows={2} />
            </div>
          </section>

          <section className="card card-pad">
            <h2 style={{ marginBottom: 14 }}>{t('Darstellung')}</h2>
            <div className="stack-sm">
              <Segmented<LayoutId>
                label={t('Layout')}
                value={doc.layout}
                onChange={(layout) => update({ layout })}
                options={[
                  { value: 'classic', label: t('Klassisch') },
                  { value: 'modern', label: t('Modern') },
                  { value: 'minimal', label: t('Minimal') },
                ]}
              />
              <AccentPicker value={doc.accentColor} onChange={(accentColor) => update({ accentColor })} />
            </div>
          </section>

          {narrow && (
            <Button variant="primary" size="lg" block icon={FileCheck2} onClick={() => setFinalizing(true)} disabled={blocking}>
              {blocking ? t('Pflichtangaben ergänzen') : t('Abschließen')}
            </Button>
          )}
        </div>

        {(!narrow || mobileTab === 'preview') && <aside className="editor-aside">{preview}</aside>}
      </div>

      <CatalogPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(c) => setItems((items) => [...items, newLineItem(settings, catalogToLine(c, settings.smallBusiness))])}
      />

      <Dialog
        open={finalizing}
        onClose={() => setFinalizing(false)}
        title={t('{p0} abschließen?', { p0: documentLabel(doc) })}
        footer={
          <>
            <Button onClick={() => setFinalizing(false)}>{t('Noch nicht')}</Button>
            <Button variant="primary" icon={Lock} onClick={finalize}>
              {t('Abschließen als')} {nextNumber}
            </Button>
          </>
        }
      >
        <div className="stack-sm">
          <p>
            {isQuote ? t('Das Angebot') : doc.kind === 'creditNote' ? t('Die Gutschrift') : t('Die Rechnung')} {t('an')} <strong>{recipientName(doc.recipient)}</strong> {t('über')} <strong>{formatMoney(totals.grossCents, doc.currency)}</strong> {t('erhält die Nummer')} <strong>{nextNumber}</strong>.
          </p>
          {!isQuote && (
            <div className="callout info">
              <Lock size={18} aria-hidden />
              <span>
                {t('Danach ist sie unveränderbar (GoBD). Korrekturen sind nur noch über eine Stornorechnung möglich. Deine Firmendaten werden mit dem heutigen Stand festgeschrieben.')}
              </span>
            </div>
          )}
          {issues.some((i) => i.level === 'warning') && (
            <>
              <strong className="small">{t('Hinweise')}</strong>
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

function noteFor(mode: TaxMode, language: Language, settings: Settings): string {
  return mode === 'smallBusiness' ? settings.texts[language].smallBusinessNote || docText(language).taxNotes.smallBusiness : docText(language).taxNotes[mode]
}

/** Every built-in or configured tax note, so a note the user hasn't touched can be replaced. */
function knownNotes(settings: Settings): string[] {
  return (['de', 'en'] as Language[]).flatMap((l) => [...Object.values(docText(l).taxNotes), settings.texts[l].smallBusinessNote]).filter(Boolean)
}

/** Switches the tax mode and swaps the note if it still is one of the defaults. */
function taxModePatch(doc: InvoiceDocument, mode: TaxMode, settings: Settings, force = false): Partial<InvoiceDocument> {
  if (mode === doc.taxMode && !force) return {}
  const keepNote = doc.taxNote && !knownNotes(settings).includes(doc.taxNote)
  return { taxMode: mode, taxNote: keepNote ? doc.taxNote : noteFor(mode, doc.language, settings) }
}

function retitle(doc: InvoiceDocument, billingType: BillingType): string {
  const known = (['de', 'en'] as Language[]).flatMap((language) => (['regular', 'downPayment', 'final'] as BillingType[]).map((b) => docTitleLabel({ ...doc, language, billingType: b })))
  if (doc.title && !known.includes(doc.title)) return doc.title
  return docTitleLabel({ ...doc, billingType })
}

/** Switches the document language and swaps texts that are still the defaults of the other language. */
function languagePatch(doc: InvoiceDocument, language: Language, settings: Settings): Partial<InvoiceDocument> {
  const from = settings.texts[doc.language]
  const to = settings.texts[language]
  const quote = doc.kind === 'quote'
  const patch: Partial<InvoiceDocument> = { language }
  if ([from.intro, from.quoteIntro, DEFAULT_TEXTS[doc.language].intro, DEFAULT_TEXTS[doc.language].quoteIntro].includes(doc.introText)) patch.introText = quote ? to.quoteIntro : to.intro
  if ([from.closing, from.quoteClosing, DEFAULT_TEXTS[doc.language].closing, DEFAULT_TEXTS[doc.language].quoteClosing].includes(doc.closingText)) patch.closingText = quote ? to.quoteClosing : to.closing
  if (doc.taxNote && knownNotes(settings).includes(doc.taxNote)) patch.taxNote = noteFor(doc.taxMode, language, settings)
  if (doc.title === docTitleLabel(doc)) patch.title = docTitleLabel({ ...doc, language })
  return patch
}

function DiscountEditor({ doc, onChange }: { doc: InvoiceDocument; onChange: (d: InvoiceDiscount | null) => void }) {
  const d = doc.discount
  const symbol = doc.currency === 'EUR' ? '€' : doc.currency
  if (!d) {
    return (
      <div className="row wrap" style={{ marginTop: 8 }}>
        <Button size="sm" variant="ghost" icon={Percent} onClick={() => onChange({ type: 'percent', value: 0 })}>
          {t('Rabatt auf die ganze Rechnung')}
        </Button>
      </div>
    )
  }
  return (
    <div className="discount-editor">
      <span className="small" style={{ fontWeight: 600 }}>{t('Rabatt auf die ganze Rechnung')}</span>
      <Segmented
        label={t('Rabattart')}
        value={d.type}
        onChange={(type) => onChange({ type, value: 0 })}
        options={[
          { value: 'percent', label: '%' },
          { value: 'amount', label: symbol },
        ]}
      />
      {d.type === 'percent' ? (
        <NumberInput value={d.value} onChange={(value) => onChange({ type: 'percent', value: Math.min(100, Math.max(0, value)) })} suffix="%" maxFraction={2} aria-label={t('Gesamtrabatt in Prozent')} style={{ width: 110 }} />
      ) : (
        <div style={{ width: 140 }}>
          <MoneyInput value={d.value} onChange={(value) => onChange({ type: 'amount', value: Math.max(0, value ?? 0) })} currencySymbol={symbol} aria-label={t('Gesamtrabatt als Betrag')} />
        </div>
      )}
      <IconButton icon={X} label={t('Rabatt entfernen')} size={16} onClick={() => onChange(null)} />
      <span className="hint small faint" style={{ flexBasis: '100%' }}>
        {t('Wird anteilig auf die Steuersätze verteilt und in der E-Rechnung als Nachlass je Steuersatz ausgewiesen.')}
      </span>
    </div>
  )
}

function DeductionPicker({ doc, onChange }: { doc: InvoiceDocument; onChange: (d: Deduction[]) => void }) {
  const candidates = useLiveQuery(() => openDownPayments(doc.customerId, doc.id), [doc.customerId, doc.id])
  const selected = new Set(doc.deductions.map((d) => d.invoiceId))
  if (!doc.customerId) {
    return <p className="callout small" style={{ marginTop: 12 }}><Info size={16} aria-hidden /><span>{t('Wähle oben einen Kunden, um seine Abschlagsrechnungen zu verrechnen.')}</span></p>
  }
  if (candidates && !candidates.length && !doc.deductions.length) {
    return <p className="callout small" style={{ marginTop: 12 }}><Info size={16} aria-hidden /><span>{t('Für diesen Kunden gibt es keine offenen Abschlagsrechnungen.')}</span></p>
  }
  const toggle = (inv: InvoiceDocument) => {
    if (selected.has(inv.id)) onChange(doc.deductions.filter((d) => d.invoiceId !== inv.id))
    else onChange([...doc.deductions, deductionFor(inv)].sort((a, b) => a.issueDate.localeCompare(b.issueDate)))
  }
  return (
    <div className="deductions">
      <strong className="small">{t('Abschläge verrechnen')}</strong>
      <ul className="list">
        {(candidates ?? []).map((inv) => (
          <li key={inv.id}>
            <label className="list-item" style={{ cursor: 'pointer', padding: '8px 0' }}>
              <input type="checkbox" className="checkbox" checked={selected.has(inv.id)} onChange={() => toggle(inv)} />
              <span className="grow">
                <span className="title" style={{ display: 'block' }}>{inv.number}</span>
                <span className="sub">{t('vom')} {formatDate(inv.issueDate)}{paidOf(inv) ? t(' · {p0} bezahlt', { p0: formatMoney(paidOf(inv), inv.currency) }) : t(' · noch nicht bezahlt')}</span>
              </span>
              <span className="tabular">{formatMoney(documentTotals(inv).grossCents, inv.currency)}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CreditNoteInfo({ doc }: { doc: InvoiceDocument }) {
  const original = useLiveQuery(() => (doc.creditsId ? db.documents.get(doc.creditsId) : undefined), [doc.creditsId])
  if (!original) return null
  const remaining = creditableAmount(original)
  const current = documentTotals(doc).grossCents
  return (
    <section className={`card card-pad ${current > remaining ? 'overdue-card' : ''}`}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Info size={20} color="var(--purple)" aria-hidden />
        <div className="grow" style={{ flex: 1 }}>
          <strong>
            {t('Gutschrift zu')} <Link to={`/rechnungen/${original.id}`}>{original.number}</Link>
          </strong>
          <p className="small muted">
            {t('Noch gutschreibbar:')} {formatMoney(remaining, original.currency)} {t('· diese Gutschrift:')} {formatMoney(current, doc.currency)}{t('. Reduziere Mengen oder Preise für eine Teilgutschrift. Die Gutschrift bekommt eine Nummer aus dem eigenen Nummernkreis.')}
          </p>
          {current > remaining && <p className="small" style={{ color: 'var(--red)', marginTop: 6 }}>{t('Die Gutschrift ist höher als der noch offene Rechnungsbetrag.')}</p>}
        </div>
      </div>
    </section>
  )
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
  const { run } = useFeedback()
  const standard = doc.taxMode === 'standard'
  const saveToCatalog = (item: LineItem) => run(() => saveCatalogItem(lineToCatalog(item)), t('„{p0}“ in Leistungen gespeichert', { p0: item.title }))
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
    return <p className="muted small items-empty">{t('Noch keine Positionen. Füge Leistungen hinzu oder übernimm erfasste Zeiten.')}</p>
  }

  return (
    <ol className="items" aria-label={t('Positionen')}>
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
              <input className="input item-title" value={item.title} onChange={(e) => patch(item.id, { title: e.target.value })} placeholder={t('Bezeichnung der Leistung')} aria-label={t('Position {p0}: Bezeichnung', { p0: idx + 1 })} />
              <textarea className="textarea item-desc" value={item.description} onChange={(e) => patch(item.id, { description: e.target.value })} placeholder={t('Beschreibung (optional)')} rows={item.description.split('\n').length > 1 ? Math.min(6, item.description.split('\n').length) : 1} aria-label={t('Position {p0}: Beschreibung', { p0: idx + 1 })} />
              <div className="item-fields">
                <label className="item-field qty">
                  <span>{t('Menge')}</span>
                  <NumberInput value={item.quantity} onChange={(quantity) => patch(item.id, { quantity })} aria-label={t('Menge')} />
                </label>
                <label className="item-field unit">
                  <span>{t('Einheit')}</span>
                  <input className="input" list="units" value={item.unit} onChange={(e) => patch(item.id, { unit: e.target.value })} aria-label={t('Einheit')} />
                </label>
                <label className="item-field price">
                  <span>{t('Einzelpreis')}</span>
                  <MoneyInput value={item.unitPriceCents} onChange={(v) => patch(item.id, { unitPriceCents: v ?? 0 })} currencySymbol={currencySymbol} aria-label={t('Einzelpreis netto')} />
                </label>
                {standard && (
                  <label className="item-field tax">
                    <span>{t('USt')}</span>
                    <select className="select" value={item.taxRate} onChange={(e) => patch(item.id, { taxRate: Number(e.target.value) })} aria-label={t('Steuersatz')}>
                      {[...new Set([...TAX_RATES, item.taxRate, settings.defaults.taxRate])].sort((a, b) => b - a).map((r) => (
                        <option key={r} value={r}>
                          {formatNumber(r)} %
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="item-field discount">
                  <span>{t('Rabatt')}</span>
                  <NumberInput value={item.discountPercent} onChange={(n) => patch(item.id, { discountPercent: Math.min(100, Math.max(0, n)) })} suffix="%" maxFraction={2} aria-label={t('Rabatt in Prozent')} />
                </label>
                <div className="item-field total">
                  <span>{t('Gesamt')}</span>
                  <strong className="tabular">{formatMoney(total.netCents, doc.currency)}</strong>
                </div>
              </div>
              {item.timeEntryIds?.length ? (
                <div className="small faint row" style={{ gap: 6 }}>
                  <Clock size={13} aria-hidden /> {item.timeEntryIds.length > 1 ? t('aus {n} Zeiteinträgen', { n: item.timeEntryIds.length }) : t('aus einem Zeiteintrag')}
                </div>
              ) : null}
            </div>
            <div className="item-actions">
              <IconButton icon={ArrowUp} label={t('Nach oben')} onClick={() => move(idx, -1)} disabled={idx === 0} size={16} />
              <IconButton icon={ArrowDown} label={t('Nach unten')} onClick={() => move(idx, 1)} disabled={idx === doc.items.length - 1} size={16} />
              <IconButton
                icon={Copy}
                label={t('Duplizieren')}
                size={16}
                onClick={() =>
                  setItems((items) => {
                    const next = [...items]
                    next.splice(idx + 1, 0, { ...item, id: crypto.randomUUID(), timeEntryIds: undefined })
                    return next
                  })
                }
              />
              <IconButton icon={BookmarkPlus} label={t('Als Leistung speichern')} size={16} onClick={() => saveToCatalog(item)} disabled={!item.title.trim()} />
              <IconButton icon={Trash2} label={t('Entfernen')} danger size={16} onClick={() => onRemove(item)} />
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
  const [eOpen, setEOpen] = useState(false)
  const [creditOpen, setCreditOpen] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const [recurring, setRecurring] = useState<RecurringInvoice | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const view = useMemo(() => buildInvoiceView(doc, settings), [doc, settings])
  const totals = documentTotals(doc)
  const isQuote = doc.kind === 'quote'
  const label = documentLabel(doc)
  useDocumentTitle(`${label} ${doc.number}`)

  const related = useLiveQuery(async () => {
    const [cancelledBy, cancels, timeCount, source, credits, settledBy] = await Promise.all([
      doc.cancelledById ? db.documents.get(doc.cancelledById) : undefined,
      doc.cancelsId ? db.documents.get(doc.cancelsId) : undefined,
      db.timeEntries.where('invoiceId').equals(doc.id).count(),
      doc.sourceQuoteId ? db.documents.get(doc.sourceQuoteId) : undefined,
      doc.creditsId ? db.documents.get(doc.creditsId) : undefined,
      doc.settledById ? db.documents.get(doc.settledById) : undefined,
    ])
    const invoicesFromQuote = isQuote ? await db.documents.filter((d) => d.sourceQuoteId === doc.id).toArray() : []
    const creditDrafts = doc.kind === 'invoice' ? await db.documents.where('creditsId').equals(doc.id).filter((d) => d.status === 'draft').toArray() : []
    return { cancelledBy, cancels, timeCount, source, invoicesFromQuote, credits, settledBy, creditDrafts }
  }, [doc.id, doc.cancelledById, doc.cancelsId, doc.creditsId, doc.settledById])

  const pdf = async (withXml = false) => {
    setBusy(true)
    await run(() => downloadPdf(doc, settings, withXml))
    setBusy(false)
  }

  const duplicate = async (asKind?: 'invoice') => {
    const copy = await run(() => duplicateDocument(doc.id, asKind), asKind ? t('Rechnung aus Angebot erstellt') : t('Kopie als Entwurf erstellt'))
    if (copy) navigate(`/rechnungen/${copy.id}`)
  }

  const credit = async (scope: 'full' | 'partial') => {
    const draft = await run(() => createCreditNote(doc.id, scope))
    setCreditOpen(false)
    if (draft) navigate(`/rechnungen/${draft.id}`)
  }

  const createFinal = async () => {
    const draft = await run(async () => {
      const fin = await createDraft('invoice', { customerId: doc.customerId, billingType: 'final' })
      const downs = await openDownPayments(doc.customerId)
      const list = downs.length ? downs : [doc]
      const next = { ...fin, title: 'Schlussrechnung', deductions: list.map(deductionFor), language: doc.language, currency: doc.currency, recipient: doc.recipient }
      await saveDocument(next)
      return next
    })
    if (draft) navigate(`/rechnungen/${draft.id}`)
  }

  const cancel = async (correct: boolean) => {
    const storno = await run(() => cancelInvoice(doc.id), t('Stornorechnung erstellt'))
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
            <ChevronLeft size={16} aria-hidden /> {isQuote ? t('Angebote') : t('Rechnungen')}
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
          <Button icon={Printer} onClick={printDocument} className="hide-sm">
            {t('Drucken')}
          </Button>
          <Button icon={Mail} onClick={() => setSendOpen(true)}>
            {t('Senden')}
          </Button>
          {!isQuote && (
            <Button icon={FileCode2} onClick={() => setEOpen(true)}>
              {t('E-Rechnung')}
            </Button>
          )}
          <Button variant="primary" icon={Download} onClick={() => pdf(false)} disabled={busy}>
            {t('PDF')}
          </Button>
        </div>
      </header>

      <div className="editor-layout viewer">
        <div className="editor-form stack">
          {doc.kind === 'invoice' && doc.status !== 'cancelled' && <PaymentsCard doc={doc} />}
          {doc.kind === 'invoice' && <ReminderHistory doc={doc} settings={settings} />}

          {isQuote && (
            <section className="card card-pad stack-sm">
              <strong>{t('Wie hat der Kunde entschieden?')}</strong>
              <Segmented
                label={t('Angebotsstatus')}
                value={doc.status as 'sent' | 'accepted' | 'declined'}
                onChange={(s) => run(() => setQuoteStatus(doc.id, s))}
                options={[
                  { value: 'sent', label: t('Offen') },
                  { value: 'accepted', label: t('Angenommen') },
                  { value: 'declined', label: t('Abgelehnt') },
                ]}
              />
              <Button variant="primary" icon={FileCheck2} onClick={() => duplicate('invoice')}>
                {t('In Rechnung umwandeln')}
              </Button>
              {related?.invoicesFromQuote.map((d) => (
                <Link key={d.id} to={`/rechnungen/${d.id}`} className="small">
                  {t('→ Rechnung')} {d.number ?? t('(Entwurf)')}
                </Link>
              ))}
            </section>
          )}

          <section className="card card-pad stack-sm">
            <h3>{t('Details')}</h3>
            <dl className="details-list">
              <dt>{t('Empfänger')}</dt>
              <dd>{recipientName(doc.recipient)}</dd>
              <dt>{t('Netto')}</dt>
              <dd className="tabular">{formatMoney(totals.netCents, doc.currency)}</dd>
              <dt>{t('Umsatzsteuer')}</dt>
              <dd className="tabular">{formatMoney(totals.taxCents, doc.currency)}</dd>
              <dt>{t('Brutto')}</dt>
              <dd className="tabular">
                <strong>{formatMoney(totals.grossCents, doc.currency)}</strong>
              </dd>
              <dt>{t('Steuerfall')}</dt>
              <dd>{t(TAX_MODE_LABELS[doc.taxMode])}</dd>
              {totals.prepaidCents !== 0 && (
                <>
                  <dt>{t('Abschläge')}</dt>
                  <dd className="tabular">−{formatMoney(totals.prepaidCents, doc.currency)}</dd>
                  <dt>{t('Zu zahlen')}</dt>
                  <dd className="tabular">{formatMoney(totals.dueCents, doc.currency)}</dd>
                </>
              )}
              {doc.sentAt && (
                <>
                  <dt>{t('Versendet')}</dt>
                  <dd>{new Date(doc.sentAt).toLocaleString(uiLocale(), { dateStyle: 'medium', timeStyle: 'short' })}</dd>
                </>
              )}
              <dt>{t('Abgeschlossen')}</dt>
              <dd>{doc.finalizedAt ? new Date(doc.finalizedAt).toLocaleString(uiLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : '–'}</dd>
              {!!related?.timeCount && (
                <>
                  <dt>{t('Zeiten')}</dt>
                  <dd>{related.timeCount === 1 ? t('1 Eintrag abgerechnet') : t('{n} Einträge abgerechnet', { n: related.timeCount })}</dd>
                </>
              )}
            </dl>
            {doc.customerId && (
              <Link to={`/kunden/${doc.customerId}`} className="small">
                {t('Zum Kunden')}
              </Link>
            )}
            {related?.cancelledBy && (
              <div className="callout warning small">
                <Ban size={16} aria-hidden />
                <span>
                  {t('Storniert durch')} <Link to={`/rechnungen/${related.cancelledBy.id}`}>{related.cancelledBy.number}</Link>
                </span>
              </div>
            )}
            {related?.cancels && (
              <div className="callout small">
                <Info size={16} aria-hidden />
                <span>
                  {t('Storniert die Rechnung')} <Link to={`/rechnungen/${related.cancels.id}`}>{related.cancels.number}</Link>
                </span>
              </div>
            )}
            {related?.source && (
              <div className="small muted">
                {t('Aus Angebot')} <Link to={`/rechnungen/${related.source.id}`}>{related.source.number}</Link>
              </div>
            )}
            {related?.credits && (
              <div className="callout small">
                <Info size={16} aria-hidden />
                <span>
                  {t('Gutschrift zur Rechnung')} <Link to={`/rechnungen/${related.credits.id}`}>{related.credits.number}</Link>
                </span>
              </div>
            )}
            {doc.creditNotes.length > 0 && (
              <div className="small stack-sm" style={{ gap: 4 }}>
                <strong>{t('Gutschriften')}</strong>
                {doc.creditNotes.map((c) => (
                  <div key={c.id} className="row between">
                    <Link to={`/rechnungen/${c.id}`}>{c.number}</Link>
                    <span className="tabular muted">−{formatMoney(c.grossCents, doc.currency)}</span>
                  </div>
                ))}
              </div>
            )}
            {related?.creditDrafts.map((d) => (
              <Link key={d.id} to={`/rechnungen/${d.id}`} className="small">
                {t('→ Gutschrift-Entwurf fortsetzen')}
              </Link>
            ))}
            {doc.deductions.length > 0 && (
              <div className="small stack-sm" style={{ gap: 4 }}>
                <strong>{t('Verrechnete Abschläge')}</strong>
                {doc.deductions.map((d) => (
                  <Link key={d.invoiceId} to={`/rechnungen/${d.invoiceId}`}>
                    {d.number} {t('vom')} {formatDate(d.issueDate)}
                  </Link>
                ))}
              </div>
            )}
            {related?.settledBy && (
              <div className="callout small">
                <Info size={16} aria-hidden />
                <span>
                  {t('Verrechnet in der Schlussrechnung')} <Link to={`/rechnungen/${related.settledBy.id}`}>{related.settledBy.number ?? t('(Entwurf)')}</Link>
                </span>
              </div>
            )}
          </section>

          <section className="card card-pad stack-sm">
            <h3>{t('Weitere Aktionen')}</h3>
            <div className="row wrap">
              <Button icon={Copy} onClick={() => duplicate()}>
                {t('Duplizieren')}
              </Button>
              {doc.kind === 'invoice' && doc.customerId && doc.billingType === 'regular' && (
                <Button icon={Repeat} onClick={() => setRecurring(newRecurring(doc.customerId!, templateFromDocument(doc), addMonths(doc.issueDate, 1)))}>
                  {t('Als Serie')}
                </Button>
              )}
              {doc.kind === 'invoice' && doc.status !== 'cancelled' && creditableAmount(doc) > 0 && (
                <Button icon={ReceiptText} onClick={() => setCreditOpen(true)}>
                  {t('Gutschrift')}
                </Button>
              )}
              {doc.kind === 'invoice' && doc.billingType === 'downPayment' && !doc.settledById && doc.status !== 'cancelled' && (
                <Button icon={FileCheck2} onClick={createFinal}>
                  {t('Schlussrechnung erstellen')}
                </Button>
              )}
              {doc.kind === 'invoice' && doc.status !== 'cancelled' && !doc.creditNotes.length && !doc.settledById && (
                <Button variant="danger" icon={Ban} onClick={() => setCancelOpen(true)}>
                  {t('Stornieren')}
                </Button>
              )}
              {isQuote && (
                <Button
                  variant="danger"
                  icon={Trash2}
                  onClick={async () => {
                    if (!(await confirm({ title: t('Angebot löschen?'), message: t('Angebote unterliegen nicht der Aufbewahrungspflicht wie Rechnungen und können gelöscht werden.'), confirmLabel: t('Löschen'), danger: true }))) return
                    await run(() => db.documents.delete(doc.id), t('Angebot gelöscht'))
                    navigate('/rechnungen?art=angebote')
                  }}
                >
                  {t('Löschen')}
                </Button>
              )}
            </div>
            {!isQuote && (
              <p className="small faint">
                <Lock size={12} aria-hidden /> {t('Abgeschlossene Rechnungen sind nicht mehr änderbar. Für Korrekturen erstellst du eine Stornorechnung.')}
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
        open={creditOpen}
        onClose={() => setCreditOpen(false)}
        title={t('Gutschrift zu {p0}', { p0: doc.number })}
        description={t('Eine Gutschrift (Rechnungskorrektur) mindert den Rechnungsbetrag, ohne die Rechnung zu stornieren. Sie bekommt eine Nummer aus dem eigenen Nummernkreis.')}
        footer={
          <>
            <Button onClick={() => setCreditOpen(false)}>{t('Abbrechen')}</Button>
            <Button onClick={() => credit('partial')}>{t('Teilgutschrift')}</Button>
            <Button variant="primary" onClick={() => credit('full')}>
              {t('Vollgutschrift')}
            </Button>
          </>
        }
      >
        <p className="small muted">
          {t('Noch gutschreibbar:')} <strong>{formatMoney(creditableAmount(doc), doc.currency)}</strong>{t('. Bei einer Teilgutschrift übernimmt Kontor die Positionen, die du anschließend reduzierst oder entfernst. Hinweis: Im Steuerrecht meint „Gutschrift“ eigentlich die Abrechnung durch den Leistungsempfänger – auf dem Dokument steht deshalb „Rechnungskorrektur“.')}
        </p>
      </Dialog>

      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t('Rechnung {p0} stornieren?', { p0: doc.number })}
        description={t('Es wird eine Stornorechnung mit eigener Nummer und negativen Beträgen erstellt. Die Original-Rechnung bleibt erhalten und wird als storniert markiert.')}
        footer={
          <>
            <Button onClick={() => setCancelOpen(false)}>{t('Abbrechen')}</Button>
            <Button variant="danger" onClick={() => cancel(false)}>
              {t('Nur stornieren')}
            </Button>
            <Button variant="primary" onClick={() => cancel(true)}>
              {t('Stornieren und korrigieren')}
            </Button>
          </>
        }
      >
        <p className="small muted">{t('„Stornieren und korrigieren“ legt zusätzlich eine Kopie als neuen Entwurf an, den du anpassen kannst. Bereits abgerechnete Zeiten werden wieder freigegeben.')}</p>
      </Dialog>

      <RecurringDialog rec={recurring} onClose={() => setRecurring(null)} />
      <SendDialog doc={doc} settings={settings} open={sendOpen} onClose={() => setSendOpen(false)} />
      <EInvoiceDialog open={eOpen} onClose={() => setEOpen(false)} doc={doc} settings={settings} seller={seller} onPdf={() => pdf(true)} />
    </div>
  )
}

function ReminderHistory({ doc, settings }: { doc: InvoiceDocument; settings: Settings }) {
  const { run } = useFeedback()
  const reminders = useLiveQuery(() => remindersFor(doc.id), [doc.id])
  const [sending, setSending] = useState<Reminder | null>(null)
  if (!reminders?.length) return null
  return (
    <section className="card card-pad stack-sm">
      <h3>{t('Mahnverlauf')}</h3>
      <ul className="list payments-list">
        {reminders.map((r) => (
          <li key={r.id} className="list-item">
            <span className="grow">
              <span className="title" style={{ display: 'block' }}>{t(LEVEL_LABELS[r.level])}</span>
              <span className="sub">
                {formatDate(r.issueDate)} {t('· Frist')} {formatDate(r.deadline)}
                {r.sentAt ? t(' · versendet') : ''}
              </span>
            </span>
            <span className="tabular">{formatMoney(reminderTotal(r), doc.currency)}</span>
            <IconButton icon={Mail} label={t('Per E-Mail senden')} size={15} onClick={() => setSending(r)} />
            <IconButton icon={Download} label={t('PDF herunterladen')} size={15} onClick={() => run(() => downloadReminderPdf(r, doc, settings))} />
          </li>
        ))}
      </ul>
      {sending && <SendDialog key={sending.id} doc={doc} reminder={sending} settings={settings} open onClose={() => setSending(null)} />}
    </section>
  )
}

function PaymentsCard({ doc }: { doc: InvoiceDocument }) {
  const { run, undoable } = useFeedback()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState<number | null>(null)
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const status = displayStatus(doc)
  const totals = documentTotals(doc)
  const due = amountDue(doc)
  const paid = paidOf(doc)
  const credited = creditedOf(doc)
  const target = totals.dueCents - credited
  const progress = target > 0 ? Math.min(100, (paid / target) * 100) : 100
  const overdueDays = status === 'overdue' ? daysBetween(doc.dueDate, today()) : 0

  const openDialog = () => {
    setAmount(Math.max(0, due))
    setDate(today())
    setNote('')
    setOpen(true)
  }

  const save = async () => {
    const ok = await run(async () => {
      await addPayment(doc.id, { date, amountCents: amount ?? 0, note: note.trim() })
      return true
    }, (amount ?? 0) >= due ? t('Rechnung ist bezahlt') : t('Zahlung erfasst'))
    if (ok) setOpen(false)
  }

  const remove = async (p: Payment) => {
    await run(() => removePayment(doc.id, p.id))
    undoable(t('Zahlung über {p0} entfernt', { p0: formatMoney(p.amountCents, doc.currency) }), () => addPayment(doc.id, { date: p.date, amountCents: p.amountCents, note: p.note }))
  }

  return (
    <section className={`card card-pad stack-sm ${status === 'overdue' ? 'overdue-card' : ''}`}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {due <= 0 ? (
          <CheckCircle2 size={20} color="var(--green)" aria-hidden />
        ) : status === 'overdue' ? (
          <AlertTriangle size={20} color="var(--red)" aria-hidden />
        ) : (
          <Clock size={20} color="var(--accent)" aria-hidden />
        )}
        <div className="grow" style={{ flex: 1 }}>
          <strong>
            {due <= 0
              ? displayStatus(doc) === 'settled'
                ? t('Durch Gutschrift ausgeglichen')
                : t('Bezahlt am {p0}', { p0: formatDate(doc.paidAt) })
              : status === 'overdue'
                ? overdueDays === 1 ? t('Seit einem Tag überfällig') : t('Seit {n} Tagen überfällig', { n: overdueDays })
                : t('Fällig am {p0}', { p0: formatDate(doc.dueDate) })}
          </strong>
          {due > 0 && (
            <p className="small muted">
              {paid > 0 ? t('{p0} von {p1} offen.', { p0: formatMoney(due, doc.currency), p1: formatMoney(target, doc.currency) }) : status === 'overdue' ? t('Zeit für eine freundliche Zahlungserinnerung.') : daysBetween(today(), doc.dueDate) === 0 ? t('Heute fällig.') : t('Noch {p0} Tage bis zur Fälligkeit.', { p0: daysBetween(today(), doc.dueDate) })}
            </p>
          )}
        </div>
      </div>
      {(paid > 0 || credited > 0) && (
        <>
          <div className="progress" aria-label={t('{p0} % bezahlt', { p0: Math.round(progress) })}>
            <span style={{ width: `${progress}%`, background: 'var(--green)' }} />
          </div>
          <ul className="list payments-list">
            {doc.payments.map((p) => (
              <li key={p.id} className="list-item">
                <span className="grow">
                  <span className="title" style={{ display: 'block' }}>{formatDate(p.date)}</span>
                  {p.note && <span className="sub">{p.note}</span>}
                </span>
                <span className="tabular">{formatMoney(p.amountCents, doc.currency)}</span>
                <IconButton icon={Trash2} label={t('Zahlung entfernen')} danger size={15} onClick={() => remove(p)} />
              </li>
            ))}
            {doc.creditNotes.map((c) => (
              <li key={c.id} className="list-item">
                <span className="grow">
                  <Link to={`/rechnungen/${c.id}`} className="title" style={{ display: 'block' }}>
                    {t('Gutschrift')} {c.number}
                  </Link>
                  <span className="sub">{formatDate(c.issueDate)}</span>
                </span>
                <span className="tabular">{formatMoney(c.grossCents, doc.currency)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {due > 0 && (
        <div className="row wrap">
          <Button variant="success" icon={CheckCircle2} onClick={openDialog} className="grow" style={{ flex: 1 }}>
            {t('Zahlung erfassen')}
          </Button>
          {status === 'overdue' && (
            <Link to={`/mahnwesen?rechnung=${doc.id}`} className="btn">
              <BellRing size={17} aria-hidden /> {t('Mahnen')}
            </Link>
          )}
        </div>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('Zahlung erfassen')}
        description={t('{p0} offen von {p1}', { p0: formatMoney(due, doc.currency), p1: recipientName(doc.recipient) })}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{t('Abbrechen')}</Button>
            <Button variant="success" onClick={save}>
              {(amount ?? 0) >= due ? t('Als bezahlt buchen') : t('Teilzahlung buchen')}
            </Button>
          </>
        }
      >
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Field className="span-3" label={t('Betrag')}>
            <MoneyInput value={amount} onChange={setAmount} currencySymbol={doc.currency === 'EUR' ? '€' : doc.currency} aria-label={t('Zahlungsbetrag')} autoFocus />
          </Field>
          <TextField className="span-3" label={t('Zahlungseingang am')} type="date" value={date} onChange={setDate} max={today()} />
          <TextField className="span-6" label={t('Notiz')} value={note} onChange={setNote} placeholder={t('optional, z. B. Verwendungszweck')} />
          {(amount ?? 0) > 0 && (amount ?? 0) < due && <p className="span-6 small muted">{t('Teilzahlung – es bleiben')} {formatMoney(due - (amount ?? 0), doc.currency)} {t('offen.')}</p>}
          {(amount ?? 0) > due && <p className="span-6 small" style={{ color: 'var(--orange)' }}>{t('Der Betrag ist höher als der offene Betrag (')}{formatMoney(due, doc.currency)}).</p>}
          <button type="submit" hidden />
        </form>
      </Dialog>
    </section>
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
      title={t('E-Rechnung exportieren')}
      description={t('Strukturierte Rechnungsdaten nach EN 16931 – seit 2025 im inländischen B2B-Bereich relevant.')}
      footer={
        <>
          <Button onClick={onClose}>{t('Schließen')}</Button>
          {profile === 'facturx' ? (
            <>
              <Button icon={FileCode2} onClick={() => run(async () => downloadXml(doc, settings, 'facturx'))}>
                {t('Nur XML (CII)')}
              </Button>
              <Button variant="primary" icon={Download} onClick={onPdf}>
                {t('ZUGFeRD-PDF')}
              </Button>
            </>
          ) : (
            <Button variant="primary" icon={Download} onClick={() => run(async () => downloadXml(doc, settings, 'xrechnung'))}>
              {t('XRechnung (XML)')}
            </Button>
          )}
        </>
      }
    >
      <div className="stack-sm">
        <Segmented
          label={t('Format')}
          value={profile}
          onChange={setProfile}
          options={[
            { value: 'facturx', label: t('ZUGFeRD / Factur-X') },
            { value: 'xrechnung', label: t('XRechnung') },
          ]}
        />
        <p className="small muted">
          {profile === 'facturx'
            ? t('PDF mit eingebetteter XML-Datei (factur-x.xml, Profil EN 16931). Für Menschen lesbar, für Buchhaltungssoftware auswertbar.')
            : t('Reines XML im CII-Format nach XRechnung 3.0 – Standard für öffentliche Auftraggeber.')}
        </p>
        <div className="callout small">
          <Info size={16} aria-hidden />
          <span>
            {t('Die XML-Daten folgen EN 16931 und wurden für typische Fälle mit dem KoSIT-Validator geprüft, das ZUGFeRD-PDF mit veraPDF als PDF/A-3B. Eine offizielle Zertifizierung gibt es nicht – prüfe neue Konstellationen vor dem Versand, z. B. mit dem Prüfwerkzeug deines Empfängers.')}
          </span>
        </div>
        {issues.length > 0 && <IssueList issues={issues.map((i) => ({ level: 'warning', field: '', message: i.message }))} />}
      </div>
    </Dialog>
  )
}
