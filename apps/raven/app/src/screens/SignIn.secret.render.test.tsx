import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
  ADMIN_LOCK_STATES,
  type AdminLock,
  ApiError,
  DEFAULT_THEME,
  type Home,
  type LockState,
  type MediaTicket,
} from '@raven/core'
import type * as Native from '@raven/native'
import type * as NativeHeadless from '@raven/native/headless'
import { fireEvent, render, screen } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

import { useAccountSession } from '@/account/session'
import { APP_ROUTES } from '@/routes'
import { SignIn } from '@/screens/SignIn'
import { useActiveServer } from '@/stores/activeServer'
import { appThemeOf } from '@/theme/appTheme'
import { mediaItemFor } from '@/test/mediaItem'

const HOME: Home = { inProgress: [{ media: mediaItemFor({ id: 7 }), poster: null }], shelves: [] }

const mockDismissTo = jest.fn<(href: string) => void>()
const mockSignOut = jest.fn()
const unlock = jest.fn<(pin: string) => Promise<LockState>>()
const getHome = jest.fn<() => Promise<Home>>()
const getMediaTicket = jest.fn<(id: number) => Promise<MediaTicket>>()
const getAdminLock = jest.fn<() => Promise<AdminLock>>()
const unlockAdmin = jest.fn<(password: string) => Promise<AdminLock>>()
const mockApiFor = jest.fn((_server: unknown) => ({
  unlock,
  getAdminLock,
  unlockAdmin,
  getHome,
  getMediaTicket,
}))

jest.mock('expo-router', () => ({
  useRouter: () => ({ dismissTo: mockDismissTo }),
}))
// The accountless end to end build: the one build that still asks for the PIN, where it begins.
jest.mock('@raven/native/headless', () => ({
  ...jest.requireActual<typeof NativeHeadless>('@raven/native/headless'),
  IS_SIGN_IN_BYPASSED: true,
}))
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: (server: unknown) => mockApiFor(server),
  cookieJar: { forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

describe('SignIn secret steps in the accountless end to end build', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    useActiveServer.setState({ servers: [], activeId: null })
    useAccountSession.setState({ signOut: mockSignOut })
    getHome.mockResolvedValue(HOME)
    getMediaTicket.mockResolvedValue({ ticket: 't', expiresAt: 1 })
    getAdminLock.mockResolvedValue({ state: ADMIN_LOCK_STATES.off })
    unlock.mockResolvedValue({ available: true, unlocked: true })
  })

  const unlockWithPin = async () => {
    await render(<SignIn />)
    await fireEvent.changeText(await screen.findByLabelText('PIN'), '1234')
    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }))
  }

  it('unlocks with the PIN and goes Home', async () => {
    await unlockWithPin()
    expect(unlock).toHaveBeenCalledWith('1234')
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
  })

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
    await render(<SignIn />)
    await screen.findByLabelText('PIN')
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }))
    expect(getAdminLock).not.toHaveBeenCalled()
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
  })

  it('signs the account out and starts over from the account step', async () => {
    await render(<SignIn />)
    await screen.findByLabelText('PIN')
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }))
    expect(mockSignOut).toHaveBeenCalled()
    expect(await screen.findByLabelText('Email')).toBeTruthy()
  })

  it('fills only Unlock as the primary action; Not now is quiet and Sign out bare', async () => {
    await render(<SignIn />)
    await screen.findByLabelText('PIN')
    const fillOf = (name: string): unknown =>
      StyleSheet.flatten(screen.getByRole('button', { name }).props.style)?.backgroundColor ?? null
    const { palette } = appThemeOf(DEFAULT_THEME)
    expect(fillOf('Unlock')).toBe(palette.accent)
    expect(fillOf('Not now')).toBe(palette.quiet)
    expect(fillOf('Sign out')).toBe('transparent')
  })

  it("shows the server's words for a wrong PIN", async () => {
    unlock.mockRejectedValue(new ApiError({ status: 401, message: 'That PIN is not right.' }))
    await render(<SignIn />)
    await fireEvent.changeText(await screen.findByLabelText('PIN'), '0000')
    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByText('That PIN is not right.')).toBeTruthy()
    expect(mockDismissTo).not.toHaveBeenCalled()
  })
})
