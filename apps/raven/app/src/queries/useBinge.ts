import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BINGE_LIMIT, type BingeState } from '@raven/core'

import { useAccountSession } from '@/account/session'
import { useAppQueries } from '@/queries/useAppQueries'

const BINGE_STATE_KEY = ['binge-state'] as const
const SIGNED_OUT = 'signed-out'
const EMPTY_IDS: readonly number[] = []

type BingeStateQueryProps = { account: string; getBinge: () => Promise<BingeState> }

/** The account's binge shows; the account is in the key so the next one never sees the last one's. */
const bingeStateQuery = ({ account, getBinge }: BingeStateQueryProps) =>
  queryOptions({ queryKey: [...BINGE_STATE_KEY, account], queryFn: getBinge })

const useAccountKey = () => useAccountSession((state) => state.session?.userId ?? SIGNED_OUT)

/**
 * The signed-in account's binge shows, most recently added first, from the server, so the web
 * and every device show the same list.
 */
export const useBingeIds = (): readonly number[] => {
  const session = useAppQueries()
  const account = useAccountKey()
  const { data } = useQuery({
    ...bingeStateQuery({
      account,
      getBinge: () => session?.api.getBinge() ?? Promise.resolve({ ids: [], hasSeenTip: true }),
    }),
    enabled: session !== null,
  })
  return data?.ids ?? EMPTY_IDS
}

export type BingeToggle = {
  isBinging: boolean
  /** The list holds `BINGE_LIMIT` other shows, so this one cannot join it. */
  isFull: boolean
  toggle: () => void
}

/** Whether a show is on the binge list, and the press that adds it or takes it off. */
export const useBingeToggle = (id: number): BingeToggle => {
  const session = useAppQueries()
  const account = useAccountKey()
  const client = useQueryClient()
  const ids = useBingeIds()
  const { queryKey } = bingeStateQuery({ account, getBinge: () => Promise.reject(new Error()) })
  const mutation = useMutation({
    mutationFn: (binge: boolean) => {
      if (session === null) return Promise.reject(new Error('No server is active'))
      return session.api.setBinge({ id, binge })
    },
    onSuccess: (state: BingeState) => client.setQueryData(queryKey, state),
    onError: () => client.invalidateQueries({ queryKey }),
  })
  const isBinging = ids.includes(id)
  const isFull = !isBinging && ids.length >= BINGE_LIMIT
  const toggle = () => {
    if (isFull) return
    mutation.mutate(!isBinging)
  }
  return { isBinging, isFull, toggle }
}
