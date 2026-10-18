import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Button, Dialog } from './ui'

interface Toast {
  id: number
  message: string
  tone: 'default' | 'error'
}

interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  danger?: boolean
}

interface FeedbackApi {
  toast: (message: string, tone?: Toast['tone']) => void
  confirm: (options: ConfirmOptions) => Promise<boolean>
  run: <T>(task: () => Promise<T>, success?: string) => Promise<T | undefined>
}

const FeedbackContext = createContext<FeedbackApi | null>(null)

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [pending, setPending] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)
  const counter = useRef(0)

  const toast = useCallback((message: string, tone: Toast['tone'] = 'default') => {
    const id = ++counter.current
    setToasts((t) => [...t, { id, message, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 5000 : 2800)
  }, [])

  const confirm = useCallback((options: ConfirmOptions) => {
    setPending(options)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const close = (result: boolean) => {
    resolver.current?.(result)
    resolver.current = null
    setPending(null)
  }

  const run = useCallback(
    async <T,>(task: () => Promise<T>, success?: string) => {
      try {
        const result = await task()
        if (success) toast(success)
        return result
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Unbekannter Fehler', 'error')
        return undefined
      }
    },
    [toast],
  )

  return (
    <FeedbackContext.Provider value={{ toast, confirm, run }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'error' ? 'error' : ''}`}>
            {t.tone === 'error' ? <AlertTriangle size={17} aria-hidden /> : <CheckCircle2 size={17} aria-hidden />}
            {t.message}
          </div>
        ))}
      </div>
      <Dialog
        open={!!pending}
        onClose={() => close(false)}
        title={pending?.title}
        description={pending?.message}
        footer={
          <>
            <Button onClick={() => close(false)}>Abbrechen</Button>
            <Button variant={pending?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
              {pending?.confirmLabel ?? 'Bestätigen'}
            </Button>
          </>
        }
      />
    </FeedbackContext.Provider>
  )
}

export function useFeedback(): FeedbackApi {
  const ctx = useContext(FeedbackContext)
  if (!ctx) throw new Error('FeedbackProvider fehlt')
  return ctx
}
