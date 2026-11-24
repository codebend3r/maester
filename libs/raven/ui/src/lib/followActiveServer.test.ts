import { afterEach, describe, expect, it } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { AUTH_CONFIG_STATES, DEFAULT_SERVER_ORIGIN, MEDIA_ORIGIN_KINDS } from '@raven/core'
import { followActiveServer } from '@/lib/followActiveServer'
import { queryKeys } from '@/query/queryClient'
import { useActiveServer } from '@/stores/activeServer'
import { useMediaOrigin } from '@/stores/mediaOrigin'
import { MELEYS } from '@/test/fixtures'

const stops: Array<() => void> = []

afterEach(() => stops.splice(0).forEach((stop) => stop()))

type FollowProps = { apiOrigin?: string; onSwitch?: () => void }

const follow = ({ apiOrigin = '', onSwitch }: FollowProps = {}) => {
  const queryClient = new QueryClient()
  queryClient.setQueryData(queryKeys.libraries, ['home libraries'])
  queryClient.setQueryData(queryKeys.authConfig, { state: AUTH_CONFIG_STATES.off })
  queryClient.setQueryData(queryKeys.libraryPins('account-1'), ['a pin'])
  queryClient.setQueryData(queryKeys.serverLibraries(MELEYS.serverId), ['their libraries'])
  stops.push(followActiveServer({ queryClient, apiOrigin, onSwitch }))
  return queryClient
}

describe('followActiveServer', () => {
  it("plays from the page's own address at home, or the proxied server's origin", () => {
    follow()
    expect(useMediaOrigin.getState().pick).toBeNull()
    stops.splice(0).forEach((stop) => stop())
    follow({ apiOrigin: DEFAULT_SERVER_ORIGIN })
    expect(useMediaOrigin.getState().pick?.origin ?? null).toEqual({
      kind: MEDIA_ORIGIN_KINDS.public,
      url: DEFAULT_SERVER_ORIGIN,
    })
  })

  it("empties the last server's answers on a switch, keeping the account's own and the home config", () => {
    const switches: string[] = []
    const queryClient = follow({ onSwitch: () => switches.push('switched') })
    useActiveServer.getState().choose(MELEYS)
    expect(queryClient.getQueryData(queryKeys.libraries)).toBeUndefined()
    expect(queryClient.getQueryData(queryKeys.authConfig)).toEqual({
      state: AUTH_CONFIG_STATES.off,
    })
    expect(queryClient.getQueryData(queryKeys.libraryPins('account-1'))).toEqual(['a pin'])
    expect(queryClient.getQueryData(queryKeys.serverLibraries(MELEYS.serverId))).toEqual([
      'their libraries',
    ])
    expect(switches).toEqual(['switched'])
  })

  it("plays another server's media from its own origin, and home's again on the way back", () => {
    follow({ apiOrigin: DEFAULT_SERVER_ORIGIN })
    useActiveServer.getState().choose(MELEYS)
    expect(useMediaOrigin.getState().pick?.origin ?? null).toEqual({
      kind: MEDIA_ORIGIN_KINDS.public,
      url: MELEYS.origin,
    })
    useActiveServer.getState().choose(null)
    expect(useMediaOrigin.getState().pick?.origin?.url ?? null).toBe(DEFAULT_SERVER_ORIGIN)
  })

  it('leaves the cache alone when the same server is chosen again', () => {
    const switches: string[] = []
    const queryClient = follow({ onSwitch: () => switches.push('switched') })
    useActiveServer.getState().choose(null)
    useActiveServer.getState().choose({ ...MELEYS })
    queryClient.setQueryData(queryKeys.libraries, ['meleys libraries'])
    useActiveServer.getState().choose({ ...MELEYS })
    expect(queryClient.getQueryData(queryKeys.libraries)).toEqual(['meleys libraries'])
    expect(switches).toEqual(['switched'])
  })

  it('stops following once told', () => {
    const queryClient = follow()
    stops.splice(0).forEach((stop) => stop())
    useActiveServer.getState().choose(MELEYS)
    expect(queryClient.getQueryData(queryKeys.libraries)).toEqual(['home libraries'])
  })
})
