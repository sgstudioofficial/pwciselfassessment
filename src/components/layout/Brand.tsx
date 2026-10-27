import { Link } from 'react-router-dom'
import { cn } from '../../lib/cn'

export function BrandMark({
  inverted = false,
  className,
}: {
  inverted?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold shadow-sm',
        inverted ? 'bg-white text-ink-900' : 'bg-ink-900 text-white',
        className,
      )}
      aria-hidden
    >
      P
      <span
        className={cn(
          'absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 bg-brand-400',
          inverted ? 'border-ink-950' : 'border-white',
        )}
      />
    </span>
  )
}

export function Brand({
  inverted = false,
  compact = false,
}: {
  inverted?: boolean
  compact?: boolean
}) {
  return (
    <Link
      to="/"
      className="group inline-flex items-center gap-2.5"
      aria-label="PWCI Self Assessment Tool home"
    >
      <BrandMark inverted={inverted} />
      {!compact ? (
        <span className="leading-tight">
          <span
            className={cn(
              'block text-[15px] font-bold tracking-tight',
              inverted ? 'text-white' : 'text-slate-900',
            )}
          >
            PWCI
          </span>
          <span
            className={cn(
              'block text-[10px] font-medium uppercase tracking-[0.16em]',
              inverted ? 'text-slate-400' : 'text-slate-500',
            )}
          >
            Self Assessment
          </span>
        </span>
      ) : null}
    </Link>
  )
}
