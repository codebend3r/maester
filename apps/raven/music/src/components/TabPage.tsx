import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, Text } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { PALETTE, SIZES } from '@/theme/wrenTheme'

type TabPageProps = { title: string; children?: ReactNode }

/** A tab's page: its title large at the top, what it holds below, clear of the notch. */
export function TabPage({ title, children }: TabPageProps) {
  const { top } = useSafeAreaInsets()
  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingTop: top + SIZES.space4 }]}
      style={styles.ground}
    >
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {children}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: PALETTE.ground },
  content: { gap: SIZES.space4, paddingHorizontal: SIZES.space4, paddingBottom: SIZES.space5 },
  title: { color: PALETTE.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
})
