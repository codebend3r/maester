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
import type * as Native from '@raven/native'
import { AUTH_OUTCOMES, type AuthOutcome, RAVEN_SERVER } from '@raven/native/headless'
import { fireEvent, render, screen } from '@testing-library/react-native'

import { useAccountSession } from '@/account/session'
import { APP_ROUTES } from '@/routes'
import { SIGN_IN_COPY } from '@/screens/copy'
import { SignIn } from '@/screens/SignIn'
import { useActiveServer } from '@/stores/activeServer'
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
type MockSignInCallbackProps = { email: string; password: string }

const mockSignIn = jest.fn<(input: MockSignInCallbackProps) => Promise<AuthOutcome>>()
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

type SignInWithProps = { email: string; password: string }

const signInWith = async ({ email, password }: SignInWithProps) => {
  await fireEvent.changeText(screen.getByLabelText('Email'), email)
  await fireEvent.changeText(screen.getByLabelText('Password'), password)
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }))
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

  it('never asks for the PIN, even when the server keeps libraries behind one', async () => {
    getLock.mockResolvedValue({ available: true, unlocked: false })
    await render(<SignIn />)
    await signInAsViewer()

    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
    expect(screen.queryByLabelText('PIN')).toBeNull()
    expect(unlock).not.toHaveBeenCalled()
    expect(getAdminLock).not.toHaveBeenCalled()
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
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }))
    expect(mockSignIn).toHaveBeenCalledTimes(1)
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

  it("shows the spec's words when the server hands out no tickets, then goes Home", async () => {
    getMediaTicket.mockRejectedValue(new ApiError({ status: 503, message: 'no secret' }))
    await render(<SignIn />)
    await signInAsViewer()

    expect(await screen.findByText(SIGN_IN_COPY.ticketsOff)).toBeTruthy()
    expect(SIGN_IN_COPY.ticketsOff).toBe(
      "This server can't hand out media tickets. Set RAVEN_MEDIA_SECRET on it to play in the app",
    )
    expect(mockDismissTo).not.toHaveBeenCalled()
    expect(useActiveServer.getState().activeId).toBe(RAVEN_SERVER.id)

    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    expect(mockDismissTo).toHaveBeenCalledWith(APP_ROUTES.home)
  })
})
