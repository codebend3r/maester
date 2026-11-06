import { LIBRARY_VIEWS, plural } from '@raven/core'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'

import { Grid, Loading } from '@/layouts'
import type { GridProps } from '@/layouts/gridKit'
import type { LoadingProps } from '@/layouts/loadingKit'
import type { ShelfCard } from '@/queries/cards'
import { librarySectionsOf } from '@/queries/libraryList'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { hrefOf } from '@/routes'
import { LIBRARIES_COPY } from '@/screens/copy'

/** What the page draws: the mark while the libraries are read, then their rows. */
const LIBRARIES_VIEW_KEYS = { loading: 'loading', grid: 'grid' } as const

type LibrariesViewProps = {
  [LIBRARIES_VIEW_KEYS.loading]: LoadingProps
  [LIBRARIES_VIEW_KEYS.grid]: GridProps
}

const LIBRARIES_VIEWS = {
  [LIBRARIES_VIEW_KEYS.loading]: Loading,
  [LIBRARIES_VIEW_KEYS.grid]: Grid,
} as const satisfies ViewsOf<LibrariesViewProps>

type ServerLibrariesProps = { session: AppQueries }

const ServerLibraries = ({ session: { queries } }: ServerLibrariesProps) => {
  const router = useRouter()
  const libraries = useQuery(queries.librariesQuery)
  const listed = libraries.data ?? []
  const back = () => router.back()
  const notice = ((): string | null => {
    if (libraries.error !== null && libraries.data === undefined) return libraries.error.message
    return listed.length === 0 ? LIBRARIES_COPY.none : null
  })()

  const line = listed.length === 0 ? null : plural({ n: listed.length, ...LIBRARIES_COPY.library })

  const view: ViewOf<LibrariesViewProps> = libraries.isPending
    ? {
        key: LIBRARIES_VIEW_KEYS.loading,
        props: { label: LIBRARIES_COPY.gathering, onBack: back },
      }
    : {
        key: LIBRARIES_VIEW_KEYS.grid,
        props: {
          icon: null,
          jump: null,
          line,
          notice,
          onBack: back,
          onOpen: ({ target }: ShelfCard) => router.push(hrefOf(target)),
          search: null,
          sections: librarySectionsOf(listed),
          title: LIBRARIES_COPY.title,
          toolbar: null,
          view: LIBRARY_VIEWS.list,
        },
      }
  return <KeyedView<LibrariesViewProps> view={view} views={LIBRARIES_VIEWS} />
}

/**
 * `/libraries`: every library the account may see, pinned or not, in the server's order, each a
 * row with its icon, its name and its type, opening it as the side menu's pinned row does, a
 * music library on its albums. Each server gets a page of its own.
 */
export const Libraries = () => {
  const session = useAppQueries()
  return session !== null && <ServerLibraries key={session.server.id} session={session} />
}
