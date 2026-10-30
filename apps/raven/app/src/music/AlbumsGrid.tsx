import { KINDS, LIBRARY_VIEWS, type Library, MUSIC_SORTS, libraryIconOf, plural } from '@raven/core'
import { useSearch } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'

import { Grid, SearchField } from '@/layouts'
import { albumSectionsOf } from '@/music/musicCards'
import type { ShelfCard } from '@/queries/cards'
import type { AppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { hrefOf } from '@/routes'

const COPY = {
  search: 'Search',
  gathering: 'Gathering the albums',
  none: 'No albums here yet. A scan files each audio file under its album as it reads its tags.',
  noMatch: (query: string) => `No album matches "${query}".`,
} as const

type AlbumsGridProps = {
  session: AppQueries
  library: Library
  asked: string
}

/** A music library: its albums as covers, by artist, of those the search finds. */
export const AlbumsGrid = ({
  session: { server, api, queries },
  library,
  asked,
}: AlbumsGridProps) => {
  const router = useRouter()
  const search = useSearch({ initial: asked })
  const albums = useQuery(
    queries.albumsQuery({ libraryId: library.id, search: search.query, sort: MUSIC_SORTS.artist }),
  )
  const pictures = usePictures({ server, api })
  const sections =
    albums.data === undefined || pictures === null
      ? []
      : albumSectionsOf({ api, headersFor: pictures.headersFor, albums: albums.data })
  const notice = ((): string | null => {
    if (albums.error !== null && albums.data === undefined) return albums.error.message
    if (albums.data === undefined) return COPY.gathering
    if (albums.data.length > 0) return null
    return search.query === '' ? COPY.none : COPY.noMatch(search.query)
  })()
  const open = ({ target }: ShelfCard) => router.push(hrefOf(target))
  return (
    <Grid
      icon={libraryIconOf(library.settings)}
      jump={null}
      line={`${KINDS[library.settings.kind].label}, ${plural({ n: albums.data?.length ?? 0, one: 'album', many: 'albums' })}`}
      notice={notice}
      onBack={() => router.back()}
      onOpen={open}
      search={<SearchField label={`${COPY.search} ${library.name}`} search={search} />}
      sections={sections}
      title={library.name}
      toolbar={null}
      view={LIBRARY_VIEWS.grid}
    />
  )
}
