import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { ADMIN_LOCK_STATES, type AdminLock, ApiError, type Home, type LockState } from '@raven/core'
import type * as Native from '@raven/native'
import { AUTH_OUTCOMES, type AuthOutcome, RAVEN_SERVER } from '@raven/native/headless'
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

type MockSignInProps = { email: string; password: string }

const mockReplace = jest.fn<(href: string) => void>()
const mockSignIn = jest.fn<(input: MockSignInProps) => Promise<AuthOutcome>>()
const getLock = jest.fn<() => Promise<LockState>>()
const unlock = jest.fn<(pin: string) => Promise<LockState>>()
const getAdminLock = jest.fn<() => Promise<AdminLock>>()
const unlockAdmin = jest.fn<(password: string) => Promise<AdminLock>>()
const getHome = jest.fn<() => Promise<Home>>()
const mockApi = { getLock, unlock, getAdminLock, unlockAdmin, getHome }

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
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

type SignInWithProps = { email: string; password: string }

const signInWith = async ({ email, password }: SignInWithProps) => {
  await fireEvent.changeText(screen.getByLabelText('Email'), email)
  await fireEvent.changeText(screen.getByLabelText('Password'), password)
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }))
}

const signInAsListener = () => signInWith({ email: SESSION.email, password: 'hunter2' })

const reachPin = async () => {
  getLock.mockResolvedValue({ available: true, unlocked: false })
  await render(<SignIn />)
  await signInAsListener()
  return screen.findByLabelText('PIN')
}

describe('SignIn', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    useActiveServer.setState({ servers: [], activeId: null })
    useWrenAccount.setState({ session: null, signIn: mockSignIn })
    mockSignIn.mockResolvedValue({ kind: AUTH_OUTCOMES.ok, session: SESSION })
    getLock.mockResolvedValue({ available: false, unlocked: false })
    getAdminLock.mockResolvedValue({ state: ADMIN_LOCK_STATES.off })
    getHome.mockResolvedValue(HOME)
  })

  it("signs in with the account's email and password, then opens the tabs on raven", async () => {
    await render(<SignIn />)
    await signInWith({ email: ' listener@example.com ', password: 'hunter2' })

    expect(mockSignIn).toHaveBeenCalledWith({ email: SESSION.email, password: 'hunter2' })
    expect(unlock).not.toHaveBeenCalled()
    expect(mockReplace).toHaveBeenCalledWith(WREN_ROUTES.home)
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

  it("shows the account service's words for wrong credentials", async () => {
    mockSignIn.mockResolvedValue({ kind: AUTH_OUTCOMES.refused, message: 'Wrong password.' })
    await render(<SignIn />)
    await signInAsListener()
    expect(await screen.findByText('Wrong password.')).toBeTruthy()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it("says so when raven can't be reached", async () => {
    mockSignIn.mockResolvedValue({ kind: AUTH_OUTCOMES.unreachable })
    await render(<SignIn />)
    await signInAsListener()
    expect(await screen.findByText(/Couldn't reach raven/)).toBeTruthy()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('asks a locked server for its PIN, then opens the tabs', async () => {
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
