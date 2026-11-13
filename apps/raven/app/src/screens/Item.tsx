import {
  ITEM_TYPES,
  type ItemDetails,
  type MediaItem,
  ROUTE_STATES,
  type RouteQuery,
  SHOW_SESSION,
  shuffleSessionOf,
  episodeCode,
  episodesOf,
  firstEpisodeIn,
  firstSeasonIn,
  formatDuration,
  libraryFiles,
  nextEpisodeIn,
  routeIdOf,
  routeState,
  seasonsOf,
} from '@raven/core'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { ComponentType } from 'react'

import { seasonTargetOf, showTargetOf, videoTargetOf } from '@/downloads/downloadTargets'
import { useDownloadButton } from '@/downloads/useDownloadButton'
import { DEVICE_PLATFORM } from '@/platform/devicePlatform'
import type { Pictures } from '@/queries/cards'
import { playablePage, seasonPage, showPage } from '@/queries/itemPage'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { useItemMarks, useVideoMarks } from '@/queries/useMarks'
import { usePictures } from '@/queries/usePictures'
import { useDownloadLibrary } from '@/queries/useDownloadLibrary'
import { useVideoLinks } from '@/queries/useVideoLinks'
import { ItemLayout, ItemNotice, Loading } from '@/layouts'
import type { ItemNoticeProps } from '@/layouts/itemKit'
import type { LoadingProps } from '@/layouts/loadingKit'
import { APP_ROUTE_PARAMS, ROUTE_TARGETS, type RouteTarget, hrefOf } from '@/routes'
import {
  downloadOf,
  favouriteOf,
  fromStartOf,
  ItemContext,
  linkActionOf,
  marksOf,
  nextOf,
  playAllOf,
  playNextActionsOf,
  playOf,
  shuffleOf,
  watchedOf,
} from '@/screens/itemActions'
import { ITEM_COPY } from '@/screens/copy'

type PlayableItemProps = {
  kind: typeof ITEM_TYPES.movie | typeof ITEM_TYPES.episode
  details: ItemDetails
  versions: MediaItem[]
  primary: MediaItem
  session: AppQueries
  context: ItemContext
}

/**
 * A movie or an episode once the library's files it shows are known: Play, or Resume where it
 * stopped, an episode's Next once the server names one, then Favourite where its library allows
 * one, then Watched, each mark shown before the server answers, and last the links: an episode's
 * up to its show and season, a movie's to its saga.
 */
const PlayableItem = ({
  kind,
  details,
  versions,
  primary,
  session,
  context,
}: PlayableItemProps) => {
  const { queries } = session
  const isEpisode = kind === ITEM_TYPES.episode
  const marks = useVideoMarks({ session, media: primary })
  const libraries = useQuery(queries.librariesQuery)
  const tracks = useQuery(queries.tracksQuery(primary.id))
  // The ways up read an episode's show, which the page sits under too, and a movie's sagas.
  const { links, show, isShowPending } = useVideoLinks({ session, media: primary, details })
  // Only an episode has a next; a film asks nothing.
  const next = useQuery({
    ...queries.nextInSessionQuery({ id: primary.id, session: SHOW_SESSION }),
    enabled: isEpisode,
  })
  const nextFile = next.data ?? null
  const library = useDownloadLibrary({ session, libraryId: primary.libraryId })
  const download = useDownloadButton({
    serverId: session.server.id,
    library,
    target: videoTargetOf({
      api: session.api,
      platform: DEVICE_PLATFORM,
      media: primary,
      details,
      show,
    }),
  })
  const page = playablePage({
    kind,
    details,
    versions,
    everyFile: details.versions,
    libraryNames: new Map((libraries.data ?? []).map(({ id, name }) => [id, name])),
    primary,
    show,
    isShowPending,
    tracks: tracks.data,
    api: session.api,
    headersFor: context.headersFor,
  })
  const actions = [
    playOf({
      media: primary,
      label:
        primary.position > 0
          ? ITEM_COPY.resumeFrom({ at: formatDuration(primary.position) })
          : ITEM_COPY.play,
      context,
    }),
    ...fromStartOf({ media: primary, context }),
    ...(nextFile === null ? [] : [nextOf({ media: nextFile, context })]),
    ...(marks.favourite === null ? [] : [favouriteOf(marks.favourite)]),
    watchedOf({ ...marks.watched, words: ITEM_COPY.videoWatched }),
    ...downloadOf(download),
  ]
  return (
    <ItemLayout
      actions={actions}
      links={links.map((link) => linkActionOf({ link, context }))}
      isPlayPending={false}
      onBack={context.onBack}
      onOpen={context.onOpen}
      page={page}
    />
  )
}

