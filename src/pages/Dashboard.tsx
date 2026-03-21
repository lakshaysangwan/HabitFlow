import { useState, useEffect, useRef } from 'react'
import { completionsApi } from '@/lib/api'
import { ApiError } from '@/lib/api'
import { toDateString, fromDateString } from '@/lib/utils'
import { toast } from '@/lib/hooks/use-toast'
import type { Task, CompletionWithTask, ActiveTimer } from '@/lib/types'
import {
  useTasks, useCalendar, useActiveTimers,
  useStartTimer, usePauseTimer, useResumeTimer, useDoneTimer, useDiscardTimer,
} from '@/lib/hooks/use-queries'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Plus, Play, Pause, X, Check, Timer, ChevronLeft, ChevronRight, Lock, AlertTriangle } from 'lucide-react'
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

// MM:SS or H:MM:SS clock display. Negative values shown as +MM:SS (past zero).
function formatTimer(totalSeconds: number): { display: string; pastZero: boolean } {
  const pastZero = totalSeconds < 0
  const abs = Math.abs(totalSeconds)
  const h = Math.floor(abs / 3600)
  const m = Math.floor((abs % 3600) / 60)
  const s = abs % 60
  const prefix = pastZero ? '+' : ''
  const display = h > 0
    ? `${prefix}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${prefix}${m}:${String(s).padStart(2, '0')}`
  return { display, pastZero }
}

// ─── Binary Task Card ─────────────────────────────────────────────────────────

