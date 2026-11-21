import { ROUTE_STATES, type RouteQuery, routeIdOf, routeState } from '@raven/core'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { detailNoticeOf } from '@raven/wren'
import { type QueryKey, type UseQueryOptions, useQuery } from '@tanstack/react-query'
import { useLocalSearchParams } from 'expo-router'
import type { ReactNode } from 'react'
import { ScrollView, View } from 'react-native'

import { Notice } from '@/components/Notice'
import { WREN_ROUTE_PARAMS } from '@/routes'
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

type DetailViewOfProps<T> = {
  page: RouteQuery<T>
  copy: DetailCopy
  children: (data: T) => ReactNode
}

const detailViewOf = <T,>({
  page,
  copy,
  children,
}: DetailViewOfProps<T>): ViewOf<DetailViewsProps> => {
  if (page.state !== ROUTE_STATES.ready)
    return { key: DETAIL_VIEW_KEYS.pending, props: { text: detailNoticeOf({ page, copy }) } }
  const { data } = page
  return { key: DETAIL_VIEW_KEYS.ready, props: { render: () => children(data) } }
}

type DetailRouteProps<T, Key extends QueryKey> = Pick<DetailViewOfProps<T>, 'copy' | 'children'> & {
  /** The query for the thing the address names by `id`, which is null when it names none. */
  queryOf: (id: number | null) => UseQueryOptions<T, Error, T, Key>
}

/**
 * A page reading one thing from its address: the page once it is read, else that it is
 * opening, missing from the server, or could not be read, with the way back.
 */
export function DetailRoute<T, Key extends QueryKey>({
  queryOf,
  copy,
  children,
}: DetailRouteProps<T, Key>) {
  const id = routeIdOf(useLocalSearchParams()[WREN_ROUTE_PARAMS.id])
  const query = useQuery(queryOf(id))
  const page = routeState({ id, query })
  return (
    <KeyedView<DetailViewsProps>
      view={detailViewOf({ page, copy, children })}
      views={DETAIL_VIEWS}
    />
  )
}
