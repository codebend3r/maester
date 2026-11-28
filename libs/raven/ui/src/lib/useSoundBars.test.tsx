import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from 'bun:test'
import { act, cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { LESS_MOTION } from '@/lib/lessMotion'
import { SOUND_BAR_FLOOR, SOUND_BAR_LEVEL, useSoundBars } from '@/lib/useSoundBars'
import { type SoundLevels, useSoundMeter } from '@/stores/soundMeter'

type BarsProps = { isPlaying: boolean }

const Bars = ({ isPlaying }: BarsProps) => {
  const ref = useRef<HTMLSpanElement>(null)
  useSoundBars({ ref, isPlaying })
  return (
    <span ref={ref}>
      <span />
      <span />
      <span />
    </span>
  )
}

/** The frames asked for and not yet drawn, run one at a time by `nextFrame`. */
const frames: FrameRequestCallback[] = []

const nextFrame = () => act(() => frames.shift()?.(0))

/** A meter that answers `values`, whatever the count, and counts its reads. */
const meterOf = (values: readonly number[]) => {
  const reads: number[] = []
  const levels: SoundLevels = ({ count }) => {
    reads.push(count)
    return values
  }
  return { levels, reads }
}

const heights = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('span > span')).map((bar) =>
    bar instanceof HTMLElement ? bar.style.getPropertyValue(SOUND_BAR_LEVEL) : '',
  )

describe('useSoundBars', () => {
  beforeEach(() => {
    frames.length = 0
    spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      frames.length = 0
    })
  })

  afterEach(() => {
    cleanup()
    jest.restoreAllMocks()
    useSoundMeter.setState({ levels: null })
  })

  it('sets each bar to its band on every frame while the track plays, never below the floor', () => {
    const meter = meterOf([1, 0, 0.5])
    useSoundMeter.getState().claim(meter.levels)
    const { container } = render(<Bars isPlaying />)
    nextFrame()
    expect(meter.reads).toEqual([3])
    expect(heights(container)).toEqual([
      '1',
      String(SOUND_BAR_FLOOR),
      String(SOUND_BAR_FLOOR + (1 - SOUND_BAR_FLOOR) / 2),
    ])
    nextFrame()
    expect(meter.reads).toEqual([3, 3])
  })

  it('stops on a pause, so the bars hold where they were', () => {
    const meter = meterOf([1, 1, 1])
    useSoundMeter.getState().claim(meter.levels)
    const { container, rerender } = render(<Bars isPlaying />)
    nextFrame()
    rerender(<Bars isPlaying={false} />)
    expect(frames).toHaveLength(0)
    expect(heights(container)).toEqual(['1', '1', '1'])
  })

  it('holds the rest heights with no meter, and goes back to them when the meter goes', () => {
    const { container, rerender } = render(<Bars isPlaying />)
    expect(frames).toHaveLength(0)
    expect(heights(container)).toEqual(['', '', ''])
    act(() => {
      useSoundMeter.getState().claim(meterOf([1, 1, 1]).levels)
    })
    rerender(<Bars isPlaying />)
    nextFrame()
    act(() => useSoundMeter.setState({ levels: null }))
    expect(frames).toHaveLength(0)
    expect(heights(container)).toEqual(['', '', ''])
  })

  it('holds the rest heights for a viewer who asks for less motion', () => {
    const real = window.matchMedia.bind(window)
    spyOn(window, 'matchMedia').mockImplementation((query) =>
      real(query === LESS_MOTION ? 'all' : 'not all'),
    )
    useSoundMeter.getState().claim(meterOf([1, 1, 1]).levels)
    const { container } = render(<Bars isPlaying />)
    expect(frames).toHaveLength(0)
    expect(heights(container)).toEqual(['', '', ''])
  })
})
