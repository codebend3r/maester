import {
  ITEM_TYPES,
  type ItemDetails,
  ROUTE_STATES,
  type RouteQuery,
  libraryFiles,
  queryId,
} from '@raven/core'
import { useSearchParams } from 'react-router-dom'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { ItemHeaderSkeleton } from '@/components/ItemHeader/ItemHeader'
import { PlayableItemView } from '@/components/PlayableItemView/PlayableItemView'
import { RouteState } from '@/components/RouteState/RouteState'
import { useRouteItem } from '@/lib/routeQuery'
import { EPISODE_COPY } from '@/pages/EpisodePage/copy'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'

const EPISODE_VIEW_KEYS = { pending: 'pending', missing: 'missing', ready: 'ready' } as const

type ShownEpisodeProps = {
  details: ItemDetails
  shown: NonNullable<ReturnType<typeof libraryFiles>>
}

const ShownEpisode = ({ details, shown }: ShownEpisodeProps) => (
  <PlayableItemView
    kind={ITEM_TYPES.episode}
    details={details}
    versions={shown.versions}
    everyCard={shown.everyCard}
    primary={shown.primary}
  />
)

type EpisodeViewProps = {
  [EPISODE_VIEW_KEYS.pending]: Parameters<typeof RouteState>[0]
  [EPISODE_VIEW_KEYS.missing]: Record<never, never>
  [EPISODE_VIEW_KEYS.ready]: ShownEpisodeProps
}

const EPISODE_VIEWS = {
  [EPISODE_VIEW_KEYS.pending]: RouteState,
  [EPISODE_VIEW_KEYS.missing]: NotFoundPage,
  [EPISODE_VIEW_KEYS.ready]: ShownEpisode,
} as const satisfies ViewsOf<EpisodeViewProps>

type EpisodeViewOfProps = { page: RouteQuery<ItemDetails>; library: number | null }

/** Which view the page shows: the episode on its way or failing, not in the library asked for, or shown. */
const episodeViewOf = ({ page, library }: EpisodeViewOfProps): ViewOf<EpisodeViewProps> => {
  if (page.state !== ROUTE_STATES.ready)
    return {
      key: EPISODE_VIEW_KEYS.pending,
      props: {
        state: page,
        noun: EPISODE_COPY.noun,
        shape: <ItemHeaderSkeleton picture="still" />,
      },
    }
  const shown = libraryFiles({ versions: page.data.versions, library, file: null })
  if (!shown) return { key: EPISODE_VIEW_KEYS.missing, props: {} }
  return { key: EPISODE_VIEW_KEYS.ready, props: { details: page.data, shown } }
}

/**
 * `/episodes/:id`: an episode's still, show and number, air date, summary,
 * file and people, as one library shows it: `?library=` names the library,
 * whose files alone the page shows, else the page keeps to the library of
 * the file Play would start.
 */
export const EpisodePage = () => {
  const page = useRouteItem(ITEM_TYPES.episode)
  const [params] = useSearchParams()
  return (
    <KeyedView<EpisodeViewProps>
      views={EPISODE_VIEWS}
      view={episodeViewOf({ page, library: queryId(params.get('library')) })}
    />
  )
}
