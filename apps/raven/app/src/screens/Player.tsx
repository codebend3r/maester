import {
  AT_HOME,
  type Chapter,
  type ItemDetails,
  type MediaItem,
  type MediaTracks,
  type PlayNetwork,
  ROUTE_STATES,
  type RouteQuery,
  SESSION_PARAMS,
  type ViewingSession,
  readSessionQuery,
  routeIdOf,
  routeState,
} from '@raven/core'
import {
  KeyedView,
  type ViewOf,
  type ViewsOf,
  useAudioQueue,
  usePlaybackPolicy,
} from '@raven/ui/headless'
import { useServerUnlock } from '@raven/native'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo } from 'react'

import { Loading, PlayerChrome, shouldDrawCaptions } from '@/layouts'
import type { LoadingProps } from '@/layouts/loadingKit'
import { NO_HEADING } from '@/layouts/playerHeading'
import { LocalPlayer, type LocalPlayerProps } from '@/player/LocalPlayer'
import { type KeptVideo, PLAY_ORIGINS, playOriginOf, usePatience } from '@/player/localPlay'
import { mediaSourcesFor } from '@/player/mediaSources'
import { Playing, type PlayingProps } from '@/player/Playing'
import { type PlayWay, serverWayOf } from '@/player/playWay'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { downloadedVideoOf } from '@/downloads/downloadVisibility'
import { APP_ROUTE_PARAMS, PLAY_FROM, ROUTE_TARGETS, hrefOf, secondsOf } from '@/routes'
import { PLAYER_SCREEN_COPY } from '@/screens/copy'
import { useAppPrefs } from '@/stores/appPrefs'
import { useDownloads } from '@/stores/downloads'

/** The cache key where a video plays from sits under, with the server and the video. */
const PLAY_NETWORK_KEY = 'playNetwork'

const NO_CHAPTERS: readonly Chapter[] = []

type ReadyPlayerProps = Omit<PlayingProps, 'way' | 'summary'>

type WaitingProps = {
  notice: string
  onBack: () => void
}

/** The player's chrome with only a line on it and Back. */
const Waiting = ({ notice, onBack }: WaitingProps) => (
  <PlayerChrome
    artwork={null}
    audio={null}
    caption={null}
    notice={notice}
    onBack={onBack}
    heading={NO_HEADING}
    isOpening={false}
    mode={null}
    upNext={null}
    chapters={NO_CHAPTERS}
    next={null}
    previous={null}
    quality={null}
    subtitles={null}
    summary={null}
    surface={null}
    title=""
    transport={null}
  />
)

const READY_PLAYER_VIEW_KEYS = { loading: 'loading', playing: 'playing' } as const

type ReadyPlayerViewProps = {
  [READY_PLAYER_VIEW_KEYS.loading]: LoadingProps
  [READY_PLAYER_VIEW_KEYS.playing]: PlayingProps
}

const READY_PLAYER_VIEWS = {
  [READY_PLAYER_VIEW_KEYS.loading]: Loading,
  [READY_PLAYER_VIEW_KEYS.playing]: Playing,
} as const satisfies ViewsOf<ReadyPlayerViewProps>

type ReadyPlayerViewOfProps = ReadyPlayerProps & {
  /** How the video plays, once the server has said enough to plan it; null while it is still asked. */
  way: PlayWay | null
  details: Pick<UseQueryResult<ItemDetails>, 'isLoading' | 'data'>
}

const readyPlayerViewOf = ({
  way,
  details,
  ...playing
}: ReadyPlayerViewOfProps): ViewOf<ReadyPlayerViewProps> => {
  if (way === null || details.isLoading) {
    return {
      key: READY_PLAYER_VIEW_KEYS.loading,
      props: { label: PLAYER_SCREEN_COPY.opening, onBack: playing.onBack },
    }
  }
  // A file whose page cannot be read still plays, with no synopsis.
  return {
    key: READY_PLAYER_VIEW_KEYS.playing,
    props: { ...playing, way, summary: details.data?.summary ?? null },
  }
}

type UseServerWayProps = {
  session: AppQueries
  media: MediaItem
  policy: ReturnType<typeof usePlaybackPolicy>
  tracks: Pick<UseQueryResult<MediaTracks>, 'isPending' | 'data'>
  network: Pick<UseQueryResult<PlayNetwork>, 'isPending' | 'data'>
}

