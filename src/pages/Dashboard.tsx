import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, CheckCircle2, Circle, Clock, FilePlus, FileText, ReceiptText, TrendingUp, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BarChart } from '../components/BarChart'
import { StatusBadge } from '../components/DocumentsTable'
import { TimerCard } from '../components/TimeComponents'
import { Button, Stat } from '../components/ui'
import { durationMinutes, formatDate, formatDuration, startOfWeek, today, toISODate } from '../lib/dates'
import { db } from '../lib/db'
import { customerName, recipientName } from '../lib/defaults'
import { useDocumentTitle, useSettings } from '../lib/hooks'
import { formatMoney } from '../lib/money'
import { countsAsRevenue, displayStatus, grossOf, isOutstanding, netOf } from '../lib/status'
import { NewDocumentDialog } from './Documents'

function greeting() {
  const h = new Date().getHours()
  if (h < 5) return 'Gute Nacht'
  if (h < 11) return 'Guten Morgen'
  if (h < 18) return 'Guten Tag'
  return 'Guten Abend'
}

export function Dashboard() {
  useDocumentTitle('Übersicht')
  const settings = useSettings()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const data = useLiveQuery(async () => {
    const [docs, entries, customers] = await Promise.all([db.documents.toArray(), db.timeEntries.toArray(), db.customers.toArray()])
    return { docs, entries, customers }
  })

  if (!data || !settings) return <div className="page" />
  const { docs, entries, customers } = data
  const now = new Date()
  const year = String(now.getFullYear())
  const month = today().slice(0, 7)

  const revenueDocs = docs.filter(countsAsRevenue)
  const monthRevenue = revenueDocs.filter((d) => d.issueDate.startsWith(month)).reduce((s, d) => s + netOf(d), 0)
  const yearRevenue = revenueDocs.filter((d) => d.issueDate.startsWith(year)).reduce((s, d) => s + netOf(d), 0)
  const outstanding = docs.filter(isOutstanding)
  const overdue = outstanding.filter((d) => displayStatus(d) === 'overdue')
  const weekStart = startOfWeek(now).toISOString()
  const weekMinutes = entries.filter((e) => e.start >= weekStart).reduce((s, e) => s + durationMinutes(e.start, e.end), 0)
  const monthMinutes = entries.filter((e) => toISODate(new Date(e.start)).slice(0, 7) === month).reduce((s, e) => s + durationMinutes(e.start, e.end), 0)
  const unbilledMinutes = entries.filter((e) => !e.invoiceId && e.billable).reduce((s, e) => s + durationMinutes(e.start, e.end), 0)

  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const value = revenueDocs.filter((x) => x.issueDate.startsWith(key)).reduce((s, x) => s + netOf(x), 0)
    return {
      key,
      label: d.toLocaleDateString('de-DE', { month: 'short' }).replace('.', ''),
      hint: d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }),
      value: Math.max(0, value),
      display: formatMoney(value),
      current: key === month,
    }
  })

  const customerById = new Map(customers.map((c) => [c.id, c]))
  const recent = [...entries].sort((a, b) => b.start.localeCompare(a.start)).slice(0, 5)
  const attention = [...outstanding].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5)
  const drafts = docs.filter((d) => d.status === 'draft')

  const company = settings.company
  const setup = [
    { done: !!(company.name && company.street && (company.taxNumber || company.vatId)), label: 'Firmendaten eintragen', to: '/einstellungen' },
    { done: !!company.iban, label: 'Bankverbindung hinterlegen', to: '/einstellungen' },
    { done: !!settings.logo, label: 'Logo hochladen', to: '/einstellungen' },
    { done: customers.length > 0, label: 'Ersten Kunden anlegen', to: '/kunden' },
    { done: docs.some((d) => d.status !== 'draft'), label: 'Erste Rechnung abschließen', to: '/rechnungen' },
  ]
  const setupOpen = setup.filter((s) => !s.done).length
  const firstName = (company.owner || '').split(' ')[0]

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="muted small" style={{ fontWeight: 550 }}>
            {now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1>
            {greeting()}
            {firstName ? `, ${firstName}` : ''}
          </h1>
        </div>
        <div className="actions">
          <Button icon={UserPlus} onClick={() => navigate('/kunden')}>
            Kunde
          </Button>
          <Button variant="primary" icon={FilePlus} onClick={() => setCreating(true)}>
            Neue Rechnung
          </Button>
        </div>
      </header>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label="Umsatz diesen Monat" value={formatMoney(monthRevenue)} sub="netto, nach Rechnungsdatum" icon={TrendingUp} tone="green" />
        <Stat label={`Umsatz ${year}`} value={formatMoney(yearRevenue)} sub={`${revenueDocs.filter((d) => d.issueDate.startsWith(year) && d.kind === 'invoice').length} Rechnungen`} icon={ReceiptText} tone="blue" />
        <Stat
          label="Offene Rechnungen"
          value={formatMoney(outstanding.reduce((s, d) => s + grossOf(d), 0))}
          sub={overdue.length ? `${overdue.length} überfällig · ${formatMoney(overdue.reduce((s, d) => s + grossOf(d), 0))}` : `${outstanding.length} offen, keine überfällig`}
          icon={overdue.length ? AlertTriangle : FileText}
          tone={overdue.length ? 'red' : 'orange'}
        />
        <Stat label="Stunden diese Woche" value={formatDuration(weekMinutes)} sub={`${formatDuration(monthMinutes)} im Monat · ${formatDuration(unbilledMinutes)} offen`} icon={Clock} tone="purple" />
      </div>

      <div className="dashboard-grid">
        <div className="stack">
          <section className="card">
            <div className="card-header">
              <h2>Umsatz der letzten 12 Monate</h2>
              <Link to="/berichte" className="small">
                Berichte
              </Link>
            </div>
            <div className="card-body">
              <BarChart bars={months} label="Nettoumsatz pro Monat" />
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2>Offene Rechnungen</h2>
              <Link to="/rechnungen?status=open" className="small">
                Alle anzeigen
              </Link>
            </div>
            {attention.length === 0 ? (
              <div className="card-body row muted">
                <CheckCircle2 size={18} color="var(--green)" aria-hidden /> Keine offenen Rechnungen – alles bezahlt.
              </div>
            ) : (
              <ul className="list" style={{ marginTop: 8 }}>
                {attention.map((d) => (
                  <li key={d.id}>
                    <Link to={`/rechnungen/${d.id}`} className="list-item">
                      <div className="grow">
                        <div className="title">{recipientName(d.recipient)}</div>
                        <div className="sub">
                          {d.number} · fällig {formatDate(d.dueDate)}
                        </div>
                      </div>
                      <StatusBadge doc={d} />
                      <strong className="tabular">{formatMoney(grossOf(d), d.currency)}</strong>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {drafts.length > 0 && (
            <section className="card">
              <div className="card-header">
                <h2>Entwürfe</h2>
              </div>
              <ul className="list" style={{ marginTop: 8 }}>
                {drafts.slice(0, 4).map((d) => (
                  <li key={d.id}>
                    <Link to={`/rechnungen/${d.id}`} className="list-item">
                      <div className="grow">
                        <div className="title">{recipientName(d.recipient)}</div>
                        <div className="sub">
                          {d.kind === 'quote' ? 'Angebot' : 'Rechnung'} · {d.items.length} {d.items.length === 1 ? 'Position' : 'Positionen'}
                        </div>
                      </div>
                      <strong className="tabular">{formatMoney(grossOf(d), d.currency)}</strong>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="stack">
          {setupOpen > 0 && (
            <section className="card card-pad">
              <h2 style={{ marginBottom: 4 }}>Erste Schritte</h2>
              <p className="small muted" style={{ marginBottom: 12 }}>
                Noch {setupOpen} von {setup.length} offen
              </p>
              <div className="progress" style={{ marginBottom: 12 }}>
                <span style={{ width: `${((setup.length - setupOpen) / setup.length) * 100}%` }} />
              </div>
              <ul className="list checklist">
                {setup.map((s) => (
                  <li key={s.label}>
                    <Link to={s.to} className={`list-item ${s.done ? 'done' : ''}`}>
                      {s.done ? <CheckCircle2 size={18} color="var(--green)" aria-hidden /> : <Circle size={18} className="faint" aria-hidden />}
                      <span className="grow">{s.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <TimerCard />

          <section className="card">
            <div className="card-header">
              <h2>Zuletzt erfasst</h2>
              <Link to="/zeit" className="small">
                Zeiterfassung
              </Link>
            </div>
            {recent.length === 0 ? (
              <p className="card-body muted small">Noch keine Zeiten erfasst.</p>
            ) : (
              <ul className="list" style={{ marginTop: 8 }}>
                {recent.map((e) => {
                  const c = customerById.get(e.customerId)
                  return (
                    <li key={e.id} className="list-item">
                      <div className="grow">
                        <div className="title">{e.description}</div>
                        <div className="sub">
                          {[c ? customerName(c) : '', formatDate(e.start)].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <span className="tabular small">{formatDuration(durationMinutes(e.start, e.end))}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

      <NewDocumentDialog kind={creating ? 'invoice' : null} onClose={() => setCreating(false)} />
    </div>
  )
}
