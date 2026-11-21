import { NOW_PLAYING_COPY, type SourceTitle } from '@raven/wren'
import type { ComponentType } from 'react'
import { COLORS } from '@/theme/tokens'
import { IconButton } from '@/ui/IconButton/IconButton'
import { ICONS } from '@/ui/WrenIcon/icons'
import styles from '@/screens/NowPlaying/PlayerHeader.module.scss'

/** How the header names the source: an overline over the name, or not at all on the wide layout. */
export const HEADER_TITLES = { full: 'full', none: 'none' } as const

type HeaderTitle = (typeof HEADER_TITLES)[keyof typeof HEADER_TITLES]

type TitleProps = { title: SourceTitle }

/** "Playing from album" over "1000 Forms Of Fear". */
function FullTitle({ title }: TitleProps) {
  return (
    <p className={styles.middle}>
      <span className={styles.overline}>{title.overline}</span>
      <span className={styles.name}>{title.name}</span>
    </p>
  )
}

/** The wide layout's: the room between the two buttons, since Up next's line names the source. */
function NoTitle() {
  return <span className={styles.middle} />
}

const TITLES = {
  [HEADER_TITLES.full]: FullTitle,
  [HEADER_TITLES.none]: NoTitle,
} as const satisfies Record<HeaderTitle, ComponentType<TitleProps>>

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
  variant?: HeaderTitle
}

/** Now Playing's top: the way down, where the queue plays from, and the song's actions. */
export function PlayerHeader({
  title,
  onClose,
  onMore,
  variant = HEADER_TITLES.full,
}: PlayerHeaderProps) {
  const Title = TITLES[variant]
  return (
    <header className={styles.header}>
      <span className={styles.close}>
        <CloseButton onClose={onClose} />
      </span>
      <Title title={title} />
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
