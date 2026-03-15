import { useState, useEffect, useCallback } from 'react'
import { tasksApi, completionsApi } from '@/lib/api'
import { ApiError } from '@/lib/api'
import { toDateString, fromDateString, formatDisplayDate } from '@/lib/utils'
import { toast } from '@/lib/hooks/use-toast'
import type { Task, CompletionWithTask } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ChevronLeft, ChevronRight, Plus, CalendarDays, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const WEEKDAYS = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 7 },
]

// ─── Task Card ────────────────────────────────────────────────────────────────

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
          <span
            className={cn(
              'text-sm font-medium transition-colors',
              isCompleted && 'line-through text-muted-foreground'
            )}
          >
            {task.name}
          </span>
          {task.frequency_type === 'weekly' && task.frequency_days && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {WEEKDAYS.filter(d => task.frequency_days!.includes(d.value)).map(d => d.label).join(', ')}
            </p>
          )}
        </div>

        {/* Completion checkbox */}
        <button
          onClick={handleCheck}
          className={cn(
            'w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all duration-200',
            isCompleted
              ? 'border-transparent text-white scale-110'
              : 'border-muted-foreground/40 hover:border-primary'
          )}
          style={isCompleted ? { backgroundColor: task.color } : {}}
          aria-label={isCompleted ? 'Mark incomplete' : 'Mark complete'}
        >
          {isCompleted && <Check className="h-4 w-4" />}
        </button>
      </div>

      {/* Data input expansion */}
      {expanded && !isCompleted && (
        <form
          onSubmit={handleDataSubmit}
          className="border-t px-4 pb-3 pt-2 bg-muted/30 flex flex-col gap-2"
        >
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
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

// ─── Add Habit Form ───────────────────────────────────────────────────────────

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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setName('')
    setFreqType('daily')
    setFreqDays([])
    setTrackData(false)
    setDataType('text')
    setDataLabel('')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Name is required')
    if (freqType === 'weekly' && freqDays.length === 0) return setError('Select at least one day')

    setLoading(true)
    setError(null)
    try {
      const { task } = await tasksApi.create({
        name: name.trim(),
        frequency_type: freqType,
        frequency_days: freqType === 'weekly' ? freqDays : undefined,
        data_type: trackData ? dataType : 'none',
        data_label: trackData && dataLabel.trim() ? dataLabel.trim() : undefined,
      })
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
    setFreqDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort()
    )
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); reset() } }}>
      <DialogContent className="max-w-sm">
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
              <Button
                type="button"
                variant={freqType === 'daily' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFreqType('daily')}
                className="flex-1"
              >
                Every day
              </Button>
              <Button
                type="button"
                variant={freqType === 'weekly' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFreqType('weekly')}
                className="flex-1"
              >
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
                      freqDays.includes(d.value)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    )}
                  >
                    {d.label}
                  </button>
                ))}
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
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

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
  const [selectedDate, setSelectedDate] = useState(toDateString())
  const [tasks, setTasks] = useState<Task[]>([])
  const [completions, setCompletions] = useState<CompletionWithTask[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddHabit, setShowAddHabit] = useState(false)

  const today = toDateString()
  const isToday = selectedDate === today

  // Filter tasks scheduled for selected date
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

  const loadData = useCallback(async (date: string) => {
    setLoading(true)
    try {
      const [tasksRes, completionsRes] = await Promise.all([
        tasksApi.list('all'),
        completionsApi.list(date),
      ])
      setTasks(tasksRes.tasks)
      setCompletions(completionsRes.completions)
    } catch {
      toast({ title: 'Failed to load', description: 'Could not fetch data.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData(selectedDate)
  }, [selectedDate, loadData])

  function goToPrev() {
    const d = fromDateString(selectedDate)
    d.setDate(d.getDate() - 1)
    setSelectedDate(toDateString(d))
  }

  function goToNext() {
    if (!isToday) {
      const d = fromDateString(selectedDate)
      d.setDate(d.getDate() + 1)
      const next = toDateString(d)
      if (next <= today) setSelectedDate(next)
    }
  }

  async function handleToggle(task: Task, completion: CompletionWithTask | undefined) {
    // Optimistic update
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
        id: tempId,
        task_id: task.id,
        user_id: '',
        completed_date: selectedDate,
        completed_at: new Date().toISOString(),
        data_text: null,
        data_number: null,
        task,
      }
      setCompletions(prev => [...prev, optimistic])
      try {
        const { completion: created } = await completionsApi.create({
          task_id: task.id,
          date: selectedDate,
        })
        setCompletions(prev =>
          prev.map(c => c.id === tempId ? { ...created, task } : c)
        )
      } catch (err) {
        setCompletions(prev => prev.filter(c => c.id !== tempId))
        const msg = err instanceof ApiError ? err.message : 'Failed to save'
        toast({ title: msg, variant: 'destructive' })
      }
    }
  }

  function handleTaskCreated(task: Task) {
    setTasks(prev => [...prev, task])
    toast({ title: `"${task.name}" added!` })
  }

  return (
    <div className="space-y-4">
      {/* Past date banner */}
      {!isToday && (
        <div className="flex items-center justify-between rounded-lg border bg-muted px-4 py-2 text-sm">
          <span className="text-muted-foreground">Viewing {formatDisplayDate(selectedDate)}</span>
          <button
            onClick={() => setSelectedDate(today)}
            className="text-primary font-medium hover:underline text-xs"
          >
            Back to Today
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={goToPrev}
          className="p-2 rounded-lg hover:bg-muted transition-colors"
          aria-label="Previous day"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 text-center">
          <h2 className="font-semibold text-lg">{formatDisplayDate(selectedDate)}</h2>
        </div>
        <button
          onClick={goToNext}
          disabled={isToday}
          className="p-2 rounded-lg hover:bg-muted transition-colors disabled:opacity-30"
          aria-label="Next day"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Completion summary */}
      {scheduledTasks.length > 0 && (
        <div className="rounded-lg border bg-card px-4 py-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Daily progress</span>
            <span className="font-medium tabular-nums">
              {completedCount}/{scheduledTasks.length} · {completionRate}%
            </span>
          </div>
          <Progress value={completionRate} className="h-2" />
        </div>
      )}

      {/* Task list */}
      <div className="space-y-2">
        {loading ? (
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
          scheduledTasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              completion={completionMap.get(task.id)}
              onToggle={handleToggle}
            />
          ))
        )}
      </div>

      {/* Add habit button */}
      <Button
        onClick={() => setShowAddHabit(true)}
        variant="outline"
        className="w-full border-dashed"
      >
        <Plus className="h-4 w-4 mr-2" />
        Add Habit
      </Button>

      <AddHabitDialog
        open={showAddHabit}
        onClose={() => setShowAddHabit(false)}
        onCreated={handleTaskCreated}
      />
    </div>
  )
}
