import { type ItemSummary, itemPath } from '@raven/core'
import { Link } from 'react-router-dom'
import { POSTER_SIZES, posterSources } from '@/lib/posters'
import styles from '@/components/TitleCard/TitleCard.module.scss'

/**
 * A favourite show or season as a poster that opens its page, its title
 * and facts beneath: a season names its show.
 */
export const TitleCard = ({ item }: { item: ItemSummary }) => {
  const poster = posterSources({ item, sizes: POSTER_SIZES.grid })
  const facts = [item.show?.title ?? null, item.year == null ? null : String(item.year)].filter(
    (fact): fact is string => fact != null,
  )
  return (
    <li className={styles.card}>
      <Link to={itemPath(item) ?? '/'} className={styles.link}>
        <span className={styles.poster}>
          {poster ? (
            <img {...poster} alt="" loading="lazy" decoding="async" />
          ) : (
            <span aria-hidden="true">{item.title.slice(0, 1)}</span>
          )}
        </span>
        <span className={styles.words}>
          <span className={styles.title}>{item.title}</span>
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
