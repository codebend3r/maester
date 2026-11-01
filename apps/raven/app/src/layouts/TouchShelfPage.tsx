import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Logo } from '@/layouts/Logo'
import { Text } from '@/layouts/Text'
import { TouchNav } from '@/layouts/TouchNav'
import { SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'

type TouchNoticeProps = { children: ReactNode }

/** A line of the page in place of what it would show: a failure, a wait, or nothing found. */
export const TouchNotice = ({ children }: TouchNoticeProps) => {
  const styles = useStyles()
  return <Text style={styles.notice}>{children}</Text>
}

type TouchShelfPageProps = {
  title: string
  /** The way back; left out on Home, which has nothing behind it. */
  onBack?: () => void
  isHome?: boolean
  /** The search field under the header's buttons. */
  search: ReactNode
  notice: string | null
  /** The page's shelves. */
  children: ReactNode
}

/**
 * The page every list of shelves wears, once for Home and the search results: the header,
 * its search field and the page's name over the shelves, stacked and scrolled, clear of the
 * side insets of a phone held sideways. A drag puts the keyboard away, and a card under it
 * still takes the first tap.
 */
export const TouchShelfPage = ({
  title,
  onBack,
  isHome = false,
  search,
  notice,
  children,
}: TouchShelfPageProps) => {
  const insets = useSafeAreaInsets()
  const styles = useStyles()
  return (
    <ScrollView
      contentContainerStyle={[
        styles.shelves,
        {
          paddingTop: insets.top + SIZES.space3,
          paddingBottom: insets.bottom + SIZES.space5,
          // Clear of the Dynamic Island and the corners of a phone held sideways.
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      style={styles.ground}
    >
      <View style={styles.header}>
        <TouchNav isHome={isHome} onBack={onBack} search={search} />
        <View style={styles.brand}>
          <Logo width={SIZES.textXl} />
          <Text accessibilityRole="header" style={styles.pageTitle}>
            {title}
          </Text>
        </View>
      </View>
      {notice !== null && <TouchNotice>{notice}</TouchNotice>}
      {children}
    </ScrollView>
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    ground: { flex: 1, backgroundColor: colours.ground },
    shelves: { gap: SIZES.space4 },
    header: { gap: SIZES.space3, paddingHorizontal: SIZES.space3 },
    brand: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: SIZES.space2 },
    pageTitle: { flexShrink: 1, color: colours.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
    notice: { color: colours.muted, fontSize: SIZES.text, paddingHorizontal: SIZES.space3 },
  }),
)
