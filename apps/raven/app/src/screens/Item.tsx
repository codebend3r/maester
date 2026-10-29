import {
  ITEM_TYPES,
  type ItemDetails,
  type MediaItem,
  ROUTE_STATES,
  WATCHED_STATES,
  WATCH_TARGET_KINDS,
  type WatchedState,
  canFavouriteIn,
  episodeCode,
  episodesOf,
  episodesWatched,
  formatDuration,
  libraryFiles,
  nextEpisodeIn,
  routeIdOf,
  routeState,
  seasonsOf,
  seasonsWatched,
  watchedStateOf,
} from '@raven/core'
import {
  useServerItemFavourite,
  useServerMediaMutations,
  useServerWatchedToggle,
} from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'

import type { Pictures } from '@/queries/cards'
import { playablePage, seasonPage, showPage } from '@/queries/itemPage'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { ItemLayout, ItemNotice, Loading } from '@/layouts'
import { type CheckState, ITEM_ACTIONS, type ItemAction } from '@/layouts/itemKit'
import { APP_ROUTE_PARAMS, ROUTE_TARGETS, type RouteTarget, hrefOf } from '@/routes'

const COPY = {
  opening: 'Opening the title',
  missing: 'This title is not on the server.',
  play: 'Play',
  markWatched: 'Mark watched',
  watched: 'Watched',
  favourite: 'Favourite',
} as const

const ACTION_KEYS = { play: 'play', favourite: 'favourite', watched: 'watched' } as const

/** A Watched toggle reads as ticked for all of it, half ticked for some, as the web's does. */
const WATCHED_CHECKS = {
  [WATCHED_STATES.unwatched]: false,
  [WATCHED_STATES.partly]: 'mixed',
  [WATCHED_STATES.watched]: true,
} as const satisfies Record<WatchedState, CheckState>

/** What a page's item is shown with: its pictures' headers, and where it leads. */
type ItemContext = Pick<Pictures, 'headersFor'> & {
  onOpen: (target: RouteTarget) => void
  onBack: () => void
}

type PlayOfProps = {
  media: MediaItem
  label: string
  context: ItemContext
}

const playOf = ({ media, label, context }: PlayOfProps): ItemAction => ({
  kind: ITEM_ACTIONS.play,
  key: ACTION_KEYS.play,
  label,
  onPress: () =>
    context.onOpen({ kind: ROUTE_TARGETS.play, mediaId: media.id, at: media.position }),
})

type FavouriteOfProps = {
  isOn: boolean
  onToggle: (isMarked: boolean) => void
}

const favouriteOf = ({ isOn, onToggle }: FavouriteOfProps): ItemAction => ({
  kind: ITEM_ACTIONS.toggle,
  key: ACTION_KEYS.favourite,
  label: COPY.favourite,
  isOn,
  onPress: () => onToggle(!isOn),
})

type WatchedOfProps = {
  state: WatchedState
  onToggle: () => void
}

/** Watched reads as what pressing it does until everything is: then it says it is. */
const watchedOf = ({ state, onToggle }: WatchedOfProps): ItemAction => ({
  kind: ITEM_ACTIONS.toggle,
  key: ACTION_KEYS.watched,
  label: state === WATCHED_STATES.watched ? COPY.watched : COPY.markWatched,
  isOn: WATCHED_CHECKS[state],
  onPress: onToggle,
})

/** "Play S01E02" for the episode a show or season plays next, or plain Play without a number. */
const playNextLabel = (code: string | null): string =>
  code === null ? COPY.play : `${COPY.play} ${code}`

type MarksOfProps = {
  details: ItemDetails
  favourite: ReturnType<typeof useServerItemFavourite>
  watched: ReturnType<typeof useServerWatchedToggle>
}

/**
 * A show's or a season's marks: Favourite where the server says it can be one, then Watched
 * over every episode under it.
 */
const marksOf = ({ details, favourite, watched }: MarksOfProps): ItemAction[] => [
  ...(details.favourite === null
    ? []
    : [favouriteOf({ isOn: details.favourite, onToggle: favourite.mutate })]),
  watchedOf(watched),
]

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
 * stopped, then Favourite where its library allows one, then Watched, each mark shown before
 * the server answers.
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
  const { favourite, watched } = useServerMediaMutations({ api: session.api, media: primary })
  const libraries = useQuery(queries.librariesQuery)
  const tracks = useQuery(queries.tracksQuery(primary.id))
  // An episode sits under its show's backdrop.
  const show = useQuery(
    queries.itemQuery(kind === ITEM_TYPES.episode ? (details.show?.id ?? null) : null),
  )
  // A locked library's videos are never marked, but one marked before it locked can be unmarked.
  const canFavourite =
    canFavouriteIn({ libraries: libraries.data ?? [], libraryId: primary.libraryId }) ||
    primary.favourite
  const page = playablePage({
    kind,
    details,
    versions,
    primary,
    show: show.data ?? null,
    isShowPending: details.show !== null && show.isPending,
    tracks: tracks.data,
    api: session.api,
    headersFor: context.headersFor,
  })
  const actions = [
    playOf({
      media: primary,
      label: primary.position > 0 ? `Resume from ${formatDuration(primary.position)}` : COPY.play,
      context,
    }),
    ...(canFavourite ? [favouriteOf({ isOn: primary.favourite, onToggle: favourite.mutate })] : []),
    watchedOf({
      state: primary.watched ? WATCHED_STATES.watched : WATCHED_STATES.unwatched,
      onToggle: () => watched.mutate(!primary.watched),
    }),
  ]
  return (
    <ItemLayout
      actions={actions}
      isPlayPending={false}
      onBack={context.onBack}
      onOpen={context.onOpen}
      page={page}
    />
  )
}

