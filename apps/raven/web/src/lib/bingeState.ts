import { queryOptions } from '@tanstack/react-query'
import { queryKeys } from '@raven/ui/headless'
import { api } from '@/lib/api'
import { moveLegacyBinge } from '@/lib/legacyBinge'

type BingeStateQueryProps = { account: string }

/** The account's binge shows from the server, after moving any this browser still held locally. */
export const bingeStateQuery = ({ account }: BingeStateQueryProps) =>
  queryOptions({
    queryKey: [...queryKeys.bingeState, account],
    queryFn: async () => {
      await moveLegacyBinge({ account })
      return api.getBinge()
    },
  })
