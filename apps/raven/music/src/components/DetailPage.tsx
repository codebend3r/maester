import { ROUTE_STATES, type RouteQuery, routeState } from '@raven/core'
import { useRouter } from 'expo-router'
import type { ComponentType, ReactNode } from 'react'
import { ScrollView } from 'react-native'

import { IconButton } from '@/components/Controls'
import { Notice } from '@/components/Notice'
import { pageStyles, usePageTop } from '@/components/TabPage'
import { DETAIL_COPY } from '@/components/copy'
import { WREN_ICONS } from '@/theme/icons'

/** The way back from a page a listing opened. */
export function BackButton() {
  const router = useRouter()
  return (
    <IconButton icon={WREN_ICONS.back} label={DETAIL_COPY.back} onPress={() => router.back()} />
  )
}

type DetailPageProps = { children: ReactNode }

/** A page a listing opens, an album, an artist or a playlist, with the way back at its top. */
export function DetailPage({ children }: DetailPageProps) {
  const top = usePageTop()
  return (
    <ScrollView
      contentContainerStyle={[pageStyles.content, { paddingTop: top }]}
      style={pageStyles.ground}
    >
      <BackButton />
      {children}
    </ScrollView>
  )
}

type DetailNoticeProps = { text: string }

/** A page that has nothing to show yet, or will not: what it says, and the way back. */
function DetailNotice({ text }: DetailNoticeProps) {
  return (
    <DetailPage>
      <Notice text={text} />
    </DetailPage>
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
  const View = DETAIL_VIEWS[page.state]
  return (
    <View
      copy={copy}
      page={page}
      ready={() => page.state === ROUTE_STATES.ready && children(page.data)}
    />
  )
}
