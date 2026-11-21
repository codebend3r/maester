import type { SourceTitle } from '@raven/wren'
import type { ComponentType } from 'react'
import { Text, View } from 'react-native'

import { NOW_PLAYING_COPY } from '@raven/wren'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { SPACE, TYPE } from '@/theme/wrenTokens'
import { IconButton } from '@/ui/IconButton'
import { ICONS } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  header: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s2 },
  middle: { alignItems: 'center', flex: 1 },
  overline: { ...TYPE.overline, color: colors.text3 },
  name: { ...TYPE.tileTitle, color: colors.text, textAlign: 'center' },
}))

/** How the header names the source: an overline over the name, or not at all on the tablet. */
export const HEADER_TITLES = { full: 'full', none: 'none' } as const

type HeaderTitle = (typeof HEADER_TITLES)[keyof typeof HEADER_TITLES]

type TitleProps = { title: SourceTitle }

/** "Playing from album" over "1000 Forms Of Fear". */
function FullTitle({ title }: TitleProps) {
  const styles = useStyles()
  return (
    <View accessible style={styles.middle}>
      <Text numberOfLines={1} style={styles.overline}>
        {title.overline}
      </Text>
      <Text numberOfLines={1} style={styles.name}>
        {title.name}
      </Text>
    </View>
  )
}

/** The tablet's: the room between the two buttons, since Up next's line names the source. */
function NoTitle() {
  const styles = useStyles()
  return <View style={styles.middle} />
}

const TITLES = {
  [HEADER_TITLES.full]: FullTitle,
  [HEADER_TITLES.none]: NoTitle,
} as const satisfies Record<HeaderTitle, ComponentType<TitleProps>>

type CloseButtonProps = { onClose: () => void }

/** The way down, out of Now Playing. */
export function CloseButton({ onClose }: CloseButtonProps) {
  const { colors } = useWrenTheme()
  return (
    <IconButton
      color={colors.text}
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
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const Title = TITLES[variant]
  return (
    <View style={styles.header}>
      <CloseButton onClose={onClose} />
      <Title title={title} />
      <IconButton
        color={colors.text}
        icon={ICONS.more}
        label={NOW_PLAYING_COPY.more}
        onPress={onMore}
      />
    </View>
  )
}
