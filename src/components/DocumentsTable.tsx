import { t } from '../lib/i18n'
import { useNavigate } from 'react-router-dom'
import { formatDate } from '../lib/dates'
import { recipientName } from '../lib/defaults'
import { formatMoney } from '../lib/money'
import { amountDue, displayStatus, documentLabel, grossOf, STATUS_LABELS, type DisplayStatus } from '../lib/status'
import type { InvoiceDocument } from '../lib/types'

const TONES: Record<DisplayStatus, string> = {
  draft: '',
  open: 'blue',
  partial: 'orange',
  overdue: 'red',
  paid: 'green',
  settled: 'green',
  cancelled: '',
  cancellation: 'purple',
  creditNote: 'purple',
  sent: 'blue',
  accepted: 'green',
  declined: 'red',
}

export function StatusBadge({ doc }: { doc: InvoiceDocument }) {
  const s = displayStatus(doc)
  return <span className={`badge ${TONES[s]}`}>{t(STATUS_LABELS[s])}</span>
}

export function DocumentsTable({ docs, showCustomer = true }: { docs: InvoiceDocument[]; showCustomer?: boolean }) {
  const navigate = useNavigate()
  return (
    <div className="table-wrap">
      <table className="table responsive">
        <thead>
          <tr>
            <th>{t('Nummer')}</th>
            {showCustomer && <th>{t('Empfänger')}</th>}
            <th>{t('Datum')}</th>
            <th>{t('Status')}</th>
            <th className="num">{t('Betrag')}</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => {
            const gross = grossOf(d)
            return (
              <tr key={d.id} className="clickable" onClick={() => navigate(`/rechnungen/${d.id}`)}>
                <td className="primary-cell">
                  <a href={`#/rechnungen/${d.id}`} onClick={(e) => e.stopPropagation()} style={{ color: 'inherit' }}>
                    {d.number ?? t('Entwurf')}
                  </a>
                  <small>
                    {d.kind === 'cancellation'
                      ? t('Storno zu {p0}', { p0: d.cancelsNumber })
                      : d.kind === 'creditNote'
                        ? t('Gutschrift zu {p0}', { p0: d.creditsNumber })
                        : [d.billingType !== 'regular' ? documentLabel(d) : '', d.items[0]?.title || d.title].filter(Boolean).join(' · ')}
                  </small>
                </td>
                {showCustomer && <td className="hide-sm">{recipientName(d.recipient)}</td>}
                <td className="muted nowrap hide-sm">
                  {formatDate(d.issueDate)}
                  {displayStatus(d) === 'overdue' && <small style={{ display: 'block', color: 'var(--red)' }}>{t('fällig')} {formatDate(d.dueDate)}</small>}
                  {displayStatus(d) === 'partial' && <small style={{ display: 'block' }}>{formatMoney(amountDue(d), d.currency)} {t('offen')}</small>}
                </td>
                <td>
                  <StatusBadge doc={d} />
                </td>
                <td className="num">
                  <strong style={d.status === 'cancelled' ? { textDecoration: 'line-through', color: 'var(--text-3)' } : undefined}>{formatMoney(gross, d.currency)}</strong>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