type UseShowShuffleProps = { showId: number | null; session: AppQueries; context: ItemContext }

/**
 * What Shuffle does for show `showId`: the server deals its episodes, and the first not yet
 * watched (else the first dealt) plays in the show's shuffle session, where the server draws
 * every next one. Null without a show to shuffle.
 */
const useShowShuffle = ({ showId, session, context }: UseShowShuffleProps): (() => void) | null => {
  const deal = useMutation({
    mutationFn: (id: number) => session.api.shuffleEpisodes(id),
    onSuccess: (dealt, id) => {
      const first = dealt.find((media) => !media.watched) ?? dealt.at(0)
      if (first === undefined) return
      context.onOpen({
        kind: ROUTE_TARGETS.play,
        mediaId: first.id,
        at: 0,
        session: shuffleSessionOf(id),
      })
    },
  })
  return showId === null ? null : () => deal.mutate(showId)
}

type ShowItemProps = {
  details: ItemDetails
  /** The library the page was opened in, which its downloads are filed under; null when the address named none. */
  library: number | null
  session: AppQueries
  context: ItemContext
}

/**
 * A show: Play for the episode the server says comes next, once it says, Play all from its first
 * episode, Shuffle, Favourite and Mark show watched over every episode, Binge, then its seasons.
 */
const ShowItem = ({ details, library: libraryId, session, context }: ShowItemProps) => {
  const next = useQuery(session.queries.nextEpisodeQuery(details.id))
  const marks = useItemMarks({ session, details })
  const seasons = seasonsOf(details)
  // Read for the first episode a fully watched show starts again from.
  const first = useQuery(session.queries.itemQuery(firstSeasonIn(seasons)?.id ?? null))
  const firstFile =
    (first.data === undefined ? undefined : firstEpisodeIn(episodesOf(first.data)))?.primary ?? null
  const nextFile = next.data ?? null
  const nextItem = nextFile?.item ?? null
  const nextCode = nextItem === null ? null : episodeCode(nextItem)
  const onShuffle = useShowShuffle({ showId: details.id, session, context })
  const library = useDownloadLibrary({ session, libraryId })
  const download = useDownloadButton({
    serverId: session.server.id,
    library,
    target: showTargetOf({ api: session.api, platform: DEVICE_PLATFORM, show: details }),
  })
  const actions = [
    ...playNextActionsOf({
      next: nextFile,
      code: nextCode,
      first: firstFile,
      state: marks.watched.state,
      context,
    }),
    ...playAllOf({ first: firstFile, context }),
    ...shuffleOf({ onShuffle }),
    ...marksOf({ marks, words: ITEM_COPY.showWatched }),
    ...downloadOf(download),
  ]
  return (
    <ItemLayout
      actions={actions}
      links={[]}
      isPlayPending={next.isPending}
      onBack={context.onBack}
      onOpen={context.onOpen}
      page={showPage({ details, api: session.api, headersFor: context.headersFor })}
    />
  )
}

type SeasonItemProps = {
  details: ItemDetails
  /** The library the page was opened in, which its downloads are filed under; null when the address named none. */
  library: number | null
  session: AppQueries
  context: ItemContext
}

/**
 * A season: Play for its first episode not yet watched, Play all from its first episode on through
 * the show, Shuffle over the whole show, Favourite and Mark season watched over every episode in
 * it, then its episodes.
 */
