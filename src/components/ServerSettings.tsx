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
    }, 'Synchronisiert')
    if (mode === 'download') window.location.reload()
  }

  const signIn = async (register: boolean) => {
    const c = await run(() => login(url, email, password, register), register ? 'Konto angelegt' : 'Angemeldet')
    if (!c) return
    setPassword('')
    const me = await api<{ cursor: number }>('/api/me')
    if (me.cursor > 0 && (await hasLocalData())) setChoice({ remote: me.cursor })
    else await startSync(me.cursor > 0 ? 'download' : 'upload')
  }

  const disconnect = async () => {
    const ok = await confirm({
      title: 'Vom Server abmelden?',
      message: 'Die Daten bleiben in diesem Browser erhalten. Änderungen werden danach nicht mehr mit anderen Geräten abgeglichen.',
      confirmLabel: 'Abmelden',
    })
    if (!ok) return
    await run(async () => {
      await logout()
      resetSyncState()
    }, 'Abgemeldet')
    setHealth(null)
  }

  return (
    <>
      <div className="form-section">
        <h3>Server & Synchronisierung</h3>
        <p className="muted">
          Optional: Mit einem eigenen Kontor-Server (siehe README, Docker) verschickst du E-Mails direkt aus Kontor und nutzt deine Daten auf mehreren Geräten. Ohne Server bleibt alles nur in diesem Browser.
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
                    ? 'synchronisiert …'
                    : status.state === 'error'
                      ? `Fehler: ${status.message}`
                      : status.lastSync
                        ? `zuletzt ${new Date(status.lastSync).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
                        : 'bereit'}
                  {status.pending ? ` · ${status.pending} Änderungen ausstehend` : ''}
                </span>
              </span>
              <Button size="sm" icon={RefreshCw} onClick={() => void syncNow()} disabled={status.state === 'syncing'}>
                Jetzt abgleichen
              </Button>
              <Button size="sm" variant="ghost" icon={LogOut} onClick={disconnect}>
                Abmelden
              </Button>
            </div>
            <p className="small faint">Hinweis: Rechnungen am besten online abschließen, damit zwei Geräte nicht offline dieselbe Nummer vergeben.</p>
          </div>
        ) : (
          <div className="stack-sm">
            {connection && !connection.token && (
              <div className="callout warning small">
                <CloudOff size={16} aria-hidden />
                <span>Die Anmeldung ist abgelaufen. Bitte melde dich erneut an.</span>
              </div>
            )}
            <div className="row wrap" style={{ alignItems: 'flex-end' }}>
              <TextField className="grow" label="Serveradresse" value={url} onChange={(v) => { setUrl(v); setHealth(null) }} placeholder="https://kontor.example.de" style={{ minWidth: 260 }} />
              <Button onClick={check} disabled={!url.trim()}>
                Prüfen
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
                <TextField className="span-3" label="Konto-E-Mail" type="email" value={email} onChange={setEmail} autoComplete="username" />
                <TextField className="span-3" label="Passwort" type="password" value={password} onChange={setPassword} autoComplete="current-password" hint={health.signup ? 'Für ein neues Konto mindestens 10 Zeichen.' : undefined} />
                <div className="span-6 row wrap">
                  <Button type="submit" variant="primary" disabled={!email || !password}>
                    Anmelden
                  </Button>
                  {health.signup && (
                    <Button onClick={() => signIn(true)} disabled={!email || password.length < 10}>
                      Konto anlegen
                    </Button>
                  )}
                </div>
              </form>
            )}
          </div>
        )}
      </div>
      {connected && <SmtpSettings onSaved={() => toast('SMTP-Zugang gespeichert')} />}

      <Dialog
        open={!!choice}
        onClose={() => setChoice(null)}
        title="Daten abgleichen"
        description="Auf dem Server und in diesem Browser liegen bereits Daten."
        footer={
          <>
            <Button onClick={() => startSync('upload')}>Zusammenführen</Button>
            <Button variant="primary" onClick={() => startSync('download')}>
              Vom Server übernehmen
            </Button>
          </>
        }
      >
        <p className="small muted">
          „Vom Server übernehmen“ ersetzt die Daten in diesem Browser durch den Stand des Servers – empfohlen für ein weiteres Gerät. „Zusammenführen“ lädt die hiesigen Daten zusätzlich hoch; gleiche Einträge werden mit dem Stand dieses Geräts überschrieben.
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
      <h3>E-Mail-Versand (SMTP)</h3>
      <p className="muted">
        Die Zugangsdaten liegen verschlüsselt auf deinem Server und werden nie an den Browser zurückgegeben.
        {form.serverDefault && !form.configured ? ' Der Server hat bereits ein Standardkonto – eigene Angaben sind optional.' : ''}
      </p>
      <div className="form-grid">
        <TextField className="span-3" label="SMTP-Server" value={form.host} onChange={(host) => set({ host })} placeholder="smtp.example.de" />
        <Field className="span-1" label="Port">
          <NumberInput value={form.port} onChange={(port) => set({ port: Math.round(port) })} maxFraction={0} aria-label="Port" />
        </Field>
        <div className="span-2" style={{ alignSelf: 'end' }}>
          <Toggle checked={form.secure} onChange={(secure) => set({ secure, port: secure ? 465 : 587 })} label="SSL/TLS" description="Port 465; sonst STARTTLS" />
        </div>
        <TextField className="span-3" label="Benutzername" value={form.user} onChange={(user) => set({ user })} autoComplete="off" />
        <TextField className="span-3" label="Passwort" type="password" value={form.password} onChange={(password) => set({ password })} autoComplete="new-password" placeholder={form.hasPassword ? 'gespeichert – leer lassen zum Beibehalten' : ''} />
        <TextField className="span-6" label="Absender" value={form.from} onChange={(from) => set({ from })} placeholder="Studio Nordlicht <rechnung@example.de>" />
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
          Speichern
        </Button>
        <Button
          onClick={() =>
            run(async () => {
              const me = getConnection()?.email ?? ''
              await api('/api/mail/send', { body: { to: me, subject: 'Kontor: Testnachricht', text: 'Der E-Mail-Versand aus Kontor funktioniert.' } })
              toast(`Testmail an ${me} gesendet`)
            })
          }
          disabled={!form.configured && !form.serverDefault}
        >
          Testmail an mich
        </Button>
      </div>
    </div>
  )
}
