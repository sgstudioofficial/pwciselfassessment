import { Badge } from './ui/Misc'
import type {
  AttemptStatus,
  QuestionType,
  StudentAssignmentStatus,
  TestStatus,
} from '../lib/types'

export function TestStatusBadge({ status }: { status: TestStatus }) {
  if (status === 'published') {
    return (
      <Badge tone="green" dot>
        Published
      </Badge>
    )
  }
  if (status === 'archived') {
    return (
      <Badge tone="slate" dot>
        Archived
      </Badge>
    )
  }
  return (
    <Badge tone="amber" dot>
      Draft
    </Badge>
  )
}

export function AttemptStatusBadge({ status }: { status: AttemptStatus }) {
  if (status === 'graded') {
    return <Badge tone="green">Graded</Badge>
  }
  if (status === 'submitted') {
    return <Badge tone="amber">Needs grading</Badge>
  }
  return <Badge tone="blue">In progress</Badge>
}

export function StudentAssignmentBadge({
  status,
}: {
  status: StudentAssignmentStatus
}) {
  switch (status) {
    case 'available':
      return <Badge tone="green" dot>Available</Badge>
    case 'in_progress':
      return <Badge tone="blue" dot>In progress</Badge>
    case 'upcoming':
      return <Badge tone="purple" dot>Scheduled</Badge>
    case 'expired':
      return <Badge tone="rose" dot>Expired</Badge>
    case 'completed':
      return <Badge tone="slate" dot>Completed</Badge>
    default:
      return <Badge tone="slate">Unavailable</Badge>
  }
}

export function QuestionTypeBadge({ type }: { type: QuestionType }) {
  const labels: Record<QuestionType, string> = {
    single_choice: 'Single choice',
    multiple_select: 'Multiple select',
    true_false: 'True / false',
    short_answer: 'Short answer',
    grid: 'Grid',
  }
  const tones: Record<
    QuestionType,
    'brand' | 'blue' | 'purple' | 'amber' | 'slate'
  > = {
    single_choice: 'brand',
    multiple_select: 'blue',
    true_false: 'purple',
    short_answer: 'amber',
    grid: 'slate',
  }
  return <Badge tone={tones[type]}>{labels[type]}</Badge>
}
