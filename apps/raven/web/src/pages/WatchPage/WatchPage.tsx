import {
  ACCOUNT_TICKET_SECONDS,
  AUTH_CONFIG_STATES,
  MEDIA_TICKET_SECONDS,
  type MediaItem,
  ROUTE_STATES,
  type RouteQuery,
  mediaLabel,
  playLinkFor,
  readWatchState,
  resumeAtFor,
  routeState,
  watchLink,
} from '@raven/core'
import { useState } from 'react'
import {
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
} from '@raven/ui/headless'
import { useReprobe } from '@/components/MediaOriginProbe/MediaOriginProbe'
import { DesktopWatch } from '@/desktop/DesktopWatch/DesktopWatch'
import { PlayerMessage } from '@/desktop/player/PlayerMessage'
import { api } from '@/lib/api'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { authConfigQuery, mediaQuery } from '@/lib/queries'
import { ravenPlayer } from '@/lib/ravenPlayer'
import { useRouteId } from '@/lib/routeQuery'
import { useMediaMutations } from '@/lib/useMediaMutations'
import { useTicketFollowsSession } from '@/lib/useTicketFollowsSession'
import { ravenVersion } from '@/lib/version'
import { useIsDesktop } from '@/stores/desktop'
import styles from '@/pages/WatchPage/WatchPage.module.scss'

/** How long a copied file link plays, as long as the ticket it carries: an account ticket can end sooner, with its token. */
const LINK_LIFE = {
  account: `up to ${ACCOUNT_TICKET_SECONDS / 60} minutes`,
  legacy: `${MEDIA_TICKET_SECONDS / 3600} hours`,
} as const

/** Where a video that cannot play goes back to. */
const LIBRARIES_PATH = '/libraries'

/** The player's place while there is no video: waiting for one (a null message), or saying why. */
const WatchMessage = ({ message }: { message: string | null }) => (
  <main className={styles.page}>
    {message === null ? (
      <p aria-live="polite">Loading</p>
    ) : (
      <>
        <p role="alert">{message}</p>
        <ButtonLink to={LIBRARIES_PATH} tone="pill" icon="back" className={styles.back}>
          Back to libraries
        </ButtonLink>
      </>
    )}
  </main>
)

/** What the player's place says while the video is not there: nothing yet, or why not. */
const messageOf = (
  page: Exclude<RouteQuery<MediaItem>, { state: typeof ROUTE_STATES.ready }>,
): string | null => {
  switch (page.state) {
    case ROUTE_STATES.loading:
      return null
    case ROUTE_STATES.missing:
      return 'This video is no longer in any library.'
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
 * Play all hands over the videos to play after it too.
 */
export const WatchPage = () => {
  const id = useRouteId()
  const { state, search } = useLocation()
  const isDesktop = useIsDesktop()
  const handed = readWatchState({ state, id })
  const page = routeState({
    id,
    query: useQuery({ ...mediaQuery(id), initialData: handed?.media }),
  })
  useLeaveFullscreen()

  if (page.state === ROUTE_STATES.ready) {
    return (
      <WatchPlayer
        // A play link Raven opens for the title on screen names where to start: a new player.
        key={isDesktop ? `${page.data.id}${search}` : page.data.id}
        media={page.data}
        upNext={handed?.upNext ?? []}
        isShuffled={handed?.isShuffled ?? false}
        backTo={`/libraries/${page.data.libraryId}`}
      />
    )
  }
  // Outside the side menu, Raven's window has no other way back while this waits.
  if (isDesktop) return <PlayerMessage message={messageOf(page)} fallback={LIBRARIES_PATH} />
  return <WatchMessage message={messageOf(page)} />
}

/**
 * The browser host owns server history, favourites, links and clipboard
 * behavior. A favourite marked here patches the cached video WatchPage
 * reads, so `media` brings the heart its new state before the server answers.
 */
export const WatchPlayer = ({
  media,
  upNext,
  isShuffled = false,
  backTo,
}: {
  media: MediaItem
  upNext: readonly MediaItem[]
  /** The videos after this one were dealt by a shuffle. */
  isShuffled?: boolean
  backTo: string
}) => {
  const queryClient = useQueryClient()
  const { favourite } = useMediaMutations({ media })
  const [copied, setCopied] = useState<string | null>(null)
  const [saver] = useState(() =>
    createProgressSaver({ send: (report) => api.saveProgress({ id: media.id, ...report }) }),
  )
  const opensInRavenPlayer = usePlayerPrefs((prefs) => prefs.opensInRavenPlayer)
  const [next, ...after] = upNext
  const mediaPlane = useMediaPlane({ api, mediaId: media.id, reprobe: useReprobe() })
  useTicketFollowsSession({ mediaId: media.id })
  const hasAccounts = (useQuery(authConfigQuery).data?.state ?? null) === AUTH_CONFIG_STATES.ready
  const copyLink = () => {
    const href = api.fileUrl({ id: media.id, access: mediaPlane.access })
    const link = href.startsWith('/') ? new URL(href, window.location.origin).href : href
    const life = hasAccounts ? LINK_LIFE.account : LINK_LIFE.legacy
    const lasts = mediaPlane.access ? `; it works for ${life}` : ''
    navigator.clipboard.writeText(link).then(
      () => setCopied(`Link copied. Paste it into VLC or IINA to play it there${lasts}.`),
      () => setCopied(`Copy this link: ${link}`),
    )
  }
  const isDesktop = useIsDesktop()
  const services: PlayerServices = {
    title: {
      label: mediaLabel(media),
      duration: media.duration,
      resumeAt: resumeAtFor({ at: 0, media }),
      backTo,
      next: next
        ? {
            ...watchLink({ media: next, upNext: after, isShuffled }),
            label: mediaLabel(next),
            isShuffled,
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
    },
    posterUrl: api.thumbnailUrl(media),
    escape: { label: 'Copy file link', run: copyLink },
    escapeFeedback: copied,
    favourite: {
      isFavourite: media.favourite,
      toggle: () => favourite.mutate(!media.favourite),
    },
    report: {
      appVersion: ravenVersion,
      send: (diagnostics) => api.reportPlaybackError(diagnostics),
    },
    // Inside Raven the title already plays there.
    ...(opensInRavenPlayer &&
      !isDesktop && {
        handoff: {
          label: 'Open in Raven',
          run: (at) =>
            ravenPlayer.open(
              playLinkFor({
                origin: window.location.origin,
                mediaId: media.id,
                at,
                next: upNext.map(({ id }) => id),
              }),
            ),
        },
      }),
  }
  return isDesktop ? (
    <DesktopWatch services={services} media={media} upNext={upNext} />
  ) : (
    <BrowserWatch services={services} media={media} mediaPlane={mediaPlane} />
  )
}

/** The browser's own video, hosted for as long as it plays. */
const BrowserWatch = ({
  services,
  media,
  mediaPlane,
}: {
  services: PlayerServices
  media: MediaItem
  mediaPlane: MediaPlane
}) => {
  const isHosting = useHostPlayer(services)
  return (
    isHosting && (
      <Player engine={{ kind: 'html', source: { kind: 'server', media, api, mediaPlane } }} />
    )
  )
}
