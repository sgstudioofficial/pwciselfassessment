import type { ReactNode } from 'react'
import { CheckCircle2, LockKeyhole, Timer, UploadCloud } from 'lucide-react'
import { Brand } from './Brand'

const highlights = [
  {
    icon: Timer,
    title: 'Timed assessments',
    body: 'Countdowns, autosave and automatic submission.',
  },
  {
    icon: LockKeyhole,
    title: 'Controlled access',
    body: 'Only assigned students see each assessment.',
  },
  {
    icon: CheckCircle2,
    title: 'Instant objective scoring',
    body: 'Short answers stay open for admin review.',
  },
]

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  compact = false,
}: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  compact?: boolean
}) {
  return (
    <div className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[1.02fr_1fr]">
      {!compact ? (
        <aside className="relative hidden overflow-hidden bg-ink-950 px-10 py-10 text-white lg:flex lg:flex-col xl:px-14">
          <div className="pointer-events-none absolute -left-24 top-1/3 h-96 w-96 rounded-full bg-brand-600/20 blur-3xl" />
          <div className="pointer-events-none absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-indigo-500/10 blur-3xl" />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage:
                'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
              backgroundSize: '48px 48px',
            }}
          />

          <div className="relative">
            <Brand inverted />
          </div>

          <div className="relative my-auto max-w-md py-12">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-300">
              <UploadCloud className="h-3.5 w-3.5 text-brand-300" />
              Company assessment platform
            </span>
            <h2 className="mt-6 text-4xl font-bold leading-[1.15] tracking-tight text-balance xl:text-[2.75rem]">
              Assess what your team knows. Act on what they learn.
            </h2>
            <p className="mt-5 max-w-sm text-sm leading-7 text-slate-400">
              Build structured assessments, assign them to the right people, and
              review reliable results without spreadsheets.
            </p>

            <div className="mt-10 space-y-4">
              {highlights.map((item) => (
                <div key={item.title} className="flex items-start gap-3.5">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                    <item.icon className="h-4 w-4 text-brand-300" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{item.title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-slate-400">
                      {item.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="relative text-xs text-slate-500">
            Secure by design · Role-based access · Audit-ready results
          </p>
        </aside>
      ) : null}

      <main className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[420px]">
          <div className="mb-9 lg:hidden">
            <Brand />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 text-sm leading-6 text-slate-500">{subtitle}</p>
          ) : null}
          <div className="mt-7">{children}</div>
          {footer ? <div className="mt-7">{footer}</div> : null}
          <p className="mt-10 text-center text-[11px] text-slate-400">
            Protected by Supabase Auth · Row Level Security enforced
          </p>
        </div>
      </main>
    </div>
  )
}
