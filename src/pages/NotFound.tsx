import { t } from '../lib/i18n'
import { Compass } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/ui'

export function NotFound() {
  return (
    <div className="page">
      <div className="card">
        <EmptyState icon={Compass} title={t('Seite nicht gefunden')} action={<Link to="/" className="btn primary">{t('Zur Übersicht')}</Link>}>
          {t('Diese Adresse gibt es in Kontor nicht. Vielleicht wurde der Eintrag gelöscht.')}
        </EmptyState>
      </div>
    </div>
  )
}
