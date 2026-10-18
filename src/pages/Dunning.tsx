import { useLiveQuery } from 'dexie-react-hooks'
import { BellRing, CheckCircle2, Download, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useFeedback } from '../components/feedback'
import { ReminderDialog } from '../components/ReminderDialog'
import { Button, EmptyState, IconButton, PageHeader, Stat } from '../components/ui'
import { daysBetween, formatDate, today } from '../lib/dates'
import { db } from '../lib/db'
import { recipientName } from '../lib/defaults'
import { lastReminder, LEVEL_LABELS, nextLevel, nextReminderDate, reminderTotal } from '../lib/dunning'
import { downloadReminderPdf } from '../lib/exporters'
import { useDocumentTitle, useSettings } from '../lib/hooks'
import { formatMoney } from '../lib/money'
import { deleteReminder } from '../lib/repo'
import { amountDue, displayStatus } from '../lib/status'
import type { InvoiceDocument, Reminder } from '../lib/types'

export function Dunning() {
  useDocumentTitle('Mahnwesen')
  const settings = useSettings()
  const { run, undoable } = useFeedback()
  const [params, setParams] = useSearchParams()
  const [manual, setManual] = useState<InvoiceDocument | null>(null)

  const data = useLiveQuery(async () => {
    const [docs, reminders] = await Promise.all([db.documents.where('kind').equals('invoice').toArray(), db.reminders.toArray()])
    return { docs, reminders }
  })

  const rows = useMemo(() => {
    if (!data || !settings) return []
    const ref = today()
    return data.docs
      .filter((d) => displayStatus(d, ref) === 'overdue')
      .map((d) => {
        const reminders = data.reminders.filter((r) => r.invoiceId === d.id)
        const next = nextReminderDate(d, reminders, settings.dunning)
        return { doc: d, reminders, last: lastReminder(reminders), level: nextLevel(reminders), next, ready: !!next && next <= ref, days: daysBetween(d.dueDate, ref) }
      })
      .sort((a, b) => Number(b.ready) - Number(a.ready) || b.days - a.days)
  }, [data, settings])

  const requested = params.get('rechnung')
  const target = manual ?? (requested ? (data?.docs.find((d) => d.id === requested) ?? null) : null)
  const close = () => {
    setManual(null)
    if (requested) setParams({}, { replace: true })
  }

  if (!data || !settings) return <div className="page" />
  const byId = new Map(data.docs.map((d) => [d.id, d]))
  const history = [...data.reminders].sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.createdAt.localeCompare(a.createdAt))
  const openSum = rows.reduce((s, r) => s + amountDue(r.doc), 0)
  const ready = rows.filter((r) => r.ready)

  const remove = async (r: Reminder) => {
    await run(() => deleteReminder(r.id))
    undoable(`${LEVEL_LABELS[r.level]} gelöscht`, () => db.reminders.put(r))
  }

  return (
    <div className="page">
      <PageHeader title="Mahnwesen" subtitle="Überfällige Rechnungen im Blick behalten und freundlich, aber bestimmt nachfassen." />

      <div className="grid grid-3" style={{ marginBottom: 20 }}>
        <Stat label="Überfällig" value={formatMoney(openSum)} sub={`${rows.length} ${rows.length === 1 ? 'Rechnung' : 'Rechnungen'}`} icon={BellRing} tone={rows.length ? 'red' : 'green'} />
        <Stat label="Jetzt fällig" value={String(ready.length)} sub="nächster Mahnschritt erreicht" tone="orange" />
        <Stat label="Basiszinssatz" value={`${settings.dunning.baseRatePercent.toLocaleString('de-DE')} %`} sub={<Link to="/einstellungen#mahnwesen">seit {formatDate(settings.dunning.baseRateSince)} · ändern</Link>} tone="blue" />
      </div>

      <section className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <h2>Überfällige Rechnungen</h2>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nichts überfällig" compact>
            Alle Rechnungen sind bezahlt oder noch nicht fällig.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>Rechnung</th>
                  <th className="hide-sm">Überfällig</th>
                  <th className="hide-sm">Letzter Schritt</th>
                  <th className="num">Offen</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.doc.id}>
                    <td className="primary-cell">
                      <Link to={`/rechnungen/${r.doc.id}`} style={{ color: 'inherit' }}>
                        {r.doc.number}
                      </Link>
                      <small>{recipientName(r.doc.recipient)}</small>
                    </td>
                    <td className="hide-sm">
                      {r.days} {r.days === 1 ? 'Tag' : 'Tage'}
                      <small className="faint" style={{ display: 'block' }}>seit {formatDate(r.doc.dueDate)}</small>
                    </td>
                    <td className="hide-sm muted">
                      {r.last ? `${LEVEL_LABELS[r.last.level]} vom ${formatDate(r.last.issueDate)}` : '–'}
                      {r.level !== null && r.next && !r.ready && <small style={{ display: 'block' }}>nächster Schritt ab {formatDate(r.next)}</small>}
                    </td>
                    <td className="num">
                      <strong>{formatMoney(amountDue(r.doc), r.doc.currency)}</strong>
                    </td>
                    <td className="num">
                      {r.level === null ? (
                        <span className="badge red">Letzte Stufe</span>
                      ) : (
                        <Button size="sm" variant={r.ready ? 'primary' : 'default'} icon={BellRing} onClick={() => setManual(r.doc)}>
                          {LEVEL_LABELS[r.level]}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Verlauf</h2>
        </div>
        {history.length === 0 ? (
          <p className="card-body muted small">Noch keine Erinnerungen oder Mahnungen geschrieben.</p>
        ) : (
          <ul className="list" style={{ marginTop: 8 }}>
            {history.map((r) => {
              const inv = byId.get(r.invoiceId)
              return (
                <li key={r.id} className="list-item">
                  <div className="grow">
                    <div className="title">
                      {LEVEL_LABELS[r.level]} · {inv ? <Link to={`/rechnungen/${inv.id}`}>{inv.number}</Link> : 'Rechnung gelöscht'}
                    </div>
                    <div className="sub">
                      {formatDate(r.issueDate)} · Frist {formatDate(r.deadline)}
                      {inv ? ` · ${recipientName(inv.recipient)}` : ''}
                    </div>
                  </div>
                  <strong className="tabular">{formatMoney(reminderTotal(r), inv?.currency)}</strong>
                  {inv && <IconButton icon={Download} label="PDF herunterladen" onClick={() => run(() => downloadReminderPdf(r, inv, settings))} />}
                  <IconButton icon={Trash2} label="Löschen" danger onClick={() => remove(r)} />
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <ReminderDialog invoice={target} onClose={close} />
    </div>
  )
}
