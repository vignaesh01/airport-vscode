import { describe, it, expect } from 'vitest'
import { formatElapsed } from './format-elapsed'

describe('formatElapsed', () => {
  it('formats sub-minute durations in seconds', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(45_000)).toBe('45s')
  })

  it('formats sub-hour durations in minutes', () => {
    expect(formatElapsed(60_000)).toBe('1m')
    expect(formatElapsed(125_000)).toBe('2m')
  })

  it('formats hour-plus durations in hours', () => {
    expect(formatElapsed(3_600_000)).toBe('1h')
    expect(formatElapsed(7_200_000)).toBe('2h')
  })

  it('clamps negative durations to 0s', () => {
    expect(formatElapsed(-500)).toBe('0s')
  })
})
