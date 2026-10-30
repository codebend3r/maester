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
import { MOVIE_COPY } from '@/pages/MoviePage/copy'
import { NotFoundPage } from '@/pages/NotFoundPage/NotFoundPage'

const MOVIE_VIEW_KEYS = { pending: 'pending', missing: 'missing', ready: 'ready' } as const

type ShownMovieProps = {
  details: ItemDetails
  shown: NonNullable<ReturnType<typeof libraryFiles>>
}

const ShownMovie = ({ details, shown }: ShownMovieProps) => (
  <PlayableItemView
    kind={ITEM_TYPES.movie}
    details={details}
    versions={shown.versions}
    everyCard={shown.everyCard}
    primary={shown.primary}
  />
)

type MovieViewProps = {
  [MOVIE_VIEW_KEYS.pending]: Parameters<typeof RouteState>[0]
  [MOVIE_VIEW_KEYS.missing]: Record<never, never>
  [MOVIE_VIEW_KEYS.ready]: ShownMovieProps
}

const MOVIE_VIEWS = {
  [MOVIE_VIEW_KEYS.pending]: RouteState,
  [MOVIE_VIEW_KEYS.missing]: NotFoundPage,
  [MOVIE_VIEW_KEYS.ready]: ShownMovie,
} as const satisfies ViewsOf<MovieViewProps>

type MovieViewOfProps = {
  page: RouteQuery<ItemDetails>
  library: number | null
  file: number | null
}

/** Which view the page shows: the movie on its way or failing, not in the library asked for, or shown. */
const movieViewOf = ({ page, library, file }: MovieViewOfProps): ViewOf<MovieViewProps> => {
  if (page.state !== ROUTE_STATES.ready)
    return {
      key: MOVIE_VIEW_KEYS.pending,
      props: {
        state: page,
        noun: MOVIE_COPY.noun,
        shape: <ItemHeaderSkeleton picture="poster" />,
      },
    }
  const shown = libraryFiles({ versions: page.data.versions, library, file })
  if (!shown) return { key: MOVIE_VIEW_KEYS.missing, props: {} }
  return { key: MOVIE_VIEW_KEYS.ready, props: { details: page.data, shown } }
}

/**
 * `/movies/:id`: a movie's backdrop, poster, facts, scores, summary, files
 * and people, as one library shows it. `?library=` names the library, whose
 * files alone the page shows, as a card's link does; without it the page
 * keeps to the library of the file Play would start. `?file=` names the
 * version Play starts, as a card the movie was split onto does; one that is
 * not among the library's files falls back to the usual.
 */
export const MoviePage = () => {
  const page = useRouteItem(ITEM_TYPES.movie)
  const [params] = useSearchParams()
  return (
    <KeyedView<MovieViewProps>
      views={MOVIE_VIEWS}
      view={movieViewOf({
        page,
        library: queryId(params.get('library')),
        file: queryId(params.get('file')),
      })}
    />
  )
}
