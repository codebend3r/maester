import type { ComponentType } from 'react'
import { PlaylistsSection } from '@/components/PlaylistsSection/PlaylistsSection'
import { LIBRARY_SECTIONS, type LibrarySection } from '@/pages/LibraryPage/librarySections'
import {
  AlbumsSection,
  ArtistsSection,
  UnmatchedAlbumsSection,
} from '@/pages/LibraryPage/MusicSections'
import { AllSection } from '@/pages/LibraryPage/sections/AllSection'
import { DolbyVisionOnlySection } from '@/pages/LibraryPage/sections/DolbyVisionOnlySection'
import { DuplicatesSection } from '@/pages/LibraryPage/sections/DuplicatesSection'
import { FavouritesSection } from '@/pages/LibraryPage/sections/FavouritesSection'
import { FinishedSection } from '@/pages/LibraryPage/sections/FinishedSection'
import { InProgressSection } from '@/pages/LibraryPage/sections/InProgressSection'
import { NotMatchedSection } from '@/pages/LibraryPage/sections/NotMatchedSection'
import { SagasSection } from '@/pages/LibraryPage/sections/SagasSection'
import type { SectionProps } from '@/pages/LibraryPage/sections/sectionParts'

/** Each tab's content. */
const SECTION_VIEWS = {
  [LIBRARY_SECTIONS.all]: AllSection,
  [LIBRARY_SECTIONS.albums]: AlbumsSection,
  [LIBRARY_SECTIONS.artists]: ArtistsSection,
  [LIBRARY_SECTIONS.playlists]: PlaylistsSection,
  [LIBRARY_SECTIONS.unmatchedAlbums]: UnmatchedAlbumsSection,
  [LIBRARY_SECTIONS.inProgress]: InProgressSection,
  [LIBRARY_SECTIONS.favourites]: FavouritesSection,
  [LIBRARY_SECTIONS.sagas]: SagasSection,
  [LIBRARY_SECTIONS.notMatched]: NotMatchedSection,
  [LIBRARY_SECTIONS.duplicates]: DuplicatesSection,
  [LIBRARY_SECTIONS.dolbyVisionOnly]: DolbyVisionOnlySection,
  [LIBRARY_SECTIONS.finished]: FinishedSection,
} as const satisfies Record<LibrarySection, ComponentType<SectionProps>>

type SectionViewProps = SectionProps & { section: LibrarySection }

/** The open tab's content. */
export const SectionView = ({ library, section }: SectionViewProps) => {
  const View = SECTION_VIEWS[section]
  return <View library={library} />
}
