import { useState } from 'react'
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import type { Task } from '@/lib/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { AnalyticsOverview, type Range, type ChartType } from '@/components/AnalyticsOverview'
import { useAnalyticsOverview, useAnalyticsTask, useTasks } from '@/lib/hooks/use-queries'
import { Flame, ChevronRight } from 'lucide-react'

const RANGE_LABELS: Record<Range, string> = {
  week: 'Week',
  month: 'Month',
  year: 'Year',
  all: 'Lifetime',
}

// ─── Overview section ─────────────────────────────────────────────────────────

function OverviewSection() {
  const [range, setRange] = useState<Range>('month')
  const [chartType, setChartType] = useState<ChartType>('bar')

  const { data: overviewData, isLoading: overviewLoading } = useAnalyticsOverview(range)

  return (
    <>
      {/* Summary strip */}
      {overviewData && (
        <div className="flex gap-2 text-sm text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <Flame className="h-4 w-4 text-orange-500" />
            {overviewData.current_streak}-day streak
          </span>
          <span>·</span>
          <span>{overviewData.avg_daily_rate}% this {RANGE_LABELS[range].toLowerCase()}</span>
          <span>·</span>
          <span>Best: {overviewData.best_streak} days</span>
        </div>
      )}

      <AnalyticsOverview
        data={overviewData ?? null}
        loading={overviewLoading}
        range={range}
        onRangeChange={setRange}
        chartType={chartType}
        onChartTypeChange={setChartType}
        showHeatmap={false}
      />
    </>
  )
}

// ─── Task row (accordion) ─────────────────────────────────────────────────────

function TaskInsightRow({ task, expanded, onToggle, range }: {
  task: Task
  expanded: boolean
  onToggle: () => void
  range: Range
}) {
  const { data, isLoading } = useAnalyticsTask(task.id, range)

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: task.color }} />
        <span className="flex-1 text-sm font-medium">{task.name}</span>
        {data && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {data.completion_rate}% · {data.current_streak > 0 && <span>🔥{data.current_streak}</span>}
          </span>
        )}
        <ChevronRight className={cn('h-4 w-4 text-muted-foreground transition-transform shrink-0', expanded && 'rotate-90')} />
      </button>

      {expanded && (
        <div className="border-t px-4 pb-4 pt-3 space-y-3">
          {isLoading || !data ? (
            <div className="text-center py-4 text-muted-foreground text-sm">Loading...</div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-lg font-bold">{data.completion_rate}%</p>
                  <p className="text-xs text-muted-foreground">Completion</p>
                </div>
                <div>
                  <p className="text-lg font-bold">{data.current_streak}</p>
                  <p className="text-xs text-muted-foreground">Streak</p>
                </div>
                <div>
                  <p className="text-lg font-bold">{data.total_completed}</p>
                  <p className="text-xs text-muted-foreground">Total done</p>
                </div>
              </div>

              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={data.data_points.filter(d => d.scheduled).map(d => ({
                  date: d.date.slice(5),
                  done: d.completed ? 1 : 0,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                  <YAxis domain={[0, 1]} ticks={[0, 1]} tickFormatter={v => v ? '✓' : '✗'} />
                  <Tooltip formatter={(v: number) => v ? 'Done' : 'Missed'} />
                  <Line type="monotone" dataKey="done" stroke={task.color} strokeWidth={2} dot={{ fill: task.color, r: 2 }} />
                </LineChart>
              </ResponsiveContainer>

              {(task.data_type === 'number' || task.data_type === 'both') && (
                <ResponsiveContainer width="100%" height={120}>
                  <AreaChart data={data.data_points.filter(d => d.data_number != null).map(d => ({ date: d.date.slice(5), value: d.data_number }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 9 }} />
                    <Tooltip />
                    <Area type="monotone" dataKey="value" stroke={task.color} fill={task.color} fillOpacity={0.2} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}

              {(task.data_type === 'text' || task.data_type === 'both') && (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {data.data_points.filter(d => d.data_text).reverse().map(d => (
                    <div key={d.date} className="flex gap-2 text-xs">
                      <span className="text-muted-foreground shrink-0 tabular-nums">{d.date}</span>
                      <span className="font-mono">{d.data_text}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Insights Page ────────────────────────────────────────────────────────────

export default function Insights() {
  const [range, setRange] = useState<Range>('month')
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const { data: tasksData } = useTasks('all')
  const tasks = (tasksData?.tasks ?? []).filter(t => t.status !== 'archived')

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Insights</h2>
        <div className="flex gap-1">
          {(Object.keys(RANGE_LABELS) as Range[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                'px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                range === r ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
              )}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {/* Section 1 + 2 — Summary strip + overview chart */}
      <OverviewSection />

      {/* Section 3 — Per-task accordion */}
      {tasks.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Per Habit</h3>
          {tasks.map(task => (
            <TaskInsightRow
              key={task.id}
              task={task}
              expanded={expandedTaskId === task.id}
              onToggle={() => setExpandedTaskId(id => id === task.id ? null : task.id)}
              range={range}
            />
          ))}
        </div>
      )}
    </div>
  )
}
