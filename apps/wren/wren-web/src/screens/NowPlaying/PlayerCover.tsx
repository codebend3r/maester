import { classNames } from '@raven/ui/headless'
import { useState } from 'react'
import type { Playing } from '@/screens/NowPlaying/usePlaying'
import { RADII } from '@/theme/tokens'
import { AlbumArt } from '@/ui/AlbumArt/AlbumArt'
import { TrackCoverMenu } from '@/ui/CoverMenu/CoverMenu'
import styles from '@/screens/NowPlaying/PlayerCover.module.scss'

type PlayerCoverProps = Pick<Playing, 'cover' | 'track'> & {
  /** The layout's own class, which sizes the cover to its column. */
  className: string
}

/**
 * The playing song's cover, large and raised, in the middle of its column. Held, it opens the
 * song's cover menu: what it is, Go to album and Go to artist.
 */
export function PlayerCover({ cover, track, className }: PlayerCoverProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  return (
    <span className={classNames([styles.cover, className])}>
      <AlbumArt cover={cover} isRaised onHold={() => setIsMenuOpen(true)} radius={RADII.art} />
      {isMenuOpen && <TrackCoverMenu onClose={() => setIsMenuOpen(false)} track={track} />}
    </span>
  )
}
