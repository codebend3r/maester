import { type Account, isAccountId } from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { ACCESS_KINDS, useAccessState } from '@/lib/accessState'
import { membersQuery } from '@/lib/queries'

/** The accounts the owner's list knows; none on a server without accounts, or for anyone but the owner. */
export const useAccounts = (): readonly Account[] => {
  const access = useAccessState()
  const ownerId = access.kind === ACCESS_KINDS.approved ? access.account.id : null
  const members = useQuery(membersQuery(ownerId))
  return members.data ?? []
}

/** How a list names an account: by its email when the owner's list has it. */
export type AccountName = (accountId: string) => string

type AccountNamesOfProps = {
  accounts: readonly Account[]
  /** What the one account of a server without accounts, or from before them, is called. */
  thisServer: string
}

/** Names an account by its email, an account the list lacks by its id, and anything else as this server's own. */
export const accountNamesOf = ({ accounts, thisServer }: AccountNamesOfProps): AccountName => {
  const emails = new Map(accounts.map((account) => [account.id, account.email]))
  return (id) => emails.get(id) ?? (isAccountId(id) ? id : thisServer)
}
