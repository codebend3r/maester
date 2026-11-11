import { afterEach, describe, expect, it, setSystemTime } from 'bun:test'
import { act, renderHook } from '@testing-library/react'
import { clockTextOf, useClock } from '@/lib/useClock'

type AtProps = { hour: number; minute: number; second: number }

const at = ({ hour, minute, second }: AtProps) => new Date(2026, 10, 5, hour, minute, second)

describe('useClock', () => {
  afterEach(() => {
    setSystemTime()
  })

  it('gives the time of day to the minute, and turns over with it', async () => {
    setSystemTime(at({ hour: 22, minute: 33, second: 59 }))
    const { result } = renderHook(() => useClock())
    expect(result.current).toMatch(/^10:33\s?PM$|^22:33$/)
    setSystemTime(at({ hour: 22, minute: 34, second: 0 }))
    await act(() => new Promise((resolve) => setTimeout(resolve, 1_100)))
    expect(result.current).toMatch(/^10:34\s?PM$|^22:34$/)
  })
})

describe('clockTextOf', () => {
  it('drops the full stops a locale writes in p.m., and keeps the time on one line', () => {
    const text = clockTextOf([
      { type: 'hour', value: '10' },
      { type: 'literal', value: ':' },
      { type: 'minute', value: '47' },
      { type: 'literal', value: ' ' },
      { type: 'dayPeriod', value: 'p.m.' },
    ])
    expect(text).toBe('10:47\u00A0pm')
  })

  it('leaves a 24-hour time as it is', () => {
    const german = new Intl.DateTimeFormat('de-DE', { hour: 'numeric', minute: '2-digit' })
    expect(clockTextOf(german.formatToParts(at({ hour: 22, minute: 47, second: 0 })))).toBe('22:47')
  })
})
