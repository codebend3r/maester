import {
  type DetailRouteProps,
  type DetailStandInProps,
  type DetailViews,
  DetailRoute as WrenDetailRoute,
} from '@raven/wren-native'
import type { QueryKey } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ScrollView, View } from 'react-native'

import { LoadingMark } from '@/components/LoadingMark'
import { Notice } from '@/components/Notice'
import { BackButton } from '@/screens/detail/BackButton'
import { usePageInsets } from '@/shell/useShell'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SPACE } from '@/theme/wrenTokens'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  ground: { backgroundColor: colors.bg, flex: 1 },
  content: { gap: SPACE.s4 },
}))

type DetailFrameProps = { children: ReactNode }

/** A page that has nothing to show yet, or will not: what stands in for it, and the way back. */
function DetailFrame({ children }: DetailFrameProps) {
  const styles = useStyles()
  const insets = usePageInsets()
  return (
    <ScrollView contentContainerStyle={[styles.content, insets]} style={styles.ground}>
      <View>
        <BackButton />
      </View>
      {children}
    </ScrollView>
  )
}

/** The page while it is read: the loading mark, its words said aloud. */
function DetailLoading({ text }: DetailStandInProps) {
  return (
    <DetailFrame>
      <LoadingMark label={text} />
    </DetailFrame>
  )
}

/** The page missing from the server or not read: its words. */
function DetailNotice({ text }: DetailStandInProps) {
  return (
    <DetailFrame>
      <Notice text={text} />
    </DetailFrame>
  )
}

const PHONE_DETAIL_VIEWS = {
  loading: DetailLoading,
  notice: DetailNotice,
} as const satisfies DetailViews

type PhoneDetailRouteProps<T, Key extends QueryKey> = Omit<DetailRouteProps<T, Key>, 'views'>

/** A page reading one thing from its address, in the phone's stand-ins, each with the way back. */
export function DetailRoute<T, Key extends QueryKey>(props: PhoneDetailRouteProps<T, Key>) {
  return <WrenDetailRoute {...props} views={PHONE_DETAIL_VIEWS} />
}
