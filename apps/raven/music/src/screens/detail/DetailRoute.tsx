import { ROUTE_STATES, type RouteQuery, routeIdOf, routeState } from '@raven/core'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { detailNoticeOf } from '@raven/wren'
import { type QueryKey, type UseQueryOptions, useQuery } from '@tanstack/react-query'
import { useLocalSearchParams } from 'expo-router'
import type { ComponentType, ReactNode } from 'react'
import { ScrollView, View } from 'react-native'

import { Notice } from '@/components/Notice'
import { WREN_ROUTE_PARAMS } from '@/routes'
import { BackButton } from '@/screens/detail/BackButton'
import { usePageInsets } from '@/shell/useShell'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SPACE } from '@/theme/wrenTokens'
import { type WrenSession, useWren } from '@/useWren'

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

type DetailReadyProps = {
  /** The page itself, drawn once it is read. */
  render: () => ReactNode
}

function DetailReady({ render }: DetailReadyProps) {
  return render()
}

const DETAIL_VIEW_KEYS = { pending: 'pending', ready: 'ready' } as const

type DetailViewsProps = {
  [DETAIL_VIEW_KEYS.pending]: DetailNoticeProps
  [DETAIL_VIEW_KEYS.ready]: DetailReadyProps
}

/** What a page reading one thing draws: what it says while it has nothing to show, else itself. */
const DETAIL_VIEWS = {
  [DETAIL_VIEW_KEYS.pending]: DetailNotice,
  [DETAIL_VIEW_KEYS.ready]: DetailReady,
} as const satisfies ViewsOf<DetailViewsProps>

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
    return { key: DETAIL_VIEW_KEYS.pending, props: { text: detailNoticeOf({ page, copy }) } }
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
