import {
  KINDS,
  LIBRARY_VIEWS,
  type Library,
  MUSIC_PAGE,
  MUSIC_SORTS,
  QUEUE_SOURCE_KINDS,
  libraryIconOf,
  plural,
} from '@raven/core'
import { useAudioQueue, useSearch } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import type { ReactNode } from 'react'

import { Grid, SearchField, ToolButton } from '@/layouts'
import { MUSIC_COPY } from '@/layouts/copy'
import { ALBUMS_GRID_COPY } from '@/music/copy'
import { albumSectionsOf } from '@/music/musicCards'
import type { ShelfCard } from '@/queries/cards'
import type { AppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { hrefOf } from '@/routes'

type AlbumsGridProps = {
  session: AppQueries
  library: Library
  asked: string
  /** The ways to the library's other pages, in the toolbar. */
  toggle: ReactNode
}

/**
 * A music library: its albums as covers, by artist, of those the search finds, with Shuffle,
 * which plays the tracks those albums hold, as many as one page of them, in a random order.
 */
export const AlbumsGrid = ({
  session: { server, api, queries },
  library,
  asked,
  toggle,
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
    if (albums.data === undefined) return ALBUMS_GRID_COPY.gathering
    if (albums.data.length > 0) return null
    return search.query === '' ? ALBUMS_GRID_COPY.none : ALBUMS_GRID_COPY.noMatch(search.query)
  })()
  const open = ({ target }: ShelfCard) => router.push(hrefOf(target))
  const playTracks = useAudioQueue((store) => store.playTracks)
  // A read that fails leaves the queue as it was.
  const shuffle = () =>
    api
      .listTracks({
        libraryId: library.id,
        search: search.query,
        sort: MUSIC_SORTS.artist,
        limit: MUSIC_PAGE.most,
      })
      .then(
        ({ tracks }) =>
          tracks.length > 0 &&
          playTracks({
            tracks,
            source: { kind: QUEUE_SOURCE_KINDS.library, id: library.id },
            isShuffled: true,
          }),
      )
      .catch(() => undefined)
  return (
    <Grid
      icon={libraryIconOf(library.settings)}
      jump={null}
      line={ALBUMS_GRID_COPY.line({
        kind: KINDS[library.settings.kind].label,
        count: plural({ n: albums.data?.length ?? 0, ...MUSIC_COPY.albums }),
      })}
      notice={notice}
      onBack={() => router.back()}
      onOpen={open}
      search={<SearchField label={ALBUMS_GRID_COPY.search(library.name)} search={search} />}
      sections={sections}
      title={library.name}
      toolbar={
        <>
          {toggle}
          <ToolButton
            accessibilityLabel={ALBUMS_GRID_COPY.shuffle(library.name)}
            label={MUSIC_COPY.shuffle}
            onPress={() => void shuffle()}
          />
        </>
      }
      view={LIBRARY_VIEWS.grid}
    />
  )
}
