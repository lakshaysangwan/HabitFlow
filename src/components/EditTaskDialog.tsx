import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError, tasksApi } from '@/lib/api'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import type { Task } from '@/lib/types'

const WEEKDAYS = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 7 },
]

export function EditTaskDialog({
  task,
  open,
  onClose,
}: {
  task: Task | null
  open: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [freqType, setFreqType] = useState<'daily' | 'weekly'>('daily')
  const [freqDays, setFreqDays] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (task) {
      setName(task.name)
      setFreqType(task.frequency_type)
      setFreqDays(task.frequency_days ?? [])
      setError(null)
    }
  }, [task])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!task) return
    if (!name.trim()) return setError('Name is required')
    if (freqType === 'weekly' && freqDays.length === 0) return setError('Select at least one day')

    setLoading(true)
    setError(null)
    try {
      await tasksApi.update(task.id, {
        name: name.trim(),
        frequency_type: freqType,
        frequency_days: freqType === 'weekly' ? freqDays : undefined,
      })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update')
    } finally {
      setLoading(false)
    }
  }

  function toggleDay(day: number) {
    setFreqDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort())
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Habit</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
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

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={loading}>
              {loading ? 'Saving...' : 'Save'}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
