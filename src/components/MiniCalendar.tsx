import { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CalendarData } from '@/lib/types'

interface MiniCalendarProps {
  month: string           // 'YYYY-MM', controlled
  onMonthChange: (m: string) => void
  selectedDate: string    // 'YYYY-MM-DD'
  onDateSelect: (d: string) => void
  calendarData: CalendarData | null
}

function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function getDayRatioClass(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined) return 'bg-muted'
  if (ratio === 0) return 'bg-destructive/20'
  if (ratio < 0.5) return 'bg-amber-500/30'
  if (ratio < 1) return 'bg-primary/30'
  return 'bg-green-500/40'
}

export default function MiniCalendar({
  month,
  onMonthChange,
  selectedDate,
  onDateSelect,
  calendarData,
}: MiniCalendarProps) {
  const today = new Date().toLocaleDateString('en-CA')

  const { weeks, monthLabel } = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    const firstDay = new Date(y, m - 1, 1)
    const lastDay = new Date(y, m, 0)

    // Pad to start on Monday (ISO week)
    const startDow = (firstDay.getDay() + 6) % 7 // 0=Mon
    const cells: (string | null)[] = Array(startDow).fill(null)
    for (let d = 1; d <= lastDay.getDate(); d++) {
      cells.push(`${month}-${String(d).padStart(2, '0')}`)
    }
    while (cells.length % 7 !== 0) cells.push(null)

    const weeks: (string | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7))
    }

    const monthLabel = firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    return { weeks, monthLabel }
  }, [month])

  const ratioMap = useMemo(() => {
    const m = new Map<string, number | null>()
    calendarData?.days.forEach(d => m.set(d.date, d.ratio))
    return m
  }, [calendarData])

  return (
    <div className="select-none">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => onMonthChange(addMonths(month, -1))}
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium">{monthLabel}</span>
        <button
          onClick={() => onMonthChange(addMonths(month, 1))}
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Day-of-week labels */}
      <div className="grid grid-cols-7 mb-1">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <div key={i} className="text-center text-[10px] text-muted-foreground font-medium py-0.5">
            {d}
          </div>
        ))}
      </div>

      {/* Full month grid */}
      <div className="space-y-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-0.5">
            {week.map((date, di) => {
              if (!date) return <div key={di} className="aspect-square" />

              const isFuture = date > today
              const isToday = date === today
              const isSelected = date === selectedDate
              const ratio = ratioMap.get(date)

              return (
                <button
                  key={date}
                  onClick={() => !isFuture && onDateSelect(date)}
                  disabled={isFuture}
                  className={cn(
                    'aspect-square rounded text-xs font-medium transition-colors flex items-center justify-center',
                    isFuture && 'opacity-30 cursor-not-allowed',
                    !isFuture && !isSelected && getDayRatioClass(ratio),
                    isToday && !isSelected && 'ring-2 ring-primary ring-inset',
                    isSelected && 'bg-primary text-primary-foreground',
                    !isFuture && !isSelected && 'hover:opacity-80'
                  )}
                >
                  {new Date(date + 'T12:00:00').getDate()}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
