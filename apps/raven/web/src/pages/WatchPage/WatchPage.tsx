import {
  AUTH_CONFIG_STATES,
  type MediaItem,
  ROUTE_STATES,
  type RoutePending,
  type RouteQuery,
  SESSION_KINDS,
  SHOW_SESSION,
  type ViewingSession,
  episodePlace,
  mediaLabel,
  playLinkFor,
  readWatchState,
  resumeAtFor,
  routeState,
  sessionOf,
  titleHomePath,
  watchLink,
  PLAYER_SOURCE_KINDS,
  libraryPath,
} from '@raven/core'
import { type ComponentType, useState } from 'react'
import {
  BUTTON_TONES,
  ButtonLink,
  type MediaPlane,
  Player,
  createProgressSaver,
  useLeaveFullscreen,
  useMediaPlane,
} from '@raven/ui'
import {
  afterWatching,
  type PlayerServices,
  useHostPlayer,
  usePlayerPrefs,
  ENGINE_KINDS,
  KeyedView,
  type ViewOf,
  type ViewsOf,
  NO_HOST_EXTRAS,
} from '@raven/ui/headless'
import { OfflineWatch } from '@/browserDownloads/OfflineWatch'
import { DesktopWatch } from '@/desktop/DesktopWatch/DesktopWatch'
import { PlayerMessage } from '@/desktop/player/PlayerMessage'
import { api } from '@/lib/api'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { authConfigQuery, markersQuery, mediaQuery, nextInSessionQuery } from '@/lib/queries'
import { ravenPlayer } from '@/lib/ravenPlayer'
import { useRouteId } from '@/lib/routeQuery'
import { useTicketFollowsSession } from '@/lib/useTicketFollowsSession'
import { useTitleLogo } from '@/lib/useTitleLogo'
import { ravenVersion } from '@/lib/version'
import { useBrowserDownloads } from '@/stores/browserDownloads'
import { useIsDesktop } from '@/stores/desktop'
import { useServerReach } from '@/stores/serverReach'
import { WATCH_PAGE_COPY } from '@/pages/WatchPage/copy'
import styles from '@/pages/WatchPage/WatchPage.module.scss'
import { COMMON_COPY } from '@/lib/copy'
import { APP_PATHS } from '@/lib/appPaths'

const WaitingLine = () => <p aria-live="polite">{COMMON_COPY.loading}</p>

type RefusedLineProps = { message: string }

const RefusedLine = ({ message }: RefusedLineProps) => (
  <>
    <p role="alert">{message}</p>
    <ButtonLink
      to={APP_PATHS.libraries}
      tone={BUTTON_TONES.pill}
      icon="back"
      className={styles.back}
    >
      {WATCH_PAGE_COPY.backToLibraries}
    </ButtonLink>
  </>
)

const MESSAGE_LINE_KEYS = { waiting: 'waiting', refused: 'refused' } as const

type MessageLineProps = {
  [MESSAGE_LINE_KEYS.waiting]: Record<never, never>
  [MESSAGE_LINE_KEYS.refused]: RefusedLineProps
}

const MESSAGE_LINES = {
  [MESSAGE_LINE_KEYS.waiting]: WaitingLine,
  [MESSAGE_LINE_KEYS.refused]: RefusedLine,
} as const satisfies ViewsOf<MessageLineProps>

type MessageLineOfProps = { message: string | null }

const messageLineOf = ({ message }: MessageLineOfProps): ViewOf<MessageLineProps> => {
  if (message === null) return { key: MESSAGE_LINE_KEYS.waiting, props: {} }
  return { key: MESSAGE_LINE_KEYS.refused, props: { message } }
}

type WatchMessageProps = { message: string | null }

/** The player's place while there is no video: waiting for one (a null message), or saying why. */
const WatchMessage = ({ message }: WatchMessageProps) => (
  <main className={styles.page}>
    <KeyedView<MessageLineProps> views={MESSAGE_LINES} view={messageLineOf({ message })} />
  </main>
)

/** What the player's place says while the video is not there: nothing yet, or why not. */
const messageOf = (page: RoutePending): string | null => {
  switch (page.state) {
    case ROUTE_STATES.loading:
      return null
    case ROUTE_STATES.missing:
      return WATCH_PAGE_COPY.missing
    case ROUTE_STATES.error:
      return page.message
    default: {
      const unreachable: never = page
      return unreachable
    }
  }
}

/**
 * The card that was clicked hands its item over in router state, so the
 * video element gets its src on the very first render and playback starts
 * without a round trip. A direct link or a refresh fetches it instead.
 * The link names the session it plays in; without one the video's own
 * says what follows, so a refreshed episode still rolls on. In a browser
 * that keeps downloads, a server out of reach plays the title's download.
 */
