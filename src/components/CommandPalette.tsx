import { BarChart3, BellRing, Clock, FilePlus, FileText, LayoutGrid, Package, Receipt, Search, Settings, UserPlus, Users, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { db } from '../lib/db'
import { customerName, recipientName } from '../lib/defaults'
import { t } from '../lib/i18n'
import { useLiveQuery } from '../lib/live'
import { formatMoney } from '../lib/money'
import { documentLabel, grossOf } from '../lib/status'

interface Item {
  id: string
  label: string
  hint?: string
  icon: LucideIcon
  group: string
  run: () => void
}

function matches(text: string, query: string): boolean {
  const hay = text.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}

/** Quick search over clients, documents and actions, opened with Cmd/Ctrl+K. */
export function CommandPalette() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
        setQuery('')
        setActive(0)
      }
    }
    const onOpen = () => {
      setOpen(true)
      setQuery('')
      setActive(0)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('kontor:search', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('kontor:search', onOpen)
    }
  }, [])

  const data = useLiveQuery(async () => (open ? { customers: await db.customers.toArray(), docs: await db.documents.toArray() } : null), [open])

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => navigate(to)
    const actions: Item[] = [
      { id: 'a-invoice', label: t('Neue Rechnung'), icon: FilePlus, group: t('Aktionen'), run: go('/rechnungen?neu=rechnung') },
      { id: 'a-quote', label: t('Neues Angebot'), icon: FilePlus, group: t('Aktionen'), run: go('/rechnungen?art=angebote&neu=angebot') },
      { id: 'a-customer', label: t('Neuer Kunde'), icon: UserPlus, group: t('Aktionen'), run: go('/kunden?neu=1') },
      { id: 'a-time', label: t('Zeit nachtragen'), icon: Clock, group: t('Aktionen'), run: go('/zeit?neu=1') },
      { id: 'a-expense', label: t('Neue Ausgabe'), icon: Receipt, group: t('Aktionen'), run: go('/ausgaben?neu=1') },
      { id: 'p-dash', label: t('Übersicht'), icon: LayoutGrid, group: t('Seiten'), run: go('/') },
      { id: 'p-docs', label: t('Rechnungen'), icon: FileText, group: t('Seiten'), run: go('/rechnungen') },
      { id: 'p-customers', label: t('Kunden'), icon: Users, group: t('Seiten'), run: go('/kunden') },
      { id: 'p-time', label: t('Zeiterfassung'), icon: Clock, group: t('Seiten'), run: go('/zeit') },
      { id: 'p-dunning', label: t('Mahnwesen'), icon: BellRing, group: t('Seiten'), run: go('/mahnwesen') },
      { id: 'p-expenses', label: t('Ausgaben'), icon: Receipt, group: t('Seiten'), run: go('/ausgaben') },
      { id: 'p-catalog', label: t('Leistungen'), icon: Package, group: t('Seiten'), run: go('/leistungen') },
      { id: 'p-reports', label: t('Berichte'), icon: BarChart3, group: t('Seiten'), run: go('/berichte') },
      { id: 'p-settings', label: t('Einstellungen'), icon: Settings, group: t('Seiten'), run: go('/einstellungen') },
    ]
    const customers: Item[] = (data?.customers ?? []).map((c) => ({
      id: `c-${c.id}`,
      label: customerName(c),
      hint: [c.number, c.city, c.email].filter(Boolean).join(' · '),
      icon: Users,
      group: t('Kunden'),
      run: go(`/kunden/${c.id}`),
    }))
    const docs: Item[] = (data?.docs ?? [])
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((d) => ({
        id: `d-${d.id}`,
        label: `${documentLabel(d)} ${d.number ?? t('(Entwurf)')}`,
        hint: [recipientName(d.recipient), formatMoney(grossOf(d), d.currency), d.items[0]?.title].filter(Boolean).join(' · '),
        icon: FileText,
        group: t('Dokumente'),
        run: go(`/rechnungen/${d.id}`),
      }))
    const q = query.trim()
    if (!q) return [...actions, ...docs.slice(0, 5)]
    return [...actions, ...customers, ...docs].filter((i) => matches(`${i.label} ${i.hint ?? ''}`, q)).slice(0, 30)
  }, [data, query, navigate])

  if (!open) return null
  const pick = (i: Item | undefined) => {
    if (!i) return
    setOpen(false)
    i.run()
  }

  let lastGroup = ''
  return createPortal(
    <div className="backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('Schnellsuche')}>
        <label className="palette-search">
          <Search size={18} aria-hidden />
          <input
            autoFocus
            value={query}
            placeholder={t('Kunden, Rechnungen oder Aktionen suchen …')}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(items.length - 1, a + 1))
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(0, a - 1))
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                pick(items[active])
              }
            }}
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `pal-${items[active].id}` : undefined}
          />
          <kbd className="kbd">Esc</kbd>
        </label>
        <ul id="palette-list" className="palette-list" role="listbox">
          {items.length === 0 && <li className="palette-empty">{t('Keine Treffer')}</li>}
          {items.map((i, idx) => {
            const header = i.group !== lastGroup ? (lastGroup = i.group) : null
            return (
              <li key={i.id} role="presentation">
                {header && <div className="palette-group">{header}</div>}
                <button
                  type="button"
                  id={`pal-${i.id}`}
                  role="option"
                  aria-selected={idx === active}
                  className={`palette-item ${idx === active ? 'active' : ''}`}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => pick(i)}
                >
                  <i.icon size={17} aria-hidden />
                  <span className="grow">
                    <span className="title">{i.label}</span>
                    {i.hint && <span className="sub">{i.hint}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>,
    document.body,
  )
}
