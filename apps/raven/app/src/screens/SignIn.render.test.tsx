import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
  ADMIN_LOCK_STATES,
  type AdminLock,
  ApiError,
  DEFAULT_THEME,
  type Home,
  type LockState,
  type MediaTicket,
  SERVERS_CAP,
} from '@raven/core'
import { fireEvent, render, screen } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

import { useAccountSession } from '@/account/accountSession'
import { AUTH_OUTCOMES, type AuthOutcome } from '@/account/supabaseAuth'
import { RAVEN_SERVER } from '@/servers/ravenServer'
import { APP_ROUTES } from '@/routes'
import { SignIn, TICKETS_OFF } from '@/screens/SignIn'
import { useActiveServer } from '@/stores/activeServer'
import { appThemeOf } from '@/theme/appTheme'
import { mediaItemFor } from '@/test/mediaItem'

const HOME: Home = { inProgress: [{ media: mediaItemFor({ id: 7 }), poster: null }], shelves: [] }
const SESSION = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: 1,
  userId: 'u1',
  email: 'viewer@example.com',
}

const mockDismissTo = jest.fn<(href: string) => void>()
const mockSignIn = jest.fn<(input: { email: string; password: string }) => Promise<AuthOutcome>>()
const mockSignOut = jest.fn()
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

