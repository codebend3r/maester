import type { Transport } from '@/apiClient/transport'
import { ROUTES } from '@/routes'
import {
  type MixDetails,
  type MixKind,
  type MixSummary,
  RADIO_PARAMS,
  type RadioSeed,
  type RecentAlbums,
  type Track,
  radioSeedText,
} from '@/contract'

type GetMixProps = { id: MixKind }

type GetRadioProps = { seed: RadioSeed }

/** What the server makes of the account's plays: its mixes, a radio from a seed, and Home's recent albums. */
export const mixCalls = ({ ask }: Transport) => ({
  /** The account's mixes for today; one with too few tracks is left out. */
  listMixes: (): Promise<MixSummary[]> => ask({ route: ROUTES.listMixes }),

  /** One mix with its tracks, in the order it plays all day. */
  getMix: ({ id }: GetMixProps): Promise<MixDetails> =>
    ask({ route: ROUTES.getMix, params: { id } }),

  /** Up to 50 tracks around `seed`: its artist, similar artists, its genre, then the library. */
  getRadio: ({ seed }: GetRadioProps): Promise<Track[]> =>
    ask({ route: ROUTES.getRadio, query: { [RADIO_PARAMS.seed]: radioSeedText(seed) } }),

  /** The albums the account played last, and the albums added last, 20 of each. */
  getRecentAlbums: (): Promise<RecentAlbums> => ask({ route: ROUTES.getRecentAlbums }),
})
