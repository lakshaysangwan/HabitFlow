import { useState } from 'react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const PRESET_COLORS = [
  '#3B82F6', '#6366F1', '#8B5CF6', '#A855F7', '#EC4899',
  '#F43F5E', '#EF4444', '#F97316', '#EAB308', '#22C55E',
  '#14B8A6', '#06B6D4', '#84CC16', '#0EA5E9', '#10B981',
  '#D946EF', '#78716C', '#0891B2', '#7C3AED', '#DC2626',
]

interface ColorPickerProps {
  value: string
  onChange: (color: string) => void
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-8 h-8 rounded-full border-2 border-border hover:border-primary transition-colors shrink-0"
          style={{ backgroundColor: value }}
          aria-label="Pick color"
        />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="grid grid-cols-5 gap-2">
          {PRESET_COLORS.map(color => (
            <button
              key={color}
              type="button"
              className={cn(
                'w-7 h-7 rounded-full border-2 transition-all',
                value.toUpperCase() === color.toUpperCase()
                  ? 'border-foreground scale-110'
                  : 'border-transparent hover:border-muted-foreground/50',
              )}
              style={{ backgroundColor: color }}
              onClick={() => { onChange(color); setOpen(false) }}
              aria-label={`Color ${color}`}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3 pt-3 border-t">
          <label className="text-xs text-muted-foreground">Custom:</label>
          <input
            type="color"
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer border-0 p-0"
          />
          <span className="text-xs text-muted-foreground font-mono">{value}</span>
        </div>
      </PopoverContent>
    </Popover>
  )
}
