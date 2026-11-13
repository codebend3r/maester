import { isNone } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { Duplicates } from '@/components/Duplicates/Duplicates'
import { MediaGridSkeleton } from '@/components/MediaGrid/MediaGrid'
import { duplicatesQuery } from '@/lib/queries'
import { LIBRARY_COPY } from '@/pages/LibraryPage/copy'
import { SectionQuery, type SectionProps } from '@/pages/LibraryPage/sections/sectionParts'
import { CARD_PICTURES } from '@/lib/cardPictures'

/**
 * The movies holding more than one file on their card, each to split
 * apart, and the movies already split, each to put back together.
 */
export const DuplicatesSection = ({ library }: SectionProps) => {
  const query = useQuery(duplicatesQuery(library.id))
  return (
    <SectionQuery
      query={query}
      shape={<MediaGridSkeleton picture={CARD_PICTURES.poster} />}
      isEmpty={isNone}
      empty={LIBRARY_COPY.duplicatesEmpty(library.name)}
    >
      {(listing) => <Duplicates library={library} listing={listing} />}
    </SectionQuery>
  )
}
