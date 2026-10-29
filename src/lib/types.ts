export type UserRole = 'admin' | 'student' | 'evaluator'
/** Roles that can open the staff workspace and read results. */
export type StaffRole = 'admin' | 'evaluator'
export type TestStatus = 'draft' | 'published' | 'archived'
export type QuestionType =
  | 'single_choice'
  | 'multiple_select'
  | 'true_false'
  | 'short_answer'
  | 'grid'
export type AttemptStatus = 'in_progress' | 'submitted' | 'graded'

export interface Profile {
  id: string
  email: string
  username: string | null
  full_name: string
  role: UserRole
  is_active: boolean
  must_change_password: boolean
  department: string | null
  batch: string | null
  created_at: string
  updated_at: string
}

export interface Test {
  id: string
  title: string
  description: string | null
  instructions: string | null
  duration_minutes: number | null
  max_marks: number
  passing_marks: number
  attempt_limit: number
  start_at: string | null
  end_at: string | null
  status: TestStatus
  show_results: boolean
  created_by: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

export interface Section {
  id: string
  test_id: string
  title: string
  description: string | null
  position: number
  created_at: string
  updated_at: string
}

export interface QuestionOption {
  id: string
  text: string
  /** Optional image stored in the `question-images` bucket. */
  image_path?: string | null
}

/** A row in a grid (matrix) question. Columns are stored in `options`. */
export interface GridRow {
  id: string
  text: string
}

export interface Question {
  id: string
  section_id: string
  question_type: QuestionType
  prompt: string
  image_path: string | null
  marks: number
  is_required: boolean
  options: QuestionOption[]
  correct_options: string[]
  answer_key: string | null
  /** Additional accepted short answers; empty for every other type. */
  answer_aliases: string[]
  explanation: string | null
  /** Rows of a grid question; always empty for other question types. */
  grid_rows: GridRow[]
  position: number
  created_at: string
  updated_at: string
}

export interface TestAssignment {
  id: string
  test_id: string
  student_id: string
  assigned_by: string | null
  due_at: string | null
  attempt_limit: number | null
  created_at: string
  updated_at: string
}

export type AnswerFeedbackMode = 'after_submit' | 'immediate'

export interface Attempt {
  id: string
  assignment_id: string
  test_id: string
  student_id: string
  attempt_number: number
  status: AttemptStatus
  max_marks: number
  score: number | null
  started_at: string
  submitted_at: string | null
  graded_at: string | null
  time_taken_seconds: number | null
  due_at: string | null
  feedback_mode: AnswerFeedbackMode
  created_at: string
  updated_at: string
}

export interface ResponseRow {
  id: string
  attempt_id: string
  question_id: string
  selected_options: string[]
  text_answer: string | null
  is_flagged: boolean
  awarded_marks: number | null
  is_correct: boolean | null
  graded_by: string | null
  graded_at: string | null
  answered_at: string
  created_at: string
  updated_at: string
}

/* ------------------------------------------------------------------------- */
/* RPC payloads                                                              */
/* ------------------------------------------------------------------------- */

export interface DashboardStats {
  active_students: number
  total_students: number
  total_tests: number
  published_tests: number
  completed_attempts: number
  in_progress_attempts: number
  pending_review: number
  pending_assignments: number
  recent_submissions: RecentSubmission[]
}

export interface RecentSubmission {
  attempt_id: string
  student_id: string
  student_name: string
  username: string | null
  test_id: string
  test_title: string
  status: AttemptStatus
  score: number | null
  max_marks: number
  submitted_at: string
}

export type StudentAssignmentStatus =
  | 'available'
  | 'upcoming'
  | 'expired'
  | 'in_progress'
  | 'completed'
  | 'unavailable'

export interface StudentAssignment {
  assignment_id: string
  test_id: string
  title: string
  description: string | null
  instructions: string | null
  duration_minutes: number | null
  max_marks: number
  passing_marks: number
  attempt_limit: number
  attempts_used: number
  submitted_count: number
  open_attempt_id: string | null
  last_attempt: {
    attempt_id: string
    score: number | null
    max_marks: number
    status: AttemptStatus
    submitted_at: string
    attempt_number: number
  } | null
  start_at: string | null
  end_at: string | null
  due_at: string | null
  show_results: boolean
  published: boolean
  can_start: boolean
  status: StudentAssignmentStatus
}

export interface StudentDashboardData {
  server_now: string
  assignments: StudentAssignment[]
}

export interface AttemptQuestion {
  id: string
  question_type: QuestionType
  prompt: string
  image_path: string | null
  marks: number
  is_required: boolean
  options: QuestionOption[]
  /** Grid rows; empty for every other question type. */
  rows: GridRow[]
  position: number
}

export interface AttemptSection {
  id: string
  title: string
  description: string | null
  position: number
  questions: AttemptQuestion[]
}

export interface AttemptFeedback {
  question_id: string
  is_correct: boolean | null
  awarded_marks: number | null
  marks: number
  correct_options: string[]
  answer_key: string | null
  explanation: string | null
  checked_at?: string | null
  check_attempts?: number
}

export interface AttemptAnswerState {
  question_id: string
  selected_options: string[]
  text_answer: string | null
  is_flagged: boolean
  answered_at: string
  awarded_marks?: number | null
  is_correct?: boolean | null
  graded_at?: string | null
  checked_at?: string | null
  check_attempts?: number
  feedback?: AttemptFeedback | null
}

export interface AttemptState {
  server_now: string
  attempt: {
    id: string
    status: AttemptStatus
    score: number | null
    max_marks: number
    started_at: string
    submitted_at: string | null
    time_taken_seconds: number | null
    attempt_number: number
    deadline_at: string | null
    seconds_remaining: number | null
    feedback_mode: AnswerFeedbackMode
  }
  test: {
    id: string
    title: string
    description: string | null
    instructions: string | null
    duration_minutes: number | null
    show_results: boolean
  }
  sections: AttemptSection[]
  responses: AttemptAnswerState[]
}

export interface MyResult {
  attempt_id: string
  test_id: string
  test_title: string
  attempt_number: number
  status: AttemptStatus
  score: number | null
  max_marks: number
  passing_marks: number
  submitted_at: string
  time_taken_seconds: number | null
  show_results: boolean
  needs_grading: boolean
}

export interface MyResultsData {
  results: MyResult[]
}

export interface ReviewQuestion extends AttemptQuestion {
  correct_options: string[]
  answer_key: string | null
  answer_aliases: string[]
  explanation: string | null
  response: {
    id: string
    selected_options: string[]
    text_answer: string | null
    awarded_marks: number | null
    is_correct: boolean | null
    is_flagged: boolean
    graded_at: string | null
    checked_at?: string | null
    check_attempts?: number
  } | null
}

export interface ReviewSection {
  id: string
  title: string
  description: string | null
  position: number
  max_marks: number
  score: number
  questions: ReviewQuestion[]
}

export interface AttemptReview {
  allowed: boolean
  attempt: {
    id: string
    status: AttemptStatus
    score?: number | null
    max_marks?: number
    started_at?: string
    submitted_at: string | null
    time_taken_seconds?: number | null
    attempt_number: number
  }
  test: {
    id: string
    title: string
    description?: string | null
    passing_marks?: number
    show_results?: boolean
  }
  sections?: ReviewSection[]
  totals?: {
    score: number
    max_marks: number
    pending_manual: number
    passed: boolean
  }
}

export interface AdminAttemptDetail {
  attempt: {
    id: string
    attempt_number: number
    status: AttemptStatus
    score: number | null
    max_marks: number
    started_at: string
    submitted_at: string | null
    graded_at: string | null
    time_taken_seconds: number | null
  }
  student: {
    id: string
    full_name: string
    username: string | null
    email: string
    department: string | null
    batch: string | null
  }
  test: {
    id: string
    title: string
    description: string | null
    instructions: string | null
    passing_marks: number
    attempt_limit: number
  }
  sections: (ReviewSection & { questions: ReviewQuestion[] })[]
  totals: {
    score: number
    max_marks: number
    pending_manual: number
    passed: boolean
  }
}

/* ------------------------------------------------------------------------- */
/* Nested query helpers used by admin screens                                */
/* ------------------------------------------------------------------------- */

export interface TestWithStructure extends Test {
  sections: (Section & { questions: Question[] })[]
}

export interface TestListRow extends Test {
  sections: { id: string; questions: { id: string }[] }[]
  attempts?: { count: number }[]
}

export interface AssignmentListRow extends TestAssignment {
  tests: Pick<
    Test,
    'id' | 'title' | 'status' | 'duration_minutes' | 'max_marks' | 'attempt_limit'
  > | null
  profiles: Pick<
    Profile,
    'id' | 'full_name' | 'username' | 'is_active' | 'department' | 'batch'
  > | null
  attempts: Pick<
    Attempt,
    'id' | 'status' | 'submitted_at' | 'score' | 'attempt_number'
  >[]
}

export interface ResultListRow extends Attempt {
  tests: Pick<
    Test,
    'id' | 'title' | 'passing_marks' | 'show_results' | 'attempt_limit'
  > | null
  profiles: Pick<
    Profile,
    'id' | 'full_name' | 'username' | 'department' | 'batch'
  > | null
}
