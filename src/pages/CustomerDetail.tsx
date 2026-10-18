import { useLiveQuery } from 'dexie-react-hooks'
import { Archive, ArchiveRestore, ChevronLeft, Clock, FilePlus, FileText, Mail, MapPin, Pencil, Phone, Play, ReceiptText, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CustomerDialog } from '../components/CustomerDialog'
import { DocumentsTable } from '../components/DocumentsTable'
import { useFeedback } from '../components/feedback'
import { BillTimeDialog, emptyEntry, TimeEntryDialog, TimeEntryList } from '../components/TimeComponents'
import { Avatar, Button, EmptyState, PageHeader, Segmented, Stat } from '../components/ui'
import { minutesToHours } from '../lib/calc'
import { countryName } from '../lib/countries'
import { durationMinutes, formatDuration } from '../lib/dates'
import { db } from '../lib/db'
import { customerName } from '../lib/defaults'
import { useDocumentTitle, useSettings, useTimer } from '../lib/hooks'
import { formatMoney } from '../lib/money'
import { createDraft, deleteCustomer, entryRate, startTimer } from '../lib/repo'
import { amountDue, countsAsRevenue, displayStatus, isOutstanding, netOf } from '../lib/status'
import type { TimeEntry } from '../lib/types'
import { NotFound } from './NotFound'

