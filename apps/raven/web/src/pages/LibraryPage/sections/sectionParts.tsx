import { type Library, type PosterEntry, matchTypeFor } from '@raven/core'
import { QueryView, type QueryRead } from '@raven/ui/headless'
import type { ReactNode } from 'react'
import { MediaGrid } from '@/components/MediaGrid/MediaGrid'
import { mediaEntryOf } from '@/components/SelectionScope/SelectionScope'
import { Loading } from '@/components/Skeleton/Skeleton'
import { type CardPicture, cardPictureOf } from '@/lib/cardPictures'
import { COMMON_COPY } from '@/lib/copy'
import { SelectableCards } from '@/pages/LibraryPage/SelectableCards'
import styles from '@/pages/LibraryPage/LibraryPage.module.scss'

/** The props every tab's content takes: the library it is a tab of. */
export type SectionProps = { library: Library }

type SectionFailedProps = { error: Error }

/** Why what a tab lists could not be read. */
export const SectionFailed = ({ error }: SectionFailedProps) => (
  <p className={styles.message} role="alert">
    {error.message}
  </p>
)

type SectionMessageProps = { message: string }

/** A line a tab says about what it lists. */
export const SectionMessage = ({ message }: SectionMessageProps) => (
  <p className={styles.message}>{message}</p>
)

/** How the library's cards are pictured: a matched library's wear posters, frame grabs elsewhere. */
export const libraryCardPicture = (library: Library): CardPicture =>
  cardPictureOf({ hasPosters: matchTypeFor(library.settings.kind) != null })

type SectionQueryProps<T> = {
  query: QueryRead<T>
  /** The shape of what is on its way, in grey. */
  shape: ReactNode
  isEmpty: (data: T) => boolean
  /** What the tab says when its list holds nothing. */
  empty: string
  children: (data: T) => ReactNode
}

/**
 * A tab's body: why its read failed, `shape` while it loads, `empty` for an
 * answer with nothing in it, else its content.
 */
export const SectionQuery = <T,>({
  query,
  shape,
  isEmpty,
  empty,
  children,
}: SectionQueryProps<T>) => (
  <QueryView
    query={query}
    pending={<Loading label={COMMON_COPY.loading}>{shape}</Loading>}
    renderFailed={(error) => <SectionFailed error={error} />}
    empty={{ isEmpty, shown: <SectionMessage message={empty} /> }}
  >
    {children}
  </QueryView>
)

type EntryGridProps = { library: Library; entries: readonly PosterEntry[] }

/**
 * Videos as the library lays its cards out: posters where it is matched (an
 * episode wears its season's), frame grabs where it is not.
 */
export const EntryGrid = ({ library, entries }: EntryGridProps) => {
  const posters = new Map(entries.map(({ media, poster }) => [media.id, poster]))
  return (
    <SelectableCards entries={entries.map(({ media }) => mediaEntryOf(media))}>
      <MediaGrid
        items={entries.map((entry) => entry.media)}
        picture={libraryCardPicture(library)}
        posterOf={(media) => posters.get(media.id) ?? null}
        matchType={matchTypeFor(library.settings.kind)}
      />
    </SelectableCards>
  )
}
