import { afterEach, describe, expect, it, setSystemTime } from 'bun:test'
import { act, renderHook } from '@testing-library/react'
import { useClock } from '@/lib/useClock'

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
