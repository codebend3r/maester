import { Button, ButtonLink } from '@raven/ui'
import { Fragment, type KeyboardEvent, useEffect, useState, useSyncExternalStore } from 'react'
import type { Featured } from '@/pages/HomePage/featured'
import { PictureFact } from '@/components/ResolutionChip/ResolutionChip'
import { HOME_COPY } from '@/pages/HomePage/copy'
import styles from '@/pages/HomePage/HomeHero.module.scss'
import { COMMON_COPY } from '@/lib/copy'

/** How long each arrival holds before the next takes its place. */
export const HERO_MS = 7000

/** The sizes a title is set at, from the hero's own down. */
const TITLE_SIZES = { display: undefined, long: styles.long, longest: styles.longest } as const

/**
 * How big a title is set: as big as it goes while it is short, a size down
 * past 16 characters or for a word of more than 9, and down again past 36,
 * so every title stays two or three lines tall and its words fit the
 * column whole. The arrivals change in place, so their titles keep near
 * one height.
 */
export const titleSize = (title: string): keyof typeof TITLE_SIZES => {
  if (title.length > 36) return 'longest'
  return title.length > 16 || title.split(' ').some((word) => word.length > 9) ? 'long' : 'display'
}

export const LESS_MOTION = '(prefers-reduced-motion: reduce)'

