import { classNames } from '@raven/ui/headless'
import { PLAYER_COPY } from '@raven/wren'
import type { Cover } from '@/music/useCovers'
import { RADII, type Size } from '@/theme/tokens'
import { AlbumArt } from '@/ui/AlbumArt/AlbumArt'
import { EqualizerIndicator } from '@/ui/EqualizerIndicator/EqualizerIndicator'
import { Pressable } from '@/ui/Pressable/Pressable'
import styles from '@/ui/PlayingSummary/PlayingSummary.module.scss'

type PlayingSummaryProps = {
  title: string
  artists: string
  /** The line under the title: the artists, or more about the track where there is room. */
  line: string
  /** The file's format and quality, a line of its own under the other; null where there is no room. */
  quality: string | null
  /** What went wrong playing, said in the line's place. */
  error: string | null
  cover: Cover | null
  /** Whether it plays rather than being paused, so the equalizer before the title moves. */
  isPlaying: boolean
  artSize: Size
  /** Where the place it sits in sets it, and the room between the art and the words. */
  className: string
  onOpen: () => void
}

/**
 * What plays, as a press that opens Now Playing: its cover, the equalizer before its title, and a
 * line under it.
 */
export function PlayingSummary({
  title,
  artists,
  line,
  quality,
  error,
  cover,
  isPlaying,
  artSize,
  className,
  onOpen,
}: PlayingSummaryProps) {
  return (
    <Pressable
      className={classNames([styles.summary, className])}
      label={PLAYER_COPY.open({ title, artists })}
      onPress={onOpen}
    >
      <AlbumArt cover={cover} radius={RADII.thumb} size={artSize} />
      <span className={styles.text}>
        <span className={styles.heading}>
          <EqualizerIndicator isPlaying={isPlaying} />
          <span className={styles.title}>{title}</span>
        </span>
        <span className={error === null ? styles.line : styles.error}>{error ?? line}</span>
        {quality !== null && error === null && <span className={styles.quality}>{quality}</span>}
      </span>
    </Pressable>
  )
}
