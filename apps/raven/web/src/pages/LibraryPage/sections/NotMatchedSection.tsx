import {
  type AiSuggestion,
  ITEM_TYPES,
  type MediaItem,
  type UnmatchedFile,
  matchTypeFor,
} from '@raven/core'
import { isNone } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import type { ComponentType } from 'react'
import { MediaGrid, MediaGridSkeleton } from '@/components/MediaGrid/MediaGrid'
import { MediaTilesSkeleton } from '@/components/MediaTiles/MediaTiles'
import { SuggestedMovies } from '@/components/SuggestedMovies/SuggestedMovies'
import { UnmatchedShows } from '@/components/UnmatchedShows/UnmatchedShows'
import { cannotManageNote, useManagement } from '@/lib/management'
import { unmatchedQuery } from '@/lib/queries'
import { useCanMatch } from '@/lib/useCanMatch'
import { LIBRARY_COPY } from '@/pages/LibraryPage/copy'
import {
  SectionMessage,
  SectionQuery,
  type SectionProps,
} from '@/pages/LibraryPage/sections/sectionParts'
import { useAiLookupsDone } from '@/pages/LibraryPage/useAiLookupsDone'
import { POLL_MS, anyPending, useMatchingPassDone } from '@/pages/LibraryPage/useMatchingPassDone'

/** What the AI lookup suggests for a file, read off the Not matched listing. */
const suggestionsIn =
  (files: readonly UnmatchedFile[]) =>
  (file: MediaItem): AiSuggestion | null =>
    files.find((each) => each.id === file.id)?.aiSuggestion ?? null

type MatchType = ReturnType<typeof matchTypeFor>

type NotMatchedHintProps = {
  matchType: MatchType
  management: ReturnType<typeof useManagement>
}

/** What the Not matched tab says to do about its files: Fix match, once the viewer may manage. */
const notMatchedHint = ({ matchType, management }: NotMatchedHintProps): string => {
  const title = matchType ?? LIBRARY_COPY.title
  if (!management.canManage) {
    return cannotManageNote({
      mode: management.mode,
      action: LIBRARY_COPY.pointAt(title),
    })
  }
  if (matchType === ITEM_TYPES.show) return LIBRARY_COPY.fixShowMatch
  return LIBRARY_COPY.fixFileMatch(title)
}

const NOT_MATCHED_LAYOUTS = { shows: 'shows', files: 'files' } as const

type NotMatchedLayout = (typeof NOT_MATCHED_LAYOUTS)[keyof typeof NOT_MATCHED_LAYOUTS]

/** A TV library's files not matched are gathered by the show their folder is for; any other's are cards. */
const notMatchedLayout = (matchType: MatchType): NotMatchedLayout =>
  matchType === ITEM_TYPES.show ? NOT_MATCHED_LAYOUTS.shows : NOT_MATCHED_LAYOUTS.files

const NOT_MATCHED_SHAPES = {
  [NOT_MATCHED_LAYOUTS.shows]: MediaTilesSkeleton,
  [NOT_MATCHED_LAYOUTS.files]: MediaGridSkeleton,
} as const satisfies Record<NotMatchedLayout, ComponentType>

type NotMatchedShapeProps = { matchType: MatchType }

const NotMatchedShape = ({ matchType }: NotMatchedShapeProps) => {
  const Bones = NOT_MATCHED_SHAPES[notMatchedLayout(matchType)]
  return <Bones />
}

type NotMatchedFilesProps = SectionProps & { files: UnmatchedFile[] }

/** A TV library's files not matched, by the show their folder is for. */
const UnmatchedShowFiles = ({ library, files }: NotMatchedFilesProps) => {
  const matchType = matchTypeFor(library.settings.kind)
  return (
    <UnmatchedShows
      files={files}
      suggestionOf={suggestionsIn(files)}
      renderFiles={(group) => <MediaGrid items={group} matchType={matchType} />}
    />
  )
}

/** Any other library's files not matched, with the movies the AI lookup suggests. */
const UnmatchedFileCards = ({ library, files }: NotMatchedFilesProps) => (
  <>
    <SuggestedMovies files={files} libraryId={library.id} />
    <MediaGrid items={files} matchType={matchTypeFor(library.settings.kind)} />
  </>
)

const NOT_MATCHED_FILES = {
  [NOT_MATCHED_LAYOUTS.shows]: UnmatchedShowFiles,
  [NOT_MATCHED_LAYOUTS.files]: UnmatchedFileCards,
} as const satisfies Record<NotMatchedLayout, ComponentType<NotMatchedFilesProps>>

const NotMatchedFiles = ({ library, files }: NotMatchedFilesProps) => {
  const Files = NOT_MATCHED_FILES[notMatchedLayout(matchTypeFor(library.settings.kind))]
  return <Files library={library} files={files} />
}

/**
 * The files no movie or show was found for, each with Fix match in its menu,
 * and what the AI lookup suggests where it was not sure. While TMDB answers,
 * the tab keeps reading again until none is pending, then reads the library
 * again for its count of files not matched. The lookups run after that, so
 * once they end, the tab reads both again.
 */
export const NotMatchedSection = ({ library }: SectionProps) => {
  const matchType = matchTypeFor(library.settings.kind)
  const canMatch = useCanMatch()
  const management = useManagement()
  const query = useQuery({
    ...unmatchedQuery(library.id),
    refetchInterval: (current) =>
      canMatch && anyPending(current.state.data ?? []) ? POLL_MS : false,
  })
  useMatchingPassDone({ libraryId: library.id, files: query.data ?? [] })
  useAiLookupsDone({ libraryId: library.id, files: query.data ?? [] })
  return (
    <SectionQuery
      query={query}
      shape={<NotMatchedShape matchType={matchType} />}
      isEmpty={isNone}
      empty={LIBRARY_COPY.allMatched(library.name)}
    >
      {(files) => (
        <>
          <SectionMessage message={notMatchedHint({ matchType, management })} />
          <NotMatchedFiles files={files} library={library} />
        </>
      )}
    </SectionQuery>
  )
}
