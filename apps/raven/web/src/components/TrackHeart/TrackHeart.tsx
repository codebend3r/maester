import type { Track } from '@raven/core'
import { useToasts } from '@raven/ui'
import { useTrackFavourite } from '@raven/ui/headless'
import { FavouriteButton } from '@/components/FavouriteButton/FavouriteButton'
import { api } from '@/lib/api'
import { COMMON_COPY } from '@/lib/copy'
import { ravenQueries } from '@/lib/queries'

const sayFailed = () => useToasts.getState().show(COMMON_COPY.favouriteFailed)

type TrackHeartProps = { track: Track }

/**
 * The heart on a playing track: filled for a favourite on the server in use, and pressing it
 * marks or unmarks one, with a toast when that fails.
 */
export const TrackHeart = ({ track }: TrackHeartProps) => {
  const { isLiked, onToggle } = useTrackFavourite({
    api,
    queries: ravenQueries,
    track,
    onFailure: sayFailed,
  })
  return <FavouriteButton isFavourite={isLiked} onToggle={onToggle} />
}
