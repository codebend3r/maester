import { ROUTE_STATES, type RouteQuery, routeIdOf, routeState } from '@raven/core'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { detailNoticeOf } from '@raven/wren'
import { type QueryKey, type UseQueryOptions, useQuery } from '@tanstack/react-query'
import type { ComponentType, ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { LoadingMark } from '@/components/LoadingMark/LoadingMark'
import { Notice } from '@/components/Notice/Notice'
import { WREN_ROUTE_PARAMS } from '@/routes'
import { BackButton } from '@/screens/detail/BackButton'
import { Page } from '@/shell/Page/Page'
import { SIZES } from '@/theme/tokens'
import styles from '@/screens/detail/DetailRoute.module.scss'

const NOTICE_KEYS = { loading: 'loading', words: 'words' } as const

type NoticeKey = (typeof NOTICE_KEYS)[keyof typeof NOTICE_KEYS]

type NoticeBodyProps = { text: string }

const LoadingNotice = ({ text }: NoticeBodyProps) => (
  <LoadingMark label={text} size={SIZES.loadingMark} />
)

const WordsNotice = ({ text }: NoticeBodyProps) => <Notice text={text} />

/** What a page with nothing to show says: the loading mark while it is read, else its words. */
const NOTICE_VIEWS = {
  [NOTICE_KEYS.loading]: LoadingNotice,
  [NOTICE_KEYS.words]: WordsNotice,
} as const satisfies Record<NoticeKey, ComponentType<NoticeBodyProps>>

type DetailNoticeProps = { text: string; isLoading: boolean }

/** A page that has nothing to show yet, or will not: what it says, and the way back. */
function DetailNotice({ text, isLoading }: DetailNoticeProps) {
  const Body = NOTICE_VIEWS[isLoading ? NOTICE_KEYS.loading : NOTICE_KEYS.words]
  return (
    <Page className={styles.notice}>
      <BackButton />
      <Body text={text} />
    </Page>
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
    return {
      key: DETAIL_VIEW_KEYS.pending,
      props: {
        text: detailNoticeOf({ page, copy }),
        isLoading: page.state === ROUTE_STATES.loading,
      },
    }
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
  const id = routeIdOf(useParams()[WREN_ROUTE_PARAMS.id])
  const query = useQuery(queryOf(id))
  const page = routeState({ id, query })
  return (
    <KeyedView<DetailViewsProps>
      view={detailViewOf({ page, copy, children })}
      views={DETAIL_VIEWS}
    />
  )
}
