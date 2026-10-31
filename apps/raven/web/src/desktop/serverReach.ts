import { ApiError } from '@raven/core'
import { queryKeys } from '@raven/ui/headless'
import { hashKey, type Query, useQueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { isDownloadsPage, offlineReturnIn } from '@/desktop/paths'
import { useServerReach } from '@/stores/serverReach'
import { handled } from '@/desktop/handled'

/** How often Raven asks again while its server cannot be reached. */
export const OFFLINE_RETRY_MS = 5_000

const AUTH_CONFIG_HASH = hashKey(queryKeys.authConfig)

/**
 * Whether a failed read of the account config means the server is out of reach: the network
 * failed before any answer, or the answer came from in front of it (Raven's web host, or
 * a proxy's gateway error with no JSON; see core's `isUnreachableAnswer`). Any other answer,
 * an error status among them, came from the server.
 */
const isUnreachable = (error: Error): boolean =>
  !(error instanceof ApiError) || error.isServerUnreachable

/**
 * What the account config's last settled read says of the server. A failed read keeps the data
 * of an earlier one, so the error decides: out of reach, or answering. A read under way with
 * nothing settled yet says nothing new.
 */
const follow = (query: Pick<Query, 'state'> | undefined): void => {
  if (query === undefined) return
  const { data, error } = query.state
  if (error !== null) {
    useServerReach.setState({ isOffline: isUnreachable(error) })
    return
  }
  if (data !== undefined) useServerReach.setState({ isOffline: false })
}

/**
 * Keeps `useServerReach` in step with the account config's reads, which every page waits on:
 * the first, and any read again later (a retry, a sign out). While the server is out of reach
 * it asks again every `OFFLINE_RETRY_MS`, so the normal app comes back by itself once it answers.
 */
export const useFollowServerReach = (): void => {
  const queryClient = useQueryClient()
  const isOffline = useServerReach((state) => state.isOffline)

  useEffect(() => {
    const cache = queryClient.getQueryCache()
    follow(cache.get(AUTH_CONFIG_HASH))
    return cache.subscribe((event) => {
      if (event.query.queryHash === AUTH_CONFIG_HASH) follow(event.query)
    })
  }, [queryClient])

  useEffect(() => {
    if (!isOffline) return
    const timer = setInterval(() => {
      queryClient
        .refetchQueries({ queryKey: queryKeys.authConfig, exact: true })
        .catch(() => undefined)
    }, OFFLINE_RETRY_MS)
    return () => clearInterval(timer)
  }, [isOffline, queryClient])
}

/**
 * Once the server answers again, goes back to the page the offline redirect left, if the person
 * is still on the Downloads page it sent them to, raven's or the music mode's.
 */
export const useReturnWhenReached = (): void => {
  const isOffline = useServerReach((state) => state.isOffline)
  const navigate = useNavigate()
  const { pathname, state } = useLocation()
  const wasOffline = useRef(isOffline)

  const goBack = useEffectEvent(() => {
    const returnTo = isDownloadsPage(pathname) ? offlineReturnIn(state) : null
    if (returnTo !== null) handled(Promise.resolve(navigate(returnTo, { replace: true })))
  })

  useEffect(() => {
    const was = wasOffline.current
    wasOffline.current = isOffline
    if (was && !isOffline) goBack()
  }, [isOffline])
}
