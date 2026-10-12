import { primaryVersion } from '@raven/core'
import { useSearchParams } from 'react-router-dom'
import { PlayableItemView } from '@/components/PlayableItemView/PlayableItemView'
import { RouteState } from '@/components/RouteState/RouteState'
import { useRouteItem } from '@/lib/routeQuery'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'

/**
 * `/movies/:id`: a movie's backdrop, poster, facts, scores, summary, files
 * and people. `?file=` names the version Play starts, as a card the movie
 * was split onto does; one that is not the movie's falls back to the usual.
 */
export const MoviePage = () => {
  const page = useRouteItem('movie')
  const [params] = useSearchParams()
  if (page.state !== 'ready') return <RouteState state={page} noun="movie" />
  const file = Number(params.get('file'))
  const primary =
    page.data.versions.find((version) => version.id === file) ?? primaryVersion(page.data.versions)
  if (!primary) return <NotFoundPage />
  return <PlayableItemView kind="movie" details={page.data} primary={primary} />
}
