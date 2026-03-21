import { useState, useEffect, useRef } from 'react'
import { completionsApi } from '@/lib/api'
import { ApiError } from '@/lib/api'
import { toDateString, fromDateString } from '@/lib/utils'
import { toast } from '@/lib/hooks/use-toast'
import type { Task, CompletionWithTask, ActiveTimer } from '@/lib/types'
import {
  useTasks, useCalendar, useActiveTimers,
  useStartTimer, useStopTimer, useDiscardTimer,
} from '@/lib/hooks/use-queries'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Plus, Play, Square, X, Check, Timer, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import MiniCalendar from '@/components/MiniCalendar'
import { tasksApi } from '@/lib/api'

function fullDateLabel(date: string): string {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

const WEEKDAYS = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 7 },
]

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

// ─── Binary Task Card ─────────────────────────────────────────────────────────

function TaskCard({
  task,
  completion,
  onToggle,
}: {
  task: Task
  completion: CompletionWithTask | undefined
  onToggle: (task: Task, completion: CompletionWithTask | undefined) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [dataText, setDataText] = useState(completion?.data_text ?? '')
  const [dataNumber, setDataNumber] = useState<string>(
    completion?.data_number != null ? String(completion.data_number) : ''
  )
  const [saving, setSaving] = useState(false)

  const isCompleted = !!completion

  async function handleCheck() {
    if (task.data_type !== 'none' && !isCompleted) {
      setExpanded(true)
      return
    }
    onToggle(task, completion)
  }

  async function handleDataSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await onToggle(task, completion)
      setExpanded(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="rounded-lg border bg-card overflow-hidden transition-all"
      style={{ borderLeftWidth: 4, borderLeftColor: task.color }}
    >
      <div className="flex items-center gap-3 px-4 py-3 min-h-[56px]">
        <div className="flex-1 min-w-0">
          <span className={cn('text-sm font-medium transition-colors', isCompleted && 'line-through text-muted-foreground')}>
            {task.name}
          </span>
          {task.frequency_type === 'weekly' && task.frequency_days && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {WEEKDAYS.filter(d => task.frequency_days!.includes(d.value)).map(d => d.label).join(', ')}
            </p>
          )}
        </div>
        <button
          onClick={handleCheck}
          className={cn(
            'w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all duration-200',
            isCompleted ? 'border-transparent text-white scale-110' : 'border-muted-foreground/40 hover:border-primary'
          )}
          style={isCompleted ? { backgroundColor: task.color } : {}}
          aria-label={isCompleted ? 'Mark incomplete' : 'Mark complete'}
        >
          {isCompleted && <Check className="h-4 w-4" />}
        </button>
      </div>

      {expanded && !isCompleted && (
        <form onSubmit={handleDataSubmit} className="border-t px-4 pb-3 pt-2 bg-muted/30 flex flex-col gap-2">
          {(task.data_type === 'text' || task.data_type === 'both') && (
            <Input
              placeholder={task.data_label ?? 'Add a note...'}
              value={dataText}
              onChange={e => setDataText(e.target.value)}
              maxLength={500}
              className="font-mono text-sm"
            />
          )}
          {(task.data_type === 'number' || task.data_type === 'both') && (
            <Input
              type="number"
              placeholder={task.data_label ?? 'Enter value...'}
              value={dataNumber}
              onChange={e => setDataNumber(e.target.value)}
              className="font-mono text-sm"
            />
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving} className="flex-1">
              {saving ? 'Saving...' : 'Complete'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

// ─── Timer Task Card ──────────────────────────────────────────────────────────

function TimerTaskCard({
  task,
  completion,
  activeTimer,
  isToday,
  onStart,
  onStop,
  onDiscard,
}: {
  task: Task
  completion: CompletionWithTask | undefined
  activeTimer: ActiveTimer | undefined
  isToday: boolean
  onStart: () => void
  onStop: () => void
  onDiscard: () => void
}) {
  const [elapsed, setElapsed] = useState(0)
  const [discardOpen, setDiscardOpen] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!activeTimer) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      setElapsed(0)
      return
    }
    const startMs = new Date(activeTimer.started_at).getTime()
    const tick = () => setElapsed(Math.floor((Date.now() - startMs) / 1000))
    tick()
    intervalRef.current = setInterval(tick, 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [activeTimer])

  const isRunning = !!activeTimer
  const isCountdown = task.tracking_mode === 'countdown'
  const target = task.timer_target_seconds ?? 0
  const remaining = isCountdown ? Math.max(0, target - elapsed) : 0
  const displayTime = isCountdown ? formatDuration(remaining) : formatDuration(elapsed)
  const progress = isCountdown && target > 0 ? Math.min(1, elapsed / target) : null
  const existingDuration = (completion?.duration_seconds ?? 0)

  return (
    <div
      className="rounded-lg border bg-card overflow-hidden transition-all"
      style={{ borderLeftWidth: 4, borderLeftColor: task.color }}
    >
      <div className="flex items-center gap-3 px-4 py-3 min-h-[56px]">
        <div className="flex-1 min-w-0">
          <span className={cn('text-sm font-medium', isRunning && 'text-primary')}>
            {task.name}
          </span>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isRunning
              ? displayTime
              : task.tracking_mode === 'countdown' && target > 0
                ? `Countdown · ${formatDuration(target)}`
                : 'Stopwatch'}
            {existingDuration > 0 && !isRunning && (
              <span className="ml-1 text-green-600">· {formatDuration(existingDuration)} logged</span>
            )}
          </p>
          {isRunning && progress !== null && (
            <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}
          {isRunning && !isCountdown && (
            <div className="mt-1.5 h-0.5 rounded-full bg-primary/30 animate-pulse" />
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {completion && !isRunning && (
            <Timer className="h-4 w-4 text-green-600" />
          )}
          {isToday && !isRunning && (
            <button
              onClick={onStart}
              className="w-8 h-8 rounded-full border-2 border-muted-foreground/40 hover:border-primary flex items-center justify-center transition-colors"
              aria-label="Start timer"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          {isRunning && (
            <>
              <button
                onClick={onStop}
                className="w-8 h-8 rounded-full bg-primary/10 text-primary hover:bg-primary/20 flex items-center justify-center transition-colors"
                aria-label="Stop timer"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setDiscardOpen(true)}
                className="w-8 h-8 rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20 flex items-center justify-center transition-colors"
                aria-label="Discard timer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Discard timer?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {formatDuration(elapsed)} will be lost and no completion will be recorded.
          </p>
          <div className="flex gap-2 mt-2">
            <Button variant="destructive" className="flex-1" onClick={() => { setDiscardOpen(false); onDiscard() }}>
              Discard
            </Button>
            <Button variant="outline" onClick={() => setDiscardOpen(false)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Add Habit Dialog ─────────────────────────────────────────────────────────

function AddHabitDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (task: Task) => void
}) {
  const [name, setName] = useState('')
  const [freqType, setFreqType] = useState<'daily' | 'weekly'>('daily')
  const [freqDays, setFreqDays] = useState<number[]>([])
  const [trackData, setTrackData] = useState(false)
  const [dataType, setDataType] = useState<'text' | 'number' | 'both'>('text')
  const [dataLabel, setDataLabel] = useState('')
  const [trackingMode, setTrackingMode] = useState<'binary' | 'stopwatch' | 'countdown'>('binary')
  const [timerHours, setTimerHours] = useState('')
  const [timerMinutes, setTimerMinutes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()

  function reset() {
    setName(''); setFreqType('daily'); setFreqDays([]); setTrackData(false)
    setDataType('text'); setDataLabel(''); setTrackingMode('binary')
    setTimerHours(''); setTimerMinutes(''); setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Name is required')
    if (freqType === 'weekly' && freqDays.length === 0) return setError('Select at least one day')

    let timer_target_seconds: number | null = null
    if (trackingMode === 'countdown') {
      const h = parseInt(timerHours || '0', 10)
      const m = parseInt(timerMinutes || '0', 10)
      const secs = h * 3600 + m * 60
      if (isNaN(secs) || secs < 10 || secs > 86400) {
        return setError('Countdown must be between 10 seconds and 24 hours')
      }
      timer_target_seconds = secs
    }

    setLoading(true); setError(null)
    try {
      const { task } = await tasksApi.create({
        name: name.trim(),
        frequency_type: freqType,
        frequency_days: freqType === 'weekly' ? freqDays : undefined,
        data_type: trackData ? dataType : 'none',
        data_label: trackData && dataLabel.trim() ? dataLabel.trim() : undefined,
        tracking_mode: trackingMode,
        timer_target_seconds,
      })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      onCreated(task)
      reset()
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create habit')
    } finally {
      setLoading(false)
    }
  }

  function toggleDay(day: number) {
    setFreqDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort())
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); reset() } }}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Habit</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input
              placeholder="e.g. Morning run"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={100}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>Frequency</Label>
            <div className="flex gap-2">
              <Button type="button" variant={freqType === 'daily' ? 'default' : 'outline'} size="sm" onClick={() => setFreqType('daily')} className="flex-1">
                Every day
              </Button>
              <Button type="button" variant={freqType === 'weekly' ? 'default' : 'outline'} size="sm" onClick={() => setFreqType('weekly')} className="flex-1">
                Specific days
              </Button>
            </div>
            {freqType === 'weekly' && (
              <div className="flex gap-1 flex-wrap">
                {WEEKDAYS.map(d => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => toggleDay(d.value)}
                    className={cn(
                      'w-9 h-9 rounded-full text-xs font-medium transition-colors border',
                      freqDays.includes(d.value) ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Tracking</Label>
            <div className="flex gap-1">
              {(['binary', 'stopwatch', 'countdown'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTrackingMode(mode)}
                  className={cn(
                    'flex-1 py-1.5 px-2 rounded text-xs font-medium border transition-colors',
                    trackingMode === mode ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'
                  )}
                >
                  {mode === 'binary' ? 'Done/Not Done' : mode === 'stopwatch' ? 'Stopwatch' : 'Countdown'}
                </button>
              ))}
            </div>
            {trackingMode === 'countdown' && (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  placeholder="0"
                  value={timerHours}
                  onChange={e => setTimerHours(e.target.value)}
                  min={0}
                  max={23}
                  className="w-16 text-center"
                />
                <span className="text-muted-foreground text-sm">h</span>
                <Input
                  type="number"
                  placeholder="30"
                  value={timerMinutes}
                  onChange={e => setTimerMinutes(e.target.value)}
                  min={0}
                  max={59}
                  className="w-16 text-center"
                />
                <span className="text-muted-foreground text-sm">min</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <Label>Track data?</Label>
            <Switch checked={trackData} onCheckedChange={setTrackData} />
          </div>

          {trackData && (
            <div className="space-y-2">
              <Select value={dataType} onValueChange={v => setDataType(v as 'text' | 'number' | 'both')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text note</SelectItem>
                  <SelectItem value="number">Numeric value</SelectItem>
                  <SelectItem value="both">Text + Number</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="Label (e.g. km, pages, reps)"
                value={dataLabel}
                onChange={e => setDataLabel(e.target.value)}
                maxLength={50}
              />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={loading}>
              {loading ? 'Adding...' : 'Add Habit'}
            </Button>
            <Button type="button" variant="outline" onClick={() => { onClose(); reset() }}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const today = toDateString()
  const [selectedDate, setSelectedDate] = useState(today)
  const [calendarMonth, setCalendarMonth] = useState(today.slice(0, 7))
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [completions, setCompletions] = useState<CompletionWithTask[]>([])
  const [completionsLoading, setCompletionsLoading] = useState(true)
  const [showAddHabit, setShowAddHabit] = useState(false)

  const { data: tasksData } = useTasks('all')
  const { data: timersData } = useActiveTimers()
  const { data: calendarData } = useCalendar(calendarMonth)

  const tasks = tasksData?.tasks ?? []
  const activeTimers = timersData?.timers ?? []
  const isToday = selectedDate === today

  const startTimer = useStartTimer()
  const stopTimer = useStopTimer()
  const discardTimer = useDiscardTimer()

  // Auto-stop expired countdown timers on mount / when timers load
  useEffect(() => {
    if (!timersData) return
    for (const timer of timersData.timers) {
      if (timer.tracking_mode === 'countdown' && timer.timer_target_seconds) {
        const elapsed = Math.floor((Date.now() - new Date(timer.started_at).getTime()) / 1000)
        if (elapsed >= timer.timer_target_seconds) {
          stopTimer.mutate(timer.task_id)
        }
      }
    }
  }, [timersData?.timers.map(t => t.id).join(',')])

  function isTaskScheduled(task: Task): boolean {
    if (task.status !== 'active') return false
    if (selectedDate < task.start_date) return false
    if (task.paused_at && selectedDate >= task.paused_at.slice(0, 10)) return false
    if (task.frequency_type === 'weekly' && task.frequency_days) {
      const d = fromDateString(selectedDate)
      const dow = d.getDay() === 0 ? 7 : d.getDay()
      return task.frequency_days.includes(dow)
    }
    return true
  }

  const scheduledTasks = tasks.filter(isTaskScheduled)
  const completionMap = new Map(completions.map(c => [c.task_id, c]))
  const completedCount = scheduledTasks.filter(t => completionMap.has(t.id)).length
  const completionRate = scheduledTasks.length > 0
    ? Math.round((completedCount / scheduledTasks.length) * 100)
    : 0

  useEffect(() => {
    setCompletionsLoading(true)
    completionsApi.list(selectedDate)
      .then(res => setCompletions(res.completions))
      .catch(() => toast({ title: 'Failed to load completions', variant: 'destructive' }))
      .finally(() => setCompletionsLoading(false))
  }, [selectedDate])

  // Sync calendar month when user navigates to a different month date
  useEffect(() => {
    const m = selectedDate.slice(0, 7)
    if (m !== calendarMonth) setCalendarMonth(m)
  }, [selectedDate])

  async function handleToggle(task: Task, completion: CompletionWithTask | undefined) {
    if (completion) {
      setCompletions(prev => prev.filter(c => c.id !== completion.id))
      try {
        await completionsApi.delete(completion.id)
      } catch {
        setCompletions(prev => [...prev, completion])
        toast({ title: 'Failed to undo', variant: 'destructive' })
      }
    } else {
      const tempId = `temp-${Date.now()}`
      const optimistic: CompletionWithTask = {
        id: tempId, task_id: task.id, user_id: '', completed_date: selectedDate,
        completed_at: new Date().toISOString(), data_text: null, data_number: null,
        duration_seconds: null, task,
      }
      setCompletions(prev => [...prev, optimistic])
      try {
        const { completion: created } = await completionsApi.create({ task_id: task.id, date: selectedDate })
        setCompletions(prev => prev.map(c => c.id === tempId ? { ...created, task } : c))
      } catch (err) {
        setCompletions(prev => prev.filter(c => c.id !== tempId))
        const msg = err instanceof ApiError ? err.message : 'Failed to save'
        toast({ title: msg, variant: 'destructive' })
      }
    }
  }

  function goToPrev() {
    const d = fromDateString(selectedDate)
    d.setDate(d.getDate() - 1)
    setSelectedDate(toDateString(d))
  }

  function goToNext() {
    if (isToday) return
    const d = fromDateString(selectedDate)
    d.setDate(d.getDate() + 1)
    setSelectedDate(toDateString(d))
  }

  return (
    <div className="space-y-4">
      {/* Zone 1 — Date header + calendar picker */}
      <div className="rounded-lg border bg-card px-4 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <button
            onClick={goToPrev}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Previous day"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            className="flex-1 text-center font-semibold text-sm hover:text-primary transition-colors"
            onClick={() => setCalendarOpen(v => !v)}
          >
            {fullDateLabel(selectedDate)}
          </button>
          <button
            onClick={goToNext}
            disabled={isToday}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Next day"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        {!isToday && (
          <button
            onClick={() => setSelectedDate(today)}
            className="w-full text-xs text-center text-primary hover:underline"
          >
            ← Back to today
          </button>
        )}

        {scheduledTasks.length > 0 && (
          <p className="text-xs text-center text-muted-foreground">
            {completedCount}/{scheduledTasks.length} · {completionRate}%
          </p>
        )}

        {calendarOpen && (
          <MiniCalendar
            month={calendarMonth}
            onMonthChange={setCalendarMonth}
            selectedDate={selectedDate}
            onDateSelect={(d) => { setSelectedDate(d); setCalendarOpen(false) }}
            calendarData={calendarData ?? null}
          />
        )}
      </div>

      {/* Zone 3 — Task list */}
      <div className="space-y-2">
        {completionsLoading ? (
          <div className="text-center py-12 text-muted-foreground text-sm">Loading...</div>
        ) : scheduledTasks.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-sm">
              {tasks.filter(t => t.status === 'active').length === 0
                ? 'No habits yet! Start building your routine.'
                : 'No habits scheduled for today.'}
            </p>
          </div>
        ) : (
          scheduledTasks.map(task => {
            if (task.tracking_mode !== 'binary') {
              return (
                <TimerTaskCard
                  key={task.id}
                  task={task}
                  completion={completionMap.get(task.id)}
                  activeTimer={activeTimers.find(t => t.task_id === task.id)}
                  isToday={isToday}
                  onStart={() => {
                    startTimer.mutate(task.id, {
                      onError: (err) => toast({ title: err instanceof ApiError ? err.message : 'Failed to start timer', variant: 'destructive' }),
                    })
                  }}
                  onStop={() => {
                    stopTimer.mutate(task.id, {
                      onSuccess: () => {
                        completionsApi.list(selectedDate)
                          .then(res => setCompletions(res.completions))
                          .catch(() => {})
                      },
                      onError: (err) => toast({ title: err instanceof ApiError ? err.message : 'Failed to stop timer', variant: 'destructive' }),
                    })
                  }}
                  onDiscard={() => {
                    discardTimer.mutate(task.id, {
                      onError: (err) => toast({ title: err instanceof ApiError ? err.message : 'Failed to discard timer', variant: 'destructive' }),
                    })
                  }}
                />
              )
            }
            return (
              <TaskCard
                key={task.id}
                task={task}
                completion={completionMap.get(task.id)}
                onToggle={handleToggle}
              />
            )
          })
        )}
      </div>

      {/* Add habit button */}
      <Button onClick={() => setShowAddHabit(true)} variant="outline" className="w-full border-dashed">
        <Plus className="h-4 w-4 mr-2" />
        Add Habit
      </Button>

      <AddHabitDialog
        open={showAddHabit}
        onClose={() => setShowAddHabit(false)}
        onCreated={task => toast({ title: `"${task.name}" added!` })}
      />
    </div>
  )
}
