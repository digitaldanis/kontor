import { saveCustomer } from '../lib/actions'
import { t } from '../lib/i18n'
import { useEffect, useState } from 'react'
import { COUNTRIES, isEU } from '../lib/countries'
import { CURRENCIES } from '../lib/defaults'
import { useSettings } from '../lib/hooks'
import type { Customer, CustomerType, Language } from '../lib/types'
import { useFeedback } from './feedback'
import { Button, Dialog, Field, MoneyInput, NumberInput, SelectField, TextAreaField, TextField } from './ui'

export function CustomerDialog({
  open,
  customer,
  onClose,
  onSaved,
}: {
  open: boolean
  customer: Customer | null
  onClose: () => void
  onSaved?: (c: Customer) => void
}) {
  const [c, setC] = useState<Customer | null>(customer)
  const [tried, setTried] = useState(false)
  const { run } = useFeedback()
  const settingsCurrency = useSettings()?.defaults.currency ?? 'EUR'

  useEffect(() => {
    if (open) {
      setC(customer)
      setTried(false)
    }
  }, [open, customer])

  if (!c) return null
  const set = <K extends keyof Customer>(key: K) => (v: Customer[K]) => setC({ ...c, [key]: v })
  const nameMissing = !c.company.trim() && !c.contactPerson.trim()
  const foreignEU = c.country !== 'DE' && isEU(c.country)

  const save = async () => {
    setTried(true)
    if (nameMissing) return
    const saved = await run(() => saveCustomer(c), t('Kunde gespeichert'))
    if (saved) {
      onSaved?.(saved)
      onClose()
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={customer?.number ? t('Kunde bearbeiten') : t('Neuer Kunde')}
      description={t('Die Anschrift wird in neue Rechnungen übernommen.')}
      footer={
        <>
          <Button onClick={onClose}>{t('Abbrechen')}</Button>
          <Button variant="primary" onClick={save}>
            {t('Speichern')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        className="stack"
      >
        <div className="form-grid">
          <TextField className="span-3" label={t('Firma')} value={c.company} onChange={set('company')} autoFocus error={tried && nameMissing ? t('Firma oder Ansprechpartner angeben') : null} />
          <TextField className="span-3" label={t('Ansprechpartner')} value={c.contactPerson} onChange={set('contactPerson')} placeholder={t('z. B. Frau Erika Mustermann')} />
          <TextField className="span-6" label={t('Adresszusatz')} value={c.addressExtra} onChange={set('addressExtra')} placeholder={t('optional, z. B. Abteilung Buchhaltung')} />
          <TextField className="span-4" label={t('Straße und Hausnummer')} value={c.street} onChange={set('street')} />
          <TextField className="span-2" label={t('PLZ')} value={c.zip} onChange={set('zip')} />
          <TextField className="span-3" label={t('Ort')} value={c.city} onChange={set('city')} />
          <SelectField className="span-3" label={t('Land')} value={c.country} onChange={set('country')}>
            {COUNTRIES.map((x) => (
              <option key={x.code} value={x.code}>
                {x.name}
              </option>
            ))}
          </SelectField>
          <TextField
            className="span-3"
            label={t('USt-IdNr.')}
            value={c.vatId}
            onChange={(v) => set('vatId')(v.toUpperCase())}
            hint={foreignEU ? t('Nötig für Reverse Charge bei Unternehmen im EU-Ausland') : t('Optional')}
          />
          <TextField className="span-3" label={t('E-Mail')} type="email" value={c.email} onChange={set('email')} />
          <TextField className="span-3" label={t('Telefon')} type="tel" value={c.phone} onChange={set('phone')} />
          <Field className="span-3" label={t('Stundensatz')} hint={t('Leer = Standard aus den Einstellungen')}>
            <MoneyInput value={c.hourlyRateCents} onChange={set('hourlyRateCents')} allowEmpty placeholder={t('Standard')} aria-label={t('Stundensatz')} />
          </Field>
          <Field className="span-3" label={t('Zahlungsziel')} hint={t('Leer = Standard')}>
            <NumberInput value={c.paymentTermDays ?? 0} onChange={(n) => set('paymentTermDays')(n > 0 ? Math.round(n) : null)} suffix="Tage" maxFraction={0} aria-label={t('Zahlungsziel')} />
          </Field>
          <TextField className="span-3" label={t('Leitweg-ID')} value={c.leitwegId} onChange={set('leitwegId')} hint={t('Nur für öffentliche Auftraggeber (XRechnung)')} />
          <SelectField
            className="span-2"
            label={t('Kundentyp')}
            value={c.customerType ?? (c.company.trim() ? 'business' : 'consumer')}
            onChange={(v) => setC({ ...c, customerType: v as CustomerType })}
            hint={t('Bestimmt Verzugszins (Unternehmen + 9, Verbraucher + 5 Punkte) und Pauschale.')}
          >
            <option value="business">{t('Unternehmen')}</option>
            <option value="consumer">{t('Verbraucher/in')}</option>
          </SelectField>
          <SelectField className="span-2" label={t('Dokumentsprache')} value={c.language ?? 'de'} onChange={(v) => setC({ ...c, language: v as Language })} hint={t('Neue Dokumente für diesen Kunden entstehen in dieser Sprache und Währung.')}>
            <option value="de">{t('Deutsch')}</option>
            <option value="en">{t('English')}</option>
          </SelectField>
          <SelectField className="span-2" label={t('Währung')} value={c.currency ?? ''} onChange={(v) => setC({ ...c, currency: v || undefined })}>
            <option value="">{t('Standard ({p0})', { p0: settingsCurrency })}</option>
            {CURRENCIES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </SelectField>
          <TextAreaField className="span-6" label={t('Notizen')} value={c.notes} onChange={set('notes')} rows={3} placeholder={t('Interne Notizen, erscheinen nicht auf der Rechnung')} />
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
