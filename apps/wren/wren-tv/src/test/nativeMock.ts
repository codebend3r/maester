import { jest } from '@jest/globals'
import type * as Native from '@raven/native'

/** The test's client, read as each screen asks for it: `jest.mock` runs before the test's own lines. */
type NativeMockProps = { apiOf: () => unknown }

/**
 * `@raven/native` with the server's client swapped for the test's and the device's stores
 * for ones that keep nothing. A screen test hands it to `jest.mock` through `jest.requireActual`.
 */
export const nativeModuleMock = ({ apiOf }: NativeMockProps) => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: apiOf,
  watchNetwork: () => () => undefined,
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
})
