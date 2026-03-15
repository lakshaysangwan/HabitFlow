import { useState, useEffect, useCallback } from 'react'
import { adminApi } from '@/lib/api'
import { ApiError } from '@/lib/api'
import type { User, Task } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/lib/hooks/use-toast'
import { Search, Shield, Users, Key, ChevronRight } from 'lucide-react'

type AdminTab = 'users' | 'invite-codes'

// ─── User Detail Panel ────────────────────────────────────────────────────────

function UserDetail({ userId, onBack }: { userId: string; onBack: () => void }) {
  const [data, setData] = useState<{ user: User; tasks: Task[] } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminApi.getUser(userId)
      .then(setData)
      .catch(() => toast({ title: 'Failed to load user', variant: 'destructive' }))
      .finally(() => setLoading(false))
  }, [userId])

  if (loading) return <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
  if (!data) return null

  const { user, tasks } = data
  const activeTasks = tasks.filter(t => t.status === 'active')
  const pausedTasks = tasks.filter(t => t.status === 'paused')
  const archivedTasks = tasks.filter(t => t.status === 'archived')

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
      >
        ← Back to search
      </button>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>{user.display_name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Username</span>
            <span className="font-mono">@{user.username}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Timezone</span>
            <span>{user.timezone}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Joined</span>
            <span>{user.created_at.slice(0, 10)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">God Mode</span>
            <Badge variant={user.is_god ? 'default' : 'secondary'}>
              {user.is_god ? 'Yes' : 'No'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Habits ({tasks.length} total)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No habits yet.</p>
          ) : (
            tasks.map(t => (
              <div key={t.id} className="flex items-center gap-2 text-sm" style={{ borderLeftWidth: 3, borderLeftColor: t.color, paddingLeft: 8 }}>
                <span className="flex-1 truncate">{t.name}</span>
                <Badge
                  variant={t.status === 'active' ? 'success' : t.status === 'paused' ? 'warning' : 'secondary'}
                  className="text-[10px]"
                >
                  {t.status}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── User Search ──────────────────────────────────────────────────────────────

function UserSearch() {
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const search = useCallback(async (q: string) => {
    setLoading(true)
    setSearched(true)
    try {
      const res = await adminApi.searchUsers({ search: q, limit: 20 })
      setUsers(res.users)
    } catch {
      toast({ title: 'Search failed', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    search('')
  }, [search])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searched) search(query)
    }, 400)
    return () => clearTimeout(timer)
  }, [query, search, searched])

  if (selectedUserId) {
    return (
      <UserDetail
        userId={selectedUserId}
        onBack={() => setSelectedUserId(null)}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by username or display name..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="text-center py-6 text-muted-foreground text-sm">Searching...</div>
      ) : users.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground text-sm">No users found.</div>
      ) : (
        <div className="space-y-2">
          {users.map(user => (
            <button
              key={user.id}
              onClick={() => setSelectedUserId(user.id)}
              className="w-full flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted transition-colors text-left"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{user.display_name}</div>
                <div className="text-xs text-muted-foreground font-mono">@{user.username}</div>
              </div>
              {user.is_god === 1 && (
                <Badge variant="default" className="text-[10px]">
                  <Shield className="h-3 w-3 mr-1" />
                  God
                </Badge>
              )}
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Invite Codes ─────────────────────────────────────────────────────────────

function InviteCodes() {
  const [codes, setCodes] = useState<Array<{ id: string; code: string; max_uses: number; current_uses: number; created_at: string }>>([])
  const [newCode, setNewCode] = useState('')
  const [maxUses, setMaxUses] = useState('10')
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    adminApi.listInviteCodes()
      .then(res => setCodes(res.invite_codes as typeof codes))
      .finally(() => setLoading(false))
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newCode.trim()) return setError('Code is required')
    setError(null)
    setCreating(true)
    try {
      const res = await adminApi.createInviteCode({
        code: newCode.trim().toUpperCase(),
        max_uses: parseInt(maxUses, 10) || 10,
      })
      setCodes(prev => [res.invite_code as (typeof codes)[0], ...prev])
      setNewCode('')
      setMaxUses('10')
      toast({ title: `Code "${res.invite_code.code}" created!` })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create code')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Create Invite Code</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Code (uppercase, A-Z 0-9 -_)</Label>
              <Input
                placeholder="HABITFLOW-ALPHA-2026"
                value={newCode}
                onChange={e => setNewCode(e.target.value.toUpperCase())}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Max uses</Label>
              <Input
                type="number"
                min="1"
                max="1000"
                value={maxUses}
                onChange={e => setMaxUses(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={creating} className="w-full">
              {creating ? 'Creating...' : 'Create Code'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">All Codes ({codes.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : codes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No codes yet.</p>
          ) : (
            <div className="space-y-2">
              {codes.map(code => (
                <div key={code.id} className="flex items-center gap-2 py-1 border-b last:border-0">
                  <span className="font-mono text-sm flex-1 truncate">{code.code}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {code.current_uses}/{code.max_uses} uses
                  </span>
                  <Badge
                    variant={code.current_uses >= code.max_uses ? 'destructive' : 'success'}
                    className="text-[10px] shrink-0"
                  >
                    {code.current_uses >= code.max_uses ? 'Full' : 'Active'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Admin Page ───────────────────────────────────────────────────────────────

export default function Admin() {
  const [tab, setTab] = useState<AdminTab>('users')

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-primary" />
        <h2 className="text-xl font-bold">God Mode</h2>
      </div>

      <div className="flex gap-2 border-b pb-2">
        <button
          onClick={() => setTab('users')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            tab === 'users'
              ? 'text-primary bg-primary/10'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Users className="h-4 w-4" />
          Users
        </button>
        <button
          onClick={() => setTab('invite-codes')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            tab === 'invite-codes'
              ? 'text-primary bg-primary/10'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Key className="h-4 w-4" />
          Invite Codes
        </button>
      </div>

      {tab === 'users' ? <UserSearch /> : <InviteCodes />}
    </div>
  )
}
