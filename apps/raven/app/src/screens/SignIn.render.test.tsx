import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
  ADMIN_LOCK_STATES,
  type AdminLock,
  ApiError,
  type Home,
  type LockState,
  type MediaTicket,
  SERVERS_CAP,
} from '@raven/core'
import { fireEvent, render, screen } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

import { APP_ROUTES } from '@/routes'
import { SignIn, TICKETS_OFF } from '@/screens/SignIn'
import { useActiveServer } from '@/stores/activeServer'
import { COLOURS } from '@/theme/appTheme'
import { mediaItemFor } from '@/test/mediaItem'
import { NATIVE_EVENTS } from '@/test/nativeEvents'

const MOCK_SERVER_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const HOME: Home = { inProgress: [{ media: mediaItemFor({ id: 7 }), poster: null }], shelves: [] }

const mockDismissTo = jest.fn<(href: string) => void>()
const getLock = jest.fn<() => Promise<LockState>>()
const unlock = jest.fn<(pin: string) => Promise<LockState>>()
const getHome = jest.fn<() => Promise<Home>>()
const getMediaTicket = jest.fn<(id: number) => Promise<MediaTicket>>()
const getAdminLock = jest.fn<() => Promise<AdminLock>>()
const unlockAdmin = jest.fn<(password: string) => Promise<AdminLock>>()
const mockApiFor = jest.fn((_server: unknown) => ({
  getLock,
  unlock,
  getAdminLock,
  unlockAdmin,
  getHome,
  getMediaTicket,
}))
const mockNewServerId = jest.fn(() => MOCK_SERVER_ID)
const mockForget = jest.fn(async (_serverId: string) => {})

const mockBack = jest.fn()
const mockCanGoBack = jest.fn(() => false)

