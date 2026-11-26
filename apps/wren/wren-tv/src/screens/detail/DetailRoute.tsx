import {
  ROUTE_STATES,
  type RoutePending,
  type RouteQuery,
  routeIdOf,
  routeState,
} from '@raven/core'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { detailNoticeOf } from '@raven/wren'
import { type QueryKey, type UseQueryOptions, useQuery } from '@tanstack/react-query'
import { useLocalSearchParams } from 'expo-router'
import type { ComponentType, ReactNode } from 'react'
import { Text, View } from 'react-native'

import { type WrenSession, useWren } from '@raven/wren-native'
import { WREN_ROUTE_PARAMS } from '@raven/wren-native/headless'
import { SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { Loading } from '@/ui/Loading'

const useStyles = themedStyles(({ colors }) => ({
  ground: { backgroundColor: colors.bg, flex: 1, gap: SPACE.s4, padding: SPACE.gutter },
  notice: { ...TYPE.body, color: colors.text2 },
}))

type DetailNoticeProps = { text: string }

/** The page while it is read: the loading mark, its words said aloud. */
function DetailLoading({ text }: DetailNoticeProps) {
  const styles = useStyles()
  return (
    <View accessibilityLabel={text} style={styles.ground}>
      <Loading />
    </View>
  )
}

/** The page missing from the server or not read: its words. Back leaves it. */
function DetailNotice({ text }: DetailNoticeProps) {
  const styles = useStyles()
  return (
    <View style={styles.ground}>
      <Text accessibilityLiveRegion="polite" style={styles.notice}>
        {text}
      </Text>
    </View>
  )
}

type DetailReadyProps = {
  /** The page itself, drawn once it is read. */
  render: () => ReactNode
}

function DetailReady({ render }: DetailReadyProps) {
  return render()
}

const DETAIL_VIEW_KEYS = { loading: 'loading', notice: 'notice', ready: 'ready' } as const

type DetailViewKey = (typeof DETAIL_VIEW_KEYS)[keyof typeof DETAIL_VIEW_KEYS]

type DetailViewsProps = {
  [DETAIL_VIEW_KEYS.loading]: DetailNoticeProps
  [DETAIL_VIEW_KEYS.notice]: DetailNoticeProps
  [DETAIL_VIEW_KEYS.ready]: DetailReadyProps
}

const DETAIL_VIEWS = {
  [DETAIL_VIEW_KEYS.loading]: DetailLoading,
  [DETAIL_VIEW_KEYS.notice]: DetailNotice,
  [DETAIL_VIEW_KEYS.ready]: DetailReady,
} as const satisfies ViewsOf<DetailViewsProps>

/** Which stand-in a page shows by where it stands: the loading mark while it is read, else its words. */
const PENDING_VIEWS = {
  [ROUTE_STATES.loading]: DETAIL_VIEW_KEYS.loading,
  [ROUTE_STATES.missing]: DETAIL_VIEW_KEYS.notice,
  [ROUTE_STATES.error]: DETAIL_VIEW_KEYS.notice,
} as const satisfies Record<RoutePending['state'], DetailViewKey>

/** What a page says while it has nothing of its own to show. */
type DetailCopy = Parameters<typeof detailNoticeOf>[0]['copy']

/** What a detail page is handed: the session it reads through, and the thing it shows. */
type DetailPageProps<T> = { session: WrenSession; details: T }

type DetailRouteProps<T, Key extends QueryKey> = {
  /** The page itself, drawn once the thing it shows is read. */
  Page: ComponentType<DetailPageProps<T>>
  copy: DetailCopy
  /** The session's query for the thing the address names by `id`, which is null when it names none. */
  queryOf: (
    queries: WrenSession['queries'],
  ) => (id: number | null) => UseQueryOptions<T, Error, T, Key>
}

type DetailViewOfProps<T, Key extends QueryKey> = Pick<
  DetailRouteProps<T, Key>,
  'Page' | 'copy'
> & {
  page: RouteQuery<T>
  session: WrenSession
}

const detailViewOf = <T, Key extends QueryKey>({
  page,
  copy,
  Page,
  session,
}: DetailViewOfProps<T, Key>): ViewOf<DetailViewsProps> => {
  if (page.state !== ROUTE_STATES.ready)
    return { key: PENDING_VIEWS[page.state], props: { text: detailNoticeOf({ page, copy }) } }
  const { data } = page
  return {
    key: DETAIL_VIEW_KEYS.ready,
    props: { render: () => <Page details={data} session={session} /> },
  }
}

type SessionDetailProps<T, Key extends QueryKey> = DetailRouteProps<T, Key> & {
  session: WrenSession
}

function SessionDetail<T, Key extends QueryKey>({
  Page,
  copy,
  queryOf,
  session,
}: SessionDetailProps<T, Key>) {
  const id = routeIdOf(useLocalSearchParams()[WREN_ROUTE_PARAMS.id])
  const query = useQuery(queryOf(session.queries)(id))
  const page = routeState({ id, query })
  return (
    <KeyedView<DetailViewsProps>
      view={detailViewOf({ page, copy, Page, session })}
      views={DETAIL_VIEWS}
    />
  )
}

/**
 * A page reading one thing from its address, once a server is active, the phone's: the page when
 * it is read, else that it is opening, missing from the server, or could not be read. A TV draws
 * no way back: Back on Android TV and Menu on Apple TV leave it.
 */
export function DetailRoute<T, Key extends QueryKey>(props: DetailRouteProps<T, Key>) {
  const session = useWren()
  return session !== null && <SessionDetail {...props} session={session} />
}