export const WatchPage = () => {
  const id = useRouteId()
  const { state, search } = useLocation()
  const isDesktop = useIsDesktop()
  const isOffline = useServerReach((reach) => reach.isOffline)
  const hasBrowserDownloads = useBrowserDownloads((downloads) => downloads.engine !== null)
  const handed = readWatchState({ state, id })
  const page = routeState({
    id,
    query: useQuery({ ...mediaQuery(id), initialData: handed?.media }),
  })
  useLeaveFullscreen()
  return (
    <KeyedView<WatchViewProps>
      views={WATCH_VIEWS}
      view={watchViewOf({
        page,
        isDesktop,
        search,
        handed,
        offlineId: isOffline && hasBrowserDownloads ? { mediaId: id } : null,
      })}
    />
  )
}

type PlayingProps = { playKey: string | number; player: WatchPlayerProps }

/** A play link Raven opens for the title on screen names where to start: a new player. */
const Playing = ({ playKey, player }: PlayingProps) => <WatchPlayer key={playKey} {...player} />

type DesktopMessageProps = Parameters<typeof PlayerMessage>[0]

type OfflineWatchProps = Parameters<typeof OfflineWatch>[0]

const WATCH_VIEW_KEYS = {
  playing: 'playing',
  offline: 'offline',
  desktop: 'desktop',
  browser: 'browser',
} as const

type WatchViewProps = {
  [WATCH_VIEW_KEYS.playing]: PlayingProps
  [WATCH_VIEW_KEYS.offline]: OfflineWatchProps
  [WATCH_VIEW_KEYS.desktop]: DesktopMessageProps
  [WATCH_VIEW_KEYS.browser]: WatchMessageProps
}

const WATCH_VIEWS = {
  [WATCH_VIEW_KEYS.playing]: Playing,
  [WATCH_VIEW_KEYS.offline]: OfflineWatch,
  [WATCH_VIEW_KEYS.desktop]: PlayerMessage,
  [WATCH_VIEW_KEYS.browser]: WatchMessage,
} as const satisfies ViewsOf<WatchViewProps>

type WatchViewOfProps = {
  page: RouteQuery<MediaItem>
  isDesktop: boolean
  search: string
  handed: ReturnType<typeof readWatchState>
  /** The title to play from its download: set while a browser that keeps downloads cannot reach the server. */
  offlineId: OfflineWatchProps | null
}

/** The video's player once it is in, else the player's place saying why not, Raven's or the browser's. */
const watchViewOf = ({
  page,
  isDesktop,
  search,
  handed,
  offlineId,
}: WatchViewOfProps): ViewOf<WatchViewProps> => {
  if (offlineId !== null) return { key: WATCH_VIEW_KEYS.offline, props: offlineId }
  if (page.state === ROUTE_STATES.ready)
    return {
      key: WATCH_VIEW_KEYS.playing,
      props: {
        playKey: isDesktop ? `${page.data.id}${search}` : page.data.id,
        player: {
          media: page.data,
          session: handed?.session ?? sessionOf(page.data),
          upNext: handed?.upNext ?? [],
          backTo: libraryPath(page.data.libraryId),
        },
      },
    }
  // Outside the side menu, Raven's window has no other way back while this waits.
  if (isDesktop)
    return {
      key: WATCH_VIEW_KEYS.desktop,
      props: { message: messageOf(page), fallback: APP_PATHS.libraries },
    }
  return { key: WATCH_VIEW_KEYS.browser, props: { message: messageOf(page) } }
}

type WatchPlayerProps = {
  media: MediaItem
  session: ViewingSession
  /** A queue's videos after this one, as a shuffle dealt them; the server finds any other session's. */
  upNext: readonly MediaItem[]
  backTo: string
}

