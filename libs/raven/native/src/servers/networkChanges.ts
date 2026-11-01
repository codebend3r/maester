import {
  NetInfoStateType,
  addEventListener,
  configure,
  fetch,
} from '@react-native-community/netinfo'
import { isRecord, isString } from '@raven/core'

import type { WatchNetwork } from '@/servers/mediaAccess'

/** What the key reads of a state NetInfo reports. */
type NetworkState = { type: string; isConnected: boolean | null; details: unknown }

// NetInfo checks for the internet by asking Google's generate_204 page now and then. raven has no
// business there, and only a move to another network matters to it.
configure({ reachabilityShouldRun: () => false })

type NetworkKeyOfProps = NetworkState

/** One network apart from another: its kind, whether it is up, and the device's address on it. */
const networkKeyOf = ({ type, isConnected, details }: NetworkKeyOfProps): string => {
  const address = isRecord(details) && isString(details.ipAddress) ? details.ipAddress : ''
  return [type, String(isConnected), address].join(' ')
}

/**
 * `WatchNetwork` over NetInfo. NetInfo reports the state it starts in soon after a subscription,
 * which is no move, and may report one network more than once, so only a new key is a change.
 */
export const watchNetwork: WatchNetwork = ({ onChange }) => {
  let last: string | null = null
  return addEventListener((state) => {
    const key = networkKeyOf(state)
    const isMove = last !== null && key !== last
    last = key
    if (isMove) onChange()
  })
}

/** Whether the device is on a mobile network now, where a track streams smaller to save data. */
export const isOnCellular = async (): Promise<boolean> =>
  (await fetch()).type === NetInfoStateType.cellular
