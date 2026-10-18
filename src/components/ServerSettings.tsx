import { t, uiLocale } from '../lib/i18n'
import { CloudOff, LogOut, RefreshCw, Server } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { wipeAll } from '../lib/backup'
import { db } from '../lib/db'
import { api, checkServer, getConnection, login, logout, onConnectionChange, type Health } from '../lib/server'
import { getSyncStatus, markAllDirty, resetSyncState, subscribeSync, syncNow } from '../lib/sync'
import { useFeedback } from './feedback'
import { Button, Dialog, NumberInput, Field, TextField, Toggle } from './ui'

function useConnection() {
  return useSyncExternalStore(onConnectionChange, getConnection)
}

export function useSyncStatus() {
  return useSyncExternalStore(subscribeSync, getSyncStatus)
}

async function hasLocalData() {
  return (await db.documents.count()) + (await db.customers.count()) + (await db.timeEntries.count()) > 0
}

export function ServerSettings() {
  const connection = useConnection()
  const status = useSyncStatus()
  const { run, toast, confirm } = useFeedback()
  const [url, setUrl] = useState(connection?.url ?? '')
  const [health, setHealth] = useState<Health | null>(null)
  const [email, setEmail] = useState(connection?.email ?? '')
  const [password, setPassword] = useState('')
  const [choice, setChoice] = useState<{ remote: number } | null>(null)

  const connected = !!connection?.token

  const check = () =>
    run(async () => {
      setHealth(await checkServer(url))
    })

  const startSync = async (mode: 'upload' | 'download') => {
    setChoice(null)
    await run(async () => {
      if (mode === 'download') {
        await wipeAll()
        resetSyncState()
      } else {
        resetSyncState()
        await markAllDirty()
      }
      await syncNow()
      const s = getSyncStatus()
      if (s.state === 'error') throw new Error(s.message)
    }, t('Synchronisiert'))
    if (mode === 'download') window.location.reload()
  }

  const signIn = async (register: boolean) => {
    const c = await run(() => login(url, email, password, register), register ? t('Konto angelegt') : t('Angemeldet'))
    if (!c) return
    setPassword('')
    const me = await api<{ cursor: number }>('/api/me')
    if (me.cursor > 0 && (await hasLocalData())) setChoice({ remote: me.cursor })
    else await startSync(me.cursor > 0 ? 'download' : 'upload')
  }

  const disconnect = async () => {
    const ok = await confirm({
      title: t('Vom Server abmelden?'),
      message: t('Die Daten bleiben in diesem Browser erhalten. Änderungen werden danach nicht mehr mit anderen Geräten abgeglichen.'),
      confirmLabel: t('Abmelden'),
    })
    if (!ok) return
    await run(async () => {
      await logout()
      resetSyncState()
    }, t('Abgemeldet'))
    setHealth(null)
  }

  return (
    <>
      <div className="form-section">
        <h3>{t('Server & Synchronisierung')}</h3>
        <p className="muted">
          {t('Optional: Mit einem eigenen Kontor-Server (siehe README, Docker) verschickst du E-Mails direkt aus Kontor und nutzt deine Daten auf mehreren Geräten. Ohne Server bleibt alles nur in diesem Browser.')}
        </p>
        {connected ? (
          <div className="stack-sm">
            <div className="row wrap">
              <Server size={18} color="var(--green)" aria-hidden />
              <span className="grow" style={{ flex: 1 }}>
                <strong>{connection.email}</strong>
                <span className="small muted" style={{ display: 'block' }}>
                  {connection.url} ·{' '}
                  {status.state === 'syncing'
                    ? t('synchronisiert …')
                    : status.state === 'error'
                      ? t('Fehler: {p0}', { p0: status.message })
                      : status.lastSync
                        ? t('zuletzt {p0}', { p0: new Date(status.lastSync).toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit' }) })
                        : t('bereit')}
                  {status.pending ? t(' · {p0} Änderungen ausstehend', { p0: status.pending }) : ''}
                </span>
              </span>
              <Button size="sm" icon={RefreshCw} onClick={() => void syncNow()} disabled={status.state === 'syncing'}>
                {t('Jetzt abgleichen')}
              </Button>
              <Button size="sm" variant="ghost" icon={LogOut} onClick={disconnect}>
                {t('Abmelden')}
              </Button>
            </div>
            <p className="small faint">{t('Hinweis: Rechnungen am besten online abschließen, damit zwei Geräte nicht offline dieselbe Nummer vergeben.')}</p>
          </div>
        ) : (
          <div className="stack-sm">
            {connection && !connection.token && (
              <div className="callout warning small">
                <CloudOff size={16} aria-hidden />
                <span>{t('Die Anmeldung ist abgelaufen. Bitte melde dich erneut an.')}</span>
              </div>
            )}
            <div className="row wrap" style={{ alignItems: 'flex-end' }}>
              <TextField className="grow" label={t('Serveradresse')} value={url} onChange={(v) => { setUrl(v); setHealth(null) }} placeholder={t('https://kontor.example.de')} style={{ minWidth: 260 }} />
              <Button onClick={check} disabled={!url.trim()}>
                {t('Prüfen')}
              </Button>
            </div>
            {health && (
              <form
                className="form-grid"
                onSubmit={(e) => {
                  e.preventDefault()
                  void signIn(false)
                }}
              >
                <TextField className="span-3" label={t('Konto-E-Mail')} type="email" value={email} onChange={setEmail} autoComplete="username" />
                <TextField className="span-3" label={t('Passwort')} type="password" value={password} onChange={setPassword} autoComplete="current-password" hint={health.signup ? t('Für ein neues Konto mindestens 10 Zeichen.') : undefined} />
                <div className="span-6 row wrap">
                  <Button type="submit" variant="primary" disabled={!email || !password}>
                    {t('Anmelden')}
                  </Button>
                  {health.signup && (
                    <Button onClick={() => signIn(true)} disabled={!email || password.length < 10}>
                      {t('Konto anlegen')}
                    </Button>
                  )}
                </div>
              </form>
            )}
          </div>
        )}
      </div>
      {connected && <SmtpSettings onSaved={() => toast(t('SMTP-Zugang gespeichert'))} />}

      <Dialog
        open={!!choice}
        onClose={() => setChoice(null)}
        title={t('Daten abgleichen')}
        description={t('Auf dem Server und in diesem Browser liegen bereits Daten.')}
        footer={
          <>
            <Button onClick={() => startSync('upload')}>{t('Zusammenführen')}</Button>
            <Button variant="primary" onClick={() => startSync('download')}>
              {t('Vom Server übernehmen')}
            </Button>
          </>
        }
      >
        <p className="small muted">
          {t('„Vom Server übernehmen“ ersetzt die Daten in diesem Browser durch den Stand des Servers – empfohlen für ein weiteres Gerät. „Zusammenführen“ lädt die hiesigen Daten zusätzlich hoch; gleiche Einträge werden mit dem Stand dieses Geräts überschrieben.')}
        </p>
      </Dialog>
    </>
  )
}

interface SmtpForm {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  from: string
  hasPassword: boolean
  configured: boolean
  serverDefault: boolean
}

function SmtpSettings({ onSaved }: { onSaved: () => void }) {
  const { run, toast } = useFeedback()
  const [form, setForm] = useState<SmtpForm | null>(null)

  useEffect(() => {
    let alive = true
    void api<Omit<SmtpForm, 'password'>>('/api/mail/settings')
      .then((s) => alive && setForm({ ...s, password: '' }))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  if (!form) return null
  const set = (patch: Partial<SmtpForm>) => setForm({ ...form, ...patch })

  return (
    <div className="form-section">
      <h3>{t('E-Mail-Versand (SMTP)')}</h3>
      <p className="muted">
        {t('Die Zugangsdaten liegen verschlüsselt auf deinem Server und werden nie an den Browser zurückgegeben.')}
        {form.serverDefault && !form.configured ? t(' Der Server hat bereits ein Standardkonto – eigene Angaben sind optional.') : ''}
      </p>
      <div className="form-grid">
        <TextField className="span-3" label={t('SMTP-Server')} value={form.host} onChange={(host) => set({ host })} placeholder={t('smtp.example.de')} />
        <Field className="span-1" label={t('Port')}>
          <NumberInput value={form.port} onChange={(port) => set({ port: Math.round(port) })} maxFraction={0} aria-label={t('Port')} />
        </Field>
        <div className="span-2" style={{ alignSelf: 'end' }}>
          <Toggle checked={form.secure} onChange={(secure) => set({ secure, port: secure ? 465 : 587 })} label={t('SSL/TLS')} description={t('Port 465; sonst STARTTLS')} />
        </div>
        <TextField className="span-3" label={t('Benutzername')} value={form.user} onChange={(user) => set({ user })} autoComplete="off" />
        <TextField className="span-3" label={t('Passwort')} type="password" value={form.password} onChange={(password) => set({ password })} autoComplete="new-password" placeholder={form.hasPassword ? t('gespeichert – leer lassen zum Beibehalten') : ''} />
        <TextField className="span-6" label={t('Absender')} value={form.from} onChange={(from) => set({ from })} placeholder={t('Studio Nordlicht <rechnung@example.de>')} />
      </div>
      <div className="row wrap" style={{ marginTop: 12 }}>
        <Button
          variant="primary"
          onClick={() =>
            run(async () => {
              await api('/api/mail/settings', { method: 'PUT', body: { host: form.host, port: form.port, secure: form.secure, user: form.user, password: form.password || undefined, from: form.from } })
              setForm({ ...form, password: '', hasPassword: form.hasPassword || !!form.password, configured: true })
              onSaved()
            })
          }
        >
          {t('Speichern')}
        </Button>
        <Button
          onClick={() =>
            run(async () => {
              const me = getConnection()?.email ?? ''
              await api('/api/mail/send', { body: { to: me, subject: 'Kontor: Testnachricht', text: 'Der E-Mail-Versand aus Kontor funktioniert.' } })
              toast(t('Testmail an {p0} gesendet', { p0: me }))
            })
          }
          disabled={!form.configured && !form.serverDefault}
        >
          {t('Testmail an mich')}
        </Button>
      </div>
    </div>
  )
}
