import { LIBRARY_VIEWS, plural } from '@raven/core'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'

import { Grid, Loading } from '@/layouts'
import type { GridProps } from '@/layouts/gridKit'
import type { LoadingProps } from '@/layouts/loadingKit'
import type { ShelfCard } from '@/queries/cards'
import { continueSectionsOf } from '@/queries/libraryGrid'
import { showArtIdsOf } from '@/queries/showArt'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { useShowArts } from '@/queries/useShowArts'
import { hrefOf } from '@/routes'
import { CONTINUE_WATCHING_COPY, LIBRARY_COPY } from '@/screens/copy'

/** What the page draws: the mark while Home's list is read, then the cards. */
const CONTINUE_VIEW_KEYS = { loading: 'loading', grid: 'grid' } as const

type ContinueViewProps = {
  [CONTINUE_VIEW_KEYS.loading]: LoadingProps
  [CONTINUE_VIEW_KEYS.grid]: GridProps
}

const CONTINUE_VIEWS = {
  [CONTINUE_VIEW_KEYS.loading]: Loading,
  [CONTINUE_VIEW_KEYS.grid]: Grid,
} as const satisfies ViewsOf<ContinueViewProps>

type ServerContinueWatchingProps = { session: AppQueries }

const ServerContinueWatching = ({ session }: ServerContinueWatchingProps) => {
  const { server, api, queries } = session
  const router = useRouter()
  const home = useQuery(queries.homeQuery)
  const pictures = usePictures({ server, api })
  const entries = home.data?.inProgress ?? []
  const arts = useShowArts({ queries, ids: showArtIdsOf(entries), pictures })
  const sections = pictures === null ? [] : continueSectionsOf({ entries, arts, ...pictures })
  const back = () => router.back()
  const notice = ((): string | null => {
    if (home.error !== null) return home.error.message
    return entries.length === 0 ? CONTINUE_WATCHING_COPY.none : null
  })()

  const line =
    entries.length === 0 ? null : plural({ n: entries.length, ...LIBRARY_COPY.inProgress })

  const view: ViewOf<ContinueViewProps> = home.isPending
    ? {
        key: CONTINUE_VIEW_KEYS.loading,
        props: { label: CONTINUE_WATCHING_COPY.gathering, onBack: back },
      }
    : {
        key: CONTINUE_VIEW_KEYS.grid,
        props: {
          icon: null,
          jump: null,
          line,
          notice,
          onBack: back,
          onOpen: ({ target }: ShelfCard) => router.push(hrefOf(target)),
          search: null,
          sections,
          title: CONTINUE_WATCHING_COPY.title,
          toolbar: null,
          view: LIBRARY_VIEWS.grid,
        },
      }
  return <KeyedView<ContinueViewProps> view={view} views={CONTINUE_VIEWS} />
}

/**
 * `/continue-watching`: every video in progress across the libraries the viewer may see, as
 * the web's page lists them, most recently watched first, each the wide resume card Home's
 * shelf draws. A card opens its page. Each server gets a page of its own.
 */
export const ContinueWatching = () => {
  const session = useAppQueries()
  return session !== null && <ServerContinueWatching key={session.server.id} session={session} />
}
