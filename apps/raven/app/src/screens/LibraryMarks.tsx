import {
  type HistoryEntry,
  LIBRARY_VIEWS,
  type Library as LibraryRecord,
  type PosterEntry,
  libraryIconOf,
  plural,
} from '@raven/core'
import { HISTORY_SHOWS } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'

import { Grid } from '@/layouts'
import { favouriteSectionsOf } from '@/queries/favouriteCards'
import { type GridSection, continueSectionsOf } from '@/queries/libraryGrid'
import { showArtIdsOf } from '@/queries/showArt'
import type { AppQueries } from '@/queries/useAppQueries'
import { usePictures } from '@/queries/usePictures'
import { useShowArts } from '@/queries/useShowArts'
import { hrefOf } from '@/routes'
import { LIBRARY_COPY } from '@/screens/copy'
import { type PageFrame, PageTools, pageTabsOf } from '@/screens/PageTools'

/** How many finished videos Finished lists, as the web's tab does. */
const FINISHED_LIMIT = 48

type MarksNoticeOfProps = {
  /** How many cards were read; null until the server answers. */
  count: number | null
  error: Error | null
  gathering: string
  empty: string
}

/** The line in place of the cards: while they are read, when the read fails, or when there are none. */
const marksNoticeOf = ({ count, error, gathering, empty }: MarksNoticeOfProps): string | null => {
  if (count === null) return error === null ? gathering : error.message
  return count === 0 ? empty : null
}

export type MarksGridProps<P extends string> = {
  session: AppQueries
  library: LibraryRecord
  /** The library's pages, whose toggles and Lock are the toolbar; these pages add no button of their own. */
  frame: PageFrame<P>
}

type MarksPageProps<P extends string> = Pick<MarksGridProps<P>, 'library' | 'frame'> & {
  sections: GridSection[]
  line: string | null
  notice: string | null
}

/** A page of a library's marked videos: its cards under the library's name and the way to its other pages. */
const MarksPage = <P extends string>({
  library,
  frame,
  sections,
  line,
  notice,
}: MarksPageProps<P>) => {
  const router = useRouter()
  return (
    <Grid
      icon={libraryIconOf(library.settings)}
      jump={null}
      line={line}
      notice={notice}
      onBack={() => router.back()}
      onOpen={({ target }) => router.push(hrefOf(target))}
      search={null}
      sections={sections}
      tabs={pageTabsOf(frame)}
      title={library.name}
      toolbar={<PageTools frame={frame} />}
      view={LIBRARY_VIEWS.grid}
    />
  )
}

/**
 * A library's Favourites page, the web's tab: its favourite shows and seasons, then its
 * favourite videos, each most recently marked first, drawn as the Favourites screen draws them.
 */
export const FavouritesGrid = <P extends string>({
  session: { server, api, queries },
  library,
  frame,
}: MarksGridProps<P>) => {
  const titles = useQuery(queries.libraryFavouriteTitlesQuery(library.id))
  const videos = useQuery(queries.libraryFavouritesQuery(library.id))
  const pictures = usePictures({ server, api })
  const arts = useShowArts({
    queries,
    ids: [...(titles.data ?? []).map(({ id }) => id), ...showArtIdsOf(videos.data ?? [])],
    pictures,
  })
  const isRead = titles.data !== undefined && videos.data !== undefined
  const count = isRead ? titles.data.length + videos.data.length : null
  const sections =
    pictures === null || !isRead
      ? []
      : favouriteSectionsOf({
          titles: titles.data,
          videos: videos.data,
          albums: [],
          artists: [],
          arts,
          api,
          headersFor: pictures.headersFor,
        })
  return (
    <MarksPage
      frame={frame}
      library={library}
      line={count === null ? null : plural({ n: count, ...LIBRARY_COPY.favourite })}
      notice={marksNoticeOf({
        count,
        error: titles.error ?? videos.error,
        gathering: LIBRARY_COPY.gathering.favourites,
        empty: LIBRARY_COPY.favouritesEmpty(library.name),
      })}
      sections={sections}
    />
  )
}

/** A finished video as the cards read one: an older server sends no poster with it. */
const posterEntryOf = ({ media, poster }: HistoryEntry): PosterEntry => ({
  media,
  poster: poster ?? null,
})

/**
 * A library's Finished page, the web's tab: the videos watched to the end, or marked
 * watched, the latest first, as wide cards like Continue watching's.
 */
export const FinishedGrid = <P extends string>({
  session: { server, api, queries },
  library,
  frame,
}: MarksGridProps<P>) => {
  const finished = useQuery(
    queries.historyQuery({
      libraryId: library.id,
      show: HISTORY_SHOWS.watched,
      limit: FINISHED_LIMIT,
    }),
  )
  const entries = finished.data?.map(posterEntryOf) ?? null
  const pictures = usePictures({ server, api })
  const arts = useShowArts({ queries, ids: showArtIdsOf(entries ?? []), pictures })
  const sections =
    pictures === null || entries === null ? [] : continueSectionsOf({ entries, arts, ...pictures })
  return (
    <MarksPage
      frame={frame}
      library={library}
      line={entries === null ? null : plural({ n: entries.length, ...LIBRARY_COPY.finished })}
      notice={marksNoticeOf({
        count: entries?.length ?? null,
        error: finished.error,
        gathering: LIBRARY_COPY.gathering.finished,
        empty: LIBRARY_COPY.finishedEmpty({
          name: library.name,
          percent: library.settings.watchedPercent,
        }),
      })}
      sections={sections}
    />
  )
}
