import { type RefObject, useEffect } from 'react'
import { useAsksForLessMotion } from '@/lib/lessMotion'
import { useSoundMeter } from '@/stores/soundMeter'

/**
 * The custom property each bar's height reads, from 0 to 1 of the tallest. A bar with none
 * set stands at the rest height its stylesheet gives it.
 */
export const SOUND_BAR_LEVEL = '--bar-level'

/** The least a bar shows while the sound moves it, so a quiet passage never flattens it away. */
export const SOUND_BAR_FLOOR = 0.15

/** How big an equalizer's bars stand: small in a track's row, medium beside a title, large where there is room. */
export const EQUALIZER_SIZES = { small: 'small', medium: 'medium', large: 'large' } as const

export type EqualizerSize = (typeof EQUALIZER_SIZES)[keyof typeof EQUALIZER_SIZES]

/** The attribute every equalizer carries, naming its size, so a test finds one no screen reader is told of. */
export const EQUALIZER_MARK = 'data-equalizer'

const isHtmlElement = (node: Element): node is HTMLElement => node instanceof HTMLElement

/** A band's level as a bar's height: lifted onto the floor, so silence still shows a sliver. */
const heightOf = (level: number): number =>
  SOUND_BAR_FLOOR + (1 - SOUND_BAR_FLOOR) * Math.min(1, Math.max(0, level))

type UseSoundBarsProps = {
  /** The bars' row: each of its children is one bar, the lowest band first. */
  ref: RefObject<HTMLElement | null>
  /** Whether the bars' track plays: they follow the sound while it does, and hold while it is paused. */
  isPlaying: boolean
}

/**
 * Moves equalizer bars with what plays: on every frame while the track plays, each child of
 * `ref` gets its band's level from `useSoundMeter` as `SOUND_BAR_LEVEL`, written to the
 * element, never to React state. Paused, the loop stops and the bars hold where they are;
 * with no meter, or for a viewer who asks for less motion, they go back to their rest heights.
 */
export const useSoundBars = ({ ref, isPlaying }: UseSoundBarsProps): void => {
  const levels = useSoundMeter((meter) => meter.levels)
  const isStill = useAsksForLessMotion()

  useEffect(() => {
    const row = ref.current
    if (row === null) return
    const bars = Array.from(row.children).filter(isHtmlElement)
    if (levels === null || isStill) {
      bars.forEach((bar) => bar.style.removeProperty(SOUND_BAR_LEVEL))
      return
    }
    if (!isPlaying) return
    let frame = 0
    const draw = () => {
      const read = levels({ count: bars.length })
      bars.forEach((bar, band) =>
        bar.style.setProperty(SOUND_BAR_LEVEL, String(heightOf(read[band] ?? 0))),
      )
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [ref, levels, isPlaying, isStill])
}
