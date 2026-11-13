import { ITEM_TYPES, finishedNote, matchTypeFor } from '@raven/core'
import { ButtonLink } from '@raven/ui'
import { HISTORY_SHOWS, isNone } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { MediaTiles, MediaTilesSkeleton } from '@/components/MediaTiles/MediaTiles'
import { mediaEntryOf } from '@/components/SelectionScope/SelectionScope'
import { libraryHistoryPath } from '@/lib/appPaths'
import { historyQuery } from '@/lib/queries'
import { LIBRARY_COPY } from '@/pages/LibraryPage/copy'
import { FINISHED_LIMIT } from '@/pages/LibraryPage/librarySections'
import { SelectableCards } from '@/pages/LibraryPage/SelectableCards'
import { SectionQuery, type SectionProps } from '@/pages/LibraryPage/sections/sectionParts'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

/** What was watched to the end most recently, with a way to the whole history. */
export const FinishedSection = ({ library }: SectionProps) => {
  const matchType = matchTypeFor(library.settings.kind)
  const query = useQuery(
    historyQuery({ libraryId: library.id, show: HISTORY_SHOWS.watched, limit: FINISHED_LIMIT }),
  )
  return (
    <SectionQuery
      query={query}
      shape={<MediaTilesSkeleton />}
      isEmpty={isNone}
      empty={LIBRARY_COPY.finishedEmpty({
        name: library.name,
        percent: library.settings.watchedPercent,
      })}
    >
      {(entries) => {
        const notes = new Map(entries.map((entry) => [entry.media.id, finishedNote({ entry })]))
        const posters = new Map(entries.map(({ media, poster }) => [media.id, poster ?? null]))
        return (
          <SelectableCards entries={entries.map(({ media }) => mediaEntryOf(media))}>
            <MediaTiles
              items={entries.map((entry) => entry.media)}
              note={(media) => notes.get(media.id) ?? null}
              posters={matchType === ITEM_TYPES.movie}
              posterOf={(media) => posters.get(media.id) ?? null}
              matchType={matchType}
            />
            <ButtonLink to={libraryHistoryPath(library.id)} icon="history" className={styles.more}>
              {LIBRARY_COPY.fullHistory}
            </ButtonLink>
          </SelectableCards>
        )
      }}
    </SectionQuery>
  )
}
