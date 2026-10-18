import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, Download, FileInput, Paperclip, Plus, Receipt, Search, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFeedback } from '../components/feedback'
import { Button, Dialog, EmptyState, Field, IconButton, MoneyInput, PageHeader, SelectField, Stat, TextAreaField, TextField } from '../components/ui'
import { downloadFile } from '../lib/backup'
import { formatDate } from '../lib/dates'
import { db } from '../lib/db'
import { CURRENCIES, TAX_RATES } from '../lib/defaults'
import { extractXmlFromPdf, importedToExpense, parseEInvoice } from '../lib/einvoiceImport'
import { deleteExpense, emptyExpense, EXPENSE_CATEGORIES, expenseNet, expensesToCsv, saveExpense, storeAttachment, vatFromGross } from '../lib/expenses'
import { useDocumentTitle, useSettings } from '../lib/hooks'
import { formatMoney, formatNumber } from '../lib/money'
import type { Attachment, Expense } from '../lib/types'

export function Expenses() {
  useDocumentTitle('Ausgaben')
  const settings = useSettings()
  const { run, undoable, toast } = useFeedback()
  const [year, setYear] = useState(new Date().getFullYear())
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [editing, setEditing] = useState<Expense | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const all = useLiveQuery(() => db.expenses.toArray(), [])

  const list = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (all ?? [])
      .filter((e) => e.date.startsWith(String(year)))
      .filter((e) => !category || e.category === category)
      .filter((e) => !term || [e.vendor, e.description, e.invoiceNumber, e.category].some((v) => v.toLowerCase().includes(term)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  }, [all, year, q, category])

  const total = list.reduce((s, e) => s + e.grossCents, 0)
  const vat = list.reduce((s, e) => s + e.vatCents, 0)
  const withoutReceipt = list.filter((e) => !e.attachmentId).length
  const fresh = () => emptyExpense({ taxRate: settings?.smallBusiness ? 0 : 19, currency: settings?.defaults.currency ?? 'EUR' })

  const remove = async (e: Expense) => {
    const removed = await run(() => deleteExpense(e.id))
    if (!removed) return
    undoable('Ausgabe gelöscht', async () => {
      if (removed.attachment) await db.attachments.put(removed.attachment)
      if (removed.expense) await db.expenses.put(removed.expense)
    })
  }

  const importFile = async (file: File | undefined) => {
    if (!file) return
    await run(async () => {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      const xml = isPdf ? await extractXmlFromPdf(bytes) : new TextDecoder().decode(bytes)
      if (!xml) throw new Error('In diesem PDF steckt keine E-Rechnung (ZUGFeRD/Factur-X).')
      const inv = parseEInvoice(xml)
      const att = await storeAttachment(file)
      setEditing(importedToExpense(inv, { ...fresh(), attachmentId: att.id }))
      toast(`E-Rechnung ${inv.number} von ${inv.sellerName || 'unbekannt'} gelesen – bitte prüfen`)
    })
  }

  return (
    <div className="page">
      <PageHeader
        title="Ausgaben"
        subtitle="Belege mit Vorsteuer erfassen – Grundlage für EÜR und Umsatzsteuer-Voranmeldung."
        actions={
          <>
            <Button icon={FileInput} onClick={() => importInput.current?.click()}>
              E-Rechnung importieren
            </Button>
            <Button variant="primary" icon={Plus} onClick={() => setEditing(fresh())}>
              Neue Ausgabe
            </Button>
            <input ref={importInput} type="file" accept=".xml,.pdf,application/xml,text/xml,application/pdf" hidden onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = '' }} />
          </>
        }
      />

      <div className="grid grid-3" style={{ marginBottom: 20 }}>
        <Stat label={`Ausgaben ${year}`} value={formatMoney(total)} sub={`${list.length} Belege, brutto`} icon={Receipt} tone="orange" />
        <Stat label="Vorsteuer" value={formatMoney(vat)} sub={settings?.smallBusiness ? 'als Kleinunternehmer nicht abziehbar' : 'abziehbar, siehe Berichte'} tone="green" />
        <Stat label="Ohne Beleg" value={String(withoutReceipt)} sub={withoutReceipt ? 'Beleg-Datei fehlt noch' : 'alles belegt'} icon={Paperclip} tone={withoutReceipt ? 'red' : 'blue'} />
      </div>

      <div className="toolbar">
        <div className="row" style={{ gap: 2 }}>
          <IconButton icon={ChevronLeft} label="Vorheriges Jahr" onClick={() => setYear(year - 1)} />
          <strong className="tabular" style={{ minWidth: 48, textAlign: 'center', fontSize: 17 }}>
            {year}
          </strong>
          <IconButton icon={ChevronRight} label="Nächstes Jahr" onClick={() => setYear(year + 1)} />
        </div>
        <label className="search">
          <span className="sr-only">Ausgaben durchsuchen</span>
          <Search size={16} aria-hidden />
          <input className="input" type="search" placeholder="Lieferant, Beschreibung …" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <select className="select" style={{ width: 'auto' }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kategorie">
          <option value="">Alle Kategorien</option>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <span className="spacer" />
        <Button size="sm" icon={Download} disabled={!list.length} onClick={() => downloadFile(`kontor-ausgaben-${year}.csv`, expensesToCsv(list), 'text/csv;charset=utf-8')}>
          CSV
        </Button>
      </div>

      <div className="card">
        {all && !all.length ? (
          <EmptyState icon={Receipt} title="Noch keine Ausgaben" action={<Button variant="primary" icon={Plus} onClick={() => setEditing(fresh())}>Erste Ausgabe erfassen</Button>}>
            Trage Belege mit Datum, Betrag und Vorsteuer ein und hänge ein Foto oder PDF an. Eingehende XRechnungen und ZUGFeRD-PDFs liest Kontor direkt ein.
          </EmptyState>
        ) : !list.length ? (
          <EmptyState icon={Search} title="Keine Ausgaben gefunden" compact>
            Für {year} und diese Filter gibt es keine Einträge.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Ausgabe</th>
                  <th className="hide-sm">Datum</th>
                  <th className="hide-sm">Kategorie</th>
                  <th className="num hide-sm">Vorsteuer</th>
                  <th className="num">Brutto</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id} className="clickable" onClick={() => setEditing(e)}>
                    <td className="primary-cell">
                      <a href="#/ausgaben" style={{ color: 'inherit' }} onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); setEditing(e) }}>
                        {e.vendor || e.description || 'Ohne Bezeichnung'}
                      </a>
                      <small>
                        {[e.vendor ? e.description : '', e.invoiceNumber].filter(Boolean).join(' · ')}
                        {e.attachmentId ? '' : ' · ohne Beleg'}
                      </small>
                    </td>
                    <td className="muted nowrap hide-sm">{formatDate(e.date)}</td>
                    <td className="muted hide-sm">{e.category}</td>
                    <td className="num muted hide-sm">{formatMoney(e.vatCents, e.currency)}</td>
                    <td className="num">
                      <strong>{formatMoney(e.grossCents, e.currency)}</strong>
                    </td>
                    <td className="num" onClick={(ev) => ev.stopPropagation()}>
                      {e.attachmentId && <IconButton icon={Paperclip} label="Beleg öffnen" onClick={() => run(() => openAttachment(e.attachmentId!))} />}
                      <IconButton icon={Trash2} label="Löschen" danger onClick={() => remove(e)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ExpenseDialog expense={editing} onClose={() => setEditing(null)} smallBusiness={!!settings?.smallBusiness} />
    </div>
  )
}

