import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '../lib/cn'

type ToastTone = 'success' | 'error' | 'info'

type ToastItem = {
  id: number
  tone: ToastTone
  title: string
  description?: string
}

type ToastInput = {
  title: string
  description?: string
}

type ToastApi = {
  success: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
  info: (title: string, description?: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const toneStyles: Record<ToastTone, string> = {
  success: 'border-emerald-200 bg-white',
  error: 'border-rose-200 bg-white',
  info: 'border-slate-200 bg-white',
}

const toneIcon: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />,
  error: <AlertCircle className="h-5 w-5 text-rose-600" aria-hidden />,
  info: <Info className="h-5 w-5 text-brand-600" aria-hidden />,
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem
  onDismiss: (id: number) => void
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), 6000)
    return () => window.clearTimeout(timer)
  }, [toast.id, onDismiss])

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex w-full items-start gap-3 rounded-xl border p-4 shadow-lift animate-slide-up',
        toneStyles[toast.tone],
      )}
    >
      <div className="mt-0.5 shrink-0">{toneIcon[toast.tone]}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{toast.title}</p>
        {toast.description ? (
          <p className="mt-0.5 text-sm leading-5 text-slate-600">
            {toast.description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const counterRef = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback((tone: ToastTone, input: ToastInput) => {
    counterRef.current += 1
    const item: ToastItem = {
      id: counterRef.current,
      tone,
      title: input.title,
      description: input.description,
    }
    setToasts((current) => [...current.slice(-3), item])
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, description) => push('success', { title, description }),
      error: (title, description) => push('error', { title, description }),
      info: (title, description) => push('info', { title, description }),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex justify-end px-4 sm:inset-x-auto sm:right-4 sm:w-full sm:max-w-sm">
        <div className="flex w-full flex-col gap-2">
          {toasts.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}
