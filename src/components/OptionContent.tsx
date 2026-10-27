import { publicImageUrl } from '../lib/supabase'
import type { QuestionOption } from '../lib/types'
import { cn } from '../lib/cn'

/**
 * Renders an answer option's text and/or image. Options may be text-only,
 * image-only, or a combination of both.
 */
export function OptionContent({
  option,
  label,
  className,
  imageClassName,
}: {
  option: QuestionOption
  label?: string
  className?: string
  imageClassName?: string
}) {
  const imageUrl = publicImageUrl(option.image_path)
  const hasText = option.text.trim().length > 0
  const alt = label ? `Option ${label} image` : 'Answer option image'

  if (!hasText && !imageUrl) {
    return <span className={cn('italic text-slate-400', className)}>Empty option</span>
  }

  return (
    <span className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {hasText ? <span>{option.text}</span> : null}
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={alt}
          className={cn(
            'max-h-40 max-w-full rounded-lg border border-slate-200 bg-white object-contain',
            imageClassName,
          )}
        />
      ) : null}
    </span>
  )
}
