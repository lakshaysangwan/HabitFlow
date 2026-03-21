// Shared types between frontend and API

export interface User {
  id: string
  username: string
  display_name: string
  timezone: string
  is_god: number
  theme: string
  created_at: string
}

export interface Task {
  id: string
  user_id: string
  name: string
  color: string
  frequency_type: 'daily' | 'weekly'
  frequency_days: number[] | null
  data_type: 'none' | 'text' | 'number' | 'both'
  data_label: string | null
  status: 'active' | 'paused' | 'archived'
  sort_order: number
  start_date: string
  paused_at: string | null
  tracking_mode: 'binary' | 'stopwatch' | 'countdown'
  timer_target_seconds: number | null
  created_at: string
  updated_at: string
}

export interface Completion {
  id: string
  task_id: string
  user_id: string
  completed_date: string
  completed_at: string
  data_text: string | null
  data_number: number | null
  duration_seconds: number | null
  is_finalized: number // 0 | 1 — set by /timers/done, locks the row
}

export interface CompletionWithTask extends Completion {
  task: Task
}

export interface InviteCode {
  id: string
  code: string
  max_uses: number
  current_uses: number
  created_by: string | null
  created_at: string
}

export interface ApiResponse<T> {
  ok: true
  data: T
}

export interface ApiError {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type ApiResult<T> = ApiResponse<T> | ApiError

// Analytics types
export interface DailyAnalytics {
  date: string
  total: number
  completed: number
  rate: number
  tasks: Array<{
    task_id: string
    task_name: string
    task_color: string
    completed: boolean
    completion_id: string | null
  }>
}

export interface TaskAnalytics {
  task: Task
  range: string
  total_scheduled: number
  total_completed: number
  completion_rate: number
  current_streak: number
  best_streak: number
  data_points: Array<{
    date: string
    scheduled: boolean
    completed: boolean
    data_text: string | null
    data_number: number | null
    duration_seconds: number | null
    is_finalized: number | null // 0 | 1 | null (null = no completion)
  }>
}

export interface OverviewAnalytics {
  range: string
  daily_rates: Array<{ date: string; rate: number; completed: number; total: number }>
  current_streak: number
  best_streak: number
  total_completions: number
  avg_daily_rate: number
  task_breakdown: Array<{
    task_id: string
    task_name: string
    task_color: string
    completion_rate: number
    total_completed: number
  }>
}

export interface HeatmapData {
  year: number
  days: Array<{ date: string; count: number; total: number }>
}

export interface ActiveTimer {
  id: string
  task_id: string
  task_name: string
  task_color: string
  tracking_mode: 'stopwatch' | 'countdown'
  timer_target_seconds: number | null
  target_override_seconds: number | null
  started_at: string | null  // null = paused
  accumulated_seconds: number
  logical_date: string        // YYYY-MM-DD in user TZ at creation
  orphaned: boolean           // logical_date ≠ today_in_user_tz
}

export interface CalendarDay {
  date: string
  completed: number
  total: number
  ratio: number | null
}

export interface CalendarData {
  month: string
  days: CalendarDay[]
}
