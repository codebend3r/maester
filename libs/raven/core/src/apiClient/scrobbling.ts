import type { Transport } from '@/apiClient/transport'
import { ROUTES } from '@/routes'
import {
  type LastFmAuthPage,
  type LastFmStart,
  type ListenBrainzLink,
  type ScrobbleService,
  type ScrobbleStatus,
} from '@/contract'

type UnlinkScrobblingProps = { service: ScrobbleService }

/** The account's scrobbling: which services it forwards its listens to, and linking them. */
export const scrobblingCalls = ({ ask }: Transport) => ({
  /** Each service, whether this server offers it, and the account's name there once linked. */
  getScrobbling: (): Promise<ScrobbleStatus[]> => ask({ route: ROUTES.getScrobbling }),

  /** Links ListenBrainz with the account's user token, which ListenBrainz checks first. */
  linkListenBrainz: ({ token }: ListenBrainzLink): Promise<ScrobbleStatus[]> =>
    ask({ route: ROUTES.linkListenBrainz, body: { token } satisfies ListenBrainzLink }),

  /** Last.fm's sign-in page, which comes back to `returnTo` once the account allowed raven. */
  startLastFm: ({ returnTo }: LastFmStart): Promise<LastFmAuthPage> =>
    ask({ route: ROUTES.startLastFm, body: { returnTo } satisfies LastFmStart }),

  /** Stops forwarding to `service` and forgets its token, with the listens still waiting for it. */
  unlinkScrobbling: ({ service }: UnlinkScrobblingProps): Promise<ScrobbleStatus[]> =>
    ask({ route: ROUTES.unlinkScrobbling, params: { service } }),
})
