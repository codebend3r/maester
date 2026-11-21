import { classNames } from '@raven/ui/headless'
import { PLAYER_COPY } from '@raven/wren'
import type { Cover } from '@/music/useCovers'
import { RADII, type Size } from '@/theme/tokens'
import { AlbumArt } from '@/ui/AlbumArt/AlbumArt'
import { Pressable } from '@/ui/Pressable/Pressable'
import styles from '@/ui/PlayingSummary/PlayingSummary.module.scss'

type PlayingSummaryProps = {
  title: string
  artists: string
  /** The line under the title: the artists, or more about the track where there is room. */
  line: string
  /** What went wrong playing, said in the line's place. */
  error: string | null
  cover: Cover | null
  artSize: Size
  /** Where the place it sits in sets it, and the room between the art and the words. */
  className: string
  onOpen: () => void
}

/** What plays, as a press that opens Now Playing: its cover, its title and a line under it. */
export function PlayingSummary({
  title,
  artists,
  line,
  error,
  cover,
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
        <span className={styles.title}>{title}</span>
        <span className={error === null ? styles.line : styles.error}>{error ?? line}</span>
      </span>
    </Pressable>
  )
}
