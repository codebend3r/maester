import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { moveLegacyBinge } from '@/lib/legacyBinge'

const BINGE_STATE_KEY = ['binge-state'] as const

type BingeStateQueryProps = { account: string }

/** The account's binge shows from the server, after moving any this browser still held locally. */
export const bingeStateQuery = ({ account }: BingeStateQueryProps) =>
  queryOptions({
    queryKey: [...BINGE_STATE_KEY, account],
    queryFn: async () => {
      await moveLegacyBinge({ account })
      return api.getBinge()
    },
  })
