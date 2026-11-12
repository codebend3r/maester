import type { Transport } from '@/apiClient/transport'
import {
  type TitleRequest,
  type TitleRequestAsk,
  type TitleRequests,
  isTitleRequest,
  isTitleRequests,
  isUpcomingDetails,
  REQUEST_PATHS,
  type UpcomingDetails,
  UPCOMING_TITLE_PARAMS,
  UPCOMING_TITLE_PATH,
} from '@/contract'
import { fillPath } from '@/query'

/** Coming soon's titles of their own, and the requests to download them. */
export const requestCalls = ({ send, expect }: Transport) => ({
  /** One upcoming movie or show, as TMDB describes it. */
  getUpcomingDetails: ({ type, tmdbId }: TitleRequestAsk): Promise<UpcomingDetails> =>
    expect({
      request: send({
        path: fillPath({
          path: UPCOMING_TITLE_PATH,
          params: { [UPCOMING_TITLE_PARAMS.type]: type, [UPCOMING_TITLE_PARAMS.tmdbId]: tmdbId },
        }),
      }),
      guard: isUpcomingDetails,
    }),

  /** Every request with where it stands, and how many the caller has left. */
  listRequests: (): Promise<TitleRequests> =>
    expect({ request: send({ path: REQUEST_PATHS.requests }), guard: isTitleRequests }),

  /** Asks for a movie or show to be downloaded for everyone; spends one of the caller's requests. */
  requestDownload: (ask: TitleRequestAsk): Promise<TitleRequest> =>
    expect({
      request: send({ path: REQUEST_PATHS.requests, method: 'POST', body: ask }),
      guard: isTitleRequest,
    }),
})
