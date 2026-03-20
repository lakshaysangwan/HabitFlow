import { useState } from 'react'
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import type { Task } from '@/lib/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { AnalyticsOverview, type Range, type ChartType } from '@/components/AnalyticsOverview'
import { useAnalyticsOverview, useAnalyticsHeatmap, useAnalyticsTask, useTasks } from '@/lib/hooks/use-queries'

type View = 'overview' | 'task'

const RANGE_LABELS: Record<Range, string> = {
  week: 'Week',
  month: 'Month',
  year: 'Year',
  all: 'Lifetime',
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function OverviewView() {
  const [range, setRange] = useState<Range>('month')
  const [chartType, setChartType] = useState<ChartType>('bar')
  const year = new Date().getFullYear()

  const { data: overviewData, isLoading: overviewLoading } = useAnalyticsOverview(range)
  const { data: heatmapData } = useAnalyticsHeatmap(year)

  return (
    <AnalyticsOverview
      data={overviewData ?? null}
      heatmap={heatmapData ?? null}
      loading={overviewLoading}
      range={range}
      onRangeChange={setRange}
      chartType={chartType}
      onChartTypeChange={setChartType}
      showHeatmap={true}
    />
  )
}

// ─── Task Deep Dive ───────────────────────────────────────────────────────────

function TaskDeepDive({ tasks }: { tasks: Task[] }) {
  const [selectedTask, setSelectedTask] = useState<string>(tasks[0]?.id ?? '')
  const [range, setRange] = useState<Range>('month')

  const { data, isLoading: loading } = useAnalyticsTask(selectedTask, range)

  if (tasks.length === 0) {
    return <div className="text-center py-8 text-muted-foreground text-sm">No habits to analyze yet.</div>
  }

  return (
    <div className="space-y-4">
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
  const { data: tasksData } = useTasks('all')
  const tasks = tasksData?.tasks ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Analytics</h2>
      </div>

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
