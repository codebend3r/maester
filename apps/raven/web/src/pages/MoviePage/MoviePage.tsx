import { ROUTE_STATES, libraryFiles, queryId } from '@raven/core'
import { useSearchParams } from 'react-router-dom'
import { ItemHeaderSkeleton } from '@/components/ItemHeader/ItemHeader'
import { PlayableItemView } from '@/components/PlayableItemView/PlayableItemView'
import { RouteState } from '@/components/RouteState/RouteState'
import { useRouteItem } from '@/lib/routeQuery'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'

/**
 * `/movies/:id`: a movie's backdrop, poster, facts, scores, summary, files
 * and people, as one library shows it. `?library=` names the library, whose
 * files alone the page shows, as a card's link does; without it the page
 * keeps to the library of the file Play would start. `?file=` names the
 * version Play starts, as a card the movie was split onto does; one that is
 * not among the library's files falls back to the usual.
 */
export const MoviePage = () => {
  const page = useRouteItem('movie')
  const [params] = useSearchParams()
  if (page.state !== ROUTE_STATES.ready)
    return <RouteState state={page} noun="movie" shape={<ItemHeaderSkeleton picture="poster" />} />
  const shown = libraryFiles({
    versions: page.data.versions,
    library: queryId(params.get('library')),
    file: queryId(params.get('file')),
  })
  if (!shown) return <NotFoundPage />
  return (
    <PlayableItemView
      kind="movie"
      details={page.data}
      versions={shown.versions}
      everyCard={shown.everyCard}
      primary={shown.primary}
    />
  )
}
