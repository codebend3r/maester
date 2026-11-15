import { ITEM_TYPES, libraryFiles, queryId } from '@raven/core'
import { useSearchParams } from 'react-router-dom'
import { ItemHeaderSkeleton, PICTURE_SHAPES } from '@/components/ItemHeader/ItemHeader'
import { PlayableItemView } from '@/components/PlayableItemView/PlayableItemView'
import { RouteView } from '@/components/RouteState/RouteState'
import { pickRoute, useRouteItem } from '@/lib/routeQuery'
import { MOVIE_COPY } from '@/pages/MoviePage/copy'
import { PAGE_PARAMS } from '@/lib/appPaths'

/**
 * `/movies/:id`: a movie's backdrop, poster, facts, scores, summary, files
 * and people, as one library shows it. `?library=` names the library, whose
 * files alone the page shows, as a card's link does; without it the page
 * keeps to the library of the file Play would start. `?file=` names the
 * version Play starts, as a card the movie was split onto does; one that is
 * not among the library's files falls back to the usual. A movie with no
 * file in that library is not there.
 */
export const MoviePage = () => {
  const [params] = useSearchParams()
  const library = queryId(params.get(PAGE_PARAMS.library))
  const file = queryId(params.get(PAGE_PARAMS.file))
  const page = pickRoute({
    page: useRouteItem(ITEM_TYPES.movie),
    pick: (details) => {
      const shown = libraryFiles({ versions: details.versions, library, file })
      return shown && { details, shown }
    },
  })
  return (
    <RouteView
      page={page}
      noun={MOVIE_COPY.noun}
      shape={<ItemHeaderSkeleton picture={PICTURE_SHAPES.poster} />}
    >
      {({ details, shown }) => (
        <PlayableItemView
          kind={ITEM_TYPES.movie}
          details={details}
          versions={shown.versions}
          everyCard={shown.everyCard}
          primary={shown.primary}
        />
      )}
    </RouteView>
  )
}
