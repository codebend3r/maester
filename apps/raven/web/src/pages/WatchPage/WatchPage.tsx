import {
  ACCOUNT_TICKET_SECONDS,
  AUTH_CONFIG_STATES,
  MEDIA_TICKET_SECONDS,
  type MediaItem,
  ROUTE_STATES,
  mediaLabel,
  playLinkFor,
  readWatchState,
  routeState,
  watchLink,
} from '@raven/core'
import { useState } from 'react'
import {
  ButtonLink,
  Player,
  createProgressSaver,
  useLeaveFullscreen,
  useMediaPlane,
} from '@raven/ui'
import { useHostPlayer, usePlayerPrefs } from '@raven/ui/headless'
import { useReprobe } from '@/components/MediaOriginProbe/MediaOriginProbe'
import { api } from '@/lib/api'
import { afterWatching } from '@/lib/invalidate'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { authConfigQuery, mediaQuery } from '@/lib/queries'
import { ravenPlayer } from '@/lib/ravenPlayer'
import { useRouteId } from '@/lib/routeQuery'
import { useMediaMutations } from '@/lib/useMediaMutations'
import { useTicketFollowsSession } from '@/lib/useTicketFollowsSession'
import { ravenVersion } from '@/lib/version'
import styles from '@/pages/WatchPage/WatchPage.module.scss'

/** How long a copied file link plays, as long as the ticket it carries: an account ticket can end sooner, with its token. */
const LINK_LIFE = {
  account: `up to ${ACCOUNT_TICKET_SECONDS / 60} minutes`,
  legacy: `${MEDIA_TICKET_SECONDS / 3600} hours`,
} as const

/**
 * The card that was clicked hands its item over in router state, so the
 * video element gets its src on the very first render and playback starts
 * without a round trip. A direct link or a refresh fetches it instead.
 * Play all hands over the videos to play after it too.
 */
export const WatchPage = () => {
  const id = useRouteId()
  const { state } = useLocation()
  const handed = readWatchState({ state, id })
  const page = routeState({
    id,
    query: useQuery({ ...mediaQuery(id), initialData: handed?.media }),
  })
  useLeaveFullscreen()

  if (page.state === ROUTE_STATES.ready) {
    return (
      <WatchPlayer
        key={page.data.id}
        media={page.data}
        upNext={handed?.upNext ?? []}
        isShuffled={handed?.isShuffled ?? false}
        backTo={`/libraries/${page.data.libraryId}`}
      />
    )
  }
  return (
    <main className={styles.page}>
      {page.state === ROUTE_STATES.loading ? (
        <p aria-live="polite">Loading</p>
      ) : (
        <>
          <p role="alert">
            {page.state === ROUTE_STATES.missing
              ? 'This video is no longer in any library.'
              : page.message}
          </p>
          <ButtonLink to="/libraries" tone="pill" icon="back" className={styles.back}>
            Back to libraries
          </ButtonLink>
        </>
      )}
    </main>
  )
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
  const resumable = media.position > 0 && media.position < (media.duration ?? Infinity) - 10
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
  const isHosting = useHostPlayer({
    title: {
      label: mediaLabel(media),
      duration: media.duration,
      resumeAt: resumable ? media.position : 0,
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
    ...(opensInRavenPlayer && {
      handoff: {
        label: 'Open in raven player',
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
  })
  return (
    isHosting && (
      <Player engine={{ kind: 'html', source: { kind: 'server', media, api, mediaPlane } }} />
    )
  )
}