async function openAttachment(id: string) {
  const att = await db.attachments.get(id)
  if (!att) throw new Error('Der Beleg wurde nicht gefunden.')
  const url = URL.createObjectURL(att.data)
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function ExpenseDialog({ expense, onClose, smallBusiness }: { expense: Expense | null; onClose: () => void; smallBusiness: boolean }) {
  const { run } = useFeedback()
  const [e, setE] = useState<Expense | null>(expense)
  const [lastId, setLastId] = useState(expense?.id)
  const [manualVat, setManualVat] = useState(false)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  if (expense?.id !== lastId) {
    setLastId(expense?.id)
    setE(expense)
    setManualVat(!!expense && expense.vatCents !== vatFromGross(expense.grossCents, expense.taxRate))
  }
  const attachment = useLiveQuery(async (): Promise<Attachment | null> => (e?.attachmentId ? ((await db.attachments.get(e.attachmentId)) ?? null) : null), [e?.attachmentId])
  if (!e) return null

  const set = (patch: Partial<Expense>) => {
    const next = { ...e, ...patch }
    if (!manualVat && ('grossCents' in patch || 'taxRate' in patch)) next.vatCents = vatFromGross(next.grossCents, next.taxRate)
    setE(next)
  }
  const attach = (file: File | undefined) => {
    if (!file) return
    void run(async () => {
      const att = await storeAttachment(file)
      setE((cur) => (cur ? { ...cur, attachmentId: att.id } : cur))
    }, 'Beleg angehängt')
  }
  const save = async () => {
    const saved = await run(() => saveExpense(e), 'Ausgabe gespeichert')
    if (saved) onClose()
  }

  return (
    <Dialog
      open={!!expense}
      onClose={onClose}
      wide
      title={expense?.vendor || expense?.grossCents ? 'Ausgabe bearbeiten' : 'Neue Ausgabe'}
      footer={
        <>
          <span className="muted small" style={{ marginRight: 'auto', alignSelf: 'center' }}>
            netto {formatMoney(expenseNet(e), e.currency)}
          </span>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save}>
            Speichern
          </Button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(ev) => {
          ev.preventDefault()
          void save()
        }}
      >
        <TextField className="span-3" label="Lieferant" value={e.vendor} onChange={(vendor) => set({ vendor })} autoFocus placeholder="z. B. Hosting Nord GmbH" />
        <TextField className="span-3" label="Belegnummer" value={e.invoiceNumber} onChange={(invoiceNumber) => set({ invoiceNumber })} placeholder="optional" />
        <TextField className="span-6" label="Beschreibung" value={e.description} onChange={(description) => set({ description })} />
        <TextField className="span-2" label="Belegdatum" type="date" value={e.date} onChange={(date) => set({ date })} />
        <TextField className="span-2" label="Bezahlt am" type="date" value={e.paidAt ?? ''} onChange={(paidAt) => set({ paidAt: paidAt || null })} hint="leer = noch offen" />
        <SelectField className="span-2" label="Kategorie" value={e.category} onChange={(category) => set({ category })}>
          {[...new Set([...EXPENSE_CATEGORIES, e.category])].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </SelectField>
        <Field className="span-2" label="Betrag brutto">
          <MoneyInput value={e.grossCents} onChange={(v) => set({ grossCents: v ?? 0 })} currencySymbol={e.currency === 'EUR' ? '€' : e.currency} aria-label="Betrag brutto" />
        </Field>
        <SelectField className="span-1" label="USt" value={String(e.taxRate)} onChange={(v) => set({ taxRate: Number(v) })}>
          {[...new Set([...TAX_RATES, e.taxRate])].map((r) => (
            <option key={r} value={r}>
              {formatNumber(r)} %
            </option>
          ))}
        </SelectField>
        <Field className="span-2" label="Vorsteuer" hint={manualVat ? <button type="button" className="link-button" onClick={() => { setManualVat(false); setE({ ...e, vatCents: vatFromGross(e.grossCents, e.taxRate) }) }}>automatisch berechnen</button> : 'aus Brutto berechnet'}>
          <MoneyInput value={e.vatCents} onChange={(v) => { setManualVat(true); setE({ ...e, vatCents: v ?? 0 }) }} aria-label="Vorsteuer" />
        </Field>
        <SelectField className="span-1" label="Währung" value={e.currency} onChange={(currency) => set({ currency })}>
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </SelectField>
        {smallBusiness && <p className="span-6 small muted">Als Kleinunternehmer ziehst du keine Vorsteuer ab – die Ausgabe zählt in der EÜR mit dem Bruttobetrag.</p>}
        <TextAreaField className="span-6" label="Notiz" value={e.notes} onChange={(notes) => set({ notes })} rows={2} />
        <div
          className={`span-6 logo-drop ${dragging ? 'dragging' : ''}`}
          onDragOver={(ev) => {
            ev.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(ev) => {
            ev.preventDefault()
            setDragging(false)
            attach(ev.dataTransfer.files[0])
          }}
        >
          <div className="logo-preview">
            {attachment?.mime.startsWith('image/') ? <AttachmentThumb att={attachment} /> : <Paperclip size={24} aria-hidden />}
          </div>
          <div className="stack-sm" style={{ gap: 8 }}>
            <div>
              <strong>{attachment ? attachment.name : 'Beleg anhängen'}</strong>
              <p className="muted small">{attachment ? `${Math.round(attachment.size / 1024)} KB · bleibt auf diesem Gerät` : 'Foto oder PDF bis 10 MB, hierher ziehen oder auswählen.'}</p>
            </div>
            <div className="row wrap">
              <Button size="sm" icon={Upload} onClick={() => input.current?.click()}>
                {attachment ? 'Ersetzen' : 'Datei wählen'}
              </Button>
              {attachment && (
                <>
                  <Button size="sm" icon={Paperclip} onClick={() => run(() => openAttachment(attachment.id))}>
                    Öffnen
                  </Button>
                  <Button size="sm" variant="ghost" icon={X} onClick={() => setE({ ...e, attachmentId: null })}>
                    Entfernen
                  </Button>
                </>
              )}
            </div>
          </div>
          <input ref={input} type="file" accept="image/*,application/pdf,.xml" capture="environment" hidden onChange={(ev) => { attach(ev.target.files?.[0]); ev.target.value = '' }} />
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

function AttachmentThumb({ att }: { att: Attachment }) {
  const [url] = useState(() => URL.createObjectURL(att.data))
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return <img src={url} alt="" />
}
