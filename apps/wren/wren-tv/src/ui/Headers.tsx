import { Text, View } from 'react-native'

import { SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { FocusButton } from '@/ui/FocusButton'

const useStyles = themedStyles(({ colors }) => ({
  page: { gap: SPACE.s1 },
  eyebrow: { ...TYPE.overline, color: colors.text3 },
  title: { ...TYPE.title, color: colors.text },
  line: { ...TYPE.body, color: colors.text2 },
  section: { ...TYPE.section, color: colors.text },
  head: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s4 },
}))

type PageHeaderProps = {
  title: string
  /** A small line over the title: Home's date, a category's kind. */
  eyebrow?: string | null
  /** A quiet line under it: a count, the server. */
  line?: string | null
}

/** A screen's title in the display face, read out as its header. */
export function PageHeader({ title, eyebrow = null, line = null }: PageHeaderProps) {
  const styles = useStyles()
  return (
    <View style={styles.page}>
      {eyebrow !== null && <Text style={styles.eyebrow}>{eyebrow}</Text>}
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {line !== null && <Text style={styles.line}>{line}</Text>}
    </View>
  )
}

/** What a section's heading offers beside it: See all, Clear. */
type SectionAction = {
  /** Its words on screen. */
  text: string
  /** What it is called aloud, named for its section: "See all, Recently added". */
  label: string
  onPress: () => void
}

type SectionHeaderProps = {
  title: string
  action?: SectionAction
}

/** A section's heading, read out as a header, with the action it offers beside it. */
export function SectionHeader({ title, action }: SectionHeaderProps) {
  const styles = useStyles()
  return (
    <View style={styles.head}>
      <Text accessibilityRole="header" style={styles.section}>
        {title}
      </Text>
      {action !== undefined && (
        <FocusButton label={action.label} onPress={action.onPress} text={action.text} />
      )}
    </View>
  )
}
