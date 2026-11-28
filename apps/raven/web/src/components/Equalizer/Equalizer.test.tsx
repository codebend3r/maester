import { EQUALIZER_MARK, EQUALIZER_SIZES, LESS_MOTION, SOUND_BAR_LEVEL } from '@raven/ui'
import { type SoundLevels, useSoundMeter } from '@raven/ui/headless'
import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from 'bun:test'
import { act, cleanup, render } from '@testing-library/react'
import { Equalizer } from '@/components/Equalizer/Equalizer'

/** The frames asked for and not yet drawn, run one at a time by `nextFrame`. */
const frames: FrameRequestCallback[] = []

const nextFrame = () => act(() => frames.shift()?.(0))

/** A meter as loud as `level` in every band. */
const steady =
  (level: number): SoundLevels =>
  ({ count }) =>
    Array.from({ length: count }, () => level)

const barLevels = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll(`[${EQUALIZER_MARK}] > span`)).map((bar) =>
    bar instanceof HTMLElement ? bar.style.getPropertyValue(SOUND_BAR_LEVEL) : '',
  )

describe('Equalizer', () => {
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

  it('stands medium unless told a size', () => {
    const { container } = render(
      <>
        <Equalizer isPlaying />
        <Equalizer isPlaying size={EQUALIZER_SIZES.small} />
      </>,
    )
    expect(
      Array.from(container.querySelectorAll(`[${EQUALIZER_MARK}]`)).map((bars) =>
        bars.getAttribute(EQUALIZER_MARK),
      ),
    ).toEqual([EQUALIZER_SIZES.medium, EQUALIZER_SIZES.small])
  })

  it('follows the sound while playing and holds where it was when paused', () => {
    useSoundMeter.getState().claim(steady(1))
    const { container, rerender } = render(<Equalizer isPlaying />)
    nextFrame()
    expect(barLevels(container)).toEqual(['1', '1', '1', '1', '1'])
    rerender(<Equalizer isPlaying={false} />)
    act(() => {
      useSoundMeter.getState().claim(steady(0.5))
    })
    expect(frames).toHaveLength(0)
    expect(barLevels(container)).toEqual(['1', '1', '1', '1', '1'])
  })

  it('rests, still, while nothing measures the sound', () => {
    const { container } = render(<Equalizer isPlaying />)
    expect(frames).toHaveLength(0)
    expect(barLevels(container)).toEqual(['', '', '', '', ''])
  })

  it('rests, still, for a viewer who asks for less motion', () => {
    const real = window.matchMedia.bind(window)
    spyOn(window, 'matchMedia').mockImplementation((query) =>
      real(query === LESS_MOTION ? 'all' : 'not all'),
    )
    useSoundMeter.getState().claim(steady(1))
    const { container } = render(<Equalizer isPlaying />)
    expect(frames).toHaveLength(0)
    expect(barLevels(container)).toEqual(['', '', '', '', ''])
  })
})
