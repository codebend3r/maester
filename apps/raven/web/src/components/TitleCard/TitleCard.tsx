import { type AppPath, type ItemSummary, itemPath } from '@raven/core'
import { Link } from 'react-router-dom'
import { ItemPoster } from '@/components/PosterImage/PosterImage'
import { POSTER_SIZES } from '@/lib/posters'
import styles from '@/components/TitleCard/TitleCard.module.scss'

type PosterTitleCardProps = {
  /** The item whose poster the card wears. */
  poster: ItemSummary
  to: AppPath
  title: string
  facts: readonly string[]
}

/** A poster that opens a page, its title and facts beneath, a dot apart. */
export const PosterTitleCard = ({ poster: item, to, title, facts }: PosterTitleCardProps) => (
  <li className={styles.card}>
    <Link to={to} className={styles.link}>
      <span className={styles.poster}>
        <ItemPoster item={item} sizes={POSTER_SIZES.grid} />
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
