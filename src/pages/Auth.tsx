import { ArrowRight, LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import { useFeedback } from '../components/useFeedback'
import { LanguageSwitch } from '../components/LanguageSwitch'
import { BrandMark } from '../components/Layout'
import { Button, TextField } from '../components/ui'
import { t } from '../lib/i18n'
import { useDocumentTitle } from '../lib/hooks'
import { login, register } from '../lib/session'
import './onboarding.css'

/** Sign-in, or creating the owner account on first start. */
export function AuthScreen({ firstRun, signup }: { firstRun: boolean; signup: boolean }) {
  const [mode, setMode] = useState<'login' | 'register'>(firstRun ? 'register' : 'login')
  useDocumentTitle(mode === 'register' ? t('Konto anlegen') : t('Anmelden'))
  const { run } = useFeedback()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const registering = mode === 'register'

  const submit = async () => {
    setBusy(true)
    await run(() => (registering ? register(email, password, name) : login(email, password)))
    setBusy(false)
  }

  return (
    <div className="onboarding">
      <div className="onboarding-language">
        <LanguageSwitch />
      </div>
      <form
        className="onboarding-card card auth-card"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="onboarding-hero" style={{ marginBottom: 8 }}>
          <BrandMark />
          <h1>{registering ? (firstRun ? t('Willkommen bei Kontor') : t('Konto anlegen')) : t('Anmelden')}</h1>
          <p className="lead">
            {registering
              ? firstRun
                ? t('Lege das Konto des Inhabers an. Weitere Personen lädst du später unter Einstellungen → Team ein.')
                : t('Lege ein neues Konto mit eigenem Arbeitsbereich an.')
              : t('Melde dich mit deinem Kontor-Konto an.')}
          </p>
        </div>
        <div className="stack-sm">
          {registering && <TextField label={t('Dein Name')} value={name} onChange={setName} autoComplete="name" />}
          <TextField label={t('E-Mail')} type="email" value={email} onChange={setEmail} autoComplete="username" required autoFocus />
          <TextField
            label={t('Passwort')}
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete={registering ? 'new-password' : 'current-password'}
            required
            minLength={registering ? 10 : undefined}
            hint={registering ? t('Mindestens 10 Zeichen.') : undefined}
          />
        </div>
        <div className="onboarding-actions">
          {registering && !firstRun ? (
            <Button variant="ghost" onClick={() => setMode('login')}>
              {t('Schon ein Konto? Anmelden')}
            </Button>
          ) : !registering && signup ? (
            <Button variant="ghost" onClick={() => setMode('register')}>
              {t('Neues Konto anlegen')}
            </Button>
          ) : (
            <span className="small faint row" style={{ gap: 6 }}>
              <LockKeyhole size={14} aria-hidden /> {t('Daten liegen auf deinem Kontor-Server.')}
            </span>
          )}
          <Button type="submit" variant="primary" size="lg" disabled={busy || !email || !password}>
            {registering ? t('Konto anlegen') : t('Anmelden')}
            <ArrowRight size={17} aria-hidden />
          </Button>
        </div>
      </form>
    </div>
  )
}