jest.mock('expo-router', () => ({
  useRouter: () => ({ dismissTo: mockDismissTo }),
}))
jest.mock('@/servers/serverClient', () => ({
  apiFor: (server: unknown) => mockApiFor(server),
  cookieJar: { forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

const signInWith = async ({ email, password }: { email: string; password: string }) => {
  await fireEvent.changeText(screen.getByLabelText('Email'), email)
  await fireEvent.changeText(screen.getByLabelText('Password'), password)
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
}

const signInAsViewer = () => signInWith({ email: SESSION.email, password: 'hunter2' })

describe('SignIn', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    useActiveServer.setState({ servers: [], activeId: null })
    useAccountSession.setState({ signIn: mockSignIn, signOut: mockSignOut })
    mockSignIn.mockResolvedValue({ kind: AUTH_OUTCOMES.ok, session: SESSION })
    getLock.mockResolvedValue({ available: false, unlocked: false })
    getHome.mockResolvedValue(HOME)
    getMediaTicket.mockResolvedValue({ ticket: 't', expiresAt: 1 })
    getAdminLock.mockResolvedValue({ state: ADMIN_LOCK_STATES.off })
  })

  const unlockWithPin = async () => {
    getLock.mockResolvedValue({ available: true, unlocked: false })
    unlock.mockResolvedValue({ available: true, unlocked: true })
    await render(<SignIn />)
    await signInAsViewer()
    await fireEvent.changeText(await screen.findByLabelText('PIN'), '1234')
    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }))
  }

  it("signs in with the account's email and password, then goes Home on the one server", async () => {
    await render(<SignIn />)
    await signInWith({ email: ' viewer@example.com ', password: 'hunter2' })

    expect(mockSignIn).toHaveBeenCalledWith({ email: 'viewer@example.com', password: 'hunter2' })
    expect(unlock).not.toHaveBeenCalled()
    expect(getMediaTicket).toHaveBeenCalledWith(7)
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
    expect(useActiveServer.getState()).toMatchObject({
      servers: [{ id: RAVEN_SERVER.id }],
      activeId: RAVEN_SERVER.id,
    })
  })

  it('asks for both an email and a password before calling anyone', async () => {
    await render(<SignIn />)
    await signInWith({ email: '', password: 'hunter2' })
    expect(await screen.findByText('Enter your email and password.')).toBeTruthy()
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it("shows the account service's words when it refuses", async () => {
    mockSignIn.mockResolvedValue({ kind: AUTH_OUTCOMES.refused, message: 'Wrong password.' })
    await render(<SignIn />)
    await signInAsViewer()
    expect(await screen.findByText('Wrong password.')).toBeTruthy()
    expect(mockDismissTo).not.toHaveBeenCalled()
  })

  it("says so when raven can't be reached", async () => {
    mockSignIn.mockResolvedValue({ kind: AUTH_OUTCOMES.unreachable })
    await render(<SignIn />)
    await signInAsViewer()
    expect(await screen.findByText(/Couldn't reach raven/)).toBeTruthy()
    expect(mockDismissTo).not.toHaveBeenCalled()
  })

  it('submits once while a submit is still running', async () => {
    mockSignIn.mockReturnValue(new Promise(() => {}))
    await render(<SignIn />)
    await signInAsViewer()
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    expect(mockSignIn).toHaveBeenCalledTimes(1)
  })

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
    getLock.mockResolvedValue({ available: true, unlocked: false })
    await render(<SignIn />)
    await signInAsViewer()
    await screen.findByLabelText('PIN')
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }))
    expect(getAdminLock).not.toHaveBeenCalled()
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
  })

  it('signs the account out and starts over from the PIN step', async () => {
    getLock.mockResolvedValue({ available: true, unlocked: false })
    await render(<SignIn />)
    await signInAsViewer()
    await screen.findByLabelText('PIN')
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }))
    expect(mockSignOut).toHaveBeenCalled()
    expect(await screen.findByLabelText('Email')).toBeTruthy()
  })

  it('fills only Unlock as the primary action; Not now is quiet and Sign out bare', async () => {
    getLock.mockResolvedValue({ available: true, unlocked: false })
    await render(<SignIn />)
    await signInAsViewer()
    await screen.findByLabelText('PIN')
    const fillOf = (name: string): unknown =>
      StyleSheet.flatten(screen.getByRole('button', { name }).props.style)?.backgroundColor ?? null
    const { palette } = appThemeOf(DEFAULT_THEME)
    expect(fillOf('Unlock')).toBe(palette.accent)
    expect(fillOf('Not now')).toBe(palette.quiet)
    expect(fillOf('Sign out')).toBe('transparent')
  })

  it('says so when the device keeps as many servers as it can, and stays', async () => {
    const full = Array.from({ length: SERVERS_CAP }, (_, n) => ({
      id: `7c9e6679-7425-40de-944b-${String(n).padStart(12, '0')}`,
      name: `nas${n}`,
      origin: `http://nas${n}:8080`,
      addedAt: n,
    }))
    useActiveServer.setState({ servers: full, activeId: null })
    await render(<SignIn />)
    await signInAsViewer()
    expect(await screen.findByText(/as many servers as it can/)).toBeTruthy()
    expect(mockDismissTo).not.toHaveBeenCalled()
  })

  it("shows the server's words for a wrong PIN", async () => {
    getLock.mockResolvedValue({ available: true, unlocked: false })
    unlock.mockRejectedValue(new ApiError({ status: 401, message: 'That PIN is not right.' }))
    await render(<SignIn />)
    await signInAsViewer()
    await fireEvent.changeText(await screen.findByLabelText('PIN'), '0000')
    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByText('That PIN is not right.')).toBeTruthy()
    expect(mockDismissTo).not.toHaveBeenCalled()
  })

  it("shows the spec's words when the server hands out no tickets, then goes Home", async () => {
    getMediaTicket.mockRejectedValue(new ApiError({ status: 503, message: 'no secret' }))
    await render(<SignIn />)
    await signInAsViewer()

    expect(await screen.findByText(TICKETS_OFF)).toBeTruthy()
    expect(TICKETS_OFF).toBe(
      "This server can't hand out media tickets. Set RAVEN_MEDIA_SECRET on it to play in the app",
    )
    expect(mockDismissTo).not.toHaveBeenCalled()
    expect(useActiveServer.getState().activeId).toBe(RAVEN_SERVER.id)

    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
  })
})
