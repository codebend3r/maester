import { describe, expect, it } from 'vitest'
import { POINT_SECONDS, sharedRun } from '@/markers/fingerprintMatch'
import { noise, pointsFor, withTheme } from '@/test/fingerprints'

describe('sharedRun', () => {
  const theme = noise({ seed: 7, count: pointsFor(40) })

  it('finds a theme two files share at different offsets, in seconds of each', () => {
    const own = withTheme({ seed: 1, seconds: 300, theme, at: 43 })
    const theirs = withTheme({ seed: 2, seconds: 300, theme, at: 120 })
    const run = sharedRun({ own: { start: 0, points: own }, theirs: { start: 0, points: theirs } })
    expect(run?.start ?? Number.NaN).toBeCloseTo(43, 0)
    expect(run?.end ?? Number.NaN).toBeCloseTo(83, 0)
    expect(run?.theirStart ?? Number.NaN).toBeCloseTo(120, 0)
  })

  it('hears through points that differ by a few bits, as a re-encode does', () => {
    const own = withTheme({ seed: 3, seconds: 200, theme, at: 10 })
    const blurred = withTheme({
      seed: 4,
      seconds: 200,
      theme: theme.map((point, index) => (index % 3 === 0 ? (point ^ 0b101) >>> 0 : point)),
      at: 60,
    })
    const run = sharedRun({ own: { start: 0, points: own }, theirs: { start: 0, points: blurred } })
    expect((run?.end ?? 0) - (run?.start ?? 0)).toBeGreaterThan(38)
  })

  it('finds nothing in two files that share no sound', () => {
    const own = noise({ seed: 5, count: pointsFor(300) })
    const theirs = noise({ seed: 6, count: pointsFor(300) })
    expect(
      sharedRun({ own: { start: 0, points: own }, theirs: { start: 0, points: theirs } }),
    ).toBeNull()
  })

  it('keeps the longer of two shared stretches, and only one within its bounds', () => {
    const sting = noise({ seed: 8, count: pointsFor(20) })
    const own = withTheme({
      seed: 9,
      seconds: 400,
      theme: [...sting, ...noise({ seed: 10, count: pointsFor(30) }), ...theme],
      at: 50,
    })
    const theirs = withTheme({
      seed: 11,
      seconds: 400,
      theme: [...sting, ...noise({ seed: 12, count: pointsFor(60) }), ...theme],
      at: 100,
    })
    const run = sharedRun({ own: { start: 0, points: own }, theirs: { start: 0, points: theirs } })
    expect((run?.end ?? 0) - (run?.start ?? 0)).toBeCloseTo(40, 0)
    expect(
      sharedRun({
        own: { start: 0, points: own },
        theirs: { start: 0, points: theirs },
        bounds: { min: 15, max: 30 },
      }),
    ).toMatchObject({ start: expect.closeTo(50, 0) })
  })

  it('counts from where each fingerprint starts in its file', () => {
    const own = withTheme({ seed: 13, seconds: 100, theme, at: 5 })
    const run = sharedRun({
      own: { start: 600, points: own },
      theirs: { start: 0, points: withTheme({ seed: 14, seconds: 100, theme, at: 5 }) },
    })
    expect(run?.start ?? Number.NaN).toBeCloseTo(605, 0)
    expect(POINT_SECONDS).toBeCloseTo(0.1238, 4)
  })
})
