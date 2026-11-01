import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { ADMIN_LOCK_STATES, type AdminLock, type Home, type LockState } from '@raven/core'
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

  it('never asks for the PIN, even when the server keeps libraries behind one', async () => {
    getLock.mockResolvedValue({ available: true, unlocked: false })
    await render(<SignIn />)
    await signInAsListener()

    expect(mockReplace).toHaveBeenCalledWith(WREN_ROUTES.home)
    expect(screen.queryByLabelText('PIN')).toBeNull()
    expect(unlock).not.toHaveBeenCalled()
    expect(getAdminLock).not.toHaveBeenCalled()
  })
})
