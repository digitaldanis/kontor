import { useNavigate } from 'react-router-dom'
import { formatDate } from '../lib/dates'
import { recipientName } from '../lib/defaults'
import { formatMoney } from '../lib/money'
import { displayStatus, grossOf, STATUS_LABELS, type DisplayStatus } from '../lib/status'
import type { InvoiceDocument } from '../lib/types'

const TONES: Record<DisplayStatus, string> = {
  draft: '',
  open: 'blue',
  overdue: 'red',
  paid: 'green',
  cancelled: '',
  cancellation: 'purple',
  sent: 'blue',
  accepted: 'green',
  declined: 'red',
}

export function StatusBadge({ doc }: { doc: InvoiceDocument }) {
  const s = displayStatus(doc)
  return <span className={`badge ${TONES[s]}`}>{STATUS_LABELS[s]}</span>
}

export function DocumentsTable({ docs, showCustomer = true }: { docs: InvoiceDocument[]; showCustomer?: boolean }) {
  const navigate = useNavigate()
  return (
    <div className="table-wrap">
      <table className="table responsive">
        <thead>
          <tr>
            <th>Nummer</th>
            {showCustomer && <th>Empfänger</th>}
            <th>Datum</th>
            <th>Status</th>
            <th className="num">Betrag</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => {
            const gross = grossOf(d)
            return (
              <tr key={d.id} className="clickable" onClick={() => navigate(`/rechnungen/${d.id}`)}>
                <td className="primary-cell">
                  <a href={`#/rechnungen/${d.id}`} onClick={(e) => e.stopPropagation()} style={{ color: 'inherit' }}>
                    {d.number ?? 'Entwurf'}
                  </a>
                  <small>{d.kind === 'cancellation' ? `Storno zu ${d.cancelsNumber}` : d.items[0]?.title || d.title}</small>
                </td>
                {showCustomer && <td className="hide-sm">{recipientName(d.recipient)}</td>}
                <td className="muted nowrap hide-sm">
                  {formatDate(d.issueDate)}
                  {displayStatus(d) === 'overdue' && <small style={{ display: 'block', color: 'var(--red)' }}>fällig {formatDate(d.dueDate)}</small>}
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
