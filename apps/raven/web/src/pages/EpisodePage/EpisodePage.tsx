import { useSearchParams } from 'react-router-dom'
import { ItemHeaderSkeleton } from '@/components/ItemHeader/ItemHeader'
import { PlayableItemView } from '@/components/PlayableItemView/PlayableItemView'
import { RouteState } from '@/components/RouteState/RouteState'
import { libraryFiles, queryId } from '@/lib/itemLinks'
import { useRouteItem } from '@/lib/routeQuery'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'

/**
 * `/episodes/:id`: an episode's still, show and number, air date, summary,
 * file and people, as one library shows it: `?library=` names the library,
 * whose files alone the page shows, else the page keeps to the library of
 * the file Play would start.
 */
export const EpisodePage = () => {
  const page = useRouteItem('episode')
  const [params] = useSearchParams()
  if (page.state !== 'ready')
    return <RouteState state={page} noun="episode" shape={<ItemHeaderSkeleton picture="still" />} />
  const shown = libraryFiles({
    versions: page.data.versions,
    library: queryId(params.get('library')),
    file: null,
  })
  if (!shown) return <NotFoundPage />
  return (
    <PlayableItemView
      kind="episode"
      details={page.data}
      versions={shown.versions}
      everyCard={shown.everyCard}
      primary={shown.primary}
    />
  )
}
