import { Check, X } from 'lucide-react'
import type { GridRow, QuestionOption } from '../lib/types'
import { gridPairMap } from '../lib/grid'
import { cn } from '../lib/cn'

/**
 * Read-only rendering of a grid question, used by the admin preview and both
 * result pages. Rows are listed on the left and columns across the top; the
 * student's selection and the answer key are highlighted per cell.
 */
export function GridAnswerTable({
  rows,
  columns,
  selected = [],
  correct,
  selectedLabel = 'Selected',
  showCorrect = true,
  className,
}: {
  rows: GridRow[]
  columns: QuestionOption[]
  selected?: string[]
  correct: string[]
  selectedLabel?: string
  showCorrect?: boolean
  className?: string
}) {
  const selectedMap = gridPairMap(selected)
  const correctMap = gridPairMap(correct)

  return (
    <div className={cn('overflow-x-auto rounded-xl border border-slate-200', className)}>
      <table className="w-full min-w-[420px] border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50/80">
            <th className="border-b border-slate-200 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Row
            </th>
            {columns.map((column, columnIndex) => (
              <th
                key={column.id}
                className="border-b border-l border-slate-200 px-2 py-2 text-center text-xs font-semibold text-slate-700"
              >
                {column.text.trim() || `Column ${columnIndex + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.id} className="align-top">
              <th
                scope="row"
                className="border-b border-slate-100 px-3 py-2.5 text-left text-sm font-medium text-slate-800 last:border-b-0"
              >
                <span className="mr-1.5 text-xs font-semibold text-slate-400">
                  {String.fromCharCode(97 + rowIndex)})
                </span>
                {row.text}
              </th>
              {columns.map((column) => {
                const isSelected = selectedMap.get(row.id) === column.id
                const isCorrect = correctMap.get(row.id) === column.id
                return (
                  <td
                    key={column.id}
                    className={cn(
                      'border-b border-l border-slate-100 px-2 py-2 text-center last:border-b-0',
                      isSelected && isCorrect && 'bg-emerald-50',
                      isSelected && !isCorrect && 'bg-rose-50',
                      !isSelected && isCorrect && showCorrect && 'bg-emerald-50/60',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        isSelected && !isCorrect ? 'text-rose-700' : 'text-emerald-700',
                      )}
                    >
                      {isSelected || (isCorrect && showCorrect) ? (
                        <>
                          {isSelected ? (
                            isCorrect ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <X className="h-3.5 w-3.5" />
                            )
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                          {isSelected ? selectedLabel : 'Correct'}
                        </>
                      ) : null}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
