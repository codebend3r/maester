import type { Transport } from '@/apiClient/transport'
import {
  DISCOVERY_PATHS,
  type MixDetails,
  type MixKind,
  type MixSummary,
  RADIO_PARAMS,
  type RadioSeed,
  type RecentAlbums,
  type Track,
  isMixDetails,
  isMixList,
  isRadioTracks,
  isRecentAlbums,
  radioSeedText,
} from '@/contract'
import { toQueryString } from '@/query'

type GetMixProps = { id: MixKind }

type GetRadioProps = { seed: RadioSeed }

/** What the server makes of the account's plays: its mixes, a radio from a seed, and Home's recent albums. */
export const mixCalls = ({ send, expect }: Transport) => ({
  /** The account's mixes for today; one with too few tracks is left out. */
  listMixes: (): Promise<MixSummary[]> =>
    expect({ request: send({ path: DISCOVERY_PATHS.mixes }), guard: isMixList }),

  /** One mix with its tracks, in the order it plays all day. */
  getMix: ({ id }: GetMixProps): Promise<MixDetails> =>
    expect({ request: send({ path: `${DISCOVERY_PATHS.mixes}/${id}` }), guard: isMixDetails }),

  /** Up to 50 tracks around `seed`: its artist, similar artists, its genre, then the library. */
  getRadio: ({ seed }: GetRadioProps): Promise<Track[]> =>
    expect({
      request: send({
        path: `${DISCOVERY_PATHS.radio}?${toQueryString({ [RADIO_PARAMS.seed]: radioSeedText(seed) })}`,
      }),
      guard: isRadioTracks,
    }),

  /** The albums the account played last, and the albums added last, 20 of each. */
  getRecentAlbums: (): Promise<RecentAlbums> =>
    expect({ request: send({ path: DISCOVERY_PATHS.recent }), guard: isRecentAlbums }),
})
