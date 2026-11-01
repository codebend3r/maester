import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { ADMIN_LOCK_STATES, type AdminLock, ApiError, type Home, type LockState } from '@raven/core'
import type * as Native from '@raven/native'
import type * as NativeHeadless from '@raven/native/headless'
import { fireEvent, render, screen } from '@testing-library/react-native'

import { WREN_ROUTES } from '@/routes'
import { SignIn } from '@/screens/SignIn'
import { useWrenAccount } from '@/session'
import { useActiveServer } from '@/stores/activeServer'

const HOME: Home = { inProgress: [], shelves: [] }
const SESSION = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: 1,
  userId: 'u1',
  email: 'listener@example.com',
}

const mockReplace = jest.fn<(href: string) => void>()
const unlock = jest.fn<(pin: string) => Promise<LockState>>()
const getAdminLock = jest.fn<() => Promise<AdminLock>>()
const unlockAdmin = jest.fn<(password: string) => Promise<AdminLock>>()
const getHome = jest.fn<() => Promise<Home>>()
const mockApi = { unlock, getAdminLock, unlockAdmin, getHome }

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}))
// The accountless end to end build: the one build that still asks for the PIN, where it begins.
jest.mock('@raven/native/headless', () => ({
  ...jest.requireActual<typeof NativeHeadless>('@raven/native/headless'),
  IS_SIGN_IN_BYPASSED: true,
}))
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: () => mockApi,
  cookieJar: { forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

const reachPin = async () => {
  await render(<SignIn />)
  return screen.findByLabelText('PIN')
}

describe('SignIn secret steps in the accountless end to end build', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    useActiveServer.setState({ servers: [], activeId: null })
    useWrenAccount.setState({ session: null })
    getAdminLock.mockResolvedValue({ state: ADMIN_LOCK_STATES.off })
    getHome.mockResolvedValue(HOME)
  })

  it('asks for the PIN, then opens the tabs', async () => {
    unlock.mockResolvedValue({ available: true, unlocked: true })
    await fireEvent.changeText(await reachPin(), '1357')
    expect(mockReplace).not.toHaveBeenCalled()
    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }))

    expect(unlock).toHaveBeenCalledWith('1357')
    expect(mockReplace).toHaveBeenCalledWith(WREN_ROUTES.home)
  })

  it("shows the server's words for a wrong PIN", async () => {
    unlock.mockRejectedValue(new ApiError({ status: 401, message: 'That PIN is not right.' }))
    await fireEvent.changeText(await reachPin(), '0000')
    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByText('That PIN is not right.')).toBeTruthy()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('asks for the admin password after the PIN while the admin lock holds', async () => {
    unlock.mockResolvedValue({ available: true, unlocked: true })
    getAdminLock.mockResolvedValue({ state: ADMIN_LOCK_STATES.on, available: true })
    unlockAdmin.mockResolvedValue({ state: ADMIN_LOCK_STATES.off })
    await fireEvent.changeText(await reachPin(), '1357')
    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }))

    await fireEvent.changeText(await screen.findByLabelText('Admin password'), 'Pass#word2026')
    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }))

    expect(unlockAdmin).toHaveBeenCalledWith('Pass#word2026')
    expect(mockReplace).toHaveBeenCalledWith(WREN_ROUTES.home)
  })

  it('goes on without the PIN on Not now', async () => {
    await reachPin()
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }))
    expect(unlock).not.toHaveBeenCalled()
    expect(mockReplace).toHaveBeenCalledWith(WREN_ROUTES.home)
  })

  it('signs the account out from the PIN step and starts over', async () => {
    await reachPin()
    useWrenAccount.setState({ session: SESSION })
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }))
    expect(useWrenAccount.getState().session).toBeNull()
    expect(await screen.findByLabelText('Email')).toBeTruthy()
  })
})
