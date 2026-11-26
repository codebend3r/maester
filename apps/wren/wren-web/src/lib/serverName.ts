import { STATUS_COPY } from '@raven/wren'
import { serverNamesQuery } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useAccountData } from '@/lib/accountData'

/**
 * The name Wren shows for raven: the one the account gave it, in Settings here or in raven or
 * another Wren, else raven's own. It is read again as every client reads the account's names.
 */
export const useServerName = (): string => {
  const { client, userId, serverId } = useAccountData()
  const names = useQuery(serverNamesQuery({ client, userId })).data ?? []
  return names.find((named) => named.serverId === serverId)?.name ?? STATUS_COPY.raven
}
