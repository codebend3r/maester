import type { Track } from '@raven/core'
import { classNames, isPlayingOf, useAudioQueue } from '@raven/ui/headless'
import type { SongLeadOf } from '@raven/wren'
import { type MouseEvent, useState } from 'react'
import { TrackMenu } from '@/components/TrackMenu/TrackMenu'
import { useTrackLike } from '@/lib/useTrackLike'
import type { Cover } from '@/music/useCovers'
import { SongRow } from '@/ui/SongRow/SongRow'
import styles from '@/components/TrackRow/TrackRow.module.scss'

type TrackRowProps = {
  track: Track
  /** Its number on its album's page, or its cover in a list of many albums' songs. */
  lead: SongLeadOf<Cover>
  /** What sits under the title: the artists, or nothing on their own album. */
  subtitle?: string | null
  length: string
  /** What the row is called aloud. */
  label: string
  /** Whether it is the queue's track: its title in red, and its number the equalizer. */
  isCurrent: boolean
  /** Whether the row sits inset and the queue's track stands out in a soft fill: the wide layout's tracklist. */
  isHighlighted?: boolean
  onPress: () => void
}

/**
 * A track in a list: a press plays from it, and its More, a right click or the context menu
 * key opens its sheet: Play next, Add to queue, Add to playlist, Go to album and Go to artist.
 */
export function TrackRow({
  track,
  lead,
  subtitle = null,
  length,
  label,
  isCurrent,
  isHighlighted = false,
  onPress,
}: TrackRowProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const isPlaying = useAudioQueue((store) => isCurrent && isPlayingOf(store))
  const like = useTrackLike({ track })
  const openMenu = () => setIsMenuOpen(true)
  /*
   * The row's own menu stands in for the browser's, as the apps' long press opens it. A right
   * click inside the sheet once it is up is the browser's own, so a field there still pastes.
   */
  const openFromContext = (event: MouseEvent) => {
    if (isMenuOpen) return
    event.preventDefault()
    openMenu()
  }
  return (
    <div
      className={classNames([
        styles.track,
        isHighlighted && styles.inset,
        isHighlighted && isCurrent && styles.highlighted,
      ])}
      onContextMenu={openFromContext}
    >
      <SongRow
        duration={length}
        isCurrent={isCurrent}
        isPlaying={isPlaying}
        label={label}
        lead={lead}
        like={like}
        onMore={openMenu}
        onPress={onPress}
        subtitle={subtitle}
        title={track.title}
      />
      {isMenuOpen && <TrackMenu like={like} onClose={() => setIsMenuOpen(false)} track={track} />}
    </div>
  )
}
