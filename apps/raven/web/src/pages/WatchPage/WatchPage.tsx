import { useQuery } from '@tanstack/react-query'
import { isMediaItem, isRecord } from '@raven/core'
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
 */
export const WatchPage = () => {
  const id = useRouteId()
  const { state } = useLocation()
  const handed =
    isRecord(state) && isMediaItem(state.media) && state.media.id === id ? state.media : undefined
  const page = routeState({ id, query: useQuery({ ...mediaQuery(id), initialData: handed }) })

  if (page.state === 'ready') {
    return (
      <Player key={page.data.id} media={page.data} backTo={`/libraries/${page.data.libraryId}`} />
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