const SeasonItem = ({ details, library: libraryId, session, context }: SeasonItemProps) => {
  // A season sits under its show's backdrop, and carries its show's content rating.
  const show = useQuery(session.queries.itemQuery(details.show?.id ?? null))
  const marks = useItemMarks({ session, details })
  const episodes = episodesOf(details)
  const next = nextEpisodeIn(episodes)
  const nextFile = next?.primary ?? null
  const firstFile = firstEpisodeIn(episodes)?.primary ?? null
  // A season's Shuffle is its show's: every next is drawn from any season.
  const onShuffle = useShowShuffle({ showId: details.show?.id ?? null, session, context })
  const library = useDownloadLibrary({ session, libraryId })
  const download = useDownloadButton({
    serverId: session.server.id,
    library,
    target: seasonTargetOf({
      api: session.api,
      platform: DEVICE_PLATFORM,
      season: details,
      show: show.data ?? null,
    }),
  })
  const actions = [
    ...playNextActionsOf({
      next: nextFile,
      code: next === undefined ? null : episodeCode(next),
      first: firstFile,
      state: marks.watched.state,
      context,
    }),
    ...playAllOf({ first: firstFile, context }),
    ...shuffleOf({ onShuffle }),
    ...marksOf({ marks, words: ITEM_COPY.seasonWatched }),
    ...downloadOf(download),
  ]
  return (
    <ItemLayout
      actions={actions}
      links={[]}
      isPlayPending={false}
      onBack={context.onBack}
      onOpen={context.onOpen}
      page={seasonPage({
        season: details,
        show: show.data ?? null,
        api: session.api,
        headersFor: context.headersFor,
      })}
    />
  )
}

type PlayableFilesProps = {
  kind: typeof ITEM_TYPES.movie | typeof ITEM_TYPES.episode
  details: ItemDetails
  library: number | null
  file: number | null
  session: AppQueries
  context: ItemContext
}

const PLAYABLE_VIEW_KEYS = { missing: 'missing', ready: 'ready' } as const

type PlayableViewProps = {
  [PLAYABLE_VIEW_KEYS.missing]: ItemNoticeProps
  [PLAYABLE_VIEW_KEYS.ready]: PlayableItemProps
}

const PLAYABLE_VIEWS = {
  [PLAYABLE_VIEW_KEYS.missing]: ItemNotice,
  [PLAYABLE_VIEW_KEYS.ready]: PlayableItem,
} as const satisfies ViewsOf<PlayableViewProps>

type PlayableViewOfProps = PlayableFilesProps

const playableViewOf = ({
  kind,
  details,
  library,
  file,
  session,
  context,
}: PlayableViewOfProps): ViewOf<PlayableViewProps> => {
  const shown = libraryFiles({ versions: details.versions, library, file })
  if (shown === null) {
    return {
      key: PLAYABLE_VIEW_KEYS.missing,
      props: { notice: ITEM_COPY.missing, onBack: context.onBack },
    }
  }
  return {
    key: PLAYABLE_VIEW_KEYS.ready,
    props: {
      context,
      session,
      details,
      kind,
      primary: shown.primary,
      versions: shown.versions,
    },
  }
}

/**
 * A movie's or an episode's files as one library shows them: the one the address names, else
 * the one holding the file Play would start, and within it the one card the address's file
 * sits on, as the web's pages keep to.
 */
const PlayableFiles = (props: PlayableFilesProps) => (
  <KeyedView<PlayableViewProps> view={playableViewOf(props)} views={PLAYABLE_VIEWS} />
)

type ItemOfProps = {
  details: ItemDetails
  library: number | null
  file: number | null
  session: AppQueries
  context: ItemContext
}

type MovieItemProps = ItemOfProps

const MovieItem = (props: MovieItemProps) => <PlayableFiles kind={ITEM_TYPES.movie} {...props} />

type EpisodeItemProps = ItemOfProps

const EpisodeItem = (props: EpisodeItemProps) => (
  <PlayableFiles kind={ITEM_TYPES.episode} {...props} />
)

const ITEM_VIEWS = {
  [ITEM_TYPES.movie]: MovieItem,
  [ITEM_TYPES.episode]: EpisodeItem,
  [ITEM_TYPES.show]: ShowItem,
  [ITEM_TYPES.season]: SeasonItem,
} as const satisfies Record<ItemDetails['type'], ComponentType<ItemOfProps>>

const ItemOf = (props: ItemOfProps) => {
  const View = ITEM_VIEWS[props.details.type]
  return <View {...props} />
}

