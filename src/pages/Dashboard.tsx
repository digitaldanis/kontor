import { t, uiLocale } from '../lib/i18n'
import { useLiveQuery } from '../lib/live'
import { AlertTriangle, CheckCircle2, Circle, Clock, FilePlus, FileText, ReceiptText, Repeat, TrendingUp, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BarChart } from '../components/BarChart'
import { StatusBadge } from '../components/DocumentsTable'
import { BudgetBar, useBudgetWarnings } from '../components/Projects'
import { TimerCard } from '../components/TimeComponents'
import { Button, Stat } from '../components/ui'
import { addDays, durationMinutes, formatDate, formatDuration, startOfWeek, today, toISODate } from '../lib/dates'
import { db } from '../lib/db'
import { customerName, recipientName } from '../lib/defaults'
import { useDocumentTitle, useSettings } from '../lib/hooks'
import { formatMoney } from '../lib/money'
import { amountDue, countsAsRevenue, displayStatus, grossOf, isOutstanding, netOf } from '../lib/status'
import { NewDocumentDialog } from './Documents'

function greeting() {
  const h = new Date().getHours()
  if (h < 5) return t('Gute Nacht')
  if (h < 11) return t('Guten Morgen')
  if (h < 18) return t('Guten Tag')
  return t('Guten Abend')
}

