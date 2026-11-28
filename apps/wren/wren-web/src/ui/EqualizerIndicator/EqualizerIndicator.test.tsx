import { EQUALIZER_MARK, EQUALIZER_SIZES, SOUND_BAR_LEVEL } from '@raven/ui'
import { type SoundLevels, useSoundMeter } from '@raven/ui/headless'
import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from 'bun:test'
import { act, cleanup, render } from '@testing-library/react'
import { renderKitWithRoutes } from '@/test/render'
import { EqualizerIndicator } from '@/ui/EqualizerIndicator/EqualizerIndicator'

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

describe('EqualizerIndicator', () => {
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

  it('keeps the equalizer from a screen reader, which hears the row instead', () => {
    const { container } = renderKitWithRoutes(<EqualizerIndicator isPlaying />)

    expect(container.querySelector('[aria-hidden="true"]')?.children ?? []).toHaveLength(4)
  })

  it('stands small unless told a size', () => {
    const { container } = renderKitWithRoutes(
      <>
        <EqualizerIndicator isPlaying />
        <EqualizerIndicator isPlaying size={EQUALIZER_SIZES.large} />
      </>,
    )

    expect(
      Array.from(container.querySelectorAll(`[${EQUALIZER_MARK}]`)).map((bars) =>
        bars.getAttribute(EQUALIZER_MARK),
      ),
    ).toEqual([EQUALIZER_SIZES.small, EQUALIZER_SIZES.large])
  })

  it('follows the sound while the track plays, and holds where it was once it is paused', () => {
    useSoundMeter.getState().claim(steady(1))
    const { container, rerender } = render(<EqualizerIndicator isPlaying />)
    nextFrame()
    expect(barLevels(container)).toEqual(['1', '1', '1', '1'])

    rerender(<EqualizerIndicator isPlaying={false} />)
    act(() => {
      useSoundMeter.getState().claim(steady(0.5))
    })
    expect(frames).toHaveLength(0)
    expect(barLevels(container)).toEqual(['1', '1', '1', '1'])
  })

  it('rests, still, while nothing measures the sound', () => {
    const { container } = renderKitWithRoutes(<EqualizerIndicator isPlaying />)
    expect(frames).toHaveLength(0)
    expect(barLevels(container)).toEqual(['', '', '', ''])
  })
})
