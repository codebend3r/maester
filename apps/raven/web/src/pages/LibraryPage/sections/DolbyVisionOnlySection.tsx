import type { DolbyVisionOnlyListing } from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { MediaGridSkeleton } from '@/components/MediaGrid/MediaGrid'
import { ShowGrid } from '@/components/ShowCard/ShowCard'
import { dolbyVisionOnlyQuery } from '@/lib/queries'
import { LIBRARY_COPY } from '@/pages/LibraryPage/copy'
import {
  EntryGrid,
  SectionMessage,
  SectionQuery,
  type SectionProps,
  libraryCardPicture,
} from '@/pages/LibraryPage/sections/sectionParts'

type DolbyVisionOnlyListingViewProps = SectionProps & { listing: DolbyVisionOnlyListing }

/** Why the tab is there, then its shows, each with how many episodes are profile 5, then its other files. */
const DolbyVisionOnlyListingView = ({ library, listing }: DolbyVisionOnlyListingViewProps) => {
  const counts = new Map(listing.shows.map(({ entry, episodes }) => [entry.show.id, episodes]))
  return (
    <>
      <SectionMessage message={LIBRARY_COPY.dolbyVisionOnlyNote} />
      {listing.shows.length > 0 && (
        <ShowGrid
          shows={listing.shows.map(({ entry }) => entry)}
          note={(entry) =>
            LIBRARY_COPY.dolbyVisionOnlyEpisodes({
              count: counts.get(entry.show.id) ?? 0,
              total: entry.episodes,
            })
          }
        />
      )}
      {listing.files.length > 0 && <EntryGrid library={library} entries={listing.files} />}
    </>
  )
}

/** Whether the listing holds no show and no file. */
const isEmptyListing = (listing: DolbyVisionOnlyListing): boolean =>
  listing.shows.length + listing.files.length === 0

/**
 * What in the library is Dolby Vision profile 5, which a browser plays
 * purple and green: its shows, with how many of their episodes are, and its
 * other such files, each wearing the DV5 chip.
 */
export const DolbyVisionOnlySection = ({ library }: SectionProps) => {
  const query = useQuery(dolbyVisionOnlyQuery(library.id))
  return (
    <SectionQuery
      query={query}
      shape={<MediaGridSkeleton picture={libraryCardPicture(library)} />}
      isEmpty={isEmptyListing}
      empty={LIBRARY_COPY.dolbyVisionOnlyEmpty(library.name)}
    >
      {(listing) => <DolbyVisionOnlyListingView library={library} listing={listing} />}
    </SectionQuery>
  )
}
