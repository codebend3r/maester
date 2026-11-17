import { ROUTE_STATES, type RouteQuery, routeState } from '@raven/core'
import type { ComponentType, ReactNode } from 'react'
import { ScrollView, View } from 'react-native'

import { Notice } from '@/components/Notice'
import { BackButton } from '@/screens/detail/BackButton'
import { usePageInsets } from '@/shell/useShell'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SPACE } from '@/theme/wrenTokens'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  ground: { backgroundColor: colors.bg, flex: 1 },
  content: { gap: SPACE.s4 },
}))

type DetailNoticeProps = { text: string }

/** A page that has nothing to show yet, or will not: what it says, and the way back. */
function DetailNotice({ text }: DetailNoticeProps) {
  const styles = useStyles()
  const insets = usePageInsets()
  return (
    <ScrollView contentContainerStyle={[styles.content, insets]} style={styles.ground}>
      <View>
        <BackButton />
      </View>
      <Notice text={text} />
    </ScrollView>
  )
}

/** What a page says while it has nothing of its own to show. */
type DetailCopy = { opening: string; missing: string }

/** What each view of a page that reads one thing from its address is handed. */
type DetailViewProps = {
  page: RouteQuery<unknown>
  copy: DetailCopy
  /** The page itself, drawn once it is read. */
  ready: () => ReactNode
}

type DetailMissingProps = DetailViewProps

/** The address names nothing the server has. */
function DetailMissing({ copy }: DetailMissingProps) {
  return <DetailNotice text={copy.missing} />
}

type DetailErrorProps = DetailViewProps

/** The server could not say, in its own words. */
function DetailError({ page }: DetailErrorProps) {
  return page.state === ROUTE_STATES.error && <DetailNotice text={page.message} />
}

type DetailLoadingProps = DetailViewProps

/** The page is on its way. */
function DetailLoading({ copy }: DetailLoadingProps) {
  return <DetailNotice text={copy.opening} />
}

type DetailReadyProps = DetailViewProps

function DetailReady({ ready }: DetailReadyProps) {
  return ready()
}

/** What a page reading one thing draws in each state its read is in. */
const DETAIL_VIEWS = {
  [ROUTE_STATES.missing]: DetailMissing,
  [ROUTE_STATES.error]: DetailError,
  [ROUTE_STATES.loading]: DetailLoading,
  [ROUTE_STATES.ready]: DetailReady,
} as const satisfies Record<RouteQuery<unknown>['state'], ComponentType<DetailViewProps>>

type DetailRouteProps<T> = {
  /** The id the address names, or null when it names none. */
  id: number | null
  query: Parameters<typeof routeState<T>>[0]['query']
  copy: DetailCopy
  children: (data: T) => ReactNode
}

/**
 * A page reading one thing from its address: the page once it is read, else that it is
 * opening, missing from the server, or could not be read, with the way back.
 */
export function DetailRoute<T>({ id, query, copy, children }: DetailRouteProps<T>) {
  const page = routeState({ id, query })
  const StateView = DETAIL_VIEWS[page.state]
  return (
    <StateView
      copy={copy}
      page={page}
      ready={() => page.state === ROUTE_STATES.ready && children(page.data)}
    />
  )
}
