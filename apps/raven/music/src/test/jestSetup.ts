import { jest } from '@jest/globals'
import type * as Audio from '@raven/audio'
import { configure } from '@testing-library/react-native'

// A loaded CI runner can spend seconds on a file's first render while jest compiles what
// the screen imports, past the library's one second wait.
configure({ asyncUtilTimeout: 10_000 })

// `WrenRoot` mounts the audio host on every screen, and jest has no native player: each call
// resolves, and a test reads what the host asked of it.
jest.mock('@raven/audio', () => ({
  ...jest.requireActual<typeof Audio>('@raven/audio'),
  audioPlayer: {
    setWindow: jest.fn(async () => undefined),
    setNext: jest.fn(async () => undefined),
    play: jest.fn(async () => undefined),
    pause: jest.fn(async () => undefined),
    seekTo: jest.fn(async () => undefined),
    setVolume: jest.fn(async () => undefined),
    setRate: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    onEvent: jest.fn(() => ({ remove: () => undefined })),
  },
}))

// jest has no AsyncStorage native module: Wren's prefs and downloads read nothing back and
// keep what they write for the test alone.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}))
