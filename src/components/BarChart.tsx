export interface Bar {
  key: string
  label: string
  value: number
  display: string
  hint?: string
  current?: boolean
}

/** Single-series bar chart with hover/focus tooltips. */
export function BarChart({ bars, label, height = 180 }: { bars: Bar[]; label: string; height?: number }) {
  const max = Math.max(1, ...bars.map((b) => b.value))
  return (
    <div className="bars" role="list" aria-label={label} style={{ height }}>
      {bars.map((b) => (
        <div key={b.key} role="listitem" tabIndex={0} className={`bar-col ${b.current ? 'current' : ''}`} aria-label={`${b.hint ?? b.label}: ${b.display}`}>
          <span className="bar-tip" aria-hidden>
            <strong>{b.display}</strong>
            {b.hint ?? b.label}
          </span>
          <div className={`bar ${b.value > 0 ? '' : 'muted-bar'}`} style={{ height: `${Math.max(0, b.value / max) * 100}%` }} />
          <span className="bar-label">{b.label}</span>
        </div>
      ))}
    </div>
  )
}
