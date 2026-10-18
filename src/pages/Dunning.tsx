import { t, uiLocale } from '../lib/i18n'
import { deleteReminder } from '../lib/actions'
import { useLiveQuery } from '../lib/live'
import { BellRing, CheckCircle2, Download, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useFeedback } from '../components/useFeedback'
import { ReminderDialog } from '../components/ReminderDialog'
import { Button, EmptyState, IconButton, PageHeader, Stat } from '../components/ui'
import { daysBetween, formatDate, today } from '../lib/dates'
import { db } from '../lib/db'
import { recipientName } from '../lib/defaults'
import { lastReminder, LEVEL_LABELS, nextLevel, nextReminderDate, reminderTotal } from '../lib/dunning'
import { downloadReminderPdf } from '../lib/exporters'
import { useDocumentTitle, useSettings } from '../lib/hooks'
import { formatMoney } from '../lib/money'
import { amountDue, displayStatus } from '../lib/status'
import type { InvoiceDocument, Reminder } from '../lib/types'

export function Dunning() {
  useDocumentTitle(t('Mahnwesen'))
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
    undoable(t('{p0} gelöscht', { p0: t(LEVEL_LABELS[r.level]) }), () => db.reminders.put(r))
  }

  return (
    <div className="page">
      <PageHeader title={t('Mahnwesen')} subtitle={t('Überfällige Rechnungen im Blick behalten und freundlich, aber bestimmt nachfassen.')} />

      <div className="grid grid-3" style={{ marginBottom: 20 }}>
        <Stat label={t('Überfällig')} value={formatMoney(openSum)} sub={rows.length === 1 ? t('1 Rechnung') : t('{n} Rechnungen', { n: rows.length })} icon={BellRing} tone={rows.length ? 'red' : 'green'} />
        <Stat label={t('Jetzt fällig')} value={String(ready.length)} sub={t('nächster Mahnschritt erreicht')} tone="orange" />
        <Stat label={t('Basiszinssatz')} value={`${settings.dunning.baseRatePercent.toLocaleString(uiLocale())} %`} sub={<Link to="/einstellungen#mahnwesen">{t('seit')} {formatDate(settings.dunning.baseRateSince)} {t('· ändern')}</Link>} tone="blue" />
      </div>

      <section className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <h2>{t('Überfällige Rechnungen')}</h2>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={CheckCircle2} title={t('Nichts überfällig')} compact>
            {t('Alle Rechnungen sind bezahlt oder noch nicht fällig.')}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>{t('Rechnung')}</th>
                  <th className="hide-sm">{t('Überfällig')}</th>
                  <th className="hide-sm">{t('Letzter Schritt')}</th>
                  <th className="num">{t('Offen')}</th>
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
                      {r.days} {r.days === 1 ? t('Tag') : t('Tage')}
                      <small className="faint" style={{ display: 'block' }}>{t('seit')} {formatDate(r.doc.dueDate)}</small>
                    </td>
                    <td className="hide-sm muted">
                      {r.last ? t('{p0} vom {p1}', { p0: t(LEVEL_LABELS[r.last.level]), p1: formatDate(r.last.issueDate) }) : '–'}
                      {r.level !== null && r.next && !r.ready && <small style={{ display: 'block' }}>{t('nächster Schritt ab')} {formatDate(r.next)}</small>}
                    </td>
                    <td className="num">
                      <strong>{formatMoney(amountDue(r.doc), r.doc.currency)}</strong>
                    </td>
                    <td className="num">
                      {r.level === null ? (
                        <span className="badge red">{t('Letzte Stufe')}</span>
                      ) : (
                        <Button size="sm" variant={r.ready ? 'primary' : 'default'} icon={BellRing} onClick={() => setManual(r.doc)}>
                          {t(LEVEL_LABELS[r.level])}
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
          <h2>{t('Verlauf')}</h2>
        </div>
        {history.length === 0 ? (
          <p className="card-body muted small">{t('Noch keine Erinnerungen oder Mahnungen geschrieben.')}</p>
        ) : (
          <ul className="list" style={{ marginTop: 8 }}>
            {history.map((r) => {
              const inv = byId.get(r.invoiceId)
              return (
                <li key={r.id} className="list-item">
                  <div className="grow">
                    <div className="title">
                      {t(LEVEL_LABELS[r.level])} · {inv ? <Link to={`/rechnungen/${inv.id}`}>{inv.number}</Link> : t('Rechnung gelöscht')}
                    </div>
                    <div className="sub">
                      {formatDate(r.issueDate)} {t('· Frist')} {formatDate(r.deadline)}
                      {inv ? ` · ${recipientName(inv.recipient)}` : ''}
                    </div>
                  </div>
                  <strong className="tabular">{formatMoney(reminderTotal(r), inv?.currency)}</strong>
                  {inv && <IconButton icon={Download} label={t('PDF herunterladen')} onClick={() => run(() => downloadReminderPdf(r, inv, settings))} />}
                  <IconButton icon={Trash2} label={t('Löschen')} danger onClick={() => remove(r)} />
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
