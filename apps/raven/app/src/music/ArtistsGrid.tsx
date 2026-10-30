import { KINDS, LIBRARY_VIEWS, type Library, libraryIconOf, plural } from '@raven/core'
import { useSearch } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import type { ReactNode } from 'react'

import { Grid, SearchField } from '@/layouts'
import { artistListSectionsOf } from '@/music/musicCards'
import type { ShelfCard } from '@/queries/cards'
import type { AppQueries } from '@/queries/useAppQueries'
import { hrefOf } from '@/routes'

const COPY = {
  search: 'Search artists in',
  gathering: 'Gathering the artists',
  none: 'No artists here yet. A scan credits each artist its tags name.',
  noMatch: (query: string) => `No artist matches "${query}".`,
} as const

type ArtistsGridProps = {
  session: AppQueries
  library: Library
  /** The ways to the library's other pages, in the toolbar. */
  toggle: ReactNode
}

/** A music library's artists by name, as rows, each with how much of the library is theirs. */
export const ArtistsGrid = ({ session: { queries }, library, toggle }: ArtistsGridProps) => {
  const router = useRouter()
  const search = useSearch({ initial: '' })
  const artists = useQuery(queries.artistsQuery({ libraryId: library.id, search: search.query }))
  const notice = ((): string | null => {
    if (artists.error !== null && artists.data === undefined) return artists.error.message
    if (artists.data === undefined) return COPY.gathering
    if (artists.data.length > 0) return null
    return search.query === '' ? COPY.none : COPY.noMatch(search.query)
  })()
  return (
    <Grid
      icon={libraryIconOf(library.settings)}
      jump={null}
      line={`${KINDS[library.settings.kind].label}, ${plural({ n: artists.data?.length ?? 0, one: 'artist', many: 'artists' })}`}
      notice={notice}
      onBack={() => router.back()}
      onOpen={({ target }: ShelfCard) => router.push(hrefOf(target))}
      search={<SearchField label={`${COPY.search} ${library.name}`} search={search} />}
      sections={artistListSectionsOf(artists.data ?? [])}
      title={library.name}
      toolbar={toggle}
      view={LIBRARY_VIEWS.list}
    />
  )
}
