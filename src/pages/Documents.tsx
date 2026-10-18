import { t } from '../lib/i18n'
import { createDraft } from '../lib/actions'
import { useLiveQuery } from '../lib/live'
import { FilePlus, FileText, Plus, Search, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { DocumentsTable } from '../components/DocumentsTable'
import { RecurringList } from '../components/Recurring'
import { useFeedback } from '../components/useFeedback'
import { Avatar, Button, Dialog, EmptyState, PageHeader, Segmented } from '../components/ui'
import { db } from '../lib/db'
import { customerName, recipientName } from '../lib/defaults'
import { useCustomers, useDocumentTitle, useNewParam } from '../lib/hooks'
import { formatMoney } from '../lib/money'
import { amountDue, displayStatus, isOutstanding, type DisplayStatus } from '../lib/status'
import type { DocumentKind } from '../lib/types'

type Filter = 'all' | DisplayStatus

const INVOICE_FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: t('Alle') },
  { value: 'draft', label: t('Entwürfe') },
  { value: 'open', label: t('Offen') },
  { value: 'overdue', label: t('Überfällig') },
  { value: 'paid', label: t('Bezahlt') },
  { value: 'creditNote', label: t('Gutschriften') },
  { value: 'cancelled', label: t('Storniert') },
]

const QUOTE_FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: t('Alle') },
  { value: 'draft', label: t('Entwürfe') },
  { value: 'sent', label: t('Versendet') },
  { value: 'accepted', label: t('Angenommen') },
  { value: 'declined', label: t('Abgelehnt') },
]

export function Documents() {
  const [params, setParams] = useSearchParams()
  const art = params.get('art')
  const view: 'invoice' | 'quote' | 'recurring' = art === 'angebote' ? 'quote' : art === 'serien' ? 'recurring' : 'invoice'
  const kind = view === 'quote' ? 'quote' : 'invoice'
  useDocumentTitle(view === 'quote' ? t('Angebote') : view === 'recurring' ? t('Serienrechnungen') : t('Rechnungen'))
  const [filter, setFilter] = useState<Filter>((params.get('status') as Filter) || 'all')
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState<DocumentKind | null>(null)
  useNewParam((v) => setCreating(v === 'angebot' ? 'quote' : 'invoice'))

  const docs = useLiveQuery(async () => {
    const all = await db.documents.toArray()
    return all
      .filter((d) => (kind === 'quote' ? d.kind === 'quote' : d.kind !== 'quote'))
      .sort((a, b) => {
        if ((a.status === 'draft') !== (b.status === 'draft')) return a.status === 'draft' ? -1 : 1
        return (b.number ?? '').localeCompare(a.number ?? '', 'de', { numeric: true }) || b.createdAt.localeCompare(a.createdAt)
      })
  }, [kind])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (docs ?? []).filter((d) => {
      const status = displayStatus(d)
      if (filter !== 'all') {
        const match: Partial<Record<Filter, DisplayStatus[]>> = {
          open: ['open', 'overdue', 'partial'],
          paid: ['paid', 'settled'],
          cancelled: ['cancelled', 'cancellation'],
        }
        if (!(match[filter] ?? [filter]).includes(status)) return false
      }
      if (!q) return true
      return [d.number ?? '', recipientName(d.recipient), d.title, ...d.items.map((i) => i.title)].some((v) => v.toLowerCase().includes(q))
    })
  }, [docs, filter, query])

  const openSum = (docs ?? []).filter(isOutstanding).reduce((s, d) => s + amountDue(d), 0)
  const overdueSum = (docs ?? []).filter((d) => displayStatus(d) === 'overdue').reduce((s, d) => s + amountDue(d), 0)

  const switchKind = (k: 'invoice' | 'quote' | 'recurring') => {
    setFilter('all')
    setParams(k === 'quote' ? { art: 'angebote' } : k === 'recurring' ? { art: 'serien' } : {})
  }

  return (
    <div className="page">
      <PageHeader
        title={view === 'quote' ? t('Angebote') : view === 'recurring' ? t('Serienrechnungen') : t('Rechnungen')}
        subtitle={
          view === 'recurring'
            ? t('Wiederkehrende Rechnungen werden zum Stichtag als Entwurf angelegt.')
            : kind === 'invoice' && docs?.length
            ? t('{p0} offen{p1}', { p0: formatMoney(openSum), p1: overdueSum ? ` · ${formatMoney(overdueSum)} überfällig` : '' })
            : kind === 'quote'
              ? t('Angebote lassen sich mit einem Klick in eine Rechnung umwandeln.')
              : undefined
        }
        actions={
          view !== 'recurring' && <Button variant="primary" icon={Plus} onClick={() => setCreating(kind)}>
            {kind === 'quote' ? t('Neues Angebot') : t('Neue Rechnung')}
          </Button>
        }
      />

      <div className="toolbar">
        <Segmented
          label={t('Dokumentart')}
          value={view}
          onChange={switchKind}
          options={[
            { value: 'invoice', label: t('Rechnungen') },
            { value: 'quote', label: t('Angebote') },
            { value: 'recurring', label: t('Serien') },
          ]}
        />
        {view !== 'recurring' && docs && docs.length > 0 && (
          <>
            <Segmented label={t('Status')} value={filter} onChange={setFilter} options={kind === 'quote' ? QUOTE_FILTERS : INVOICE_FILTERS} />
            <label className="search">
              <span className="sr-only">{t('Suchen')}</span>
              <Search size={16} aria-hidden />
              <input className="input" type="search" placeholder={t('Nummer, Kunde, Leistung …')} value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </>
        )}
      </div>

      {view === 'recurring' ? <RecurringList /> : <div className="card">
        {docs && docs.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={kind === 'quote' ? t('Noch keine Angebote') : t('Noch keine Rechnungen')}
            action={
              <Button variant="primary" icon={FilePlus} onClick={() => setCreating(kind)}>
                {kind === 'quote' ? t('Erstes Angebot erstellen') : t('Erste Rechnung erstellen')}
              </Button>
            }
          >
            {kind === 'quote'
              ? t('Erstelle ein Angebot für einen Kunden. Wird es angenommen, machst du daraus mit einem Klick eine Rechnung.')
              : t('Wähle einen Kunden oder schreib eine Schnellrechnung an einen beliebigen Empfänger. Kontor prüft dabei alle Pflichtangaben.')}
          </EmptyState>
        ) : list.length === 0 && docs ? (
          <EmptyState icon={Search} title={t('Nichts gefunden')} compact>
            {t('Passe Filter oder Suche an.')}
          </EmptyState>
        ) : (
          <DocumentsTable docs={list} />
        )}
      </div>}

      <NewDocumentDialog kind={creating} onClose={() => setCreating(null)} />
    </div>
  )
}

