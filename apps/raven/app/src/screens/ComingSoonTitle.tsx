import {
  REQUEST_STATES,
  type RequestState,
  type TitleRequestAsk,
  type UpcomingDetails,
  isTitleRequestAsk,
  requestKeyOf,
} from '@raven/core'
import { KeyedView, type ViewOf, type ViewsOf, queryKeys } from '@raven/ui/headless'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { useAccountSession } from '@/account/session'
import { useOwnerId } from '@/account/useOwnerId'
import { ItemLayout, ItemNotice } from '@/layouts'
import { ITEM_ACTIONS, type ItemAction, type ItemNoticeProps } from '@/layouts/itemKit'
import type { Pictures } from '@/queries/cards'
import { COMING_SOON_COPY } from '@/queries/comingSoonCopy'
import { requestControlOf } from '@/queries/requestControl'
import { accountNamesOf, upcomingPageOf } from '@/queries/upcomingCards'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { APP_ROUTE_PARAMS, type RouteTarget, hrefOf } from '@/routes'
import { APP_ICONS } from '@/theme/icons'

const REQUEST_KEY = 'request'

type RequestActionOfProps = { isAsking: boolean; onRequest: () => void }

const nothing = (): void => undefined

/** The button that asks, for a title free to request. */
const openAction = ({ isAsking, onRequest }: RequestActionOfProps): ItemAction => ({
  kind: ITEM_ACTIONS.play,
  key: REQUEST_KEY,
  icon: APP_ICONS.download,
  label: isAsking ? COMING_SOON_COPY.request.requesting : COMING_SOON_COPY.request.request,
  text: isAsking ? COMING_SOON_COPY.request.requesting : COMING_SOON_COPY.request.request,
  onPress: isAsking ? nothing : onRequest,
})

type GreyedActionProps = { isRequested: boolean }

/**
 * The button greyed out: ticked for a title asked for once, or that its downloader holds, which
 * is never asked for again; else as it was, with the line under it saying why it cannot ask now.
 */
const greyedAction = ({ isRequested }: GreyedActionProps): ItemAction => {
  const words = isRequested ? COMING_SOON_COPY.request.requested : COMING_SOON_COPY.request.request
  return {
    kind: ITEM_ACTIONS.toggle,
    key: REQUEST_KEY,
    icon: isRequested ? APP_ICONS.check : APP_ICONS.download,
    label: words,
    text: words,
    isOn: isRequested,
    isDisabled: true,
    onPress: nothing,
  }
}

/** The page's one action in each state of its request; none while it is read. */
const REQUEST_ACTIONS = {
  [REQUEST_STATES.loading]: () => [],
  [REQUEST_STATES.open]: (props) => [openAction(props)],
  [REQUEST_STATES.requested]: () => [greyedAction({ isRequested: true })],
  [REQUEST_STATES.spent]: () => [greyedAction({ isRequested: false })],
  // The web shows no button while requests of the kind are off, only the line saying so.
  [REQUEST_STATES.off]: () => [],
} as const satisfies Record<RequestState, (props: RequestActionOfProps) => ItemAction[]>

type UpcomingTitleProps = {
  session: AppQueries
  ask: TitleRequestAsk
  details: UpcomingDetails
  pictures: Pictures
  onBack: () => void
}

const UpcomingTitle = ({ session, ask, details, pictures, onBack }: UpcomingTitleProps) => {
  const { api, queries } = session
  const router = useRouter()
  const queryClient = useQueryClient()
  const ownerId = useOwnerId(session)
  const userId = useAccountSession((state) => state.session?.userId ?? null)
  const account = useQuery(queries.accountQuery(userId))
  const list = useQuery(queries.requestsQuery)
  const holding = useQuery(queries.requestHoldingQuery(ask))
  // Only the owner may read whose each request was, to name another account's.
  const everyone = useQuery({ ...queries.everyonesRequestsQuery, enabled: ownerId !== null })
  const members = useQuery(queries.membersQuery(ownerId))
  const request = useMutation({
    mutationFn: () => api.requestDownload(ask),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.requests }),
  })
  const control = requestControlOf({
    ask,
    list: list.data,
    holding: holding.data,
    isReading: holding.isPending,
    failure: request.error?.message ?? null,
    ownEmail: account.data?.email ?? null,
    everyone: everyone.data,
    names: accountNamesOf(members.data),
  })
  return (
    <ItemLayout
      actions={REQUEST_ACTIONS[control.state]({
        isAsking: request.isPending,
        onRequest: () => request.mutate(),
      })}
      isPlayPending={control.state === REQUEST_STATES.loading}
      links={[]}
      onBack={onBack}
      onOpen={(target: RouteTarget) => router.push(hrefOf(target))}
      page={upcomingPageOf({ details, notes: control.notes, ...pictures })}
    />
  )
}

