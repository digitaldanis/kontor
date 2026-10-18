import { createContext, useContext, type ReactNode } from 'react'

export interface ToastAction {
  label: string
  onClick: () => void | Promise<void>
}

export interface Toast {
  id: number
  message: string
  tone: 'default' | 'error'
  action?: ToastAction
}

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  danger?: boolean
}

export interface FeedbackApi {
  toast: (message: string, tone?: Toast['tone'], action?: ToastAction) => void
  /** Shows a toast with an undo button; `undo` restores what was just removed. */
  undoable: (message: string, undo: () => Promise<unknown>) => void
  confirm: (options: ConfirmOptions) => Promise<boolean>
  run: <T>(task: () => Promise<T>, success?: string) => Promise<T | undefined>
}

export const FeedbackContext = createContext<FeedbackApi | null>(null)

export function useFeedback(): FeedbackApi {
  const ctx = useContext(FeedbackContext)
  if (!ctx) throw new Error('FeedbackProvider fehlt')
  return ctx
}
