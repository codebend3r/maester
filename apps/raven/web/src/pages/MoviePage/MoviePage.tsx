import { primaryVersion } from '@raven/core'
import { PlayableItemView } from '@/components/PlayableItemView/PlayableItemView'
import { RouteState } from '@/components/RouteState/RouteState'
import { useRouteItem } from '@/lib/routeQuery'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'

/** `/movies/:id`: a movie's backdrop, poster, facts, scores, summary, files and people. */
export const MoviePage = () => {
  const page = useRouteItem('movie')
  if (page.state !== 'ready') return <RouteState state={page} noun="movie" />
  const primary = primaryVersion(page.data.versions)
  if (!primary) return <NotFoundPage />
  return <PlayableItemView kind="movie" details={page.data} primary={primary} />
}
