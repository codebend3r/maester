import { type AppPath, type ItemSummary, itemPath } from '@raven/core'
import type { ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { POSTER_SIZES, posterSources } from '@/lib/posters'
import styles from '@/components/TitleCard/TitleCard.module.scss'

/** Whether the title has a poster to show, or stands in with its initial. */
const POSTER_STATES = { picture: 'picture', initial: 'initial' } as const

type PosterState = (typeof POSTER_STATES)[keyof typeof POSTER_STATES]

type PosterViewProps = { item: ItemSummary; poster: ReturnType<typeof posterSources> }

type PosterPictureProps = PosterViewProps

const PosterPicture = ({ poster }: PosterPictureProps) => (
  <img {...poster} alt="" loading="lazy" decoding="async" />
)

type PosterInitialProps = PosterViewProps

const PosterInitial = ({ item }: PosterInitialProps) => (
  <span aria-hidden="true">{item.title.slice(0, 1)}</span>
)

const POSTER_VIEWS = {
  [POSTER_STATES.picture]: PosterPicture,
  [POSTER_STATES.initial]: PosterInitial,
} as const satisfies Record<PosterState, ComponentType<PosterViewProps>>

type PosterTitleCardProps = {
  /** The item whose poster the card wears. */
  poster: ItemSummary
  to: AppPath
  title: string
  facts: readonly string[]
}

/** A poster that opens a page, its title and facts beneath, a dot apart. */
export const PosterTitleCard = ({ poster: item, to, title, facts }: PosterTitleCardProps) => {
  const poster = posterSources({ item, sizes: POSTER_SIZES.grid })
  const Poster = POSTER_VIEWS[poster ? POSTER_STATES.picture : POSTER_STATES.initial]
  return (
    <li className={styles.card}>
      <Link to={to} className={styles.link}>
        <span className={styles.poster}>
          <Poster item={item} poster={poster} />
        </span>
        <span className={styles.words}>
          <span className={styles.title}>{title}</span>
          <span className={styles.facts}>
            {facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </span>
        </span>
      </Link>
    </li>
  )
}

type TitleCardProps = { item: ItemSummary }

/**
 * A favourite show or season as a poster that opens its page, its title
 * and facts beneath: a season names its show.
 */
export const TitleCard = ({ item }: TitleCardProps) => (
  <PosterTitleCard
    poster={item}
    to={itemPath(item) ?? '/'}
    title={item.title}
    facts={[item.show?.title ?? null, item.year == null ? null : String(item.year)].filter(
      (fact): fact is string => fact != null,
    )}
  />
)
