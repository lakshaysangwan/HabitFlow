import type {
  User,
  Task,
  Completion,
  CompletionWithTask,
  InviteCode,
  DailyAnalytics,
  TaskAnalytics,
  OverviewAnalytics,
  HeatmapData,
  ActiveTimer,
  CalendarData,
  ApiResult,
} from './types'

class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  })

  const json: ApiResult<T> = await res.json()

  if (!json.ok) {
    throw new ApiError(json.error.code, json.error.message)
  }

  return json.data
}

// Auth
export const authApi = {
  login: (data: { username: string; password: string; invite_code?: string }) =>
    request<{ user: User }>('POST', '/api/auth/login', data),

  logout: () => request<void>('POST', '/api/auth/logout'),

  me: () => request<{ user: User }>('GET', '/api/auth/me'),

  changePassword: (data: { old_password: string; new_password: string; confirm_password: string }) =>
    request<void>('PATCH', '/api/auth/password', data),

  updateProfile: (data: { display_name?: string; timezone?: string }) =>
    request<{ user: User }>('PATCH', '/api/auth/profile', data),
}

// Tasks
export const tasksApi = {
  list: (status?: 'active' | 'paused' | 'archived' | 'all') =>
    request<{ tasks: Task[] }>('GET', `/api/tasks${status ? `?status=${status}` : ''}`),

  create: (data: {
    name: string
    frequency_type: 'daily' | 'weekly'
    frequency_days?: number[]
    data_type?: 'none' | 'text' | 'number' | 'both'
    data_label?: string
    tracking_mode?: 'binary' | 'stopwatch' | 'countdown'
    timer_target_seconds?: number | null
  }) => request<{ task: Task }>('POST', '/api/tasks', data),

  update: (id: string, data: Partial<Task>) =>
    request<{ task: Task }>('PATCH', `/api/tasks/${id}`, data),

  delete: (id: string) => request<void>('DELETE', `/api/tasks/${id}`),

  pause: (id: string) => request<{ task: Task }>('PATCH', `/api/tasks/${id}/pause`),

  resume: (id: string) => request<{ task: Task }>('PATCH', `/api/tasks/${id}/resume`),

  reorder: (task_ids: string[]) => request<void>('PUT', '/api/tasks/reorder', { task_ids }),
}

// Completions
export const completionsApi = {
  list: (date: string) =>
    request<{ completions: CompletionWithTask[] }>('GET', `/api/completions?date=${date}`),

  create: (data: {
    task_id: string
    date: string
    data_text?: string
    data_number?: number
  }) => request<{ completion: Completion }>('POST', '/api/completions', data),

  delete: (id: string) => request<void>('DELETE', `/api/completions/${id}`),
}

// Analytics
export const analyticsApi = {
  daily: (date: string) =>
    request<DailyAnalytics>('GET', `/api/analytics/daily?date=${date}`),

  task: (id: string, range: 'week' | 'month' | 'year' | 'all') =>
    request<TaskAnalytics>('GET', `/api/analytics/task/${id}?range=${range}`),

  overview: (range: 'week' | 'month' | 'year' | 'all') =>
    request<OverviewAnalytics>('GET', `/api/analytics/overview?range=${range}`),

  heatmap: (year: number) =>
    request<HeatmapData>('GET', `/api/analytics/heatmap?year=${year}`),

  calendar: (month: string) =>
    request<CalendarData>('GET', `/api/analytics/calendar?month=${month}`),
}

// Timers
export const timersApi = {
  active: () =>
    request<{ timers: ActiveTimer[] }>('GET', '/api/timers/active'),

  start: (task_id: string) =>
    request<{ timer: ActiveTimer }>('POST', '/api/timers/start', { task_id }),

  stop: (task_id: string) =>
    request<{ completion: { id: string; duration_seconds: number; completed_date: string }; needs_data_input: boolean }>('POST', '/api/timers/stop', { task_id }),

  discard: (task_id: string) =>
    request<{ ok: true }>('POST', '/api/timers/discard', { task_id }),
}

// Admin / God Mode
export const adminApi = {
  searchUsers: (params: { search?: string; page?: number; limit?: number }) => {
    const q = new URLSearchParams()
    if (params.search) q.set('search', params.search)
    if (params.page) q.set('page', String(params.page))
    if (params.limit) q.set('limit', String(params.limit))
    return request<{ users: User[]; total: number }>('GET', `/api/admin/users?${q}`)
  },

  getUser: (id: string) =>
    request<{ user: User; tasks: Task[] }>('GET', `/api/admin/users/${id}`),

  getUserAnalytics: (id: string, range: 'week' | 'month' | 'year' | 'all') =>
    request<OverviewAnalytics>('GET', `/api/admin/users/${id}/analytics?range=${range}`),

  resetUserPassword: (id: string, new_password: string) =>
    request<void>('PATCH', `/api/admin/users/${id}/password`, { new_password }),

  createInviteCode: (data: { code: string; max_uses: number }) =>
    request<{ invite_code: InviteCode }>('POST', '/api/admin/invite-codes', data),

  listInviteCodes: () =>
    request<{ invite_codes: InviteCode[] }>('GET', '/api/admin/invite-codes'),
}

export { ApiError }