export function Dashboard() {
  useDocumentTitle(t('Übersicht'))
  const settings = useSettings()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const warnings = useBudgetWarnings()
  const data = useLiveQuery(async () => {
    const [docs, entries, customers, recurring] = await Promise.all([db.documents.toArray(), db.timeEntries.toArray(), db.customers.toArray(), db.recurring.toArray()])
    return { docs, entries, customers, recurring }
  })

  if (!data || !settings) return <div className="page" />
  const { docs, entries, customers, recurring } = data
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
      label: d.toLocaleDateString(uiLocale(), { month: 'short' }).replace('.', ''),
      hint: d.toLocaleDateString(uiLocale(), { month: 'long', year: 'numeric' }),
      value: Math.max(0, value),
      display: formatMoney(value),
      current: key === month,
    }
  })

  const customerById = new Map(customers.map((c) => [c.id, c]))
  const recent = [...entries].sort((a, b) => b.start.localeCompare(a.start)).slice(0, 5)
  const attention = [...outstanding].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5)
  const drafts = docs.filter((d) => d.status === 'draft')
  const recurringDrafts = drafts.filter((d) => d.recurringId)
  const soon = addDays(today(), 14)
  const upcoming = recurring.filter((r) => r.active && r.nextRun <= soon).sort((a, b) => a.nextRun.localeCompare(b.nextRun)).slice(0, 3)

  const company = settings.company
  const setup = [
    { done: !!(company.name && company.street && (company.taxNumber || company.vatId)), label: t('Firmendaten eintragen'), to: '/einstellungen' },
    { done: !!company.iban, label: t('Bankverbindung hinterlegen'), to: '/einstellungen' },
    { done: !!settings.logo, label: t('Logo hochladen'), to: '/einstellungen' },
    { done: customers.length > 0, label: t('Ersten Kunden anlegen'), to: '/kunden' },
    { done: docs.some((d) => d.status !== 'draft'), label: t('Erste Rechnung abschließen'), to: '/rechnungen' },
  ]
  const setupOpen = setup.filter((s) => !s.done).length
  const firstName = (company.owner || '').split(' ')[0]

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="muted small" style={{ fontWeight: 550 }}>
            {now.toLocaleDateString(uiLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1>
            {greeting()}
            {firstName ? `, ${firstName}` : ''}
          </h1>
        </div>
        <div className="actions">
          <Button icon={UserPlus} onClick={() => navigate('/kunden')}>
            {t('Kunde')}
          </Button>
          <Button variant="primary" icon={FilePlus} onClick={() => setCreating(true)}>
            {t('Neue Rechnung')}
          </Button>
        </div>
      </header>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat label={t('Umsatz diesen Monat')} value={formatMoney(monthRevenue)} sub={t('netto, nach Rechnungsdatum')} icon={TrendingUp} tone="green" />
        <Stat label={t('Umsatz {p0}', { p0: year })} value={formatMoney(yearRevenue)} sub={t('{p0} Rechnungen', { p0: revenueDocs.filter((d) => d.issueDate.startsWith(year) && d.kind === 'invoice').length })} icon={ReceiptText} tone="blue" />
        <Stat
          label={t('Offene Rechnungen')}
          value={formatMoney(outstanding.reduce((s, d) => s + amountDue(d), 0))}
          sub={overdue.length ? t('{p0} überfällig · {p1}', { p0: overdue.length, p1: formatMoney(overdue.reduce((s, d) => s + amountDue(d), 0)) }) : t('{p0} offen, keine überfällig', { p0: outstanding.length })}
          icon={overdue.length ? AlertTriangle : FileText}
          tone={overdue.length ? 'red' : 'orange'}
        />
        <Stat label={t('Stunden diese Woche')} value={formatDuration(weekMinutes)} sub={t('{p0} im Monat · {p1} offen', { p0: formatDuration(monthMinutes), p1: formatDuration(unbilledMinutes) })} icon={Clock} tone="purple" />
      </div>

      <div className="dashboard-grid">
        <div className="stack">
          <section className="card">
            <div className="card-header">
              <h2>{t('Umsatz der letzten 12 Monate')}</h2>
              <Link to="/berichte" className="small">
                {t('Berichte')}
              </Link>
            </div>
            <div className="card-body">
              <BarChart bars={months} label={t('Nettoumsatz pro Monat')} />
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2>{t('Offene Rechnungen')}</h2>
              <Link to="/rechnungen?status=open" className="small">
                {t('Alle anzeigen')}
              </Link>
            </div>
            {attention.length === 0 ? (
              <div className="card-body row muted">
                <CheckCircle2 size={18} color="var(--green)" aria-hidden /> {t('Keine offenen Rechnungen – alles bezahlt.')}
              </div>
            ) : (
              <ul className="list" style={{ marginTop: 8 }}>
                {attention.map((d) => (
                  <li key={d.id}>
                    <Link to={`/rechnungen/${d.id}`} className="list-item">
                      <div className="grow">
                        <div className="title">{recipientName(d.recipient)}</div>
                        <div className="sub">
                          {d.number} {t('· fällig')} {formatDate(d.dueDate)}
                        </div>
                      </div>
                      <StatusBadge doc={d} />
                      <strong className="tabular">{formatMoney(amountDue(d), d.currency)}</strong>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {drafts.length > 0 && (
            <section className="card">
              <div className="card-header">
                <h2>{t('Entwürfe')}</h2>
              </div>
              <ul className="list" style={{ marginTop: 8 }}>
                {drafts.slice(0, 4).map((d) => (
                  <li key={d.id}>
                    <Link to={`/rechnungen/${d.id}`} className="list-item">
                      <div className="grow">
                        <div className="title">{recipientName(d.recipient)}</div>
                        <div className="sub">
                          {d.kind === 'quote' ? t('Angebot') : t('Rechnung')} · {d.items.length} {d.items.length === 1 ? t('Position') : t('Positionen')}
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
              <h2 style={{ marginBottom: 4 }}>{t('Erste Schritte')}</h2>
              <p className="small muted" style={{ marginBottom: 12 }}>
                {t('Noch')} {setupOpen} {t('von')} {setup.length} {t('offen')}
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

          {!!warnings?.length && (
            <section className="card">
              <div className="card-header">
                <h2>{t('Budgets')}</h2>
                <Link to="/zeit" className="small">
                  {t('Projekte')}
                </Link>
              </div>
              <ul className="list" style={{ marginTop: 8 }}>
                {warnings.slice(0, 4).map((w) => (
                  <li key={w.project.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                    <div className="title">
                      {w.project.name}
                      <span className="sub"> · {w.customer ? customerName(w.customer) : ''}</span>
                    </div>
                    <BudgetBar usage={w.usage} project={w.project} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(recurringDrafts.length > 0 || upcoming.length > 0) && (
            <section className="card">
              <div className="card-header">
                <h2>{t('Serienrechnungen')}</h2>
                <Link to="/rechnungen?art=serien" className="small">
                  {t('Alle Serien')}
                </Link>
              </div>
              <ul className="list" style={{ marginTop: 8 }}>
                {recurringDrafts.map((d) => (
                  <li key={d.id}>
                    <Link to={`/rechnungen/${d.id}`} className="list-item">
                      <Repeat size={17} color="var(--accent)" aria-hidden />
                      <div className="grow">
                        <div className="title">{recipientName(d.recipient)}</div>
                        <div className="sub">{t('Entwurf bereit ·')} {formatDate(d.serviceFrom)}</div>
                      </div>
                      <strong className="tabular">{formatMoney(grossOf(d), d.currency)}</strong>
                    </Link>
                  </li>
                ))}
                {upcoming.map((r) => (
                  <li key={r.id} className="list-item">
                    <Repeat size={17} className="faint" aria-hidden />
                    <div className="grow">
                      <div className="title">{r.name}</div>
                      <div className="sub">{t('nächster Entwurf am')} {formatDate(r.nextRun)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <TimerCard />

          <section className="card">
            <div className="card-header">
              <h2>{t('Zuletzt erfasst')}</h2>
              <Link to="/zeit" className="small">
                {t('Zeiterfassung')}
              </Link>
            </div>
            {recent.length === 0 ? (
              <p className="card-body muted small">{t('Noch keine Zeiten erfasst.')}</p>
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
