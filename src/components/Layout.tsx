import { t } from '../lib/i18n'
import { useLiveQuery } from '../lib/live'
import {
  BarChart3,
  BellRing,
  Clock,
  FileText,
  LayoutGrid,
  MoreHorizontal,
  Package,
  Receipt,
  Settings as SettingsIcon,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { customerName } from '../lib/defaults'
import { db } from '../lib/db'
import { useSettings, useTimer } from '../lib/hooks'
import { displayStatus } from '../lib/status'
import { Avatar, Dialog } from './ui'
import { TimerPill } from './TimerPill'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

const NAV: NavItem[] = [
  { to: '/', label: t('Übersicht'), icon: LayoutGrid, end: true },
  { to: '/rechnungen', label: t('Rechnungen'), icon: FileText },
  { to: '/kunden', label: t('Kunden'), icon: Users },
  { to: '/zeit', label: t('Zeiterfassung'), icon: Clock },
  { to: '/mahnwesen', label: t('Mahnwesen'), icon: BellRing },
  { to: '/ausgaben', label: t('Ausgaben'), icon: Receipt },
  { to: '/leistungen', label: t('Leistungen'), icon: Package },
  { to: '/berichte', label: t('Berichte'), icon: BarChart3 },
  { to: '/einstellungen', label: t('Einstellungen'), icon: SettingsIcon },
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

  const [path, setPath] = useState(location.pathname)
  if (path !== location.pathname) {
    setPath(location.pathname)
    setMoreOpen(false)
  }

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
        const map: Record<string, string> = { u: '/', r: '/rechnungen', k: '/kunden', z: '/zeit', m: '/mahnwesen', a: '/ausgaben', l: '/leistungen', b: '/berichte', e: '/einstellungen' }
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
    if (to === '/mahnwesen' && counts?.overdue) return <span className="nav-count" title={t('Überfällig')}>{counts.overdue}</span>
    return null
  }

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        {t('Zum Inhalt springen')}
      </a>
      <aside className="sidebar" aria-label={t('Hauptnavigation')}>
        <Link to="/" className="brand">
          <BrandMark />
          {t('Kontor')}
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
                {company?.name || t('Deine Firma')}
              </strong>
              <small>{settings?.smallBusiness ? t('Kleinunternehmer') : t('Firmendaten')}</small>
            </span>
          </Link>
        </div>
      </aside>

      <header className="mobile-header">
        <Link to="/" className="brand">
          <BrandMark />
          {t('Kontor')}
        </Link>
        {timer && <TimerPill timer={timer} customerName={timerCustomer ? customerName(timerCustomer) : ''} compact />}
      </header>

      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>

      <nav className="tabbar" aria-label={t('Navigation')}>
        {NAV.slice(0, 4).map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            <item.icon size={23} strokeWidth={1.9} aria-hidden />
            {item.to === '/zeit' ? t('Zeit') : item.label}
          </NavLink>
        ))}
        <button
          type="button"
          className={`tab ${NAV.slice(4).some((p) => location.pathname.startsWith(p.to)) ? 'active' : ''}`}
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
        >
          <MoreHorizontal size={23} strokeWidth={1.9} aria-hidden />
          {t('Mehr')}
        </button>
      </nav>

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title={t('Mehr')}>
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
