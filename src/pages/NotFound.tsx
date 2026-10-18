import { Compass } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/ui'

export function NotFound() {
  return (
    <div className="page">
      <div className="card">
        <EmptyState icon={Compass} title="Seite nicht gefunden" action={<Link to="/" className="btn primary">Zur Übersicht</Link>}>
          Diese Adresse gibt es in Kontor nicht. Vielleicht wurde der Eintrag gelöscht.
        </EmptyState>
      </div>
    </div>
  )
}
