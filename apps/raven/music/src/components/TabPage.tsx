import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, Text } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { PALETTE, SIZES } from '@/theme/wrenTheme'

type PageTitleProps = { title: string }

/** A page's title, large at its top. */
export function PageTitle({ title }: PageTitleProps) {
  return (
    <Text accessibilityRole="header" style={pageStyles.title}>
      {title}
    </Text>
  )
}

/** How far down a page starts, clear of the notch. */
export const usePageTop = (): number => useSafeAreaInsets().top + SIZES.space4

/** A page's ground and its content's padding, shared by the pages that scroll a list. */
export const pageStyles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: PALETTE.ground },
  content: { gap: SIZES.space4, paddingHorizontal: SIZES.space4, paddingBottom: SIZES.space5 },
  title: { color: PALETTE.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
})

type TabPageProps = { title: string; children?: ReactNode }

/** A tab's page: its title large at the top, what it holds below, clear of the notch. */
export function TabPage({ title, children }: TabPageProps) {
  const top = usePageTop()
  return (
    <ScrollView
      contentContainerStyle={[pageStyles.content, { paddingTop: top }]}
      style={pageStyles.ground}
    >
      <PageTitle title={title} />
      {children}
    </ScrollView>
  )
}
