import { describe, it, expect } from 'vitest'
import { pickTaskColor, TASK_COLORS } from '../../functions/lib/colors'

describe('pickTaskColor', () => {
  it('returns Blue (#3B82F6) when no colors are used', () => {
    expect(pickTaskColor([])).toBe('#3B82F6')
  })

  it('returns a color from the palette', () => {
    const color = pickTaskColor(['#3B82F6'])
    expect(TASK_COLORS).toContain(color)
  })

  it('avoids already-used colors when alternatives exist', () => {
    const used = ['#3B82F6', '#6366F1']
    const color = pickTaskColor(used)
    expect(used).not.toContain(color)
  })

  it('picks the first unused color in palette order', () => {
    // Use first color, expect second
    const color = pickTaskColor(['#3B82F6'])
    expect(color).toBe('#6366F1') // second in palette
  })

  it('cycles when all 12 colors are used (picks least frequent)', () => {
    // All 12 used once
    const allUsed = [...TASK_COLORS]
    const color = pickTaskColor(allUsed)
    expect(TASK_COLORS).toContain(color)
  })

  it('picks least-used color when all are exhausted', () => {
    // First color used 3 times, rest used once
    const used = [
      ...TASK_COLORS,          // each once
      TASK_COLORS[0],          // Blue twice
      TASK_COLORS[0],          // Blue three times
    ]
    const color = pickTaskColor(used)
    // Should NOT be Blue (most used), should be one of the singly-used colors
    expect(color).not.toBe(TASK_COLORS[0])
    expect(TASK_COLORS).toContain(color)
  })

  it('handles a single used color', () => {
    const color = pickTaskColor(['#3B82F6'])
    expect(color).not.toBe('#3B82F6')
  })
})
