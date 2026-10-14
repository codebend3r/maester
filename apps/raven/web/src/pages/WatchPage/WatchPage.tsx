import { useQuery } from '@tanstack/react-query'
import { isMediaItem, isMediaList, isRecord } from '@raven/core'
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { ButtonLink } from '@/components/Button/Button'
import { Player } from '@/components/Player/Player'
import { mediaQuery } from '@/lib/queries'
import { routeState, useRouteId } from '@/lib/routeQuery'
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
  const handed =
    isRecord(state) && isMediaItem(state.media) && state.media.id === id ? state.media : undefined
  const upNext = isRecord(state) && isMediaList(state.upNext) ? state.upNext : []
  const page = routeState({ id, query: useQuery({ ...mediaQuery(id), initialData: handed }) })
  // The player fills the screen with the whole page, which stays full screen
  // from one video to the next, so leaving the player leaves full screen.
  useEffect(
    () => () => {
      if (document.fullscreenElement) void document.exitFullscreen()
    },
    [],
  )

  if (page.state === 'ready') {
    return (
      <Player
        key={page.data.id}
        media={page.data}
        upNext={upNext}
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
          <ButtonLink to="/libraries" icon="back">
            Back to libraries
          </ButtonLink>
        </>
      )}
    </main>
  )
}
