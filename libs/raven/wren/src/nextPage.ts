import type { Track } from '@raven/core'

type NextPageOfProps = {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => Promise<unknown>
}

/** What a list does near its end: asks for the next page, once, while there is one. */
export const nextPageOf =
  ({ hasNextPage, isFetchingNextPage, fetchNextPage }: NextPageOfProps) =>
  (): void => {
    if (!hasNextPage || isFetchingNextPage) return
    // A page that fails keeps its error on the query, which the page says.
    fetchNextPage().catch(() => undefined)
  }

/** A page as it holds its tracks: a page of songs, or an album read whole. */
type TracksPage = { tracks: readonly Track[] }

/** The tracks of several pages as one list, in the pages' order. */
export const tracksOfPages = (pages: readonly TracksPage[]): Track[] =>
  pages.flatMap(({ tracks }) => tracks)
