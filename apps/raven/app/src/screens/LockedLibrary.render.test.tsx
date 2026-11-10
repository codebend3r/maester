import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
  APP_CALL_METHODS,
  APP_CLIENT_CALLS,
  type ApiClient,
  type LockState,
  createApiClient,
  isString,
} from '@raven/core'
import type { ApiForProps } from '@raven/native'
import type * as Native from '@raven/native'
import { allowlistedFetch } from '@raven/native/headless'
import { fireEvent, screen, waitFor } from '@testing-library/react-native'

import { LOCKED_LIBRARY_COPY, PIN_PAD_COPY } from '@/layouts/copy'
import { APP_ROUTE_PARAMS } from '@/routes'
import { Library } from '@/screens/Library'
import { LIBRARY_COPY } from '@/screens/copy'
import { useActiveServer } from '@/stores/activeServer'
import { type HeardRequest, NOT_FOUND, STATUSES, pathFor, responseOf } from '@/test/fixtureFetch'
import { FILMS, NAS } from '@/test/homeServer'
import { createScreenClient, renderScreen, untilIdle } from '@/test/renderScreen'

/** The PIN the test server opens its locked libraries with. */
const PIN = '2468'

/** What the server says to a wrong PIN, which the pad shows as it is. */
const WRONG_PIN = 'That PIN is not right.'

const LOCKED_FILMS = { ...FILMS, settings: { ...FILMS.settings, locked: true } }

const mockServer: { heard: HeardRequest[]; lock: LockState } = {
  heard: [],
  lock: { available: true, unlocked: false },
}

const { getLibrary, getLock, unlock, lock, listInProgress } = APP_CLIENT_CALLS

const pinOf = (body: unknown): string | null => {
  if (!isString(body)) return null
  const parsed: unknown = JSON.parse(body)
  return typeof parsed === 'object' && parsed !== null && 'pin' in parsed && isString(parsed.pin)
    ? parsed.pin
    : null
}

/** A server with Films locked behind `PIN`, behind the app's allowlist so an unlisted call fails. */
const mockLockedServer = (): ApiClient =>
  createApiClient({
    baseUrl: NAS.origin,
    fetch: allowlistedFetch({
      fetch: async (url, init = {}) => {
        const path = url.slice(NAS.origin.length)
        const method = init.method ?? APP_CALL_METHODS.get
        mockServer.heard = [...mockServer.heard, { method, path, body: init.body }]
        if (method === unlock.method && path === unlock.path) {
          if (pinOf(init.body) !== PIN) {
            return responseOf({ status: STATUSES.unauthorized, body: { message: WRONG_PIN } })
          }
          mockServer.lock = { available: true, unlocked: true }
          return responseOf({ status: STATUSES.ok, body: mockServer.lock })
        }
        if (method === lock.method && path === lock.path) {
          mockServer.lock = { available: true, unlocked: false }
          return responseOf({ status: STATUSES.ok, body: mockServer.lock })
        }
        if (path === getLock.path) return responseOf({ status: STATUSES.ok, body: mockServer.lock })
        if (path === pathFor({ path: getLibrary.path, id: FILMS.id })) {
          return responseOf({ status: STATUSES.ok, body: LOCKED_FILMS })
        }
        if (path === pathFor({ path: listInProgress.path, id: FILMS.id })) {
          return responseOf({ status: STATUSES.ok, body: [] })
        }
        return responseOf(NOT_FOUND)
      },
    }),
  })

