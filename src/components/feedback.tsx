import { t } from '../lib/i18n'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Button, Dialog } from './ui'

import { FeedbackContext, type ConfirmOptions, type Toast, type ToastAction } from './useFeedback'


export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [pending, setPending] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)
  const counter = useRef(0)

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const toast = useCallback(
    (message: string, tone: Toast['tone'] = 'default', action?: ToastAction) => {
      const id = ++counter.current
      setToasts((t) => [...t.slice(-3), { id, message, tone, action }])
      setTimeout(() => dismiss(id), action ? 7000 : tone === 'error' ? 5000 : 2800)
    },
    [dismiss],
  )

  const undoable = useCallback(
    (message: string, undo: () => Promise<unknown>) => {
      toast(message, 'default', {
        label: t('Rückgängig'),
        onClick: async () => {
          try {
            await undo()
            toast(t('Wiederhergestellt'))
          } catch (e) {
            toast(e instanceof Error ? e.message : t('Konnte nicht wiederhergestellt werden'), 'error')
          }
        },
      })
    },
    [toast],
  )

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
        toast(e instanceof Error ? t(e.message) : t('Unbekannter Fehler'), 'error')
        return undefined
      }
    },
    [toast],
  )

  return (
    <FeedbackContext.Provider value={{ toast, undoable, confirm, run }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'error' ? 'error' : ''}`}>
            {t.tone === 'error' ? <AlertTriangle size={17} aria-hidden /> : <CheckCircle2 size={17} aria-hidden />}
            <span>{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  dismiss(t.id)
                  void t.action?.onClick()
                }}
              >
                {t.action.label}
              </button>
            )}
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
            <Button onClick={() => close(false)}>{t('Abbrechen')}</Button>
            <Button variant={pending?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
              {pending?.confirmLabel ?? t('Bestätigen')}
            </Button>
          </>
        }
      />
    </FeedbackContext.Provider>
  )
}