/** The browser host owns server history, links and clipboard behavior. */
export const WatchPlayer = ({ media, session, upNext, backTo }: WatchPlayerProps) => {
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState<string | null>(null)
  const [saver] = useState(() =>
    createProgressSaver({ send: (report) => api.saveProgress({ id: media.id, ...report }) }),
  )
  const opensInRavenPlayer = usePlayerPrefs((prefs) => prefs.opensInRavenPlayer)
  const isShuffled = session.kind === SESSION_KINDS.queue
  const queued = isShuffled ? upNext : []
  const inSession = useQuery(nextInSessionQuery({ id: media.id, session }))
  const found = inSession.data ?? null
  const [first, ...after] = queued
  const next = first ?? found
  // A season played on its own ends with its last episode; the show's next is then the next season's first.
  const isSeasonOver = session.kind === SESSION_KINDS.season && inSession.data === null
  const nextSeason =
    useQuery({
      ...nextInSessionQuery({ id: media.id, session: SHOW_SESSION }),
      enabled: isSeasonOver,
    }).data ?? null
  const offered = next ?? (isSeasonOver ? nextSeason : null)
  // Playback never waits on these: the chapters and markers show once they come.
  const markers = useQuery(markersQuery(media.id)).data ?? null
  const mediaPlane = useMediaPlane({ api, mediaId: media.id })
  useTicketFollowsSession({ mediaId: media.id })
  const hasAccounts = (useQuery(authConfigQuery).data?.state ?? null) === AUTH_CONFIG_STATES.ready
  const copyLink = () => {
    const href = api.fileUrl({ id: media.id, access: mediaPlane.access })
    const link = href.startsWith('/') ? new URL(href, window.location.origin).href : href
    const life = hasAccounts ? WATCH_PAGE_COPY.linkLife.account : WATCH_PAGE_COPY.linkLife.legacy
    const lasts = mediaPlane.access ? WATCH_PAGE_COPY.linkLasts(life) : ''
    navigator.clipboard.writeText(link).then(
      () => setCopied(WATCH_PAGE_COPY.linkCopied(lasts)),
      () => setCopied(WATCH_PAGE_COPY.copyThisLink(link)),
    )
  }
  const isDesktop = useIsDesktop()
  const logo = useTitleLogo({ media })
  const services: PlayerServices = {
    ...NO_HOST_EXTRAS,
    title: {
      label: mediaLabel(media),
      context: null,
      logo,
      homeTo: media.item == null ? null : titleHomePath(media.item),
      duration: media.duration,
      resumeAt: resumeAtFor({ at: 0, media }),
      backTo,
      markers,
      next: offered
        ? {
            ...watchLink({ media: offered, session, upNext: after }),
            label: mediaLabel(offered),
            isShuffled,
            detail: episodePlace(offered),
            posterUrl: api.thumbnailUrl(offered),
            isNextSeason: next === null,
          }
        : null,
    },
    progress: {
      started: () => {
        api.recordPlay(media.id).catch(() => undefined)
      },
      save: saver.save,
      // The lists read again only once the last position is in, or they would show the old spot.
      left: () => {
        saver
          .settled()
          .then(() => afterWatching({ queryClient, libraryId: media.libraryId }))
          .catch(() => undefined)
      },
      duration: null,
    },
    posterUrl: api.thumbnailUrl(media),
    escape: { label: WATCH_PAGE_COPY.copyFileLink, run: copyLink, icon: 'copy' },
    escapeFeedback: copied,
    report: {
      appVersion: ravenVersion,
      send: (diagnostics) => api.reportPlaybackError(diagnostics),
    },
    // Inside Raven the title already plays there.
    ...(opensInRavenPlayer &&
      !isDesktop && {
        handoff: {
          label: WATCH_PAGE_COPY.openInRaven,
          run: (at) =>
            ravenPlayer.open(
              playLinkFor({
                origin: window.location.origin,
                mediaId: media.id,
                at,
                next: next ? [next, ...after].map(({ id }) => id) : [],
              }),
            ),
        },
      }),
  }
  const host = isDesktop ? HOST_KEYS.desktop : HOST_KEYS.browser
  const Host = HOSTS[host]
  return <Host services={services} media={media} upNext={queued} mediaPlane={mediaPlane} />
}

type BrowserWatchProps = {
  services: PlayerServices
  media: MediaItem
  mediaPlane: MediaPlane
}

type HostProps = BrowserWatchProps & { upNext: readonly MediaItem[] }

/** The browser's own video, hosted for as long as it plays. */
const BrowserWatch = ({ services, media, mediaPlane }: BrowserWatchProps) => {
  const isHosting = useHostPlayer(services)
  return (
    isHosting && (
      <Player
        engine={{
          kind: ENGINE_KINDS.html,
          source: { kind: PLAYER_SOURCE_KINDS.server, media, api, mediaPlane },
        }}
      />
    )
  )
}

const HOST_KEYS = { desktop: 'desktop', browser: 'browser' } as const

type HostKey = (typeof HOST_KEYS)[keyof typeof HOST_KEYS]

/** Raven plays through its own player; the browser hosts its video element. */
const HOSTS = {
  [HOST_KEYS.desktop]: DesktopWatch,
  [HOST_KEYS.browser]: BrowserWatch,
} as const satisfies Record<HostKey, ComponentType<HostProps>>