/**
 * The server's way to play the video, once its playback settings, its tracks and where it plays
 * from are known, planned once for them and the prefs; a file whose tracks cannot be read still
 * plays, with no pickers.
 */
const useServerWay = ({
  session,
  media,
  policy,
  tracks,
  network,
}: UseServerWayProps): PlayWay | null => {
  const shouldPreferDirectPlay = useAppPrefs((prefs) => prefs.shouldPreferDirectPlay)
  const isTranscodeAllowed = useAppPrefs((prefs) => prefs.isTranscodeAllowed)
  // One per server, so the picture and its subtitles reach the video the same way.
  const sources = mediaSourcesFor(session.server)
  const isKnown = !tracks.isPending && !network.isPending
  const tracksKnown = tracks.data ?? null
  const networkKnown = network.data ?? AT_HOME
  return useMemo(
    () =>
      policy === null || !isKnown
        ? null
        : serverWayOf({
            media,
            tracks: tracksKnown,
            policy,
            prefs: { shouldPreferDirectPlay, isTranscodeAllowed },
            shouldDrawCaptions,
            network: networkKnown,
            sources,
          }),
    [
      policy,
      isKnown,
      media,
      tracksKnown,
      shouldPreferDirectPlay,
      isTranscodeAllowed,
      networkKnown,
      sources,
    ],
  )
}

/** A video once the server's playback settings, its tracks and where it plays from are known. */
const ReadyPlayer = (props: ReadyPlayerProps) => {
  const { session, media } = props
  const policy = usePlaybackPolicy({ queries: session.queries })
  const tracks = useQuery(session.queries.tracksQuery(media.id))
  /*
   * Read before the plan is made, which starts a file over the remote limit at the transcode
   * away from home; the pick and the ticket are the ones its first source then plays by.
   */
  const network = useQuery({
    queryKey: [PLAY_NETWORK_KEY, session.server.id, media.id],
    queryFn: () => mediaSourcesFor(session.server).networkFor(media.id),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  })
  /*
   * Read before the source is handed over, which carries the synopsis on a TV: a source that
   * changes once playing reloads the video.
   */
  const details = useQuery(session.queries.itemQuery(media.item?.id ?? null))
  const way = useServerWay({ session, media, policy, tracks, network })
  const view = readyPlayerViewOf({ ...props, way, details })
  return <KeyedView<ReadyPlayerViewProps> view={view} views={READY_PLAYER_VIEWS} />
}

type ServerPlayerProps = {
  session: AppQueries
  chosen: ViewingSession | null
  mediaId: number | null
  at: number
  isFromStart: boolean
}

/** A video once it is known, drawn afresh for each video. */
const KeyedReadyPlayer = (props: ReadyPlayerProps) => (
  <ReadyPlayer key={props.media.id} {...props} />
)

const SERVER_PLAYER_VIEW_KEYS = {
  waiting: 'waiting',
  loading: 'loading',
  ready: 'ready',
  local: 'local',
} as const

type ServerPlayerViewProps = {
  [SERVER_PLAYER_VIEW_KEYS.waiting]: WaitingProps
  [SERVER_PLAYER_VIEW_KEYS.loading]: LoadingProps
  [SERVER_PLAYER_VIEW_KEYS.ready]: ReadyPlayerProps
  [SERVER_PLAYER_VIEW_KEYS.local]: LocalPlayerProps
}

const SERVER_PLAYER_VIEWS = {
  [SERVER_PLAYER_VIEW_KEYS.waiting]: Waiting,
  [SERVER_PLAYER_VIEW_KEYS.loading]: Loading,
  [SERVER_PLAYER_VIEW_KEYS.ready]: KeyedReadyPlayer,
  [SERVER_PLAYER_VIEW_KEYS.local]: LocalPlayer,
} as const satisfies ViewsOf<ServerPlayerViewProps>

/** What every way of playing the video takes, wherever its bytes come from. */
type ReadyProps = Omit<ReadyPlayerProps, 'media' | 'onBack'>

type ServerPlayerViewOfProps = ReadyProps & {
  page: RouteQuery<MediaItem>
  onBack: () => void
  /** The video's download on this device; null for none. */
  kept: KeptVideo | null
  /** Whether a download still waits for the server's word on the video. */
  isPatient: boolean
}

const waitingView = ({ notice, onBack }: WaitingProps): ViewOf<ServerPlayerViewProps> => ({
  key: SERVER_PLAYER_VIEW_KEYS.waiting,
  props: { notice, onBack },
})