export function CustomerDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const settings = useSettings()
  const timer = useTimer()
  const { run, confirm, toast } = useFeedback()
  const [tab, setTab] = useState<'invoices' | 'time' | 'details'>('invoices')
  const [editing, setEditing] = useState(false)
  const [entry, setEntry] = useState<TimeEntry | null>(null)
  const [billing, setBilling] = useState(false)

  const data = useLiveQuery(async () => {
    const customer = await db.customers.get(id)
    if (!customer) return { customer: null, docs: [], entries: [] }
    const [docs, entries] = await Promise.all([db.documents.where('customerId').equals(id).toArray(), db.timeEntries.where('customerId').equals(id).toArray()])
    docs.sort((a, b) => (b.issueDate + b.createdAt).localeCompare(a.issueDate + a.createdAt))
    return { customer, docs, entries }
  }, [id])
  useDocumentTitle(data?.customer ? customerName(data.customer) : 'Kunde')

  if (!data || !settings) return <div className="page" />
  const { customer, docs, entries } = data
  if (!customer) return <NotFound />

  const name = customerName(customer)
  const open = docs.filter(isOutstanding).reduce((s, d) => s + amountDue(d), 0)
  const overdue = docs.filter((d) => displayStatus(d) === 'overdue')
  const revenue = docs.filter(countsAsRevenue).reduce((s, d) => s + netOf(d), 0)
  const unbilled = entries.filter((e) => !e.invoiceId && e.billable)
  const unbilledMinutes = unbilled.reduce((s, e) => s + durationMinutes(e.start, e.end), 0)
  const unbilledAmount = unbilled.reduce((s, e) => s + Math.round(minutesToHours(durationMinutes(e.start, e.end)) * entryRate(e, customer, settings)), 0)
  const rate = customer.hourlyRateCents ?? settings.defaults.hourlyRateCents

  const newInvoice = async () => {
    const doc = await run(() => createDraft('invoice', { customerId: id }))
    if (doc) navigate(`/rechnungen/${doc.id}`)
  }

  const remove = async () => {
    const ok = await confirm({
      title: `${name} löschen?`,
      message: 'Kunden mit abgeschlossenen Rechnungen oder abgerechneten Zeiten werden nur archiviert, damit die Buchhaltung vollständig bleibt. Ansonsten werden der Kunde, seine Entwürfe und offenen Zeiten gelöscht.',
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (!ok) return
    const result = await run(() => deleteCustomer(id))
    if (result === 'archived') toast('Kunde archiviert')
    if (result === 'deleted') {
      toast('Kunde gelöscht')
      navigate('/kunden')
    }
  }

  return (
    <div className="page">
      <PageHeader
        back={
          <Link to="/kunden" className="back-link">
            <ChevronLeft size={16} aria-hidden /> Kunden
          </Link>
        }
        title={
          <span className="row" style={{ gap: 14 }}>
            <Avatar name={name} />
            <span style={{ minWidth: 0 }}>{name}</span>
          </span>
        }
        subtitle={
          <>
            {customer.number}
            {customer.archived && <span className="badge" style={{ marginLeft: 8 }}>Archiviert</span>}
          </>
        }
        actions={
          <>
            <Button icon={Pencil} onClick={() => setEditing(true)}>
              Bearbeiten
            </Button>
            {!timer && !customer.archived && (
              <Button icon={Play} onClick={() => run(() => startTimer({ customerId: id, project: '', description: '', billable: true }), 'Stoppuhr läuft')}>
                Stoppuhr
              </Button>
            )}
            <Button variant="primary" icon={FilePlus} onClick={newInvoice}>
              Neue Rechnung
            </Button>
          </>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label="Offen" value={formatMoney(open)} sub={overdue.length ? `${overdue.length} überfällig` : 'nichts überfällig'} icon={FileText} tone={overdue.length ? 'red' : 'blue'} />
        <Stat label="Umsatz netto" value={formatMoney(revenue)} sub={`${docs.filter(countsAsRevenue).length} Rechnungen`} icon={ReceiptText} tone="green" />
        <Stat label="Nicht abgerechnet" value={formatDuration(unbilledMinutes)} sub={formatMoney(unbilledAmount) + ' netto'} icon={Clock} tone="orange" />
        <Stat label="Stundensatz" value={formatMoney(rate)} sub={customer.hourlyRateCents == null ? 'Standardsatz' : 'kundenspezifisch'} icon={Clock} tone="purple" />
      </div>

      {unbilled.length > 0 && (
        <div className="callout info" style={{ marginBottom: 20, alignItems: 'center' }}>
          <Clock size={18} aria-hidden />
          <span className="grow" style={{ flex: 1 }}>
            <strong>{formatDuration(unbilledMinutes)}</strong> noch nicht abgerechnet ({unbilled.length} Einträge, {formatMoney(unbilledAmount)} netto).
          </span>
          <Button size="sm" variant="primary" icon={ReceiptText} onClick={() => setBilling(true)}>
            Jetzt abrechnen
          </Button>
        </div>
      )}

      <div className="toolbar">
        <Segmented
          label="Ansicht"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'invoices', label: `Rechnungen (${docs.length})` },
            { value: 'time', label: `Zeiten (${entries.length})` },
            { value: 'details', label: 'Stammdaten' },
          ]}
        />
        <span className="spacer" />
        {tab === 'time' && !customer.archived && (
          <Button size="sm" icon={Clock} onClick={() => setEntry(emptyEntry(id))}>
            Zeit nachtragen
          </Button>
        )}
      </div>

      {tab === 'invoices' && (
        <div className="card">
          {docs.length ? (
            <DocumentsTable docs={docs} showCustomer={false} />
          ) : (
            <EmptyState icon={FileText} title="Noch keine Rechnungen" compact action={<Button variant="primary" icon={FilePlus} onClick={newInvoice}>Rechnung erstellen</Button>}>
              Die Anschrift von {name} wird automatisch übernommen.
            </EmptyState>
          )}
        </div>
      )}

      {tab === 'time' && (
        <div className="card">
          {entries.length ? (
            <TimeEntryList entries={entries} customers={[customer]} onEdit={setEntry} showCustomer={false} />
          ) : (
            <EmptyState icon={Clock} title="Noch keine Zeiten" compact>
              Starte die Stoppuhr oder trage Zeiten nach – sie lassen sich später direkt in eine Rechnung übernehmen.
            </EmptyState>
          )}
        </div>
      )}

      {tab === 'details' && (
        <div className="grid grid-2">
          <div className="card card-pad stack-sm">
            <h3>Kontakt</h3>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <MapPin size={17} className="faint" aria-hidden style={{ marginTop: 3 }} />
              <div>
                {[customer.company, customer.contactPerson, customer.addressExtra, customer.street, [customer.zip, customer.city].filter(Boolean).join(' '), countryName(customer.country)]
                  .filter(Boolean)
                  .map((l, i) => (
                    <div key={i}>{l}</div>
                  ))}
              </div>
            </div>
            {customer.email && (
              <div className="row">
                <Mail size={17} className="faint" aria-hidden />
                <a href={`mailto:${customer.email}`}>{customer.email}</a>
              </div>
            )}
            {customer.phone && (
              <div className="row">
                <Phone size={17} className="faint" aria-hidden />
                <a href={`tel:${customer.phone}`}>{customer.phone}</a>
              </div>
            )}
          </div>
          <div className="card card-pad stack-sm">
            <h3>Abrechnung</h3>
            <dl className="details-list">
              <dt>USt-IdNr.</dt>
              <dd>{customer.vatId || '–'}</dd>
              <dt>Zahlungsziel</dt>
              <dd>{customer.paymentTermDays ?? settings.defaults.paymentTermDays} Tage</dd>
              <dt>Stundensatz</dt>
              <dd>{formatMoney(rate)}</dd>
              {customer.leitwegId && (
                <>
                  <dt>Leitweg-ID</dt>
                  <dd>{customer.leitwegId}</dd>
                </>
              )}
            </dl>
            {customer.notes && (
              <>
                <h3 style={{ marginTop: 12 }}>Notizen</h3>
                <p className="muted" style={{ whiteSpace: 'pre-line' }}>
                  {customer.notes}
                </p>
              </>
            )}
          </div>
          <div className="card card-pad row wrap span-2" style={{ gridColumn: '1 / -1' }}>
            {customer.archived ? (
              <Button icon={ArchiveRestore} onClick={() => run(() => db.customers.update(id, { archived: false }), 'Kunde wieder aktiv')}>
                Wiederherstellen
              </Button>
            ) : (
              <Button icon={Archive} onClick={() => run(() => db.customers.update(id, { archived: true }), 'Kunde archiviert')}>
                Archivieren
              </Button>
            )}
            <Button variant="danger" icon={Trash2} onClick={remove}>
              Kunde löschen
            </Button>
          </div>
        </div>
      )}

      <CustomerDialog open={editing} customer={customer} onClose={() => setEditing(false)} />
      <TimeEntryDialog entry={entry} onClose={() => setEntry(null)} />
      <BillTimeDialog customerId={id} open={billing} onClose={() => setBilling(false)} />
    </div>
  )
}
