import { t, uiLocale } from '../lib/i18n'
import { X, type LucideIcon } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { formatAmount, parseDecimal, parseMoney } from '../lib/money'

type BtnVariant = 'primary' | 'danger' | 'ghost' | 'outline' | 'success' | 'default'

export function Button({
  variant = 'default',
  size,
  icon: Icon,
  block,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant
  size?: 'sm' | 'lg'
  icon?: LucideIcon
  block?: boolean
}) {
  const cls = ['btn', variant !== 'default' && variant, size, block && 'block', className].filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} {...rest}>
      {Icon && <Icon size={size === 'sm' ? 15 : 17} strokeWidth={2.2} aria-hidden />}
      {children}
    </button>
  )
}

export function IconButton({
  icon: Icon,
  label,
  danger,
  className = '',
  size = 18,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; danger?: boolean; size?: number }) {
  return (
    <button type="button" className={`icon-btn ${danger ? 'danger' : ''} ${className}`} aria-label={label} title={label} {...rest}>
      <Icon size={size} strokeWidth={2} aria-hidden />
    </button>
  )
}

export function Field({
  label,
  hint,
  error,
  className = '',
  children,
  htmlFor,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  className?: string
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <div className={`field ${className}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="error-text">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  )
}

/** Field with an auto-generated id wired to its input. */
export function TextField({
  label,
  hint,
  error,
  className,
  value,
  onChange,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  value: string
  onChange: (v: string) => void
}) {
  const id = useId()
  return (
    <Field label={label} hint={hint} error={error} className={className} htmlFor={id}>
      <input
        id={id}
        className={`input ${error ? 'invalid' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error || undefined}
        {...rest}
      />
    </Field>
  )
}

export function TextAreaField({
  label,
  hint,
  className,
  value,
  onChange,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> & {
  label: ReactNode
  hint?: ReactNode
  value: string
  onChange: (v: string) => void
}) {
  const id = useId()
  return (
    <Field label={label} hint={hint} className={className} htmlFor={id}>
      <textarea id={id} className="textarea" value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
    </Field>
  )
}

export function SelectField({
  label,
  hint,
  className,
  value,
  onChange,
  children,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> & {
  label: ReactNode
  hint?: ReactNode
  value: string
  onChange: (v: string) => void
}) {
  const id = useId()
  return (
    <Field label={label} hint={hint} className={className} htmlFor={id}>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
        {children}
      </select>
    </Field>
  )
}

/**
 * Money input that keeps the raw text while focused and only parses on blur,
 * so typing "12," doesn't get reformatted under the cursor.
 */
export function MoneyInput({
  value,
  onChange,
  currencySymbol = '€',
  className = '',
  allowEmpty,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: number | null
  onChange: (cents: number | null) => void
  currencySymbol?: string
  allowEmpty?: boolean
}) {
  const [text, setText] = useState(value == null ? '' : formatAmount(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(value == null ? '' : formatAmount(value))
  }, [value, focused])
  return (
    <div className="input-affix">
      <input
        className={`input num ${className}`}
        inputMode="decimal"
        value={text}
        onFocus={(e) => {
          setFocused(true)
          e.currentTarget.select()
        }}
        onChange={(e) => {
          setText(e.target.value)
          const parsed = parseMoney(e.target.value)
          if (parsed !== null) onChange(parsed)
          else if (allowEmpty && !e.target.value.trim()) onChange(null)
        }}
        onBlur={() => {
          setFocused(false)
          const parsed = parseMoney(text)
          if (parsed === null) {
            if (allowEmpty) onChange(null)
            setText(value == null || allowEmpty ? '' : formatAmount(value))
          } else setText(formatAmount(parsed))
        }}
        {...rest}
      />
      <span className="affix">{currencySymbol}</span>
    </div>
  )
}

export function NumberInput({
  value,
  onChange,
  className = '',
  suffix,
  maxFraction = 3,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: number
  onChange: (n: number) => void
  suffix?: string
  maxFraction?: number
}) {
  const fmt = (n: number) => n.toLocaleString(uiLocale(), { maximumFractionDigits: maxFraction, useGrouping: false })
  const [text, setText] = useState(fmt(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(fmt(value))
  }, [value, focused])
  const input = (
    <input
      className={`input num ${className}`}
      inputMode="decimal"
      value={text}
      onFocus={(e) => {
        setFocused(true)
        e.currentTarget.select()
      }}
      onChange={(e) => {
        setText(e.target.value)
        const n = parseDecimal(e.target.value)
        if (n !== null) onChange(n)
      }}
      onBlur={() => {
        setFocused(false)
        const n = parseDecimal(text)
        setText(fmt(n ?? value))
      }}
      {...rest}
      style={suffix ? { paddingRight: 20 + suffix.length * 8, ...rest.style } : rest.style}
    />
  )
  if (!suffix) return input
  return (
    <div className="input-affix">
      {input}
      <span className="affix">{suffix}</span>
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  description?: ReactNode
}) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-text">
        <strong>{label}</strong>
        {description && <span>{description}</span>}
      </span>
    </label>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
  label: string
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  compact,
}: {
  icon: LucideIcon
  title: string
  children?: ReactNode
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={`empty ${compact ? 'compact' : ''}`}>
      <div className="empty-icon">
        <Icon size={compact ? 22 : 28} strokeWidth={1.8} aria-hidden />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  back?: ReactNode
}) {
  return (
    <header className="page-header">
      <div style={{ minWidth: 0 }}>
        {back}
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  )
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const el = ref.current
    const first = el?.querySelector<HTMLElement>('input, select, textarea, button:not(.icon-btn), [tabindex]:not([tabindex="-1"])')
    ;(first ?? el)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])')]
        if (!items.length) return
        const firstItem = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === firstItem) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          firstItem.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <IconButton icon={X} label={t('Schließen')} onClick={onClose} />
        </div>
        {children && <div className="dialog-body">{children}</div>}
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Avatar({ name, src }: { name: string; src?: string | null }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
  return (
    <span
      className="avatar"
      aria-hidden
      style={src ? undefined : { background: `linear-gradient(135deg, hsl(${hue} 55% 62%), hsl(${(hue + 30) % 360} 50% 46%))` }}
    >
      {src ? <img src={src} alt="" /> : initials || '?'}
    </span>
  )
}

export function Stat({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'blue',
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: LucideIcon
  tone?: 'blue' | 'green' | 'orange' | 'red' | 'purple'
}) {
  const colors: Record<string, [string, string]> = {
    blue: ['var(--accent-soft)', 'var(--accent)'],
    green: ['var(--green-soft)', 'var(--green)'],
    orange: ['var(--orange-soft)', 'var(--orange)'],
    red: ['var(--red-soft)', 'var(--red)'],
    purple: ['var(--purple-soft)', 'var(--purple)'],
  }
  const [bg, fg] = colors[tone]
  return (
    <div className="card stat">
      <span className="stat-label">
        {Icon && (
          <span className="stat-icon" style={{ background: bg, color: fg }}>
            <Icon size={15} strokeWidth={2.2} aria-hidden />
          </span>
        )}
        {label}
      </span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  )
}
