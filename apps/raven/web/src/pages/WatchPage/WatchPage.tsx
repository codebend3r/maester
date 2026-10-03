import { useQuery } from '@tanstack/react-query'
import { ApiError, isMediaItem, isRecord } from '@raven/core'
import { useLocation, useParams } from 'react-router-dom'
import { ButtonLink } from '@/components/Button/Button'
import { Player } from '@/components/Player/Player'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'
import styles from './WatchPage.module.scss'

/**
 * The card that was clicked hands its item over in router state, so the
 * video element gets its src on the very first render and playback starts
 * without a round trip. A direct link or a refresh fetches it instead.
 */
export const WatchPage = () => {
  const params = useParams()
  const id = Number(params.id)
  const { state } = useLocation()
  const handed =
    isRecord(state) && isMediaItem(state.media) && state.media.id === id ? state.media : undefined

  const media = useQuery({
    queryKey: queryKeys.mediaItem(id),
    queryFn: () => api.getMedia(id),
    enabled: Number.isInteger(id),
    initialData: handed,
  })

  if (media.data) {
    return (
      <Player
        key={media.data.id}
        media={media.data}
        backTo={`/libraries/${media.data.libraryId}`}
      />
    )
  }

  const missing =
    !Number.isInteger(id) || (media.error instanceof ApiError && media.error.status === 404)
  return (
    <main className={styles.page}>
      {media.isError || missing ? (
        <>
          <p role="alert">
            {missing ? 'This video is no longer in any library.' : media.error?.message}
          </p>
          <ButtonLink to="/" icon="back">
            Back to libraries
          </ButtonLink>
        </>
      ) : (
        <p aria-live="polite">Loading</p>
      )}
    </main>
  )
}