export function NewDocumentDialog({ kind, onClose }: { kind: DocumentKind | null; onClose: () => void }) {
  const customers = useCustomers()
  const navigate = useNavigate()
  const { run } = useFeedback()
  const [q, setQ] = useState('')

  const create = async (customerId: string | null) => {
    if (!kind) return
    const doc = await run(() => createDraft(kind, { customerId }))
    if (doc) {
      onClose()
      navigate(`/rechnungen/${doc.id}`)
    }
  }

  const filtered = (customers ?? []).filter((c) => !q || customerName(c).toLowerCase().includes(q.toLowerCase()) || c.number.toLowerCase().includes(q.toLowerCase()))

  return (
    <Dialog open={!!kind} onClose={onClose} title={kind === 'quote' ? t('Neues Angebot') : t('Neue Rechnung')} description={t('Für wen ist das Dokument?')}>
      <div className="stack-sm">
        <button type="button" className="quick-option" onClick={() => create(null)}>
          <span className="empty-icon" style={{ width: 40, height: 40, borderRadius: 12, margin: 0 }}>
            <Zap size={19} aria-hidden />
          </span>
          <span>
            <strong>{kind === 'quote' ? t('Freies Angebot') : t('Schnellrechnung')}</strong>
            <span className="muted small" style={{ display: 'block' }}>
              {t('Empfänger frei eintippen, ohne Kunden anzulegen')}
            </span>
          </span>
        </button>
        {customers && customers.length > 0 && (
          <>
            {customers.length > 6 && (
              <label className="search" style={{ maxWidth: 'none' }}>
                <span className="sr-only">{t('Kunden suchen')}</span>
                <Search size={16} aria-hidden />
                <input className="input" type="search" placeholder={t('Kunden suchen')} value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
            )}
            <div className="faint small" style={{ marginTop: 6 }}>
              {t('Kunden')}
            </div>
            <ul className="list card" style={{ boxShadow: 'none', border: '1px solid var(--border)', maxHeight: 340, overflowY: 'auto' }}>
              {filtered.map((c) => (
                <li key={c.id}>
                  <button type="button" className="list-item" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', textAlign: 'left', padding: '10px 14px' }} onClick={() => create(c.id)}>
                    <Avatar name={customerName(c)} />
                    <span className="grow">
                      <span className="title" style={{ display: 'block' }}>{customerName(c)}</span>
                      <span className="sub" style={{ display: 'block' }}>{[c.number, c.city].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Dialog>
  )
}
