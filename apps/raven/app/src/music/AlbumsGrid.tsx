import {
  KINDS,
  LIBRARY_VIEWS,
  type Library,
  MUSIC_DEFAULT_ORDERS,
  MUSIC_ORDER_LABELS,
  MUSIC_PAGE,
  MUSIC_SORT_LABELS,
  MUSIC_SORTS,
  type MusicSort,
  QUEUE_SOURCE_KINDS,
  type SortDirection,
  albumJumpScale,
  libraryIconOf,
  plural,
  reversedDirection,
} from '@raven/core'
import { useAudioQueue, useSearch } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { Grid, Picker, SearchField, ToolButton } from '@/layouts'
import { MUSIC_COPY } from '@/layouts/copy'
import { ALBUMS_GRID_COPY } from '@/music/copy'
import { albumSectionsOf } from '@/music/musicCards'
import type { MusicFrame } from '@/music/MusicPages'
import type { ShelfCard } from '@/queries/cards'
import type { AppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { hrefOf } from '@/routes'
import { PageTools } from '@/screens/PageTools'
import { libraryChoiceOf, useLibraryViews } from '@/stores/libraryViews'
import { APP_ICONS } from '@/theme/icons'

type AlbumsGridProps = {
  session: AppQueries
  library: Library
  asked: string
  /** The library's pages, whose toggles and Lock are the toolbar. */
  frame: MusicFrame
}

/** How many seeds a shuffle picks among: the server reads at most a million. */
const SHUFFLE_SEEDS = 1_000_000

/** The order the albums are listed in: the web's, Release Date newest first, until changed. */
type AlbumOrder = { sort: MusicSort; order: SortDirection; seed: number }

const STARTING_SORT = MUSIC_SORTS.release

const randomSeed = (): number => Math.floor(Math.random() * SHUFFLE_SEEDS)

/** A sort as the web's picker starts it: its own direction, and a fresh seed for Randomly. */
const orderFor = (sort: MusicSort): AlbumOrder => ({
  sort,
  order: MUSIC_DEFAULT_ORDERS[sort],
  seed: sort === MUSIC_SORTS.random ? randomSeed() : 0,
})

type UseAlbumOrderProps = { serverId: string; libraryId: number }

/** The order the albums are listed in on this device, and the way to choose again. */
type AlbumOrderChoice = { listed: AlbumOrder; change: (listed: AlbumOrder) => void }

/**
 * How the albums are ordered on this device: the sort and its direction kept per library with
 * the video grids' choices (`useLibraryViews`), and Randomly's deal, which holds while the page
 * is open.
 */
const useAlbumOrder = ({ serverId, libraryId }: UseAlbumOrderProps): AlbumOrderChoice => {
  const choice = useLibraryViews((state) =>
    libraryChoiceOf({ choices: state.choices, serverId, libraryId }),
  )
  const choose = useLibraryViews((state) => state.choose)
  const [seed, setSeed] = useState(0)
  const sort = choice.musicSort ?? STARTING_SORT
  return {
    listed: { sort, order: choice.musicOrder ?? MUSIC_DEFAULT_ORDERS[sort], seed },
    change: (listed) => {
      choose({ serverId, libraryId, change: { musicSort: listed.sort, musicOrder: listed.order } })
      setSeed(listed.seed)
    },
  }
}

type AlbumsSortProps = { listed: AlbumOrder; onChange: (listed: AlbumOrder) => void }

/** The web's sort and its direction, the direction hidden for Randomly, which has none. */
const AlbumsSort = ({ listed, onChange }: AlbumsSortProps) => (
  <>
    <Picker
      icon={APP_ICONS.ascending}
      label={ALBUMS_GRID_COPY.sort}
      onChoose={(sort) => onChange(orderFor(sort))}
      options={Object.values(MUSIC_SORTS).map((sort) => ({
        key: sort,
        label: MUSIC_SORT_LABELS[sort],
      }))}
      value={listed.sort}
    />
    {listed.sort !== MUSIC_SORTS.random && (
      <ToolButton
        accessibilityLabel={ALBUMS_GRID_COPY.reverse(MUSIC_ORDER_LABELS[listed.order])}
        icon={listed.order}
        label={MUSIC_ORDER_LABELS[listed.order]}
        onPress={() => onChange({ ...listed, order: reversedDirection(listed.order) })}
      />
    )}
  </>
)

/**
 * A music library: its albums as covers, of those the search finds, in the web's order and with
 * its sort, and its jump strip, with Shuffle, which plays the tracks those albums hold, as many
 * as one page of them, in a random order.
 */
export const AlbumsGrid = ({
  session: { server, api, queries },
  library,
  asked,
  frame,
}: AlbumsGridProps) => {
  const router = useRouter()
  const search = useSearch({ initial: asked })
  const { listed, change } = useAlbumOrder({ serverId: server.id, libraryId: library.id })
  // Taken once, as the page opens, so render stays pure.
  const [thisYear] = useState(() => new Date().getFullYear())
  const albums = useQuery(
    queries.albumsQuery({ libraryId: library.id, search: search.query, ...listed }),
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
  /*
   * A fresh seed each press: the server draws the most a page holds at random from the whole
   * library, never the first artists by name, and the queue shuffles them again. A read that
   * fails leaves the queue as it was.
   */
  const shuffle = () =>
    api
      .listTracks({
        libraryId: library.id,
        search: search.query,
        sort: MUSIC_SORTS.random,
        seed: randomSeed(),
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
      jump={
        albums.data === undefined || albums.data.length === 0
          ? null
          : albumJumpScale({
              sort: listed.sort,
              direction: listed.order,
              albums: albums.data,
              thisYear,
            })
      }
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
        <PageTools frame={frame}>
          <ToolButton
            accessibilityLabel={ALBUMS_GRID_COPY.shuffle(library.name)}
            icon={APP_ICONS.shuffle}
            label={MUSIC_COPY.shuffle}
            onPress={() => void shuffle()}
          />
          <AlbumsSort listed={listed} onChange={change} />
        </PageTools>
      }
      view={LIBRARY_VIEWS.grid}
    />
  )
}
