import { t } from '../lib/i18n'
import { ImagePlus, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { COUNTRIES } from '../lib/countries'
import { ACCENT_COLORS } from '../lib/defaults'
import { buildInvoiceView } from '../lib/invoiceView'
import { readLogo } from '../lib/logo'
import { sampleDocument } from '../lib/sample'
import type { Company, LayoutId, Logo, Settings } from '../lib/types'
import { isPlausibleIban } from '../lib/validation'
import { useFeedback } from './feedback'
import { InvoicePreview, ScaledPage } from './InvoicePreview'
import { Button, SelectField, TextField } from './ui'

export function CompanyFields({ value, onChange, showErrors }: { value: Company; onChange: (c: Company) => void; showErrors?: boolean }) {
  const set = <K extends keyof Company>(key: K) => (v: Company[K]) => onChange({ ...value, [key]: v })
  const req = (v: string) => (showErrors && !v.trim() ? 'Pflichtfeld' : null)
  return (
    <div className="form-grid">
      <TextField className="span-4" label={t('Firmenname *')} value={value.name} onChange={set('name')} autoComplete="organization" error={req(value.name)} placeholder={t('z. B. Muster Design')} />
      <TextField className="span-2" label={t('Inhaber/in')} value={value.owner} onChange={set('owner')} autoComplete="name" />
      <TextField className="span-6" label={t('Adresszusatz')} value={value.addressExtra} onChange={set('addressExtra')} placeholder={t('optional, z. B. c/o, Gebäude')} />
      <TextField className="span-4" label={t('Straße und Hausnummer *')} value={value.street} onChange={set('street')} autoComplete="street-address" error={req(value.street)} />
      <TextField className="span-2" label={t('PLZ *')} value={value.zip} onChange={set('zip')} autoComplete="postal-code" error={req(value.zip)} inputMode="numeric" />
      <TextField className="span-3" label={t('Ort *')} value={value.city} onChange={set('city')} autoComplete="address-level2" error={req(value.city)} />
      <SelectField className="span-3" label={t('Land')} value={value.country} onChange={set('country')}>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </SelectField>
    </div>
  )
}

export function TaxFields({ value, onChange, showErrors }: { value: Company; onChange: (c: Company) => void; showErrors?: boolean }) {
  const set = <K extends keyof Company>(key: K) => (v: Company[K]) => onChange({ ...value, [key]: v })
  const missing = showErrors && !value.taxNumber.trim() && !value.vatId.trim()
  return (
    <div className="form-grid">
      <TextField className="span-3" label={t('Steuernummer')} value={value.taxNumber} onChange={set('taxNumber')} placeholder="z. B. 27/123/45678" error={missing ? t('Steuernummer oder USt-IdNr. angeben') : null} />
      <TextField
        className="span-3"
        label={t('USt-IdNr.')}
        value={value.vatId}
        onChange={(v) => set('vatId')(v.toUpperCase())}
        placeholder={t('z. B. DE123456789')}
        hint={t('Pflicht für Rechnungen ins EU-Ausland')}
      />
      <TextField className="span-6" label={t('Registerangaben')} value={value.registerInfo} onChange={set('registerInfo')} placeholder={t('optional, z. B. Amtsgericht Berlin HRB 12345, GF: Max Muster')} />
    </div>
  )
}

export function ContactFields({ value, onChange }: { value: Company; onChange: (c: Company) => void }) {
  const set = <K extends keyof Company>(key: K) => (v: Company[K]) => onChange({ ...value, [key]: v })
  return (
    <div className="form-grid">
      <TextField className="span-2" label={t('E-Mail')} type="email" value={value.email} onChange={set('email')} autoComplete="email" />
      <TextField className="span-2" label={t('Telefon')} type="tel" value={value.phone} onChange={set('phone')} autoComplete="tel" />
      <TextField className="span-2" label={t('Website')} value={value.website} onChange={set('website')} autoComplete="url" />
    </div>
  )
}

export function BankFields({ value, onChange }: { value: Company; onChange: (c: Company) => void }) {
  const set = <K extends keyof Company>(key: K) => (v: Company[K]) => onChange({ ...value, [key]: v })
  const ibanError = value.iban.trim() && !isPlausibleIban(value.iban) ? t('Diese IBAN ist ungültig.') : null
  return (
    <div className="form-grid">
      <TextField className="span-3" label={t('IBAN')} value={value.iban} onChange={(v) => set('iban')(v.toUpperCase())} error={ibanError} placeholder={t('DE00 0000 0000 0000 0000 00')} spellCheck={false} />
      <TextField className="span-1" label={t('BIC')} value={value.bic} onChange={(v) => set('bic')(v.toUpperCase())} spellCheck={false} />
      <TextField className="span-2" label={t('Bank')} value={value.bankName} onChange={set('bankName')} />
      <TextField className="span-3" label={t('Kontoinhaber')} value={value.accountHolder} onChange={set('accountHolder')} hint={t('Leer lassen, wenn identisch mit Firmenname')} />
    </div>
  )
}

export function LogoField({ logo, onChange }: { logo: Logo | null; onChange: (l: Logo | null) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const { run } = useFeedback()

  const handle = (file: File | undefined) => {
    if (!file) return
    run(async () => onChange(await readLogo(file)), t('Logo übernommen'))
  }

  return (
    <div
      className={`logo-drop ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        handle(e.dataTransfer.files[0])
      }}
    >
      <div className="logo-preview">{logo ? <img src={logo.dataUrl} alt={t('Dein Logo')} /> : <ImagePlus size={28} aria-hidden />}</div>
      <div className="stack-sm" style={{ gap: 8 }}>
        <div>
          <strong>{logo ? t('Dein Logo') : t('Logo hinzufügen')}</strong>
          <p className="muted small">{t('PNG, JPG oder SVG bis 2 MB. Ziehe die Datei hierher oder wähle sie aus.')}</p>
        </div>
        <div className="row wrap">
          <Button size="sm" icon={Upload} onClick={() => input.current?.click()}>
            {logo ? t('Ersetzen') : t('Datei wählen')}
          </Button>
          {logo && (
            <Button size="sm" variant="danger" icon={Trash2} onClick={() => onChange(null)}>
              {t('Entfernen')}
            </Button>
          )}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,.svg"
        hidden
        onChange={(e) => {
          handle(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}

const LAYOUTS: { id: LayoutId; label: string }[] = [
  { id: 'classic', label: t('Klassisch') },
  { id: 'modern', label: t('Modern') },
  { id: 'minimal', label: t('Minimal') },
]

export function LayoutPicker({ settings, value, onChange, accent }: { settings: Settings; value: LayoutId; onChange: (l: LayoutId) => void; accent?: string }) {
  return (
    <div className="choice-grid" role="radiogroup" aria-label={t('Layout')}>
      {LAYOUTS.map((l) => {
        const doc = sampleDocument(settings, l.id)
        if (accent) doc.accentColor = accent
        const view = buildInvoiceView(doc, settings)
        view.isDraft = false
        return (
          <button key={l.id} type="button" className="choice" aria-pressed={value === l.id} role="radio" aria-checked={value === l.id} onClick={() => onChange(l.id)}>
            <div className="thumb">
              <ScaledPage>
                <InvoicePreview view={view} />
              </ScaledPage>
            </div>
            {l.label}
          </button>
        )
      })}
    </div>
  )
}

export function AccentPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="color-swatches" role="radiogroup" aria-label={t('Akzentfarbe')}>
      {ACCENT_COLORS.map((c) => (
        <button key={c} type="button" className="swatch" style={{ background: c }} aria-pressed={value.toLowerCase() === c} aria-label={t('Farbe {p0}', { p0: c })} onClick={() => onChange(c)} />
      ))}
      <label className="row small muted" style={{ gap: 8 }}>
        <input className="swatch-custom" type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={t('Eigene Farbe')} />
        {t('Eigene')}
      </label>
    </div>
  )
}
