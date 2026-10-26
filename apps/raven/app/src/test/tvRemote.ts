import { act } from '@testing-library/react-native'

import { KEY_ACTIONS, type RemoteKey } from '@/layouts/remoteKeys'

/** What Android TV's fork hands each listener for a key: its name and whether it went down or up. */
type KeyEvent = { eventType: RemoteKey; eventKeyAction: number }

type Listener = (event: KeyEvent) => void

/** Who listens to the remote now, as `useTVEventHandler` subscribes and lets go. */
const listening: { listeners: ReadonlySet<Listener> } = { listeners: new Set() }

/**
 * The fork's `TVEventHandler` with the remote swapped for the test's. A test hands it to
 * `jest.mock` through `jest.requireActual`, so the fork's own `useTVEventHandler` subscribes
 * here and `pressRemote` reaches every listener the screen holds.
 */
export const tvEventHandlerMock = () => ({
  __esModule: true,
  default: {
    addListener: (listener: Listener) => {
      listening.listeners = new Set([...listening.listeners, listener])
      return {
        remove: () => {
          listening.listeners = new Set(
            [...listening.listeners].filter((each) => each !== listener),
          )
        },
      }
    },
  },
})

type PressRemoteProps = { key: RemoteKey }

/**
 * Presses a key on the remote: the key going down, then coming up, as the fork sends it with its
 * key-down events on (with them off, as on Android TV, only the second comes).
 */
export const pressRemote = async ({ key }: PressRemoteProps): Promise<void> => {
  const actions = [KEY_ACTIONS.down, KEY_ACTIONS.up]
  await act(async () => {
    actions.forEach((eventKeyAction) =>
      [...listening.listeners].forEach((listener) => listener({ eventType: key, eventKeyAction })),
    )
  })
}
