/**
 * Pure presentational analytics overview.
 * Used by both Analytics.tsx (user's own data) and Admin.tsx (god mode user view).
 */
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import type { OverviewAnalytics, HeatmapData } from '@/lib/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Flame, Target, TrendingUp, CheckSquare } from 'lucide-react'

export type Range = 'week' | 'month' | 'year' | 'all'
export type ChartType = 'bar' | 'line' | 'pie' | 'heatmap' | 'area'

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

function HeatmapCalendar({ data }: { data: HeatmapData }) {
  const dayMap = new Map(data.days.map(d => [d.date, d]))
  const firstDay = new Date(`${data.year}-01-01T12:00:00`)
  const lastDay = new Date(`${data.year}-12-31T12:00:00`)
  const startPad = firstDay.getDay()
  const days: Array<{ date: string; count: number; total: number } | null> = Array(startPad).fill(null)
  const cur = new Date(firstDay)
  while (cur <= lastDay) {
    const d = cur.toLocaleDateString('en-CA')
    days.push(dayMap.get(d) ?? { date: d, count: 0, total: 0 })
    cur.setDate(cur.getDate() + 1)
  }
  while (days.length % 7 !== 0) days.push(null)
  const weeks: Array<Array<{ date: string; count: number; total: number } | null>> = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))

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
        <div className="flex mb-1 ml-6">
          {months.map(m => (
            <div key={m} className="flex-1 text-[10px] text-muted-foreground text-center">{m}</div>
          ))}
        </div>
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

interface AnalyticsOverviewProps {
  data: OverviewAnalytics | null
  heatmap?: HeatmapData | null
  loading: boolean
  range: Range
  onRangeChange: (r: Range) => void
  chartType: ChartType
  onChartTypeChange: (ct: ChartType) => void
  showHeatmap?: boolean
}

export function AnalyticsOverview({
  data,
  heatmap,
  loading,
  range,
  onRangeChange,
  chartType,
  onChartTypeChange,
  showHeatmap = true,
}: AnalyticsOverviewProps) {
  if (loading || !data) {
    return <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
  }

  const chartData = data.daily_rates.map(d => ({
    date: d.date.slice(5),
    rate: d.rate,
    completed: d.completed,
    total: d.total,
  }))

  const availableChartTypes = showHeatmap ? CHART_TYPES : CHART_TYPES.filter(ct => ct.value !== 'heatmap')

  function renderChart() {
    if (chartType === 'heatmap' && heatmap && showHeatmap) {
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

      <div className="flex items-center gap-2 flex-wrap">
        <Select value={chartType} onValueChange={v => onChartTypeChange(v as ChartType)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {availableChartTypes.map(ct => (
              <SelectItem key={ct.value} value={ct.value}>{ct.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-1 ml-auto">
          {(Object.keys(RANGE_LABELS) as Range[]).map(r => (
            <button
              key={r}
              onClick={() => onRangeChange(r)}
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

      <Card>
        <CardContent className="pt-4 pb-2">
          {renderChart()}
        </CardContent>
      </Card>

      {data.task_breakdown.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Task Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {data.task_breakdown.map(t => (
                <div key={t.task_id} className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.task_color }} />
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
