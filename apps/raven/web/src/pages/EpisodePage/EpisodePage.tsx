import { ITEM_TYPES, libraryFiles, queryId } from '@raven/core'
import { useSearchParams } from 'react-router-dom'
import { ItemHeaderSkeleton, PICTURE_SHAPES } from '@/components/ItemHeader/ItemHeader'
import { PlayableItemView } from '@/components/PlayableItemView/PlayableItemView'
import { RouteView } from '@/components/RouteState/RouteState'
import { pickRoute, useRouteItem } from '@/lib/routeQuery'
import { EPISODE_COPY } from '@/pages/EpisodePage/copy'
import { PAGE_PARAMS } from '@/lib/appPaths'

/**
 * `/episodes/:id`: an episode's still, show and number, air date, summary,
 * file and people, as one library shows it: `?library=` names the library,
 * whose files alone the page shows, else the page keeps to the library of
 * the file Play would start. An episode with no file in that library is not
 * there.
 */
export const EpisodePage = () => {
  const [params] = useSearchParams()
  const library = queryId(params.get(PAGE_PARAMS.library))
  const page = pickRoute({
    page: useRouteItem(ITEM_TYPES.episode),
    pick: (details) => {
      const shown = libraryFiles({ versions: details.versions, library, file: null })
      return shown && { details, shown }
    },
  })
  return (
    <RouteView
      page={page}
      noun={EPISODE_COPY.noun}
      shape={<ItemHeaderSkeleton picture={PICTURE_SHAPES.still} />}
    >
      {({ details, shown }) => (
        <PlayableItemView
          kind={ITEM_TYPES.episode}
          details={details}
          versions={shown.versions}
          everyCard={shown.everyCard}
          primary={shown.primary}
        />
      )}
    </RouteView>
  )
}
