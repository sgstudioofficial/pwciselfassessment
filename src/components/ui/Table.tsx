import type { HTMLAttributes, ReactNode, TdHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export function Table({
  children,
  className,
  wrapperClassName,
}: {
  children: ReactNode
  className?: string
  wrapperClassName?: string
}) {
  return (
    <div className={cn('w-full overflow-x-auto', wrapperClassName)}>
      <table className={cn('min-w-full border-collapse text-left text-sm', className)}>
        {children}
      </table>
    </div>
  )
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-slate-50/80">{children}</thead>
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-slate-100">{children}</tbody>
}

export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <tr className={cn('transition-colors hover:bg-slate-50/60', className)}>
      {children}
    </tr>
  )
}

export function Th({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500',
        className,
      )}
      {...props}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('px-4 py-3.5 align-middle text-slate-700', className)}
      {...props}
    >
      {children}
    </td>
  )
}
