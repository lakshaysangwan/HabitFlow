import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi, completionsApi, analyticsApi, adminApi } from '@/lib/api'

// ─── Query Keys ───────────────────────────────────────────────────────────────

export const QUERY_KEYS = {
  tasks: (status?: string) => ['tasks', status ?? 'active'] as const,
  completions: (date: string) => ['completions', date] as const,
  analyticsOverview: (range: string) => ['analytics', 'overview', range] as const,
  analyticsHeatmap: (year: number) => ['analytics', 'heatmap', year] as const,
  analyticsTask: (taskId: string, range: string) => ['analytics', 'task', taskId, range] as const,
  adminUser: (userId: string) => ['admin', 'user', userId] as const,
  adminUserAnalytics: (userId: string, range: string) => ['admin', 'user', userId, 'analytics', range] as const,
  adminInviteCodes: () => ['admin', 'invite-codes'] as const,
}

// ─── Query Hooks ──────────────────────────────────────────────────────────────

export function useTasks(status: 'active' | 'paused' | 'archived' | 'all' = 'active') {
  return useQuery({
    queryKey: QUERY_KEYS.tasks(status),
    queryFn: () => tasksApi.list(status),
    staleTime: 5 * 60_000,
  })
}

export function useCompletions(date: string) {
  return useQuery({
    queryKey: QUERY_KEYS.completions(date),
    queryFn: () => completionsApi.list(date),
    staleTime: 30_000,
    enabled: !!date,
  })
}

export function useAnalyticsOverview(range: 'week' | 'month' | 'year' | 'all') {
  return useQuery({
    queryKey: QUERY_KEYS.analyticsOverview(range),
    queryFn: () => analyticsApi.overview(range),
    staleTime: 2 * 60_000,
  })
}

export function useAnalyticsHeatmap(year: number) {
  return useQuery({
    queryKey: QUERY_KEYS.analyticsHeatmap(year),
    queryFn: () => analyticsApi.heatmap(year),
    staleTime: 5 * 60_000,
  })
}

export function useAnalyticsTask(taskId: string, range: 'week' | 'month' | 'year' | 'all') {
  return useQuery({
    queryKey: QUERY_KEYS.analyticsTask(taskId, range),
    queryFn: () => analyticsApi.task(taskId, range),
    staleTime: 2 * 60_000,
    enabled: !!taskId,
  })
}

export function useAdminUser(userId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.adminUser(userId),
    queryFn: () => adminApi.getUser(userId),
    staleTime: 60_000,
    enabled: !!userId,
  })
}

export function useAdminUserAnalytics(userId: string, range: 'week' | 'month' | 'year' | 'all') {
  return useQuery({
    queryKey: QUERY_KEYS.adminUserAnalytics(userId, range),
    queryFn: () => adminApi.getUserAnalytics(userId, range),
    staleTime: 2 * 60_000,
    enabled: !!userId,
  })
}

export function useAdminInviteCodes() {
  return useQuery({
    queryKey: QUERY_KEYS.adminInviteCodes(),
    queryFn: () => adminApi.listInviteCodes(),
    staleTime: 60_000,
  })
}

// ─── Mutation Hooks ───────────────────────────────────────────────────────────

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: tasksApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof tasksApi.update>[1] }) =>
      tasksApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: tasksApi.delete,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function usePauseTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: tasksApi.pause,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useResumeTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: tasksApi.resume,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useReorderTasks() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: tasksApi.reorder,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useCreateCompletion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: completionsApi.create,
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.completions(vars.date) })
    },
  })
}

export function useDeleteCompletion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: completionsApi.delete,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['completions'] })
    },
  })
}

export function useCreateInviteCode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: adminApi.createInviteCode,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.adminInviteCodes() })
    },
  })
}
