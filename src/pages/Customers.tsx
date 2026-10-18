import { t } from '../lib/i18n'
import { useLiveQuery } from '../lib/live'
import { Plus, Search, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CustomerDialog } from '../components/CustomerDialog'
import { Avatar, Button, EmptyState, PageHeader, Segmented } from '../components/ui'
import { countryName } from '../lib/countries'
import { durationMinutes, formatDuration } from '../lib/dates'
import { db } from '../lib/db'
import { customerName } from '../lib/defaults'
import { useCustomers, useDocumentTitle } from '../lib/hooks'
import { formatMoney } from '../lib/money'
import { emptyCustomer } from '../lib/repo'
import { amountDue, isOutstanding } from '../lib/status'
import type { Customer } from '../lib/types'

export function Customers() {
  useDocumentTitle(t('Kunden'))
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'active' | 'archived'>('active')
  const [editing, setEditing] = useState<Customer | null>(null)
  const customers = useCustomers(true)
  const stats = useLiveQuery(async () => {
    const [docs, entries] = await Promise.all([db.documents.toArray(), db.timeEntries.toArray()])
    const map = new Map<string, { open: number; unbilled: number }>()
    for (const d of docs) {
      if (!d.customerId || !isOutstanding(d)) continue
      const s = map.get(d.customerId) ?? { open: 0, unbilled: 0 }
      s.open += amountDue(d)
      map.set(d.customerId, s)
    }
    for (const e of entries) {
      if (e.invoiceId || !e.billable) continue
      const s = map.get(e.customerId) ?? { open: 0, unbilled: 0 }
      s.unbilled += durationMinutes(e.start, e.end)
      map.set(e.customerId, s)
    }
    return map
  })

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (customers ?? [])
      .filter((c) => (filter === 'archived' ? c.archived : !c.archived))
      .filter((c) => !q || [c.company, c.contactPerson, c.city, c.email, c.number, c.vatId].some((v) => v.toLowerCase().includes(q)))
  }, [customers, query, filter])

  const hasArchived = customers?.some((c) => c.archived)

  return (
    <div className="page">
      <PageHeader
        title={t('Kunden')}
        subtitle={customers ? t('{p0} aktive Kunden', { p0: customers.filter((c) => !c.archived).length }) : undefined}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setEditing(emptyCustomer())}>
            {t('Neuer Kunde')}
          </Button>
        }
      />

      {customers && customers.length > 0 && (
        <div className="toolbar">
          <label className="search">
            <span className="sr-only">{t('Kunden durchsuchen')}</span>
            <Search size={16} aria-hidden />
            <input className="input" type="search" placeholder={t('Name, Ort, E-Mail, Kundennummer …')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {hasArchived && (
            <Segmented
              label={t('Filter')}
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'active', label: t('Aktiv') },
                { value: 'archived', label: t('Archiviert') },
              ]}
            />
          )}
        </div>
      )}

      <div className="card">
        {customers && customers.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t('Noch keine Kunden')}
            action={
              <Button variant="primary" icon={Plus} onClick={() => setEditing(emptyCustomer())}>
                {t('Ersten Kunden anlegen')}
              </Button>
            }
          >
            {t('Lege deine Kunden einmal an – Anschrift, Stundensatz und Zahlungsziel werden dann automatisch in Rechnungen und Zeiterfassung übernommen.')}
          </EmptyState>
        ) : list.length === 0 && customers ? (
          <EmptyState icon={Search} title={t('Keine Treffer')} compact>
            {t('Für „{q}“ wurde kein Kunde gefunden.', { q: query })}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead>
                <tr>
                  <th>{t('Kunde')}</th>
                  <th>{t('Ort')}</th>
                  <th className="num">{t('Offene Zeit')}</th>
                  <th className="num">{t('Offene Rechnungen')}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const s = stats?.get(c.id)
                  return (
                    <tr key={c.id} className="clickable" onClick={() => navigate(`/kunden/${c.id}`)}>
                      <td>
                        <div className="row">
                          <Avatar name={customerName(c)} />
                          <div className="primary-cell" style={{ minWidth: 0 }}>
                            <a href={`#/kunden/${c.id}`} onClick={(e) => e.stopPropagation()} style={{ color: 'inherit' }}>
                              {customerName(c)}
                            </a>
                            <small>
                              {c.number}
                              {c.company && c.contactPerson ? ` · ${c.contactPerson}` : ''}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td className="muted hide-sm">
                        {[c.city, c.country !== 'DE' ? countryName(c.country) : ''].filter(Boolean).join(', ') || '–'}
                      </td>
                      <td className="num muted hide-sm">{s?.unbilled ? formatDuration(s.unbilled) : '–'}</td>
                      <td className="num">{s?.open ? <strong>{formatMoney(s.open)}</strong> : <span className="faint">–</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CustomerDialog open={!!editing} customer={editing} onClose={() => setEditing(null)} onSaved={(c) => !editing?.number && navigate(`/kunden/${c.id}`)} />
    </div>
  )
}
