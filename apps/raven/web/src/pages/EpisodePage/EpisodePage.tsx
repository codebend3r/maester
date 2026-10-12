import { primaryVersion } from '@raven/core'
import { ItemHeaderSkeleton } from '@/components/ItemHeader/ItemHeader'
import { PlayableItemView } from '@/components/PlayableItemView/PlayableItemView'
import { RouteState } from '@/components/RouteState/RouteState'
import { useRouteItem } from '@/lib/routeQuery'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'

/** `/episodes/:id`: an episode's still, show and number, air date, summary, file and people. */
export const EpisodePage = () => {
  const page = useRouteItem('episode')
  if (page.state !== 'ready')
    return <RouteState state={page} noun="episode" shape={<ItemHeaderSkeleton picture="still" />} />
  const primary = primaryVersion(page.data.versions)
  if (!primary) return <NotFoundPage />
  return <PlayableItemView kind="episode" details={page.data} primary={primary} />
}