jest.mock('expo-router', () => ({
  useRouter: () => ({ dismissTo: mockDismissTo, back: mockBack, canGoBack: mockCanGoBack }),
}))
jest.mock('@/servers/serverClient', () => ({
  apiFor: (server: unknown) => mockApiFor(server),
  newServerId: () => mockNewServerId(),
  cookieJar: { forget: (serverId: string) => mockForget(serverId) },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

const enterAddress = async (address: string) => {
  await fireEvent.changeText(screen.getByLabelText('Server address'), address)
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
}

describe('SignIn', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    useActiveServer.setState({ servers: [], activeId: null })
    getHome.mockResolvedValue(HOME)
    getMediaTicket.mockResolvedValue({ ticket: 't', expiresAt: 1 })
    getAdminLock.mockResolvedValue({ state: ADMIN_LOCK_STATES.off })
    mockNewServerId.mockImplementation(() => MOCK_SERVER_ID)
    mockCanGoBack.mockReturnValue(false)
  })

  it('offers no way back on the first launch, where there is nothing to go back to', async () => {
    await render(<SignIn />)
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  it('goes back to Settings on Cancel when a server is added from there', async () => {
    mockCanGoBack.mockReturnValue(true)
    await render(<SignIn />)
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }))
    expect(mockBack).toHaveBeenCalled()
    expect(mockDismissTo).not.toHaveBeenCalled()
  })

  const unlockWithPin = async () => {
    getLock.mockResolvedValue({ available: true, unlocked: false })
    unlock.mockResolvedValue({ available: true, unlocked: true })
    await render(<SignIn />)
    await enterAddress('http://nas:8080')
    await fireEvent.changeText(await screen.findByLabelText('PIN'), '1234')
    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }))
  }

  it('asks for the admin password after the PIN when the admin lock holds, then goes Home', async () => {
    getAdminLock.mockResolvedValue({ state: ADMIN_LOCK_STATES.on, available: true })
    unlockAdmin.mockResolvedValue({ state: ADMIN_LOCK_STATES.off })
    await unlockWithPin()

    await fireEvent.changeText(await screen.findByLabelText('Admin password'), 'Pass#word2026')
    expect(mockDismissTo).not.toHaveBeenCalled()
    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }))

    expect(unlockAdmin).toHaveBeenCalledWith('Pass#word2026')
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
  })

  it('goes on without the admin password on Not now', async () => {
    getAdminLock.mockResolvedValue({ state: ADMIN_LOCK_STATES.on, available: true })
    await unlockWithPin()
    await screen.findByLabelText('Admin password')
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }))
    expect(unlockAdmin).not.toHaveBeenCalled()
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
  })

  it("shows the server's words for a wrong admin password", async () => {
    getAdminLock.mockResolvedValue({ state: ADMIN_LOCK_STATES.on, available: true })
    unlockAdmin.mockRejectedValue(
      new ApiError({ status: 401, message: 'That password is not right.' }),
    )
    await unlockWithPin()
    await fireEvent.changeText(await screen.findByLabelText('Admin password'), 'wrong')
    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByText('That password is not right.')).toBeTruthy()
    expect(mockDismissTo).not.toHaveBeenCalled()
  })

  it.each([
    ['off', { state: ADMIN_LOCK_STATES.off }],
    ['on with no password set', { state: ADMIN_LOCK_STATES.on, available: false }],
  ])('asks for no admin password when the admin lock is %s', async (_name, lock: AdminLock) => {
    getAdminLock.mockResolvedValue(lock)
    await unlockWithPin()
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
    expect(screen.queryByLabelText('Admin password')).toBeNull()
  })

  it('reads the admin lock only after a PIN, never on Not now', async () => {
    getLock.mockResolvedValue({ available: true, unlocked: false })
    await render(<SignIn />)
    await enterAddress('http://nas:8080')
    await screen.findByLabelText('PIN')
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }))
    expect(getAdminLock).not.toHaveBeenCalled()
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
  })

  it("forgets a new server's cookies when the viewer starts over", async () => {
    getLock.mockResolvedValue({ available: true, unlocked: false })
    await render(<SignIn />)
    await enterAddress('http://nas:8080')
    await screen.findByLabelText('PIN')
    await fireEvent.press(screen.getByRole('button', { name: 'Use another address' }))
    expect(mockForget).toHaveBeenCalledWith(MOCK_SERVER_ID)
    expect(await screen.findByLabelText('Server address')).toBeTruthy()
  })

  it('submits the address once while a submit is still running', async () => {
    getLock.mockReturnValue(new Promise(() => {}))
    await render(<SignIn />)
    const field = screen.getByLabelText('Server address')
    await fireEvent.changeText(field, 'http://nas:8080')
    await fireEvent(field, NATIVE_EVENTS.submitEditing, {
      nativeEvent: { text: 'http://nas:8080' },
    })
    await fireEvent(field, NATIVE_EVENTS.submitEditing, {
      nativeEvent: { text: 'http://nas:8080' },
    })
    expect(getLock).toHaveBeenCalledTimes(1)
  })

  it('fills only Unlock as the primary action; Not now is quiet and another address bare', async () => {
    getLock.mockResolvedValue({ available: true, unlocked: false })
    await render(<SignIn />)
    await enterAddress('http://nas:8080')
    await screen.findByLabelText('PIN')
    const fillOf = (name: string): unknown =>
      StyleSheet.flatten(screen.getByRole('button', { name }).props.style)?.backgroundColor ?? null
    expect(fillOf('Unlock')).toBe(COLOURS.accent)
    expect(fillOf('Not now')).toBe(COLOURS.quiet)
    expect(fillOf('Use another address')).toBe('transparent')
  })

  it('says so when the server cannot be added, and stays', async () => {
    getLock.mockResolvedValue({ available: false, unlocked: false })
    mockNewServerId.mockImplementation(() => 'not-a-uuid')
    await render(<SignIn />)
    await enterAddress('http://nas:8080')
    expect(await screen.findByText(/couldn't be added/)).toBeTruthy()
    expect(mockDismissTo).not.toHaveBeenCalled()
  })

  it('says so when the device keeps as many servers as it can, and stays', async () => {
    getLock.mockResolvedValue({ available: false, unlocked: false })
    const full = Array.from({ length: SERVERS_CAP }, (_, n) => ({
      id: `7c9e6679-7425-40de-944b-${String(n).padStart(12, '0')}`,
      name: `nas${n}`,
      origin: `http://nas${n}:8080`,
      addedAt: n,
    }))
    useActiveServer.setState({ servers: full, activeId: null })
    await render(<SignIn />)
    await enterAddress('http://nas:8080')
    expect(await screen.findByText(/as many servers as it can/)).toBeTruthy()
    expect(useActiveServer.getState().servers).toHaveLength(SERVERS_CAP)
    expect(mockDismissTo).not.toHaveBeenCalled()
  })

  it('shows an error rather than failing when no id can be made', async () => {
    mockNewServerId.mockImplementation(() => {
      throw new Error('no randomness')
    })
    await render(<SignIn />)
    await enterAddress('http://nas:8080')
    expect(await screen.findByText(/Couldn't reach a raven server/)).toBeTruthy()
  })

  it('unlocks with the PIN and goes Home on the new server', async () => {
    getLock.mockResolvedValue({ available: true, unlocked: false })
    unlock.mockResolvedValue({ available: true, unlocked: true })
    await render(<SignIn />)

    await enterAddress('HTTP://nas:8080/')
    await fireEvent.changeText(await screen.findByLabelText('PIN'), '1234')
    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }))

    expect(unlock).toHaveBeenCalledWith('1234')
    expect(getMediaTicket).toHaveBeenCalledWith(7)
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
    expect(useActiveServer.getState()).toMatchObject({
      servers: [{ id: MOCK_SERVER_ID, name: 'nas:8080', origin: 'http://nas:8080' }],
      activeId: MOCK_SERVER_ID,
    })
  })

  it('asks for no PIN when the server has none', async () => {
    getLock.mockResolvedValue({ available: false, unlocked: false })
    await render(<SignIn />)
    await enterAddress('http://nas:8080')
    expect(unlock).not.toHaveBeenCalled()
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
  })

  it("shows the spec's words when the server hands out no tickets, then goes Home", async () => {
    getLock.mockResolvedValue({ available: false, unlocked: false })
    getMediaTicket.mockRejectedValue(new ApiError({ status: 503, message: 'no secret' }))
    await render(<SignIn />)

    await enterAddress('http://nas:8080')
    expect(await screen.findByText(TICKETS_OFF)).toBeTruthy()
    expect(TICKETS_OFF).toBe(
      "This server can't hand out media tickets. Set RAVEN_MEDIA_SECRET on it to play in the app",
    )
    expect(mockDismissTo).not.toHaveBeenCalled()
    expect(useActiveServer.getState().activeId).toBe(MOCK_SERVER_ID)

    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
  })

  it('refuses an address that is not a bare origin, without calling it', async () => {
    await render(<SignIn />)
    await enterAddress('http://nas:8080/library')
    expect(await screen.findByText(/like http:\/\/192\.168\.1\.20:8484/)).toBeTruthy()
    expect(mockApiFor).not.toHaveBeenCalled()
  })

  it("says so when the address doesn't answer", async () => {
    getLock.mockRejectedValue(new TypeError('Network request failed'))
    await render(<SignIn />)
    await enterAddress('http://nas:8080')
    expect(await screen.findByText(/Couldn't reach a raven server/)).toBeTruthy()
    expect(useActiveServer.getState().servers).toEqual([])
  })

  it("shows the server's words for a wrong PIN", async () => {
    getLock.mockResolvedValue({ available: true, unlocked: false })
    unlock.mockRejectedValue(new ApiError({ status: 401, message: 'That PIN is not right.' }))
    await render(<SignIn />)

    await enterAddress('http://nas:8080')
    await fireEvent.changeText(await screen.findByLabelText('PIN'), '0000')
    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByText('That PIN is not right.')).toBeTruthy()
    expect(mockDismissTo).not.toHaveBeenCalled()
  })

  it('signs in again to a server already on the list, under its own id', async () => {
    const known = {
      id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      name: 'nas',
      origin: 'http://nas:8080',
      addedAt: 1,
    }
    useActiveServer.setState({ servers: [known], activeId: null })
    getLock.mockResolvedValue({ available: true, unlocked: true })
    await render(<SignIn />)

    await enterAddress('http://nas:8080')
    expect(mockApiFor).toHaveBeenCalledWith(known)
    expect(useActiveServer.getState()).toMatchObject({ servers: [known], activeId: known.id })
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
  })
})
