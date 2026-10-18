import { Square } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatClock } from '../lib/dates'
import { useNow } from '../lib/hooks'
import { stopTimer } from '../lib/repo'
import type { RunningTimer } from '../lib/types'
import { useFeedback } from './feedback'
import { IconButton } from './ui'

export function TimerPill({ timer, customerName, compact }: { timer: RunningTimer; customerName: string; compact?: boolean }) {
  const now = useNow(true)
  const { run } = useFeedback()
  const seconds = (now - new Date(timer.startedAt).getTime()) / 1000

  return (
    <div className={`timer-pill ${compact ? 'compact' : ''}`}>
      <span className="pulse" aria-hidden />
      <Link to="/zeit" className="meta" style={{ color: 'inherit', textDecoration: 'none' }} aria-label={`Laufende Stoppuhr: ${formatClock(seconds)}`}>
        <span className="time" aria-live="off">
          {formatClock(seconds)}
        </span>
        {!compact && <small>{[customerName, timer.description].filter(Boolean).join(' · ') || 'Läuft'}</small>}
      </Link>
      <IconButton
        icon={Square}
        size={14}
        label="Stoppuhr anhalten"
        onClick={() => run(stopTimer, 'Zeit gespeichert')}
        style={{ width: 28, height: 28, background: 'var(--red-soft)', color: 'var(--red)' }}
      />
    </div>
  )
}
