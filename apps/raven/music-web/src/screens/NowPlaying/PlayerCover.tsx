import { classNames } from '@raven/ui/headless'
import type { Playing } from '@/screens/NowPlaying/usePlaying'
import { RADII } from '@/theme/tokens'
import { AlbumArt } from '@/ui/AlbumArt/AlbumArt'
import styles from '@/screens/NowPlaying/PlayerCover.module.scss'

type PlayerCoverProps = {
  cover: Playing['cover']
  /** The layout's own class, which sizes the cover to its column. */
  className: string
}

/** The playing song's cover, large and raised, in the middle of its column. */
export function PlayerCover({ cover, className }: PlayerCoverProps) {
  return (
    <span className={classNames([styles.cover, className])}>
      <AlbumArt cover={cover} isRaised radius={RADII.art} />
    </span>
  )
}