function TaskCard({
  task,
  completion,
  onToggle,
}: {
  task: Task
  completion: CompletionWithTask | undefined
  onToggle: (task: Task, completion: CompletionWithTask | undefined, data?: { data_text?: string; data_number?: number }) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [dataText, setDataText] = useState(completion?.data_text ?? '')
  const [dataNumber, setDataNumber] = useState<string>(
    completion?.data_number != null ? String(completion.data_number) : ''
  )
  const [saving, setSaving] = useState(false)

  const isCompleted = !!completion
  const hasTrackedData = task.data_type !== 'none'

  function handleRowClick() {
    // Completed task with data — tap to reveal recorded data
    if (isCompleted && hasTrackedData) {
      setExpanded(v => !v)
      return
    }
    // Incomplete task with data tracking — tap to open entry form
    if (!isCompleted && hasTrackedData) {
      setExpanded(v => !v)
      return
    }
  }

  async function handleCheck(e: React.MouseEvent) {
    e.stopPropagation()
    if (hasTrackedData && !isCompleted) {
      setExpanded(true)
      return
    }
    onToggle(task, completion)
  }

  async function handleDataSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const data: { data_text?: string; data_number?: number } = {}
      if (dataText.trim()) data.data_text = dataText.trim()
      if (dataNumber !== '') data.data_number = parseFloat(dataNumber)
      onToggle(task, undefined, Object.keys(data).length > 0 ? data : undefined)
      setExpanded(false)
    } finally {
      setSaving(false)
    }
  }

  const expandable = expanded

  return (
    <div
      className="rounded-lg border bg-card overflow-hidden"
      style={{ borderLeftWidth: 4, borderLeftColor: task.color }}
    >
      <div
        className={cn(
          'flex items-center gap-3 px-4 py-3 min-h-[56px]',
          hasTrackedData && 'cursor-pointer select-none',
        )}
        onClick={handleRowClick}
      >
        <div className="flex-1 min-w-0">
          <span className={cn('text-sm font-medium transition-colors', isCompleted && 'line-through text-muted-foreground')}>
            {task.name}
          </span>
          {task.frequency_type === 'weekly' && task.frequency_days && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {WEEKDAYS.filter(d => task.frequency_days!.includes(d.value)).map(d => d.label).join(', ')}
            </p>
          )}
          {isCompleted && hasTrackedData && (completion?.data_text || completion?.data_number != null) && !expanded && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {[completion.data_text, completion.data_number != null ? String(completion.data_number) : null].filter(Boolean).join(' · ')}
              <span className="ml-1 opacity-50">· tap to view</span>
            </p>
          )}
        </div>
        <button
          onClick={handleCheck}
          className={cn(
            'w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all duration-200 shrink-0',
            isCompleted ? 'border-transparent text-white scale-110' : 'border-muted-foreground/40 hover:border-primary'
          )}
          style={isCompleted ? { backgroundColor: task.color } : {}}
          aria-label={isCompleted ? 'Mark incomplete' : 'Mark complete'}
        >
          {isCompleted && <Check className="h-4 w-4" />}
        </button>
      </div>

      {/* Animated expand section */}
      {hasTrackedData && (
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-in-out"
          style={{ gridTemplateRows: expandable ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            {isCompleted ? (
              // Show recorded data (read-only)
              <div className="border-t px-4 pb-3 pt-2 bg-muted/20 space-y-1">
                {completion?.data_text && (
                  <p className="text-sm text-foreground">{completion.data_text}</p>
                )}
                {completion?.data_number != null && (
                  <p className="text-sm font-mono text-foreground">
                    {completion.data_number}{task.data_label ? ` ${task.data_label}` : ''}
                  </p>
                )}
                {!completion?.data_text && completion?.data_number == null && (
                  <p className="text-xs text-muted-foreground italic">No data recorded</p>
                )}
              </div>
            ) : (
              // Data entry form
              <form onSubmit={handleDataSubmit} className="border-t px-4 pb-3 pt-2 bg-muted/30 flex flex-col gap-2">
                {(task.data_type === 'text' || task.data_type === 'both') && (
                  <Input
                    placeholder={task.data_label ?? 'Add a note...'}
                    value={dataText}
                    onChange={e => setDataText(e.target.value)}
                    maxLength={500}
                    className="text-sm"
                  />
                )}
                {(task.data_type === 'number' || task.data_type === 'both') && (
                  <Input
                    type="number"
                    placeholder={task.data_label ?? 'Enter value...'}
                    value={dataNumber}
                    onChange={e => setDataNumber(e.target.value)}
                    className="text-sm"
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
        </div>
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
  onPause,
  onResume,
  onDone,
  onDiscard,
}: {
  task: Task
  completion: CompletionWithTask | undefined
  activeTimer: ActiveTimer | undefined
  isToday: boolean
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onDone: (data?: { data_text?: string; data_number?: number }) => void
  onDiscard: () => void
}) {
  const [liveElapsed, setLiveElapsed] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [doneFormOpen, setDoneFormOpen] = useState(false)
  const [doneDataText, setDoneDataText] = useState('')
  const [doneDataNumber, setDoneDataNumber] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isRunning = !!activeTimer && activeTimer.started_at !== null
  const isPaused = !!activeTimer && activeTimer.started_at === null

  // Collapse when timer state changes (resumed or discarded)
  useEffect(() => {
    if (!isPaused) setExpanded(false)
  }, [isPaused])
  const isFinalized = completion?.is_finalized === 1
  const isOrphaned = activeTimer?.orphaned ?? false

  // Live tick only when running
  useEffect(() => {
    if (!activeTimer || !activeTimer.started_at) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      setLiveElapsed(0)
      return
    }
    const startMs = new Date(activeTimer.started_at).getTime()
    const tick = () => setLiveElapsed(Math.floor((Date.now() - startMs) / 1000))
    tick()
    intervalRef.current = setInterval(tick, 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [activeTimer?.started_at])

  // Total elapsed = accumulated (from past pauses) + live (current session)
  const accumulated = activeTimer?.accumulated_seconds ?? 0
  const totalElapsed = isRunning ? accumulated + liveElapsed : accumulated

  const isCountdown = task.tracking_mode === 'countdown'
  const effectiveTarget = activeTimer?.target_override_seconds ?? task.timer_target_seconds ?? 0
  // For countdown: remaining = target - totalElapsed. Negative = past zero.
  const countdownRemaining = isCountdown ? effectiveTarget - totalElapsed : 0
  const { display: timerDisplay, pastZero } = isCountdown
    ? formatTimer(countdownRemaining)
    : formatTimer(totalElapsed)

  const progress = isCountdown && effectiveTarget > 0
    ? Math.min(1, totalElapsed / effectiveTarget)
    : null

  const existingDuration = completion?.duration_seconds ?? 0

  function handleDoneClick() {
    if (task.data_type !== 'none') {
      setDoneFormOpen(true)
    } else {
      onDone()
    }
  }

  function handleDoneSubmit(e: React.FormEvent) {
    e.preventDefault()
    const data: { data_text?: string; data_number?: number } = {}
    if (doneDataText.trim()) data.data_text = doneDataText.trim()
    if (doneDataNumber !== '') data.data_number = parseFloat(doneDataNumber)
    setDoneFormOpen(false)
    onDone(Object.keys(data).length > 0 ? data : undefined)
  }

  // ── Finalized (locked) ───────────────────────────────────────────────────
  if (isFinalized) {
    return (
      <div
        className="rounded-lg border bg-card overflow-hidden opacity-75"
        style={{ borderLeftWidth: 4, borderLeftColor: task.color }}
      >
        <div className="flex items-center gap-3 px-4 py-3 min-h-[56px]">
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium line-through text-muted-foreground">{task.name}</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatDuration(existingDuration)} · {isCountdown ? `Countdown ${formatDuration(effectiveTarget)}` : 'Stopwatch'}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-green-600 shrink-0">
            <Timer className="h-4 w-4" />
            <Lock className="h-3.5 w-3.5" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'rounded-lg border bg-card overflow-hidden transition-all',
        isRunning && 'shadow-sm',
        isOrphaned && 'border-amber-400/50',
      )}
      style={{ borderLeftWidth: 4, borderLeftColor: task.color }}
    >
      {/* Orphaned warning */}
      {isOrphaned && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <span className="text-xs text-amber-700 dark:text-amber-400 flex-1">
            Timer from {activeTimer?.logical_date} — this day is locked
          </span>
          <button
            onClick={() => setDiscardOpen(true)}
            className="text-xs text-destructive hover:underline shrink-0"
          >
            Discard
          </button>
        </div>
      )}

      <div
        className={cn('flex items-center gap-3 px-4 py-3 min-h-[56px]', isPaused && !isOrphaned && 'cursor-pointer select-none')}
        onClick={isPaused && !isOrphaned ? () => setExpanded(v => !v) : undefined}
      >
        <div className="flex-1 min-w-0">
          <span className={cn('text-sm font-medium', isRunning && !isOrphaned && 'text-primary')}>
            {task.name}
          </span>
          <p className="text-xs text-muted-foreground mt-0.5">
            {activeTimer ? (
              pastZero ? (
                <span className="text-amber-500" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{timerDisplay}</span>
              ) : (
                <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{timerDisplay}</span>
              )
            ) : isCountdown && effectiveTarget > 0 ? (
              `Countdown · ${formatDuration(effectiveTarget)}`
            ) : (
              'Stopwatch'
            )}
            {pastZero && <span className="ml-1 text-amber-500">· Time's up!</span>}
            {existingDuration > 0 && !activeTimer && (
              <span className="ml-1 text-green-600">· {formatDuration(existingDuration)} logged</span>
            )}
          </p>
          {/* Progress bar — countdown running */}
          {isRunning && isCountdown && progress !== null && (
            <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', pastZero ? 'bg-amber-500' : 'bg-primary')}
                style={{ width: `${Math.min(1, progress) * 100}%` }}
              />
            </div>
          )}
          {/* Pulse bar — stopwatch running */}
          {isRunning && !isCountdown && (
            <div className="mt-1.5 h-0.5 rounded-full bg-primary/30 animate-pulse" />
          )}
          {/* Paused indicator */}
          {isPaused && !isOrphaned && (
            <p className="text-xs text-amber-500 mt-0.5">
              Paused {!expanded && <span className="text-muted-foreground">· tap to expand</span>}
            </p>
          )}
        </div>

        {/* Running: single ⏸ */}
        {isRunning && !isOrphaned && (
          <button
            onClick={onPause}
            className="w-8 h-8 rounded-full bg-primary/10 text-primary hover:bg-primary/20 flex items-center justify-center transition-colors shrink-0"
            aria-label="Pause timer"
          >
            <Pause className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Idle (no timer, not finalized): Play */}
        {!activeTimer && isToday && (
          <button
            onClick={onStart}
            className="w-8 h-8 rounded-full border-2 border-muted-foreground/40 hover:border-primary flex items-center justify-center transition-colors shrink-0"
            aria-label="Start timer"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
        )}
        {!activeTimer && !isToday && completion && (
          <Timer className="h-4 w-4 text-green-600 shrink-0" />
        )}
      </div>

      {/* Paused controls: Resume | Done | Discard — expand on tap */}
      {isPaused && !isOrphaned && (
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-in-out"
          style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <div className="border-t px-4 pb-3 pt-2 bg-muted/20 flex gap-2">
              <Button size="sm" variant="outline" className="flex-1 gap-1.5" onClick={(e) => { e.stopPropagation(); onResume() }}>
                <Play className="h-3 w-3" />
                Resume
              </Button>
              <Button size="sm" className="flex-1 gap-1.5" onClick={(e) => { e.stopPropagation(); handleDoneClick() }}>
                <Check className="h-3 w-3" />
                Done
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive px-2" onClick={(e) => { e.stopPropagation(); setDiscardOpen(true) }}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Data input for Done */}
      {doneFormOpen && (
        <form onSubmit={handleDoneSubmit} className="border-t px-4 pb-3 pt-2 bg-muted/20 flex flex-col gap-2">
          {(task.data_type === 'text' || task.data_type === 'both') && (
            <Input
              placeholder={task.data_label ?? 'Add a note...'}
              value={doneDataText}
              onChange={e => setDoneDataText(e.target.value)}
              maxLength={500}
              autoFocus
            />
          )}
          {(task.data_type === 'number' || task.data_type === 'both') && (
            <Input
              type="number"
              placeholder={task.data_label ?? 'Enter value...'}
              value={doneDataNumber}
              onChange={e => setDoneDataNumber(e.target.value)}
            />
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" className="flex-1">Save & Finalize</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDoneFormOpen(false)}>Cancel</Button>
          </div>
        </form>
      )}

      {/* Discard confirm dialog */}
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Discard timer?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {formatDuration(totalElapsed)} will be lost. No completion recorded.
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
  const pauseTimer = usePauseTimer()
  const resumeTimer = useResumeTimer()
  const doneTimer = useDoneTimer()
  const discardTimer = useDiscardTimer()

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

  async function handleToggle(task: Task, completion: CompletionWithTask | undefined, data?: { data_text?: string; data_number?: number }) {
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
        completed_at: new Date().toISOString(), data_text: data?.data_text ?? null,
        data_number: data?.data_number ?? null, duration_seconds: null, is_finalized: 0, task,
      }
      setCompletions(prev => [...prev, optimistic])
      try {
        const { completion: created } = await completionsApi.create({
          task_id: task.id,
          date: selectedDate,
          data_text: data?.data_text,
          data_number: data?.data_number,
        })
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

        <div
          className="grid transition-[grid-template-rows] duration-200 ease-in-out"
          style={{ gridTemplateRows: calendarOpen ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <MiniCalendar
              month={calendarMonth}
              onMonthChange={setCalendarMonth}
              selectedDate={selectedDate}
              onDateSelect={(d) => { setSelectedDate(d); setCalendarOpen(false) }}
              calendarData={calendarData ?? null}
            />
          </div>
        </div>
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
                  onPause={() => {
                    pauseTimer.mutate(task.id, {
                      onError: (err) => toast({ title: err instanceof ApiError ? err.message : 'Failed to pause timer', variant: 'destructive' }),
                    })
                  }}
                  onResume={() => {
                    resumeTimer.mutate(task.id, {
                      onError: (err) => toast({ title: err instanceof ApiError ? err.message : 'Failed to resume timer', variant: 'destructive' }),
                    })
                  }}
                  onDone={(data) => {
                    doneTimer.mutate({ task_id: task.id, data }, {
                      onSuccess: () => {
                        completionsApi.list(selectedDate)
                          .then(res => setCompletions(res.completions))
                          .catch(() => {})
                      },
                      onError: (err) => toast({ title: err instanceof ApiError ? err.message : 'Failed to finalize timer', variant: 'destructive' }),
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
