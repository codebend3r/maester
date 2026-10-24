import { describe, expect, it, mock } from 'bun:test'

type ReportedState = { type: string; isConnected: boolean | null; details: unknown }
type Listener = (state: ReportedState) => void

const configured: { reachabilityShouldRun?: () => boolean }[] = []
let listeners: Listener[] = []

// NetInfo's own module reaches React Native's native modules, which bun cannot load.
mock.module('@react-native-community/netinfo', () => ({
  configure: (configuration: { reachabilityShouldRun?: () => boolean }) => {
    configured.push(configuration)
  },
  addEventListener: (listener: Listener) => {
    listeners = [...listeners, listener]
    return () => {
      listeners = listeners.filter((each) => each !== listener)
    }
  },
}))

const { watchNetwork } = await import('@/servers/networkChanges')

/** NetInfo's names for two kinds of network. */
const NETWORK_TYPES = { wifi: 'wifi', cellular: 'cellular' } as const

const stateOf = ({
  type,
  isConnected = true,
  ipAddress = null,
}: {
  type: string
  isConnected?: boolean
  ipAddress?: string | null
}): ReportedState => ({ type, isConnected, details: ipAddress === null ? null : { ipAddress } })

const report = (state: ReportedState) => listeners.forEach((listener) => listener(state))

describe('watchNetwork', () => {
  it("turns off NetInfo's own internet check, which asks Google", () => {
    expect(configured).toHaveLength(1)
    expect(configured[0]?.reachabilityShouldRun?.() ?? true).toBe(false)
  })

  it('says nothing of the state NetInfo reports on subscribing, only of each move after it', () => {
    let moves = 0
    const stop = watchNetwork({
      onChange: () => {
        moves += 1
      },
    })
    report(stateOf({ type: NETWORK_TYPES.wifi, ipAddress: '192.168.1.40' }))
    report(stateOf({ type: NETWORK_TYPES.wifi, ipAddress: '192.168.1.40' }))
    expect(moves).toBe(0)
    report(stateOf({ type: NETWORK_TYPES.wifi, ipAddress: '10.0.0.7' }))
    expect(moves).toBe(1)
    report(stateOf({ type: NETWORK_TYPES.cellular }))
    expect(moves).toBe(2)
    report(stateOf({ type: NETWORK_TYPES.cellular, isConnected: false }))
    expect(moves).toBe(3)
    stop()
    expect(listeners).toEqual([])
  })
})
