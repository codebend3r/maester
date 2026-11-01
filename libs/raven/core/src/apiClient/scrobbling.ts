import type { Transport } from '@/apiClient/transport'
import {
  type LastFmAuthPage,
  type LastFmStart,
  type ListenBrainzLink,
  SCROBBLING_PATHS,
  type ScrobbleService,
  type ScrobbleStatus,
  isLastFmAuthPage,
  isScrobbleStatusList,
} from '@/contract'

type UnlinkScrobblingProps = { service: ScrobbleService }

/** The account's scrobbling: which services it forwards its listens to, and linking them. */
export const scrobblingCalls = ({ send, expect }: Transport) => ({
  /** Each service, whether this server offers it, and the account's name there once linked. */
  getScrobbling: (): Promise<ScrobbleStatus[]> =>
    expect({ request: send({ path: SCROBBLING_PATHS.root }), guard: isScrobbleStatusList }),

  /** Links ListenBrainz with the account's user token, which ListenBrainz checks first. */
  linkListenBrainz: ({ token }: ListenBrainzLink): Promise<ScrobbleStatus[]> =>
    expect({
      request: send({
        path: SCROBBLING_PATHS.listenBrainz,
        method: 'PUT',
        body: { token } satisfies ListenBrainzLink,
      }),
      guard: isScrobbleStatusList,
    }),

  /** Last.fm's sign-in page, which comes back to `returnTo` once the account allowed raven. */
  startLastFm: ({ returnTo }: LastFmStart): Promise<LastFmAuthPage> =>
    expect({
      request: send({
        path: SCROBBLING_PATHS.lastFmStart,
        method: 'POST',
        body: { returnTo } satisfies LastFmStart,
      }),
      guard: isLastFmAuthPage,
    }),

  /** Stops forwarding to `service` and forgets its token, with the listens still waiting for it. */
  unlinkScrobbling: ({ service }: UnlinkScrobblingProps): Promise<ScrobbleStatus[]> =>
    expect({
      request: send({ path: `${SCROBBLING_PATHS.root}/${service}`, method: 'DELETE' }),
      guard: isScrobbleStatusList,
    }),
})
