import type { ReactNode } from 'react'
import { Text, View } from 'react-native'

import { type WrenTheme, themedStyles, useFormFactor } from '@/theme/wrenTheme'
import { FORM_FACTORS, SPACE, TYPE } from '@/theme/wrenTokens'
import { BackLink } from '@/ui/BackLink'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  header: { gap: SPACE.s1 },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s3 },
  title: { ...TYPE.largeTitle, color: colors.text, flex: 1 },
  actions: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s1 },
}))

/** The page a pushed page came from, and the way back to it. */
type BackTarget = { label: string; onPress: () => void }

const useTitleStyles = themedStyles(() => ({
  [FORM_FACTORS.phone]: {},
  [FORM_FACTORS.tablet]: TYPE.tabletTitle,
}))

type PageHeaderProps = {
  title: string
  /** "< Library" above the title, on a page the stack pushed. */
  back?: BackTarget
  /** What sits at the title's end: search, sort, New playlist. */
  actions?: ReactNode
}

/** A page's large Young Serif title, the way back above it and its actions beside it. */
export function PageHeader({ title, back, actions }: PageHeaderProps) {
  const styles = useStyles()
  const titleStyles = useTitleStyles()
  const formFactor = useFormFactor()
  return (
    <View style={styles.header}>
      {back !== undefined && <BackLink onPress={back.onPress} to={back.label} />}
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" style={[styles.title, titleStyles[formFactor]]}>
          {title}
        </Text>
        {actions !== undefined && <View style={styles.actions}>{actions}</View>}
      </View>
    </View>
  )
}
