import { useState } from 'react'
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell,
} from 'recharts'
import type { Task } from '@/lib/types'
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

function OverviewSection({ range }: { range: Range }) {
  const [chartType, setChartType] = useState<ChartType>('bar')
  const { data: overviewData, isLoading: overviewLoading } = useAnalyticsOverview(range)

  return (
    <>
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
        onRangeChange={() => {}}
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
  const isTimed = task.tracking_mode !== 'binary'

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
            {isTimed ? (
              <span>{data.total_completed} done</span>
            ) : (
              <span>{data.completion_rate}%{data.current_streak > 0 && <> · 🔥{data.current_streak}</>}</span>
            )}
          </span>
        )}
        <ChevronRight className={cn('h-4 w-4 text-muted-foreground transition-transform shrink-0', expanded && 'rotate-90')} />
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="border-t px-4 pb-4 pt-3 space-y-3">
            {isLoading || !data ? (
              <div className="text-center py-4 text-muted-foreground text-sm">Loading...</div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {isTimed ? (
                    <>
                      <div>
                        <p className="text-lg font-bold">{data.total_completed}</p>
                        <p className="text-xs text-muted-foreground">Finalized</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold">{data.total_scheduled - data.total_completed}</p>
                        <p className="text-xs text-muted-foreground">Missed</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold">{data.total_scheduled}</p>
                        <p className="text-xs text-muted-foreground">Scheduled</p>
                      </div>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>

                {/* Chart: duration bars for timed tasks, done/missed line for binary */}
                {isTimed ? (
                  (() => {
                    const targetMins = task.tracking_mode === 'countdown' && task.timer_target_seconds
                      ? task.timer_target_seconds / 60
                      : null
                    const chartData = data.data_points
                      .filter(d => d.scheduled)
                      .map(d => ({
                        date: d.date.slice(5),
                        mins: d.duration_seconds != null ? Math.round(d.duration_seconds / 60) : 0,
                        is_finalized: d.is_finalized,
                        has_duration: d.duration_seconds != null && d.duration_seconds > 0,
                      }))
                    return (
                      <ResponsiveContainer width="100%" height={160}>
                        <BarChart data={chartData} barSize={12}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                          <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `${v}m`} />
                          <Tooltip
                            formatter={(v: number, _: string, p: { payload?: { is_finalized: number | null; has_duration: boolean } }) => {
                              const is_finalized = p.payload?.is_finalized ?? null
                              const has_duration = p.payload?.has_duration ?? false
                              const label = is_finalized === 1 ? '✓ Done' : has_duration ? '⚠ Partial' : '—'
                              return [`${v}m  ${label}`, 'Duration']
                            }}
                          />
                          {targetMins && (
                            <ReferenceLine
                              y={targetMins}
                              stroke="hsl(var(--muted-foreground))"
                              strokeDasharray="4 3"
                              label={{ value: `${Math.round(targetMins)}m`, fontSize: 9, position: 'right' }}
                            />
                          )}
                          <Bar dataKey="mins" radius={[2, 2, 0, 0]}>
                            {chartData.map((d, i) => (
                              <Cell
                                key={i}
                                fill={
                                  d.is_finalized === 1
                                    ? 'hsl(142 71% 45%)'       // green — done
                                    : d.has_duration
                                      ? 'hsl(38 92% 50%)'      // amber — partial
                                      : 'hsl(var(--muted))'    // gray — nothing
                                }
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )
                  })()
                ) : (
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
                )}

                {/* Numeric data chart */}
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

                {/* Text data list */}
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
        </div>
      </div>
    </div>
  )
}

// ─── Insights Page ────────────────────────────────────────────────────────────

export default function Insights() {
  const [range, setRange] = useState<Range>('month')
  const [tab, setTab] = useState<'overview' | 'pertask'>('overview')
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const { data: tasksData } = useTasks('all')
  const tasks = (tasksData?.tasks ?? []).filter(t => t.status !== 'archived')

  return (
    <div className="space-y-5">
      {/* Header */}
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

      {/* Tab selector */}
      <div className="flex rounded-lg bg-muted p-1 gap-1">
        <button
          onClick={() => setTab('overview')}
          className={cn(
            'flex-1 py-1.5 rounded-md text-sm font-medium transition-colors',
            tab === 'overview' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Overview
        </button>
        <button
          onClick={() => setTab('pertask')}
          className={cn(
            'flex-1 py-1.5 rounded-md text-sm font-medium transition-colors',
            tab === 'pertask' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Per Habit
        </button>
      </div>

      {/* Tab content */}
      {tab === 'overview' ? (
        <OverviewSection range={range} />
      ) : (
        <div className="space-y-2">
          {tasks.length === 0 ? (
            <p className="text-center py-8 text-sm text-muted-foreground">No habits yet.</p>
          ) : (
            tasks.map(task => (
              <TaskInsightRow
                key={task.id}
                task={task}
                expanded={expandedTaskId === task.id}
                onToggle={() => setExpandedTaskId(id => id === task.id ? null : task.id)}
                range={range}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
