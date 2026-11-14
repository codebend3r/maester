import type { ItemSummary, PosterEntry } from '@raven/core'
import type { QueryRead } from '@raven/ui/headless'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import { MediaGridSkeleton } from '@/components/MediaGrid/MediaGrid'
import { TitleCard } from '@/components/TitleCard/TitleCard'
import { libraryFavouriteTitlesQuery, libraryFavouritesQuery } from '@/lib/queries'
import { LIBRARY_COPY } from '@/pages/LibraryPage/copy'
import {
  EntryGrid,
  SectionQuery,
  type SectionProps,
  libraryCardPicture,
} from '@/pages/LibraryPage/sections/sectionParts'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

type Favourites = { titles: ItemSummary[]; entries: PosterEntry[] }

type FavouritesContentProps = Favourites & SectionProps

/** The favourite shows and seasons as title cards, then the favourite videos as the library lays them out. */
const FavouritesContent = ({ library, titles, entries }: FavouritesContentProps) => (
  <>
    {titles.length > 0 && (
      <ul className={styles.titles}>
        {titles.map((item) => (
          <TitleCard key={item.id} item={item} />
        ))}
      </ul>
    )}
    {entries.length > 0 && <EntryGrid library={library} entries={entries} />}
  </>
)

type FavouritesQueries = {
  titles: UseQueryResult<ItemSummary[]>
  videos: UseQueryResult<PosterEntry[]>
}

/** Both favourites queries as one: either's failure, pending while either loads, else both lists. */
const favouritesOf = ({ titles, videos }: FavouritesQueries): QueryRead<Favourites> => {
  if (titles.isError) return titles
  if (videos.isError) return videos
  if (titles.isPending || videos.isPending) return { isError: false, isPending: true }
  return { isError: false, isPending: false, data: { titles: titles.data, entries: videos.data } }
}

/** Whether neither list holds a favourite. */
const hasNoFavourites = ({ titles, entries }: Favourites): boolean =>
  titles.length === 0 && entries.length === 0

/** The library's favourites, shows and seasons first, then videos, each most recently marked first. */
export const FavouritesSection = ({ library }: SectionProps) => {
  const titles = useQuery(libraryFavouriteTitlesQuery(library.id))
  const videos = useQuery(libraryFavouritesQuery(library.id))
  return (
    <SectionQuery
      query={favouritesOf({ titles, videos })}
      shape={<MediaGridSkeleton picture={libraryCardPicture(library)} />}
      isEmpty={hasNoFavourites}
      empty={LIBRARY_COPY.favouritesEmpty(library.name)}
    >
      {(favourites) => <FavouritesContent library={library} {...favourites} />}
    </SectionQuery>
  )
}