type ServerItemProps = {
  session: AppQueries
  id: number | null
  library: number | null
  file: number | null
}

type ReadyItemProps = ItemOfProps

/** A page once its item and pictures are known, drawn afresh for each item. */
const ReadyItem = (props: ReadyItemProps) => <ItemOf key={props.details.id} {...props} />

const SERVER_ITEM_VIEW_KEYS = { notice: 'notice', loading: 'loading', ready: 'ready' } as const

type ServerItemViewProps = {
  [SERVER_ITEM_VIEW_KEYS.notice]: ItemNoticeProps
  [SERVER_ITEM_VIEW_KEYS.loading]: LoadingProps
  [SERVER_ITEM_VIEW_KEYS.ready]: ItemOfProps
}

const SERVER_ITEM_VIEWS = {
  [SERVER_ITEM_VIEW_KEYS.notice]: ItemNotice,
  [SERVER_ITEM_VIEW_KEYS.loading]: Loading,
  [SERVER_ITEM_VIEW_KEYS.ready]: ReadyItem,
} as const satisfies ViewsOf<ServerItemViewProps>

type ServerItemViewOfProps = Omit<ServerItemProps, 'id'> & {
  page: RouteQuery<ItemDetails>
  pictures: Pick<Pictures, 'headersFor'> | null
  onOpen: (target: RouteTarget) => void
  onBack: () => void
}

type NoticeViewProps = ItemNoticeProps

const noticeView = ({ notice, onBack }: NoticeViewProps): ViewOf<ServerItemViewProps> => ({
  key: SERVER_ITEM_VIEW_KEYS.notice,
  props: { notice, onBack },
})

type LoadingViewProps = LoadingProps

const loadingView = ({ label, onBack }: LoadingViewProps): ViewOf<ServerItemViewProps> => ({
  key: SERVER_ITEM_VIEW_KEYS.loading,
  props: { label, onBack },
})

const serverItemViewOf = ({
  page,
  pictures,
  onOpen,
  onBack,
  ...item
}: ServerItemViewOfProps): ViewOf<ServerItemViewProps> => {
  switch (page.state) {
    case ROUTE_STATES.missing:
      return noticeView({ notice: ITEM_COPY.missing, onBack })
    case ROUTE_STATES.error:
      return noticeView({ notice: page.message, onBack })
    case ROUTE_STATES.loading:
      return loadingView({ label: ITEM_COPY.opening, onBack })
    case ROUTE_STATES.ready:
      // The pictures wait for the server's cookies, so none is asked for twice.
      if (pictures === null) return loadingView({ label: ITEM_COPY.opening, onBack })
      return {
        key: SERVER_ITEM_VIEW_KEYS.ready,
        props: {
          ...item,
          details: page.data,
          context: { headersFor: pictures.headersFor, onOpen, onBack },
        },
      }
    default: {
      const unknown: never = page
      return unknown
    }
  }
}

const ServerItem = ({ session, id, library, file }: ServerItemProps) => {
  const router = useRouter()
  const item = useQuery(session.queries.itemQuery(id))
  const pictures = usePictures(session)
  const view = serverItemViewOf({
    page: routeState({ id, query: item }),
    pictures,
    onOpen: (target) => router.push(hrefOf(target)),
    onBack: () => router.back(),
    library,
    file,
    session,
  })
  return <KeyedView<ServerItemViewProps> view={view} views={SERVER_ITEM_VIEWS} />
}

/**
 * `/item/[id]`: a movie, show, season or episode, with its pictures, facts, summary and
 * people, Play or Resume, Favourite and Watched, and the way on to its versions, seasons or
 * episodes. `?library=` and `?file=` keep a movie's or an episode's page to one library's
 * files and one card, as the web's do.
 */
export const Item = () => {
  const params = useLocalSearchParams()
  const id = routeIdOf(params[APP_ROUTE_PARAMS.id])
  const library = routeIdOf(params[APP_ROUTE_PARAMS.library])
  const file = routeIdOf(params[APP_ROUTE_PARAMS.file])
  const session = useAppQueries()
  return (
    session !== null && (
      <ServerItem key={session.server.id} file={file} id={id} library={library} session={session} />
    )
  )
}