type ServerPageViewOfProps = ReadyProps & { page: RouteQuery<MediaItem>; onBack: () => void }

/** The server's video as its page stands: not there, refused, still read, or ready to play. */
const serverPageViewOf = ({
  page,
  onBack,
  ...ready
}: ServerPageViewOfProps): ViewOf<ServerPlayerViewProps> => {
  switch (page.state) {
    case ROUTE_STATES.missing:
      return waitingView({ notice: PLAYER_SCREEN_COPY.missing, onBack })
    case ROUTE_STATES.error:
      return waitingView({ notice: page.message, onBack })
    case ROUTE_STATES.loading:
      return {
        key: SERVER_PLAYER_VIEW_KEYS.loading,
        props: { label: PLAYER_SCREEN_COPY.opening, onBack },
      }
    case ROUTE_STATES.ready:
      return {
        key: SERVER_PLAYER_VIEW_KEYS.ready,
        props: { ...ready, media: page.data, onBack },
      }
    default: {
      const unknown: never = page
      return unknown
    }
  }
}

/** Where the video's bytes come from decides the view, once; the page's state decides the server's. */
const serverPlayerViewOf = ({
  page,
  onBack,
  kept,
  isPatient,
  ...ready
}: ServerPlayerViewOfProps): ViewOf<ServerPlayerViewProps> => {
  const origin = playOriginOf({ kept, page, isPatient })
  switch (origin.kind) {
    case PLAY_ORIGINS.local:
      return {
        key: SERVER_PLAYER_VIEW_KEYS.local,
        props: { ...ready, media: origin.media, local: origin.local, onBack },
      }
    case PLAY_ORIGINS.server:
      return serverPageViewOf({ ...ready, page, onBack })
    default: {
      const unknown: never = origin
      return unknown
    }
  }
}

const ServerPlayer = ({ session, chosen, mediaId, at, isFromStart }: ServerPlayerProps) => {
  const router = useRouter()
  const isUnlocked = useServerUnlock({ serverId: session.server.id })
  const download = useDownloads((state) =>
    mediaId === null
      ? null
      : downloadedVideoOf({
          entries: state.entries,
          serverId: session.server.id,
          mediaId,
          isUnlocked,
        }),
  )
  const disk = useDownloads((state) => state.device.disk)
  const kept = useMemo(
    (): KeptVideo | null =>
      download === null
        ? null
        : {
            media: download.media,
            copy: { uri: disk.uriOf(download.path), tracks: download.tracks },
          },
    [download, disk],
  )
  const isPatient = usePatience(kept !== null)
  const onBack = () => router.back()
  /*
   * The next takes this video's place, so Back from it still goes to the page that pressed Play,
   * and it plays in the same session, so a saga's films keep walking the saga.
   */
  const onPlayNext = (next: MediaItem, viewing: ViewingSession) =>
    router.replace(hrefOf({ kind: ROUTE_TARGETS.play, mediaId: next.id, at: 0, session: viewing }))
  const page = routeState({ id: mediaId, query: useQuery(session.queries.mediaQuery(mediaId)) })
  const view = serverPlayerViewOf({
    page,
    onBack,
    onPlayNext,
    at,
    isFromStart,
    session,
    chosen,
    kept,
    isPatient,
  })
  return <KeyedView<ServerPlayerViewProps> view={view} views={SERVER_PLAYER_VIEWS} />
}

/**
 * `/play/[mediaId]`: a video under raven's controls, from the spot `?at=` names (Resume's) or
 * where the server last saved, down the ladder of ways the server offers.
 */
export const Player = () => {
  // A film and a track never play at once: the music pauses as the player opens, as on the web.
  useEffect(() => useAudioQueue.getState().pause(), [])
  const params = useLocalSearchParams()
  const mediaId = routeIdOf(params[APP_ROUTE_PARAMS.mediaId])
  const at = secondsOf(params[APP_ROUTE_PARAMS.at])
  const isFromStart = params[APP_ROUTE_PARAMS.from] === PLAY_FROM.start
  const chosen = readSessionQuery({
    session: params[SESSION_PARAMS.session],
    scope: params[SESSION_PARAMS.scope],
  })
  const session = useAppQueries()
  return (
    session !== null && (
      <ServerPlayer
        key={session.server.id}
        at={at}
        chosen={chosen}
        isFromStart={isFromStart}
        mediaId={mediaId}
        session={session}
      />
    )
  )
}
