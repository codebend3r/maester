import { describe, expect, it } from 'bun:test'
import { type SurfaceTap, type TouchSide, rewoundTo, stepTap, touchSideOf } from '@/touchGestures'

describe('touchSideOf', () => {
  it('reads the left half as back and the right half as forward', () => {
    expect(touchSideOf({ x: 10, width: 400 })).toBe(-1)
    expect(touchSideOf({ x: 199, width: 400 })).toBe(-1)
    expect(touchSideOf({ x: 200, width: 400 })).toBe(1)
    expect(touchSideOf({ x: 390, width: 400 })).toBe(1)
  })
})

/** A tap as a test lists it: its side and when it lands. */
type Tap = { side: TouchSide; at: number }

describe('stepTap', () => {
  const run = (taps: readonly Tap[]) =>
    taps
      .reduce<SurfaceTap[]>(
        (steps, tap) => [...steps, stepTap({ last: steps.at(-1) ?? null, ...tap })],
        [],
      )
      .map((tap) => tap.isSkip)

  it('takes a lone tap as no skip', () => {
    expect(run([{ side: 1, at: 0 }])).toEqual([false])
  })

  it('skips on the second tap of a double tap on one side', () => {
    expect(
      run([
        { side: 1, at: 0 },
        { side: 1, at: 200 },
      ]),
    ).toEqual([false, true])
  })

  it('skips nothing when the second tap is slow or on the other side', () => {
    expect(
      run([
        { side: 1, at: 0 },
        { side: 1, at: 300 },
      ]),
    ).toEqual([false, false])
    expect(
      run([
        { side: 1, at: 0 },
        { side: -1, at: 100 },
      ]),
    ).toEqual([false, false])
  })

  it('goes on skipping with each tap that follows a skip within a second', () => {
    expect(run([0, 200, 900, 1_700, 2_800].map((at) => ({ side: -1 as const, at })))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ])
  })
})

describe('rewoundTo', () => {
  it('goes back two seconds for each second held, never past the start', () => {
    expect(rewoundTo({ from: 100, heldMs: 0 })).toBe(100)
    expect(rewoundTo({ from: 100, heldMs: 1_500 })).toBe(97)
    expect(rewoundTo({ from: 3, heldMs: 5_000 })).toBe(0)
  })
})
