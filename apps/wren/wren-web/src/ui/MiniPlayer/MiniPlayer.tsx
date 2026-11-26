import { PLAYER_COPY, WREN_ICONS } from '@raven/wren'
import type { Cover } from '@/music/useCovers'
import { COLORS, SIZES, type TokenStyle } from '@/theme/tokens'
import { IconButton } from '@/ui/IconButton/IconButton'
import { PlayingSummary } from '@/ui/PlayingSummary/PlayingSummary'
import styles from '@/ui/MiniPlayer/MiniPlayer.module.scss'

type MiniPlayerProps = {
  title: string
  artists: string
  cover: Cover | null
  /** What went wrong playing, said in the artists' place. */
  error: string | null
  isPlaying: boolean
  /** How far through the track it is, from 0 to 1. */
  progress: number
  onOpen: () => void
  onToggle: () => void
  onNext: () => void
}

/**
 * The narrow layout's floating card while a track is queued: its cover, title and artists, pause
 * or play and next, and a thin red line for how far it has played. A press opens Now Playing.
 */
export function MiniPlayer({
  title,
  artists,
  cover,
  error,
  isPlaying,
  progress,
  onOpen,
  onToggle,
  onNext,
}: MiniPlayerProps) {
  const played: TokenStyle = { '--played': `${Math.round(progress * 100)}%` }
  return (
    <section className={styles.card}>
      <PlayingSummary
        artSize={SIZES.miniArt}
        artists={artists}
        className={styles.open}
        cover={cover}
        error={error}
        isPlaying={isPlaying}
        line={artists}
        onOpen={onOpen}
        quality={null}
        title={title}
      />
      <IconButton
        color={COLORS.text}
        icon={isPlaying ? WREN_ICONS.pause : WREN_ICONS.play}
        label={isPlaying ? PLAYER_COPY.pause : PLAYER_COPY.play}
        onPress={onToggle}
      />
      <IconButton
        color={COLORS.text}
        icon={WREN_ICONS.next}
        label={PLAYER_COPY.next}
        onPress={onNext}
      />
      <span className={styles.track}>
        <span className={styles.progress} style={played} />
      </span>
    </section>
  )
}
