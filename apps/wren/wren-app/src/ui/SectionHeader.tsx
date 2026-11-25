import { Text, View } from 'react-native'

import { KIT_COPY } from '@raven/wren'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SPACE, TYPE } from '@/theme/wrenTokens'
import { type TextAction, TextLink } from '@/ui/TextLink'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACE.s3,
    justifyContent: 'space-between',
  },
  title: { ...TYPE.section, color: colors.text, flex: 1 },
}))

type SectionHeaderProps = {
  title: string
  /** See all: the whole list this section shows the start of. */
  onSeeAll?: () => void
  /** Another link at the title's end: Clear. */
  action?: TextAction
}

type ActionOfProps = Pick<SectionHeaderProps, 'title' | 'onSeeAll' | 'action'>

/** The link at the title's end: the one asked for, else See all, named for its section. */
const actionOf = ({ title, onSeeAll, action }: ActionOfProps): TextAction | undefined =>
  action ??
  (onSeeAll === undefined
    ? undefined
    : { label: KIT_COPY.seeAll, spoken: KIT_COPY.seeAllOf(title), onPress: onSeeAll, isLink: true })

/** A section's title over its shelf or rows, and a link at its end: See all, Clear. */
export function SectionHeader({ title, onSeeAll, action }: SectionHeaderProps) {
  const styles = useStyles()
  const link = actionOf({ title, onSeeAll, action })
  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      {link !== undefined && <TextLink {...link} />}
    </View>
  )
}
