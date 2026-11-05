import type { Transport } from '@/apiClient/transport'
import {
  REMOTE_ACCESS_PATHS,
  type RemoteAccessChange,
  type RemoteAccessState,
  isRemoteAccessState,
} from '@/contract'

/** How the owner makes raven reachable from outside the home network, and whether it is. */
export const remoteAccessCalls = ({ send, expect }: Transport) => ({
  /** The settings, the addresses they come to, and the outside check's latest answer. */
  getRemoteAccess: (): Promise<RemoteAccessState> =>
    expect({ request: send({ path: REMOTE_ACCESS_PATHS.settings }), guard: isRemoteAccessState }),

  /** Changes the fields sent, then checks again from outside; an empty change only checks. */
  setRemoteAccess: (change: RemoteAccessChange): Promise<RemoteAccessState> =>
    expect({
      request: send({ path: REMOTE_ACCESS_PATHS.settings, method: 'PUT', body: change }),
      guard: isRemoteAccessState,
    }),
})
