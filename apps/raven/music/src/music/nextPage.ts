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
