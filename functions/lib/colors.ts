/** Task color palette and auto-assignment logic */

export const TASK_COLORS = [
  '#3B82F6', // Blue (default first)
  '#6366F1', // Indigo
  '#8B5CF6', // Violet
  '#A855F7', // Purple
  '#EC4899', // Pink
  '#F43F5E', // Rose
  '#EF4444', // Red
  '#F97316', // Orange
  '#EAB308', // Yellow
  '#22C55E', // Green
  '#14B8A6', // Teal
  '#06B6D4', // Cyan
]

/**
 * Pick the next color for a new task.
 * - Start with Blue if no tasks yet.
 * - Pick the first unused color from the palette.
 * - If all 12 are used, pick the color with the lowest usage count.
 */
export function pickTaskColor(usedColors: string[]): string {
  const used = new Set(usedColors)

  if (used.size === 0) return TASK_COLORS[0]

  for (const color of TASK_COLORS) {
    if (!used.has(color)) return color
  }

  // All 12 used — pick the one that appears least in usedColors
  const freq = new Map<string, number>()
  for (const c of usedColors) freq.set(c, (freq.get(c) ?? 0) + 1)

  let minFreq = Infinity
  let picked = TASK_COLORS[0]
  for (const color of TASK_COLORS) {
    const f = freq.get(color) ?? 0
    if (f < minFreq) {
      minFreq = f
      picked = color
    }
  }
  return picked
}
