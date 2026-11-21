import { ROUTE_STATES, type RoutePending } from '@raven/core'

/** What a page says while it has nothing of its own to show. */
type DetailCopy = { opening: string; missing: string }

type DetailNoticeOfProps = { page: RoutePending; copy: DetailCopy }

/**
 * What an album's, an artist's or a playlist's page says in place of itself: that it is opening,
 * that the server has none by that address, or why the server could not say, in its own words.
 */
export const detailNoticeOf = ({ page, copy }: DetailNoticeOfProps): string => {
  switch (page.state) {
    case ROUTE_STATES.missing:
      return copy.missing
    case ROUTE_STATES.error:
      return page.message
    case ROUTE_STATES.loading:
      return copy.opening
    default: {
      const unknown: never = page
      return unknown
    }
  }
}
