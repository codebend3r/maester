import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { accountServersQuery, useActiveServer } from '@raven/ui/headless'
import { useAccountData } from '@/lib/accountData'
import { onAccountLeft } from '@/stores/authSession'

/**
 * Takes the page back to its home server when the server it was left on is no longer the
 * account's: removed on another device, or kept from a visit while accounts were on, which are
 * off now. Until the account's list is read the page stays where it was. A sign out or another
 * account goes home at once, as Raven's main does, since the server was the last account's.
 */
export const KeepActiveServer = () => {
  const active = useActiveServer((state) => state.active)
  const choose = useActiveServer((state) => state.choose)
  const accountData = useAccountData()
  const rows = useQuery(accountServersQuery(accountData))
  const hasNoAccountData = accountData.isConfigRead && accountData.client === null
  const isUnlisted =
    rows.isSuccess && !rows.data.some((row) => row.serverId === (active?.serverId ?? null))
  const shouldGoHome = active !== null && (hasNoAccountData || isUnlisted)
  useEffect(() => {
    if (shouldGoHome) choose(null)
  }, [shouldGoHome, choose])
  useEffect(() => onAccountLeft(() => choose(null)), [choose])
  return null
}
