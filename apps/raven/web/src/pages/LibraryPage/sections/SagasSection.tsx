import { sagaEntryKey, sagaTargets } from '@raven/core'
import { isNone } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { MediaGridSkeleton } from '@/components/MediaGrid/MediaGrid'
import { SagaDecks } from '@/components/SagaDeck/SagaDeck'
import { sagasQuery } from '@/lib/queries'
import { LIBRARY_COPY } from '@/pages/LibraryPage/copy'
import { SelectableCards } from '@/pages/LibraryPage/SelectableCards'
import { SectionQuery, type SectionProps } from '@/pages/LibraryPage/sections/sectionParts'
import { CARD_PICTURES } from '@/lib/cardPictures'

/**
 * The library's movies gathered by the TMDB collection they belong to, by
 * name, each saga a deck of its posters that opens its own page.
 */
export const SagasSection = ({ library }: SectionProps) => {
  const query = useQuery(sagasQuery(library.id))
  return (
    <SectionQuery
      query={query}
      shape={<MediaGridSkeleton picture={CARD_PICTURES.poster} />}
      isEmpty={isNone}
      empty={LIBRARY_COPY.sagasEmpty(library.name)}
    >
      {(sagas) => (
        <SelectableCards
          entries={sagas.map((saga) => [
            sagaEntryKey(saga),
            sagaTargets({ saga, libraryId: library.id }),
          ])}
        >
          <SagaDecks libraryId={library.id} sagas={sagas} />
        </SelectableCards>
      )}
    </SectionQuery>
  )
}
