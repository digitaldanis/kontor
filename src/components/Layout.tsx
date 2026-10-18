import { useLiveQuery } from 'dexie-react-hooks'
import {
  BarChart3,
  BellRing,
  Clock,
  FileText,
  LayoutGrid,
  MoreHorizontal,
  Package,
  Settings as SettingsIcon,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { customerName } from '../lib/defaults'
import { db } from '../lib/db'
import { useSettings, useTimer } from '../lib/hooks'
import { today } from '../lib/dates'
import { runRecurring } from '../lib/recurring'
import { displayStatus } from '../lib/status'
import { useFeedback } from './feedback'
import { Avatar, Dialog } from './ui'
import { TimerPill } from './TimerPill'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

const NAV: NavItem[] = [
  { to: '/', label: 'Übersicht', icon: LayoutGrid, end: true },
  { to: '/rechnungen', label: 'Rechnungen', icon: FileText },
  { to: '/kunden', label: 'Kunden', icon: Users },
  { to: '/zeit', label: 'Zeiterfassung', icon: Clock },
  { to: '/mahnwesen', label: 'Mahnwesen', icon: BellRing },
  { to: '/leistungen', label: 'Leistungen', icon: Package },
  { to: '/berichte', label: 'Berichte', icon: BarChart3 },
  { to: '/einstellungen', label: 'Einstellungen', icon: SettingsIcon },
]

export function BrandMark() {
  const id = useId()
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a8bff" />
          <stop offset="1" stopColor="#0a5ad4" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${id})`} />
      <path d="M22 16v32M22 33l17-17M27 29l14 19" fill="none" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Layout() {
  const settings = useSettings()
  const timer = useTimer()
  const location = useLocation()
  const navigate = useNavigate()
  const [moreOpen, setMoreOpen] = useState(false)
  const counts = useLiveQuery(async () => {
    const docs = await db.documents.where('kind').equals('invoice').toArray()
    return {
      overdue: docs.filter((d) => displayStatus(d) === 'overdue').length,
      drafts: docs.filter((d) => d.status === 'draft').length,
    }
  })
  const timerCustomer = useLiveQuery(() => (timer ? db.customers.get(timer.customerId) : undefined), [timer?.customerId])

  useEffect(() => {
    setMoreOpen(false)
  }, [location.pathname])

  // Recurring invoices become drafts on their due date, checked once per start
  const { toast } = useFeedback()
  useEffect(() => {
    let cancelled = false
    void runRecurring(today()).then((created) => {
      if (!cancelled && created.length) toast(`${created.length} ${created.length === 1 ? 'Serienrechnung' : 'Serienrechnungen'} als Entwurf angelegt`)
    })
    return () => {
      cancelled = true
    }
  }, [toast])

  useEffect(() => {
    if (settings && !settings.onboarded && location.pathname !== '/willkommen') navigate('/willkommen', { replace: true })
  }, [settings, location.pathname, navigate])

  // Keyboard shortcuts: g + key jumps between sections
  useEffect(() => {
    let armed = false
    let t: ReturnType<typeof setTimeout>
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return
      if (armed) {
        const map: Record<string, string> = { u: '/', r: '/rechnungen', k: '/kunden', z: '/zeit', m: '/mahnwesen', b: '/berichte', e: '/einstellungen' }
        if (map[e.key]) navigate(map[e.key])
        armed = false
        return
      }
      if (e.key === 'g') {
        armed = true
        clearTimeout(t)
        t = setTimeout(() => (armed = false), 900)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  const company = settings?.company
  const logo = settings?.logo
  const badge = (to: string) => {
    if (to === '/mahnwesen' && counts?.overdue) return <span className="nav-count" title="Überfällig">{counts.overdue}</span>
    return null
  }

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Zum Inhalt springen
      </a>
      <aside className="sidebar" aria-label="Hauptnavigation">
        <Link to="/" className="brand">
          <BrandMark />
          Kontor
        </Link>
        <nav className="nav">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <item.icon size={18} strokeWidth={2} aria-hidden />
              {item.label}
              {badge(item.to)}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          {timer && <TimerPill timer={timer} customerName={timerCustomer ? customerName(timerCustomer) : ''} />}
          <Link to="/einstellungen" className="sidebar-company">
            <Avatar name={company?.name || 'Kontor'} src={logo?.dataUrl} />
            <span style={{ minWidth: 0 }}>
              <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {company?.name || 'Deine Firma'}
              </strong>
              <small>{settings?.smallBusiness ? 'Kleinunternehmer' : 'Firmendaten'}</small>
            </span>
          </Link>
        </div>
      </aside>

      <header className="mobile-header">
        <Link to="/" className="brand">
          <BrandMark />
          Kontor
        </Link>
        {timer && <TimerPill timer={timer} customerName={timerCustomer ? customerName(timerCustomer) : ''} compact />}
      </header>

      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Navigation">
        {NAV.slice(0, 4).map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            <item.icon size={23} strokeWidth={1.9} aria-hidden />
            {item.to === '/zeit' ? 'Zeit' : item.label}
          </NavLink>
        ))}
        <button
          type="button"
          className={`tab ${NAV.slice(4).some((p) => location.pathname.startsWith(p.to)) ? 'active' : ''}`}
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
        >
          <MoreHorizontal size={23} strokeWidth={1.9} aria-hidden />
          Mehr
        </button>
      </nav>

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="Mehr">
        <ul className="list" style={{ margin: '0 -24px' }}>
          {NAV.slice(4).map((item) => (
            <li key={item.to}>
              <Link to={item.to} className="list-item">
                <item.icon size={20} color="var(--accent)" aria-hidden />
                <span className="grow title">{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  )
}
