import { NOW_PLAYING_COPY, type SourceTitle } from '@raven/wren'
import { COLORS } from '@/theme/tokens'
import { IconButton } from '@/ui/IconButton/IconButton'
import { ICONS } from '@/ui/WrenIcon/icons'
import styles from '@/screens/NowPlaying/PlayerHeader.module.scss'

type SourceNameProps = { title: SourceTitle }

/** "Playing from album" over "1000 Forms Of Fear". */
function SourceName({ title }: SourceNameProps) {
  return (
    <p className={styles.middle}>
      <span className={styles.overline}>{title.overline}</span>
      <span className={styles.name}>{title.name}</span>
    </p>
  )
}

type CloseButtonProps = { onClose: () => void }

/** The way down, out of Now Playing. */
export function CloseButton({ onClose }: CloseButtonProps) {
  return (
    <IconButton
      color={COLORS.text}
      icon={ICONS.chevronDown}
      label={NOW_PLAYING_COPY.close}
      onPress={onClose}
    />
  )
}

type PlayerHeaderProps = {
  title: SourceTitle
  onClose: () => void
  /** Opens the song's actions. */
  onMore: () => void
}

/** Now Playing's top: the way down, where the queue plays from, and the song's actions. */
export function PlayerHeader({ title, onClose, onMore }: PlayerHeaderProps) {
  return (
    <header className={styles.header}>
      <span className={styles.close}>
        <CloseButton onClose={onClose} />
      </span>
      <SourceName title={title} />
      <span className={styles.more}>
        <IconButton
          color={COLORS.text}
          icon={ICONS.more}
          label={NOW_PLAYING_COPY.more}
          onPress={onMore}
        />
      </span>
    </header>
  )
}