/** What the page shows: a word in place of the title, or the title. */
const TITLE_VIEW_KEYS = { notice: 'notice', title: 'title' } as const

type TitleViewProps = {
  [TITLE_VIEW_KEYS.notice]: ItemNoticeProps
  [TITLE_VIEW_KEYS.title]: UpcomingTitleProps
}

const TITLE_VIEWS = {
  [TITLE_VIEW_KEYS.notice]: ItemNotice,
  [TITLE_VIEW_KEYS.title]: UpcomingTitle,
} as const satisfies ViewsOf<TitleViewProps>

type ServerTitleProps = { session: AppQueries; ask: TitleRequestAsk; onBack: () => void }

/** The title once its details are read, and until then that they are on their way or why they could not be read. */
const ServerTitle = ({ session, ask, onBack }: ServerTitleProps) => {
  const { server, api, queries } = session
  const pictures = usePictures({ server, api })
  const details = useQuery(queries.upcomingDetailsQuery(ask))
  const view: ViewOf<TitleViewProps> =
    details.data !== undefined && pictures !== null
      ? {
          key: TITLE_VIEW_KEYS.title,
          props: { session, ask, details: details.data, pictures, onBack },
        }
      : {
          key: TITLE_VIEW_KEYS.notice,
          props: { notice: details.error?.message ?? COMING_SOON_COPY.loading, onBack },
        }
  return <KeyedView<TitleViewProps> view={view} views={TITLE_VIEWS} />
}

type RouteViewProps = {
  [TITLE_VIEW_KEYS.notice]: ItemNoticeProps
  [TITLE_VIEW_KEYS.title]: ServerTitleProps
}

const ROUTE_VIEWS = {
  [TITLE_VIEW_KEYS.notice]: ItemNotice,
  [TITLE_VIEW_KEYS.title]: ServerTitle,
} as const satisfies ViewsOf<RouteViewProps>

type TitleRouteProps = { session: AppQueries }

/** The title the address names, on a page of its own a server and a title; an address that names none says so. */
const TitleRoute = ({ session }: TitleRouteProps) => {
  const router = useRouter()
  const params = useLocalSearchParams()
  const named = { type: params[APP_ROUTE_PARAMS.type], tmdbId: params[APP_ROUTE_PARAMS.tmdbId] }
  const onBack = () => router.back()
  const view: ViewOf<RouteViewProps> = isTitleRequestAsk(named)
    ? { key: TITLE_VIEW_KEYS.title, props: { session, ask: named, onBack } }
    : { key: TITLE_VIEW_KEYS.notice, props: { notice: COMING_SOON_COPY.notFound, onBack } }
  return (
    <KeyedView<RouteViewProps>
      key={`${session.server.id}:${isTitleRequestAsk(named) ? requestKeyOf(named) : ''}`}
      view={view}
      views={ROUTE_VIEWS}
    />
  )
}

/**
 * `/coming-soon/[type]/[tmdbId]`: a movie or show still to come, as TMDB describes it and as an
 * item's page is laid out: its backdrop and poster, name, tagline, the day it comes out, its
 * kind, length and genres, its directors, its summary and its cast, with the button that asks
 * for it to be downloaded for everyone, or where that request stands, who asked and when. An
 * address that names no title says so.
 */
export const ComingSoonTitle = () => {
  const session = useAppQueries()
  return session !== null && <TitleRoute session={session} />
}
