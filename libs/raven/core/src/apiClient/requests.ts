import type { Transport } from '@/apiClient/transport'
import {
  type TitleHolding,
  type TitleRequest,
  type TitleRequestAsk,
  type TitleRequests,
  UPCOMING_TITLE_PARAMS,
  type UpcomingDetails,
} from '@/contract'
import { ROUTES } from '@/routes'

/** Coming soon's titles of their own, and the requests to download them. */
export const requestCalls = ({ ask }: Transport) => ({
  /** One upcoming movie or show, as TMDB describes it. */
  getUpcomingDetails: ({ type, tmdbId }: TitleRequestAsk): Promise<UpcomingDetails> =>
    ask({
      route: ROUTES.getUpcomingDetails,
      params: { [UPCOMING_TITLE_PARAMS.type]: type, [UPCOMING_TITLE_PARAMS.tmdbId]: tmdbId },
    }),

  /** Every request with where it stands, and how many the caller has left. */
  listRequests: (): Promise<TitleRequests> => ask({ route: ROUTES.listRequests }),

  /** Whether the title's Sonarr or Radarr holds it already, and where it stands there. */
  getRequestHolding: ({ type, tmdbId }: TitleRequestAsk): Promise<TitleHolding> =>
    ask({
      route: ROUTES.getRequestHolding,
      params: { [UPCOMING_TITLE_PARAMS.type]: type, [UPCOMING_TITLE_PARAMS.tmdbId]: tmdbId },
    }),

  /** Asks for a movie or show to be downloaded for everyone; spends one of the caller's requests. */
  requestDownload: (titleAsk: TitleRequestAsk): Promise<TitleRequest> =>
    ask({ route: ROUTES.requestDownload, body: titleAsk }),
})
