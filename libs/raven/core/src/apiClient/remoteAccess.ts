import type { Transport } from '@/apiClient/transport'
import { ROUTES } from '@/routes'
import { type RemoteAccessChange, type RemoteAccessState } from '@/contract'

/** How the owner makes raven reachable from outside the home network, and whether it is. */
export const remoteAccessCalls = ({ ask }: Transport) => ({
  /** The settings, the addresses they come to, and the outside check's latest answer. */
  getRemoteAccess: (): Promise<RemoteAccessState> => ask({ route: ROUTES.getRemoteAccess }),

  /** Changes the fields sent, then checks again from outside; an empty change only checks. */
  setRemoteAccess: (change: RemoteAccessChange): Promise<RemoteAccessState> =>
    ask({ route: ROUTES.setRemoteAccess, body: change }),
})
