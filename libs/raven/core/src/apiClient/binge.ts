import type { Transport } from '@/apiClient/transport'
import { ROUTES } from '@/routes'
import { type BingeChange, type BingeState } from '@/contract'

type SetBingeProps = { id: number } & BingeChange

/** The shows an account is binging, kept on the server so every device sees the same list. */
export const bingeCalls = ({ ask }: Transport) => ({
  /** The account's binge shows, most recently added first, and whether it has seen the tip. */
  getBinge: (): Promise<BingeState> => ask({ route: ROUTES.getBinge }),

  /** Adds a show to the account's binge list, or removes it, and answers with the list. */
  setBinge: ({ id, binge }: SetBingeProps): Promise<BingeState> =>
    ask({ route: ROUTES.setBinge, params: { id }, body: { binge } satisfies BingeChange }),

  /** Records that the account has seen the binge tip, and answers with the list. */
  dismissBingeTip: (): Promise<BingeState> => ask({ route: ROUTES.dismissBingeTip }),
})
