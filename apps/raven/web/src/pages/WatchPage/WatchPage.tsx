import { type MediaItem, mediaLabel, playLinkFor } from '@raven/core'
import { useState } from 'react'
import {
  PlayerServicesProvider,
  ButtonLink,
  Player,
  useLeaveFullscreen,
  usePlayerPrefs,
} from '@raven/ui'
import { api } from '@/lib/api'
import { afterWatching } from '@/lib/invalidate'
import { watchLink } from '@/lib/itemLinks'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { readWatchState } from '@/lib/itemLinks'
import { mediaQuery } from '@/lib/queries'
import { ravenPlayer } from '@/lib/ravenPlayer'
import { routeState, useRouteId } from '@/lib/routeQuery'
import { useMediaMutations } from '@/lib/useMediaMutations'
import styles from '@/pages/WatchPage/WatchPage.module.scss'

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

  if (page.state === 'ready') {
    return (
      <WatchPlayer
        key={page.data.id}
        media={page.data}
        upNext={handed?.upNext ?? []}
        backTo={`/libraries/${page.data.libraryId}`}
      />
    )
  }
  return (
    <main className={styles.page}>
      {page.state === 'loading' ? (
        <p aria-live="polite">Loading</p>
      ) : (
        <>
          <p role="alert">
            {page.state === 'missing' ? 'This video is no longer in any library.' : page.message}
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
  backTo,
}: {
  media: MediaItem
  upNext: readonly MediaItem[]
  backTo: string
}) => {
  const queryClient = useQueryClient()
  const { favourite } = useMediaMutations({ media })
  const [copied, setCopied] = useState<string | null>(null)
  const opensInRavenPlayer = usePlayerPrefs((prefs) => prefs.opensInRavenPlayer)
  const [next, ...after] = upNext
  const resumable = media.position > 0 && media.position < (media.duration ?? Infinity) - 10
  const copyLink = () => {
    const link = new URL(api.fileUrl(media.id), window.location.origin).href
    navigator.clipboard.writeText(link).then(
      () => setCopied('Link copied. Paste it into VLC or IINA to play it there.'),
      () => setCopied(`Copy this link: ${link}`),
    )
  }
  return (
    <PlayerServicesProvider
      services={{
        title: {
          label: mediaLabel(media),
          duration: media.duration,
          resumeAt: resumable ? media.position : 0,
          backTo,
          next: next
            ? { ...watchLink({ media: next, upNext: after }), label: mediaLabel(next) }
            : null,
        },
        progress: {
          started: () => {
            api.recordPlay(media.id).catch(() => undefined)
          },
          save: (position) => {
            api.saveProgress({ id: media.id, position }).catch(() => undefined)
          },
          left: () => {
            afterWatching({ queryClient, libraryId: media.libraryId }).catch(() => undefined)
          },
        },
        posterUrl: api.thumbnailUrl(media),
        escape: { label: 'Copy file link', run: copyLink },
        escapeFeedback: copied,
        favourite: {
          isFavourite: media.favourite,
          toggle: () => favourite.mutate(!media.favourite),
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
      }}
    >
      <Player engine={{ kind: 'html', source: { kind: 'server', media, api } }} />
    </PlayerServicesProvider>
  )
}
