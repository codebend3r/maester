import type { Transport } from '@/apiClient/transport'
import { type BingeChange, type BingeState, isBingeState } from '@/contract'

type SetBingeProps = { id: number } & BingeChange

/** The shows an account is binging, kept on the server so every device sees the same list. */
export const bingeCalls = ({ send, expect }: Transport) => ({
  /** The account's binge shows, most recently added first, and whether it has seen the tip. */
  getBinge: (): Promise<BingeState> =>
    expect({ request: send({ path: '/api/binge' }), guard: isBingeState }),

  /** Adds a show to the account's binge list, or removes it, and answers with the list. */
  setBinge: ({ id, binge }: SetBingeProps): Promise<BingeState> =>
    expect({
      request: send({
        path: `/api/binge/${id}`,
        method: 'PUT',
        body: { binge } satisfies BingeChange,
      }),
      guard: isBingeState,
    }),

  /** Records that the account has seen the binge tip, and answers with the list. */
  dismissBingeTip: (): Promise<BingeState> =>
    expect({
      request: send({ path: '/api/binge/tip', method: 'PUT' }),
      guard: isBingeState,
    }),
})
