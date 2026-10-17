import type { SlideshowMotion } from '@raven/core'
import { useEffect, useState, useSyncExternalStore } from 'react'
import styles from '@/components/Slideshow/Slideshow.module.scss'

/** How long each picture holds before the next comes in; the stylesheet reads it as `--slide-ms`. */
export const SLIDE_MS = 8000

/**
 * A picture's part in the show: the one up when it began, which comes in
 * with no entrance; the one coming in or up since; the one it covers or
 * pushes out; and the next, laid out unseen so it has loaded by its turn.
 */
export type SlideRole = 'first' | 'current' | 'previous' | 'upcoming'

const ROLES = {
  first: styles.first,
  current: styles.current,
  previous: styles.previous,
  upcoming: undefined,
} as const satisfies Record<SlideRole, string | undefined>

const MOTIONS = {
  fade: styles.fade,
  kenBurns: styles.kenBurns,
  slide: styles.slide,
} as const satisfies Record<SlideshowMotion, string | undefined>

/**
 * The pictures laid out `step` changes in, each with its part, in the
 * order they came, so the ones already laid out never swap places and
 * restart their motion. With two pictures, the one going out is also the
 * next, and keeps its part going out.
 */
export const slideRoles = <T,>({
  slides,
  step,
}: {
  slides: readonly T[]
  step: number
}): Array<{ slide: T; role: SlideRole }> => {
  const at = (offset: number) => (step + offset) % slides.length
  const roleOf = (index: number): SlideRole | null => {
    if (index === at(0)) return step === 0 ? 'first' : 'current'
    if (step > 0 && index === at(slides.length - 1)) return 'previous'
    return index === at(1) ? 'upcoming' : null
  }
  return slides.flatMap((slide, index) => {
    const role = roleOf(index)
    return role ? [{ slide, role }] : []
  })
}

export const LESS_MOTION = '(prefers-reduced-motion: reduce)'

const followLessMotion = (onChange: () => void) => {
  const query = window.matchMedia(LESS_MOTION)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/**
 * Counts the changes of picture, one every `SLIDE_MS` while there is more
 * than one to show. While the browser asks for less motion it holds the
 * one up, and carries on once it stops asking.
 */
const useStep = (count: number): number => {
  const [step, setStep] = useState(0)
  const isStill = useSyncExternalStore(
    followLessMotion,
    () => window.matchMedia(LESS_MOTION).matches,
  )
  useEffect(() => {
    if (isStill || count < 2) return undefined
    const timer = window.setInterval(() => setStep((now) => now + 1), SLIDE_MS)
    return () => window.clearInterval(timer)
  }, [count, isStill])
  return step
}

/**
 * Pictures shown one after another, first to last and round again, each
 * coming in by `motion`: a cross fade, a slow zoom as it fades in, or a
 * slide that pushes the last one out. Decorative: it takes no pointer and
 * says nothing to a screen reader. `className` frames it.
 */
export const Slideshow = ({
  slides,
  motion,
  className,
}: {
  slides: readonly string[]
  motion: SlideshowMotion
  className?: string
}) => {
  const step = useStep(slides.length)
  return (
    <div
      className={[styles.slideshow, MOTIONS[motion], className].filter(Boolean).join(' ')}
      aria-hidden="true"
      ref={(node) => node?.style.setProperty('--slide-ms', `${SLIDE_MS}ms`)}
    >
      {slideRoles({ slides, step }).map(({ slide, role }) => (
        <img
          key={slide}
          className={[styles.picture, ROLES[role]].filter(Boolean).join(' ')}
          src={slide}
          alt=""
          decoding="async"
        />
      ))}
    </div>
  )
}
