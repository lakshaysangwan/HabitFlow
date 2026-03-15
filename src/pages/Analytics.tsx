import { useState, useEffect } from 'react'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import { analyticsApi, tasksApi } from '@/lib/api'
import type { OverviewAnalytics, TaskAnalytics, HeatmapData, Task } from '@/lib/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Flame, Target, TrendingUp, CheckSquare } from 'lucide-react'

type Range = 'week' | 'month' | 'year' | 'all'
type ChartType = 'bar' | 'line' | 'pie' | 'heatmap' | 'area'
type View = 'overview' | 'task'

const RANGE_LABELS: Record<Range, string> = {
  week: 'Week',
  month: 'Month',
  year: 'Year',
  all: 'Lifetime',
}

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'bar', label: 'Bar' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
  { value: 'pie', label: 'Pie' },
  { value: 'heatmap', label: 'Heatmap' },
]

// ─── Heatmap ──────────────────────────────────────────────────────────────────

function HeatmapCalendar({ data }: { data: HeatmapData }) {
  const dayMap = new Map(data.days.map(d => [d.date, d]))

  // Build weeks (Sun-Sat columns)
  const firstDay = new Date(`${data.year}-01-01T12:00:00`)
  const lastDay = new Date(`${data.year}-12-31T12:00:00`)

  // Pad to start on Sunday
  const startPad = firstDay.getDay() // 0=Sun
  const days: Array<{ date: string; count: number; total: number } | null> = Array(startPad).fill(null)

  const cur = new Date(firstDay)
  while (cur <= lastDay) {
    const d = cur.toLocaleDateString('en-CA')
    days.push(dayMap.get(d) ?? { date: d, count: 0, total: 0 })
    cur.setDate(cur.getDate() + 1)
  }

  // Pad to complete last week
  while (days.length % 7 !== 0) days.push(null)

  const weeks: Array<Array<{ date: string; count: number; total: number } | null>> = []
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7))
  }

  function getColor(d: { count: number; total: number } | null): string {
    if (!d || d.total === 0) return 'hsl(var(--muted))'
    const rate = d.count / d.total
    if (rate === 0) return 'hsl(var(--muted))'
    if (rate < 0.25) return '#bbf7d0'
    if (rate < 0.5) return '#4ade80'
    if (rate < 0.75) return '#22c55e'
    return '#15803d'
  }

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        {/* Month labels */}
        <div className="flex mb-1 ml-6">
          {months.map(m => (
            <div key={m} className="flex-1 text-[10px] text-muted-foreground text-center">{m}</div>
          ))}
        </div>
        {/* Day labels + grid */}
        <div className="flex gap-1">
          <div className="flex flex-col gap-1 mr-1">
            {['S','M','T','W','T','F','S'].map((d, i) => (
              <div key={i} className="w-3 h-3 text-[9px] text-muted-foreground flex items-center justify-center">{d}</div>
            ))}
          </div>
          <div className="flex gap-1">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-1">
                {week.map((day, di) => (
                  <div
                    key={di}
                    className="w-3 h-3 rounded-[2px] transition-colors"
                    style={{ backgroundColor: getColor(day) }}
                    title={day ? `${day.date}: ${day.count}/${day.total}` : ''}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function OverviewView() {
  const [range, setRange] = useState<Range>('month')
  const [chartType, setChartType] = useState<ChartType>('bar')
  const [data, setData] = useState<OverviewAnalytics | null>(null)
  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const year = new Date().getFullYear()
    Promise.all([
      analyticsApi.overview(range),
      analyticsApi.heatmap(year),
    ]).then(([overview, hm]) => {
      setData(overview)
      setHeatmap(hm)
    }).finally(() => setLoading(false))
  }, [range])

  if (loading || !data) return <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>

  const chartData = data.daily_rates.map(d => ({
    date: d.date.slice(5), // MM-DD
    rate: d.rate,
    completed: d.completed,
    total: d.total,
  }))

  function renderChart() {
    if (chartType === 'heatmap' && heatmap) {
      return <HeatmapCalendar data={heatmap} />
    }
    if (chartType === 'pie') {
      const pieData = data!.task_breakdown.map(t => ({
        name: t.task_name,
        value: t.total_completed,
        color: t.task_color,
      }))
      return (
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name }) => name}>
              {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      )
    }
    if (chartType === 'line') {
      return (
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
            <Tooltip formatter={(v: number) => `${v}%`} />
            <Line type="monotone" dataKey="rate" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )
    }
    if (chartType === 'area') {
      return (
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorRate" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
            <Tooltip formatter={(v: number) => `${v}%`} />
            <Area type="monotone" dataKey="rate" stroke="hsl(var(--primary))" fill="url(#colorRate)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      )
    }
    // Default: bar
    return (
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
          <Tooltip formatter={(v: number) => `${v}%`} />
          <Bar dataKey="rate" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Target className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Avg Rate</span>
            </div>
            <p className="text-2xl font-bold">{data.avg_daily_rate}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Flame className="h-4 w-4 text-orange-500" />
              <span className="text-xs text-muted-foreground">Current Streak</span>
            </div>
            <p className="text-2xl font-bold">{data.current_streak} <span className="text-sm font-normal text-muted-foreground">days</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Best Streak</span>
            </div>
            <p className="text-2xl font-bold">{data.best_streak} <span className="text-sm font-normal text-muted-foreground">days</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <CheckSquare className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Completions</span>
            </div>
            <p className="text-2xl font-bold">{data.total_completions}</p>
          </CardContent>
        </Card>
      </div>

      {/* Chart controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={chartType} onValueChange={v => setChartType(v as ChartType)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHART_TYPES.map(ct => (
              <SelectItem key={ct.value} value={ct.value}>{ct.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex gap-1 ml-auto">
          {(Object.keys(RANGE_LABELS) as Range[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                range === r
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              )}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <Card>
        <CardContent className="pt-4 pb-2">
          {renderChart()}
        </CardContent>
      </Card>

      {/* Task breakdown table */}
      {data.task_breakdown.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Task Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {data.task_breakdown.map(t => (
                <div key={t.task_id} className="flex items-center gap-3">
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: t.task_color }}
                  />
                  <span className="text-sm flex-1 truncate">{t.task_name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${t.completion_rate}%`, backgroundColor: t.task_color }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">
                      {t.completion_rate}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─── Task Deep Dive ───────────────────────────────────────────────────────────

function TaskDeepDive({ tasks }: { tasks: Task[] }) {
  const [selectedTask, setSelectedTask] = useState<string>(tasks[0]?.id ?? '')
  const [range, setRange] = useState<Range>('month')
  const [data, setData] = useState<TaskAnalytics | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!selectedTask) return
    setLoading(true)
    analyticsApi.task(selectedTask, range)
      .then(setData)
      .finally(() => setLoading(false))
  }, [selectedTask, range])

  if (tasks.length === 0) {
    return <div className="text-center py-8 text-muted-foreground text-sm">No habits to analyze yet.</div>
  }

  return (
    <div className="space-y-4">
      {/* Task selector + range */}
      <div className="flex gap-2">
        <Select value={selectedTask} onValueChange={setSelectedTask}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Select habit" />
          </SelectTrigger>
          <SelectContent>
            {tasks.map(t => (
              <SelectItem key={t.id} value={t.id}>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                  {t.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-1">
          {(Object.keys(RANGE_LABELS) as Range[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                'px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                range === r
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              )}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {loading || !data ? (
        <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
      ) : (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2">
            <Card>
              <CardContent className="pt-3 pb-3 text-center">
                <p className="text-xl font-bold">{data.completion_rate}%</p>
                <p className="text-xs text-muted-foreground">Completion</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 pb-3 text-center">
                <p className="text-xl font-bold">{data.current_streak}</p>
                <p className="text-xs text-muted-foreground">Streak</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 pb-3 text-center">
                <p className="text-xl font-bold">{data.best_streak}</p>
                <p className="text-xs text-muted-foreground">Best</p>
              </CardContent>
            </Card>
          </div>

          {/* Consistency chart */}
          <Card>
            <CardContent className="pt-4 pb-2">
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={data.data_points.filter(d => d.scheduled).map(d => ({
                  date: d.date.slice(5),
                  done: d.completed ? 1 : 0,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                  <YAxis domain={[0, 1]} ticks={[0, 1]} tickFormatter={v => v ? '✓' : '✗'} />
                  <Tooltip formatter={(v: number) => v ? 'Done' : 'Missed'} />
                  <Line
                    type="monotone"
                    dataKey="done"
                    stroke={data.task.color}
                    strokeWidth={2}
                    dot={{ fill: data.task.color, r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Numeric data chart */}
          {(data.task.data_type === 'number' || data.task.data_type === 'both') && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{data.task.data_label ?? 'Value'} over time</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={data.data_points
                    .filter(d => d.data_number != null)
                    .map(d => ({ date: d.date.slice(5), value: d.data_number }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 9 }} />
                    <Tooltip />
                    <Area type="monotone" dataKey="value" stroke={data.task.color} fill={data.task.color} fillOpacity={0.2} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Text log */}
          {(data.task.data_type === 'text' || data.task.data_type === 'both') && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Notes log</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2 max-h-48 overflow-y-auto">
                {data.data_points
                  .filter(d => d.data_text)
                  .reverse()
                  .map(d => (
                    <div key={d.date} className="flex gap-2 text-sm">
                      <span className="text-muted-foreground shrink-0 tabular-nums">{d.date}</span>
                      <span className="font-mono text-xs">{d.data_text}</span>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

// ─── Analytics Page ───────────────────────────────────────────────────────────

export default function Analytics() {
  const [view, setView] = useState<View>('overview')
  const [tasks, setTasks] = useState<Task[]>([])

  useEffect(() => {
    tasksApi.list('all').then(res => setTasks(res.tasks)).catch(() => {})
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Analytics</h2>
      </div>

      {/* View toggle */}
      <div className="flex rounded-lg border p-1 gap-1">
        {(['overview', 'task'] as View[]).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={cn(
              'flex-1 py-1.5 rounded-md text-sm font-medium transition-colors',
              view === v
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {v === 'overview' ? 'Overview' : 'Deep Dive'}
          </button>
        ))}
      </div>

      {view === 'overview' ? (
        <OverviewView />
      ) : (
        <TaskDeepDive tasks={tasks.filter(t => t.status !== 'archived')} />
      )}
    </div>
  )
}
