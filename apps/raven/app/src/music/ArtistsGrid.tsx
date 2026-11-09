import { KINDS, LIBRARY_VIEWS, type Library, libraryIconOf, plural } from '@raven/core'
import { useSearch } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'

import { Grid, SearchField } from '@/layouts'
import { MUSIC_COPY } from '@/layouts/copy'
import { ARTISTS_GRID_COPY } from '@/music/copy'
import type { MusicFrame } from '@/music/MusicPages'
import { artistListSectionsOf } from '@/music/musicCards'
import type { ShelfCard } from '@/queries/cards'
import type { AppQueries } from '@/queries/useAppQueries'
import { hrefOf } from '@/routes'
import { PageTools } from '@/screens/PageTools'

type ArtistsGridProps = {
  session: AppQueries
  library: Library
  /** The library's pages, whose toggles and Lock are the toolbar. */
  frame: MusicFrame
}

/** A music library's artists by name, as rows, each with how much of the library is theirs. */
export const ArtistsGrid = ({ session: { queries }, library, frame }: ArtistsGridProps) => {
  const router = useRouter()
  const search = useSearch({ initial: '' })
  const artists = useQuery(queries.artistsQuery({ libraryId: library.id, search: search.query }))
  const notice = ((): string | null => {
    if (artists.error !== null && artists.data === undefined) return artists.error.message
    if (artists.data === undefined) return ARTISTS_GRID_COPY.gathering
    if (artists.data.length > 0) return null
    return search.query === '' ? ARTISTS_GRID_COPY.none : ARTISTS_GRID_COPY.noMatch(search.query)
  })()
  return (
    <Grid
      icon={libraryIconOf(library.settings)}
      jump={null}
      line={ARTISTS_GRID_COPY.line({
        kind: KINDS[library.settings.kind].label,
        count: plural({ n: artists.data?.length ?? 0, ...MUSIC_COPY.artists }),
      })}
      notice={notice}
      onBack={() => router.back()}
      onOpen={({ target }: ShelfCard) => router.push(hrefOf(target))}
      search={<SearchField label={ARTISTS_GRID_COPY.search(library.name)} search={search} />}
      sections={artistListSectionsOf(artists.data ?? [])}
      title={library.name}
      toolbar={<PageTools frame={frame} />}
      view={LIBRARY_VIEWS.list}
    />
  )
}
