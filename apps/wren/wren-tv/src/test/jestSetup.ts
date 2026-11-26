import { jest } from '@jest/globals'
import { configure } from '@testing-library/react-native'

import type * as VideoMock from '@/test/videoMock'

/*
 * A loaded CI runner can spend seconds on a file's first render while jest compiles what the
 * screen imports, past the library's one second wait.
 */
configure({ asyncUtilTimeout: 10_000 })

// No screen test reaches the network: a call no test answers fails as it would on a TV offline.
globalThis.fetch = async () => {
  throw new TypeError('Network request failed')
}

/*
 * `WrenTvRoot` mounts the music host on every screen, and jest has no native player: the
 * stand-in draws nothing and keeps the props a test fires the player's events through.
 */
jest.mock('react-native-video', () =>
  jest.requireActual<typeof VideoMock>('@/test/videoMock').videoModuleMock(),
)

// jest has no AsyncStorage native module: the prefs and recent searches read nothing back.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}))

/*
 * `WrenTvRoot` keeps the Apple TV's Top Shelf on the latest releases, and jest runs as iOS, so
 * every screen would ask for them; a screen test counts its own requests, so the sync draws and
 * asks nothing here. `topShelf.test.ts` tests what it writes.
 */
jest.mock('@raven/top-shelf', () => ({ TopShelfSync: () => null }))