const mockParams = jest.fn((): Record<string, string> => ({}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams(),
}))
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: (_props: ApiForProps) => mockLockedServer(),
  openEventsFor: () => () => ({ addEventListener: () => {}, close: () => {} }),
  cookieJar: { read: async () => ({}), forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

const LOCKED_MESSAGE = LOCKED_LIBRARY_COPY.isLocked(FILMS.name)

/** Presses the pad's keys for `digits`, one at a time. */
const typePin = async (digits: string) =>
  [...digits].reduce(async (typed, digit) => {
    await typed
    await fireEvent.press(screen.getByRole('button', { name: digit }))
  }, Promise.resolve())

/** The pad's own Unlock key, drawn after the page's Unlock button. */
const padUnlock = () => screen.getAllByRole('button', { name: PIN_PAD_COPY.unlock }).at(-1)!

const heardPaths = (): string[] => mockServer.heard.map(({ path }) => path)

describe('a locked library on a phone or tablet', () => {
  beforeEach(() => {
    mockServer.heard = []
    mockServer.lock = { available: true, unlocked: false }
    mockParams.mockReturnValue({ [APP_ROUTE_PARAMS.id]: String(FILMS.id) })
    useActiveServer.setState({ servers: [NAS], activeId: NAS.id })
  })

  it('stands in place of the videos, asking nothing until Unlock is pressed', async () => {
    const client = createScreenClient()
    await renderScreen({ ui: <Library />, client })
    expect(await screen.findByText(LOCKED_MESSAGE)).toBeTruthy()
    expect(screen.queryByText(PIN_PAD_COPY.title)).toBeNull()
    expect(heardPaths()).not.toContain(pathFor({ path: listInProgress.path, id: FILMS.id }))
    await untilIdle(client)
  })

  it('offers no Unlock where the PIN cannot be entered', async () => {
    mockServer.lock = { available: false, unlocked: false }
    const client = createScreenClient()
    await renderScreen({ ui: <Library />, client })
    expect(await screen.findByText(LOCKED_MESSAGE)).toBeTruthy()
    expect(screen.queryByRole('button', { name: LOCKED_LIBRARY_COPY.unlock })).toBeNull()
    await untilIdle(client)
  })

  it('types on the pad, takes back a digit, and shows the server refusing a wrong PIN', async () => {
    const client = createScreenClient()
    await renderScreen({ ui: <Library />, client })
    await fireEvent.press(await screen.findByRole('button', { name: LOCKED_LIBRARY_COPY.unlock }))
    expect(screen.getByText(PIN_PAD_COPY.empty)).toBeTruthy()
    await typePin('135')
    expect(screen.getByText(PIN_PAD_COPY.dot.repeat(3))).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: PIN_PAD_COPY.backspace }))
    expect(screen.getByText(PIN_PAD_COPY.dot.repeat(2))).toBeTruthy()
    await fireEvent.press(padUnlock())
    expect(await screen.findByText(WRONG_PIN)).toBeTruthy()
    expect(mockServer.heard.filter(({ path }) => path === unlock.path)).toEqual([
      { method: unlock.method, path: unlock.path, body: JSON.stringify({ pin: '13' }) },
    ])
    expect(screen.getByText(PIN_PAD_COPY.empty)).toBeTruthy()
    // A new press clears the refusal.
    await typePin('2')
    expect(screen.queryByText(WRONG_PIN)).toBeNull()
    expect(screen.getByText(LOCKED_MESSAGE)).toBeTruthy()
    await untilIdle(client)
  })

  it('opens the library once the PIN is right, reading everything again, and locks it again', async () => {
    const client = createScreenClient()
    await renderScreen({ ui: <Library />, client })
    await fireEvent.press(await screen.findByRole('button', { name: LOCKED_LIBRARY_COPY.unlock }))
    await typePin(PIN)
    mockServer.heard = []
    await fireEvent.press(padUnlock())
    await waitFor(() => expect(screen.queryByText(LOCKED_MESSAGE)).toBeNull())
    expect(screen.queryByText(PIN_PAD_COPY.title)).toBeNull()
    await waitFor(() =>
      expect(heardPaths()).toContain(pathFor({ path: getLibrary.path, id: FILMS.id })),
    )
    expect(heardPaths()).toContain(pathFor({ path: listInProgress.path, id: FILMS.id }))

    await fireEvent.press(
      await screen.findByRole('button', { name: LIBRARY_COPY.lockLibrary(FILMS.name) }),
    )
    expect(await screen.findByText(LOCKED_MESSAGE)).toBeTruthy()
    expect(heardPaths()).toContain(lock.path)
    await untilIdle(client)
  })

  it('closes the pad on Cancel, forgetting what was typed', async () => {
    const client = createScreenClient()
    await renderScreen({ ui: <Library />, client })
    await fireEvent.press(await screen.findByRole('button', { name: LOCKED_LIBRARY_COPY.unlock }))
    await typePin('12')
    await fireEvent.press(screen.getByRole('button', { name: PIN_PAD_COPY.cancel }))
    expect(screen.queryByText(PIN_PAD_COPY.title)).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: LOCKED_LIBRARY_COPY.unlock }))
    expect(screen.getByText(PIN_PAD_COPY.empty)).toBeTruthy()
    await untilIdle(client)
  })
})
