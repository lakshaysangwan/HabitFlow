import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { authApi, tasksApi } from '@/lib/api'
import { ApiError } from '@/lib/api'
import { useTheme } from '@/lib/theme'
import type { Task } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/lib/hooks/use-toast'
import { Eye, EyeOff, GripVertical, Pause, Play, Archive, RotateCcw, LogOut } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'

// ─── Theme selector ───────────────────────────────────────────────────────────

function ThemeSelector() {
  const { theme, setTheme } = useTheme()
  return (
    <div className="flex gap-2">
      {(['light', 'dark', 'system'] as const).map(t => (
        <button
          key={t}
          onClick={() => setTheme(t)}
          className={cn(
            'flex-1 py-2 rounded-lg border text-sm font-medium transition-colors capitalize',
            theme === t
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:bg-muted'
          )}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

// ─── Sortable task row ────────────────────────────────────────────────────────

function SortableTaskRow({
  task,
  onPause,
  onResume,
  onArchive,
  onRestore,
}: {
  task: Task
  onPause: (id: string) => void
  onResume: (id: string) => void
  onArchive: (id: string) => void
  onRestore: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 py-2.5 border-b last:border-0"
    >
      {task.status !== 'archived' && (
        <button
          className="text-muted-foreground/50 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      {task.status === 'archived' && <div className="w-5" />}

      <div
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: task.color }}
      />

      <div className="flex-1 min-w-0">
        <span className={cn('text-sm font-medium', task.status === 'archived' && 'text-muted-foreground line-through')}>
          {task.name}
        </span>
        <p className="text-xs text-muted-foreground">
          {task.frequency_type === 'daily' ? 'Daily' : 'Weekly'}
          {task.data_type !== 'none' && ` · tracks ${task.data_type}`}
        </p>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {task.status === 'active' && (
          <>
            <button
              onClick={() => onPause(task.id)}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Pause"
            >
              <Pause className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onArchive(task.id)}
              className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              title="Archive"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        {task.status === 'paused' && (
          <>
            <Badge variant="warning" className="text-[10px]">Paused</Badge>
            <button
              onClick={() => onResume(task.id)}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Resume"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onArchive(task.id)}
              className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              title="Archive"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        {task.status === 'archived' && (
          <button
            onClick={() => onRestore(task.id)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Restore"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Manage Habits ────────────────────────────────────────────────────────────

function ManageHabits() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [showArchived, setShowArchived] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  useEffect(() => {
    tasksApi.list('all')
      .then(res => setTasks(res.tasks))
      .finally(() => setLoading(false))
  }, [])

  const activeTasks = tasks.filter(t => t.status === 'active')
  const pausedTasks = tasks.filter(t => t.status === 'paused')
  const archivedTasks = tasks.filter(t => t.status === 'archived')
  const orderedTasks = [...activeTasks, ...pausedTasks]

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = orderedTasks.findIndex(t => t.id === active.id)
    const newIndex = orderedTasks.findIndex(t => t.id === over.id)
    const reordered = arrayMove(orderedTasks, oldIndex, newIndex)

    setTasks(prev => [
      ...reordered,
      ...prev.filter(t => t.status === 'archived'),
    ])

    try {
      await tasksApi.reorder(reordered.map(t => t.id))
    } catch {
      toast({ title: 'Failed to reorder', variant: 'destructive' })
      setTasks(prev => [...prev]) // revert
    }
  }

  async function handlePause(id: string) {
    try {
      const { task } = await tasksApi.pause(id)
      setTasks(prev => prev.map(t => t.id === id ? task : t))
    } catch {
      toast({ title: 'Failed to pause', variant: 'destructive' })
    }
  }

  async function handleResume(id: string) {
    try {
      const { task } = await tasksApi.resume(id)
      setTasks(prev => prev.map(t => t.id === id ? task : t))
    } catch {
      toast({ title: 'Failed to resume', variant: 'destructive' })
    }
  }

  async function handleArchive(id: string) {
    try {
      await tasksApi.delete(id)
      setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'archived' as const } : t))
    } catch {
      toast({ title: 'Failed to archive', variant: 'destructive' })
    }
  }

  async function handleRestore(id: string) {
    try {
      const { task } = await tasksApi.update(id, { status: 'active' })
      setTasks(prev => prev.map(t => t.id === id ? task : t))
    } catch {
      toast({ title: 'Failed to restore', variant: 'destructive' })
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground py-4">Loading...</div>

  return (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {orderedTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No habits yet.</p>
          ) : (
            orderedTasks.map(task => (
              <SortableTaskRow
                key={task.id}
                task={task}
                onPause={handlePause}
                onResume={handleResume}
                onArchive={handleArchive}
                onRestore={handleRestore}
              />
            ))
          )}
        </SortableContext>
      </DndContext>

      {archivedTasks.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowArchived(v => !v)}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 mb-2"
          >
            <Archive className="h-3.5 w-3.5" />
            Archived ({archivedTasks.length})
            <span className="text-xs">{showArchived ? '▲' : '▼'}</span>
          </button>
          {showArchived && archivedTasks.map(task => (
            <SortableTaskRow
              key={task.id}
              task={task}
              onPause={handlePause}
              onResume={handleResume}
              onArchive={handleArchive}
              onRestore={handleRestore}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Settings Page ────────────────────────────────────────────────────────────

interface SettingsProps {
  initialTab?: 'tasks' | 'account'
}

export default function Settings({ initialTab }: SettingsProps) {
  const { user, refreshUser, logout } = useAuth()

  // Profile
  const [displayName, setDisplayName] = useState(user?.display_name ?? '')
  const [timezone, setTimezone] = useState(user?.timezone ?? 'Asia/Kolkata')
  const [savingProfile, setSavingProfile] = useState(false)

  // Password
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showOld, setShowOld] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    setSavingProfile(true)
    try {
      await authApi.updateProfile({
        display_name: displayName.trim() || undefined,
        timezone: timezone.trim() || undefined,
      })
      await refreshUser()
      toast({ title: 'Profile updated!' })
    } catch (err) {
      toast({
        title: err instanceof ApiError ? err.message : 'Failed to save',
        variant: 'destructive',
      })
    } finally {
      setSavingProfile(false)
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    setPasswordError(null)
    setPasswordSuccess(false)
    setSavingPassword(true)
    try {
      await authApi.changePassword({
        old_password: oldPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      })
      setPasswordSuccess(true)
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast({ title: 'Password updated. All other sessions logged out.' })
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : 'Failed to change password')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Settings</h2>

      {/* Profile */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Display Name</Label>
              <Input
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input
                value={user?.username ?? ''}
                readOnly
                className="bg-muted cursor-not-allowed text-muted-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Timezone</Label>
              <Input
                value={timezone}
                onChange={e => setTimezone(e.target.value)}
                placeholder="Asia/Kolkata"
              />
              <p className="text-xs text-muted-foreground">
                Current: {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </p>
            </div>
            <Button type="submit" disabled={savingProfile}>
              {savingProfile ? 'Saving...' : 'Save Profile'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <ThemeSelector />
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Change Password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Current Password</Label>
              <div className="relative">
                <Input
                  type={showOld ? 'text' : 'password'}
                  value={oldPassword}
                  onChange={e => setOldPassword(e.target.value)}
                  autoComplete="current-password"
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowOld(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  tabIndex={-1}
                >
                  {showOld ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>New Password</Label>
              <div className="relative">
                <Input
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowNew(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  tabIndex={-1}
                >
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Confirm New Password</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            {passwordError && (
              <p className="text-sm text-destructive">{passwordError}</p>
            )}
            {passwordSuccess && (
              <p className="text-sm text-green-600 dark:text-green-400">
                Password updated. All other sessions have been logged out.
              </p>
            )}

            <Button type="submit" disabled={savingPassword}>
              {savingPassword ? 'Updating...' : 'Change Password'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Manage Habits */}
      <Card id="tasks">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Manage Habits</CardTitle>
        </CardHeader>
        <CardContent>
          <ManageHabits />
        </CardContent>
      </Card>

      {/* Admin link (god mode only) */}
      {user?.is_god === 1 && (
        <div className="text-center">
          <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors">
            Admin Panel →
          </Link>
        </div>
      )}

      {/* Sign out */}
      <div className="pt-2 border-t border-border">
        <Button
          variant="outline"
          className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
          onClick={() => logout()}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign Out
        </Button>
      </div>
    </div>
  )
}