type ShowItemProps = {
  details: ItemDetails
  session: AppQueries
  context: ItemContext
}

/**
 * A show: Play for the episode the server says comes next, once it says, Favourite and Watched
 * over every episode, then its seasons.
 */
const ShowItem = ({ details, session, context }: ShowItemProps) => {
  const next = useQuery(session.queries.nextEpisodeQuery(details.id))
  const favourite = useServerItemFavourite({ api: session.api, item: details })
  const toggle = useServerWatchedToggle({
    api: session.api,
    state: watchedStateOf(seasonsWatched(seasonsOf(details))),
    targets: [{ kind: WATCH_TARGET_KINDS.item, id: details.id, libraryId: null }],
  })
  const nextFile = next.data ?? null
  const actions = [
    ...(nextFile === null
      ? []
      : [
          playOf({
            media: nextFile,
            label: playNextLabel(nextFile.item === null ? null : episodeCode(nextFile.item)),
            context,
          }),
        ]),
    ...marksOf({ details, favourite, watched: toggle }),
  ]
  return (
    <ItemLayout
      actions={actions}
      isPlayPending={next.isPending}
      onBack={context.onBack}
      onOpen={context.onOpen}
      page={showPage({ details, api: session.api, headersFor: context.headersFor })}
    />
  )
}

type SeasonItemProps = {
  details: ItemDetails
  session: AppQueries
  context: ItemContext
}

/** A season: Play for its first episode not yet watched, Favourite and Watched, then its episodes. */
const SeasonItem = ({ details, session, context }: SeasonItemProps) => {
  // A season sits under its show's backdrop, and carries its show's content rating.
  const show = useQuery(session.queries.itemQuery(details.show?.id ?? null))
  const favourite = useServerItemFavourite({ api: session.api, item: details })
  const episodes = episodesOf(details)
  const toggle = useServerWatchedToggle({
    api: session.api,
    state: watchedStateOf(episodesWatched(episodes)),
    targets: [{ kind: WATCH_TARGET_KINDS.item, id: details.id, libraryId: null }],
  })
  const next = nextEpisodeIn(episodes)
  const nextFile = next?.primary ?? null
  const actions = [
    ...(next === undefined || nextFile === null
      ? []
      : [playOf({ media: nextFile, label: playNextLabel(episodeCode(next)), context })]),
    ...marksOf({ details, favourite, watched: toggle }),
  ]
  return (
    <ItemLayout
      actions={actions}
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

/**
 * A movie's or an episode's files as one library shows them: the one the address names, else
 * the one holding the file Play would start, and within it the one card the address's file
 * sits on, as the web's pages keep to.
 */
const PlayableFiles = ({ kind, details, library, file, session, context }: PlayableFilesProps) => {
  const shown = libraryFiles({ versions: details.versions, library, file })
  if (shown === null) return <ItemNotice notice={COPY.missing} onBack={context.onBack} />
  return (
    <PlayableItem
      context={context}
      session={session}
      details={details}
      kind={kind}
      primary={shown.primary}
      versions={shown.versions}
    />
  )
}

type ItemOfProps = {
  details: ItemDetails
  library: number | null
  file: number | null
  session: AppQueries
  context: ItemContext
}

const ItemOf = ({ details, library, file, session, context }: ItemOfProps) => {
  switch (details.type) {
    case ITEM_TYPES.movie:
    case ITEM_TYPES.episode:
      return (
        <PlayableFiles
          context={context}
          details={details}
          file={file}
          kind={details.type}
          library={library}
          session={session}
        />
      )
    case ITEM_TYPES.show:
      return <ShowItem context={context} details={details} session={session} />
    case ITEM_TYPES.season:
      return <SeasonItem context={context} details={details} session={session} />
    default: {
      const unknown: never = details.type
      return unknown
    }
  }
}

type ServerItemProps = {
  session: AppQueries
  id: number | null
  library: number | null
  file: number | null
}

const ServerItem = ({ session, id, library, file }: ServerItemProps) => {
  const router = useRouter()
  const item = useQuery(session.queries.itemQuery(id))
  const pictures = usePictures(session)
  const onBack = () => router.back()
  const page = routeState({ id, query: item })
  switch (page.state) {
    case ROUTE_STATES.missing:
      return <ItemNotice notice={COPY.missing} onBack={onBack} />
    case ROUTE_STATES.error:
      return <ItemNotice notice={page.message} onBack={onBack} />
    case ROUTE_STATES.loading:
      return <Loading label={COPY.opening} onBack={onBack} />
    case ROUTE_STATES.ready:
      // The pictures wait for the server's cookies, so none is asked for twice.
      return pictures === null ? (
        <Loading label={COPY.opening} onBack={onBack} />
      ) : (
        <ItemOf
          key={page.data.id}
          context={{
            headersFor: pictures.headersFor,
            onOpen: (target) => router.push(hrefOf(target)),
            onBack,
          }}
          details={page.data}
          file={file}
          library={library}
          session={session}
        />
      )
    default: {
      const unknown: never = page
      return unknown
    }
  }
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
