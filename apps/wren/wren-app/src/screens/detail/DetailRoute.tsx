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
import { ScrollView, View } from 'react-native'

import { LoadingMark } from '@/components/LoadingMark'
import { Notice } from '@/components/Notice'
import { type WrenSession, useWren } from '@raven/wren-native'
import { WREN_ROUTE_PARAMS } from '@raven/wren-native/headless'
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

type DetailNoticeProps = { text: string }

/** The page while it is read: the loading mark, its words said aloud. */
function DetailLoading({ text }: DetailNoticeProps) {
  return (
    <DetailFrame>
      <LoadingMark label={text} />
    </DetailFrame>
  )
}

/** The page missing from the server or not read: its words. */
function DetailNotice({ text }: DetailNoticeProps) {
  return (
    <DetailFrame>
      <Notice text={text} />
    </DetailFrame>
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

/** What a page reading one thing draws: what it says while it has nothing to show, else itself. */
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
 * A page reading one thing from its address, once a server is active: the page when it is
 * read, else that it is opening, missing from the server, or could not be read, with the way back.
 */
export function DetailRoute<T, Key extends QueryKey>(props: DetailRouteProps<T, Key>) {
  const session = useWren()
  return session !== null && <SessionDetail {...props} session={session} />
}
