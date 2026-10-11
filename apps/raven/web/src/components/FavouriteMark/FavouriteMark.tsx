import type { MediaItem } from '@raven/core'
import { Icon } from '@/components/Icon/Icon'
import styles from '@/components/FavouriteMark/FavouriteMark.module.scss'

/** The heart beside a favourite's facts; nothing for any other video. */
export const FavouriteMark = ({ media }: { media: MediaItem }) =>
  media.favourite && (
    <span className={styles.mark}>
      <Icon name="heart" size={14} />
      <span className="visually-hidden">Favourite</span>
    </span>
  )