const followLessMotion = (onChange: () => void) => {
  const query = window.matchMedia(LESS_MOTION)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

const asksForLessMotion = () => window.matchMedia(LESS_MOTION).matches

/** A poster's place in the fan: on top, tilted out to either side, or tucked away behind. */
const FAN = {
  front: styles.front,
  next: styles.next,
  previous: styles.previous,
  away: styles.away,
} as const

/** How far past the front a poster is still fetched: the next, and the one after it. */
const FAN_LOADED = 2

type FanPlaceProps = { offset: number; count: number }

const fanPlace = ({ offset, count }: FanPlaceProps): keyof typeof FAN => {
  if (offset === 0) return 'front'
  if (offset === 1) return 'next'
  return offset === count - 1 ? 'previous' : 'away'
}

type IsInWashProps = {
  index: number
  at: number
  from: number | null
  count: number
}

/**
 * Which backdrops the wash lays out: the one up, the one it took over from,
 * fading out, and the next, loading unseen so it is there by its turn.
 */
const isInWash = ({ index, at, from, count }: IsInWashProps): boolean =>
  index === at || index === from || index === (at + 1) % count

const STEPS: Readonly<Partial<Record<string, number>>> = { ArrowLeft: -1, ArrowRight: 1 }

/**
 * Whether `node` has the pointer over it or the focus inside it, followed
 * as they come and go. A focus moving between controls inside it stays.
 */
const useAttention = (node: HTMLElement | null): boolean => {
  const [isPointedAt, setPointedAt] = useState(false)
  const [isFocused, setFocused] = useState(false)
  useEffect(() => {
    if (!node) return undefined
    const enter = () => setPointedAt(true)
    const leave = () => setPointedAt(false)
    const focusIn = () => setFocused(true)
    const focusOut = (event: FocusEvent) => {
      const { relatedTarget } = event
      if (!(relatedTarget instanceof Node && node.contains(relatedTarget))) setFocused(false)
    }
    node.addEventListener('pointerenter', enter)
    node.addEventListener('pointerleave', leave)
    node.addEventListener('focusin', focusIn)
    node.addEventListener('focusout', focusOut)
    return () => {
      node.removeEventListener('pointerenter', enter)
      node.removeEventListener('pointerleave', leave)
      node.removeEventListener('focusin', focusIn)
      node.removeEventListener('focusout', focusOut)
    }
  }, [node])
  return isPointedAt || isFocused
}

type SlideProps = {
  entry: Featured
  /** "2 of 5". */
  place: string
  isCurrent: boolean
}

/**
 * One arrival's words: where it came, its title and line, Play, the way to
 * its page and what it is. Every arrival's are laid out in one cell, so the
 * hero stays as tall as the tallest and nothing under it jumps as they
 * change; all but the current one are hidden, from sight, the focus and a
 * screen reader alike.
 */
const Slide = ({ entry, place, isCurrent }: SlideProps) => (
  <article
    className={isCurrent ? `${styles.slide} ${styles.current}` : styles.slide}
    aria-roledescription={HOME_COPY.slide}
    aria-label={place}
    aria-hidden={!isCurrent}
    inert={!isCurrent}
  >
    <p className={styles.eyebrow}>{entry.eyebrow}</p>
    <h2 className={[styles.title, TITLE_SIZES[titleSize(entry.title)]].filter(Boolean).join(' ')}>
      {entry.title}
    </h2>
    <p className={styles.line}>{entry.line}</p>
    <div className={styles.actions}>
      <div className={styles.buttons}>
        {entry.play && (
          <ButtonLink
            tone="primary"
            size="large"
            icon="play"
            to={entry.play.to}
            state={entry.play.state}
            aria-label={HOME_COPY.playTitle(entry.title)}
          >
            {COMMON_COPY.play}
          </ButtonLink>
        )}
        <ButtonLink size="large" to={entry.details}>
          {HOME_COPY.details}
        </ButtonLink>
      </div>
      <p className={styles.facts}>
        {entry.facts.map((fact, index) => (
          <Fragment key={fact}>
            {index > 0 && <span aria-hidden="true">{COMMON_COPY.separator}</span>}
            {fact}
          </Fragment>
        ))}
        {entry.picture && (
          <>
            {entry.facts.length > 0 && <span aria-hidden="true">{COMMON_COPY.separator}</span>}
            <PictureFact
              resolution={entry.picture.resolution}
              rest={entry.picture.isHdr ? COMMON_COPY.hdr : null}
            />
          </>
        )}
      </p>
    </div>
  </article>
)

type HomeHeroProps = { featured: Featured[] }

/**
 * Home's hero: the newest arrivals in turn, each with its title, its line,
 * Play and a way to its page, beside a fan of the posters before and after
 * it, its backdrop washing the ground behind. It moves on every few seconds,
 * holding still while it is pointed at or holds the focus, and for a
 * browser that asks for less motion. Previous and Next, or the arrow keys on
 * them, step through by hand, and a screen reader hears where it landed.
 */
export const HomeHero = ({ featured }: HomeHeroProps) => {
  const count = featured.length
  const [turn, setTurn] = useState<{ index: number; from: number | null }>({
    index: 0,
    from: null,
  })
  const [node, setNode] = useState<HTMLElement | null>(null)
  const isAttendedTo = useAttention(node)
  const isStill = useSyncExternalStore(followLessMotion, asksForLessMotion)
  const at = turn.index % count
  const isHeld = isStill || isAttendedTo || count < 2

  useEffect(() => {
    if (isHeld) return undefined
    const timer = window.setTimeout(() => setTurn({ index: (at + 1) % count, from: at }), HERO_MS)
    return () => window.clearTimeout(timer)
  }, [isHeld, at, count])

  const current = featured[at]

  const step = (by: number) => setTurn({ index: (at + by + count) % count, from: at })
  const onKeyDown = (event: KeyboardEvent) => {
    const by = STEPS[event.key]
    if (by == null) return
    event.preventDefault()
    step(by)
  }

  return (
    <section
      ref={setNode}
      className={styles.hero}
      aria-roledescription={HOME_COPY.carousel}
      aria-label={HOME_COPY.featured}
    >
      <div className={styles.wash} aria-hidden="true">
        {featured
          .map((entry, index) => ({ entry, index }))
          .filter(({ index }) => isInWash({ index, at, from: turn.from, count }))
          .map(({ entry: { key, backdrop }, index }) => (
            <img
              key={key}
              className={index === at ? `${styles.backdrop} ${styles.shown}` : styles.backdrop}
              src={backdrop}
              alt=""
              decoding="async"
              fetchPriority={index === at ? 'high' : 'auto'}
            />
          ))}
      </div>

      <div className={styles.slides}>
        {featured.map((entry, index) => (
          <Slide
            key={entry.key}
            entry={entry}
            place={HOME_COPY.place({ at: index + 1, count })}
            isCurrent={index === at}
          />
        ))}
      </div>

      {count > 1 && (
        <div className={styles.controls}>
          <Button
            tone="pill"
            icon="back"
            aria-label={HOME_COPY.previous}
            onClick={() => step(-1)}
            onKeyDown={onKeyDown}
          />
          <Button
            tone="pill"
            icon="next"
            aria-label={HOME_COPY.next}
            onClick={() => step(1)}
            onKeyDown={onKeyDown}
          />
          <span className={styles.count} aria-hidden="true">
            {HOME_COPY.counter({ at: at + 1, count })}
          </span>
        </div>
      )}
      <p className="visually-hidden" aria-live={isHeld ? 'polite' : 'off'}>
        {HOME_COPY.announcement({ title: current?.title ?? '', at: at + 1, count })}
      </p>

      <div className={styles.stack} aria-hidden="true">
        <div className={styles.fan}>
          {featured
            .map((entry, index) => ({ entry, offset: (index - at + count) % count }))
            // Only the posters in view, and the one the next turn brings in, are fetched.
            .filter(({ offset }) => offset <= FAN_LOADED || offset === count - 1)
            .map(({ entry: { key, poster }, offset }) => (
              <img
                key={key}
                className={`${styles.poster} ${FAN[fanPlace({ offset, count })]}`}
                src={poster}
                alt=""
                decoding="async"
                fetchPriority={offset === 0 ? 'high' : 'auto'}
              />
            ))}
        </div>
      </div>
    </section>
  )
}
