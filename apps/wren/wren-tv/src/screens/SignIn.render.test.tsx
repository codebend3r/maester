import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { AUTH_OUTCOMES, type AuthOutcome, RAVEN_SERVER } from '@raven/native/headless'
import { SIGN_IN_COPY, STATUS_COPY } from '@raven/wren'
import { fireEvent, render, screen } from '@testing-library/react-native'
import { useWrenAccount, useActiveServer } from '@raven/wren-native'
import { WREN_ROUTES } from '@raven/wren-native/headless'

import { SignIn } from '@/screens/SignIn'
import type * as NativeMock from '@/test/nativeMock'

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
const mockApi = { getHome: async () => ({ inProgress: [], shelves: [] }) }

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}))
jest.mock('@raven/native', () =>
  jest
    .requireActual<typeof NativeMock>('@/test/nativeMock')
    .nativeModuleMock({ apiOf: () => mockApi }),
)

type SignInWithProps = { email: string; password: string }

const signInWith = async ({ email, password }: SignInWithProps) => {
  await fireEvent.changeText(screen.getByLabelText(SIGN_IN_COPY.email), email)
  await fireEvent.changeText(screen.getByLabelText(SIGN_IN_COPY.password), password)
  await fireEvent.press(screen.getByRole('button', { name: SIGN_IN_COPY.signIn }))
}

describe('SignIn', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    useActiveServer.setState({ servers: [], activeId: RAVEN_SERVER.id })
    useWrenAccount.setState({ session: null, signIn: mockSignIn })
    mockSignIn.mockResolvedValue({ kind: AUTH_OUTCOMES.ok, session: SESSION })
  })

  it("signs in with the account's email and password, then opens the tabs on raven", async () => {
    await render(<SignIn />)
    expect(screen.getByRole('header', { name: SIGN_IN_COPY.welcome })).toBeTruthy()
    expect(screen.getByText(STATUS_COPY.connected(RAVEN_SERVER.name))).toBeTruthy()
    await signInWith({ email: ' listener@example.com ', password: 'hunter2' })

    expect(mockSignIn).toHaveBeenCalledWith({ email: SESSION.email, password: 'hunter2' })
    expect(mockReplace).toHaveBeenCalledWith(WREN_ROUTES.home)
  })

  it("signs in from the keyboard's Go on the password, with what was typed", async () => {
    await render(<SignIn />)
    await fireEvent.changeText(screen.getByLabelText(SIGN_IN_COPY.email), SESSION.email)
    await fireEvent(screen.getByLabelText(SIGN_IN_COPY.password), 'submitEditing', {
      nativeEvent: { text: 'hunter2' },
    })
    expect(mockSignIn).toHaveBeenCalledWith({ email: SESSION.email, password: 'hunter2' })
  })

  it('marks each empty field and says why above the button, before calling anyone', async () => {
    await render(<SignIn />)
    await fireEvent.press(screen.getByRole('button', { name: SIGN_IN_COPY.signIn }))
    expect(await screen.findByText(SIGN_IN_COPY.badAccount)).toBeTruthy()
    expect(screen.getByText(SIGN_IN_COPY.enterEmail)).toBeTruthy()
    expect(screen.getByText(SIGN_IN_COPY.enterPassword)).toBeTruthy()
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('says a wrong email or password', async () => {
    mockSignIn.mockResolvedValue({
      kind: AUTH_OUTCOMES.refused,
      message: 'Invalid login credentials',
      code: 'invalid_credentials',
    })
    await render(<SignIn />)
    await signInWith({ email: SESSION.email, password: 'wrong' })
    expect(await screen.findByText(SIGN_IN_COPY.wrongAccount)).toBeTruthy()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it("says so when raven can't be reached, and marks the server down", async () => {
    mockSignIn.mockResolvedValue({ kind: AUTH_OUTCOMES.unreachable })
    await render(<SignIn />)
    await signInWith({ email: SESSION.email, password: 'hunter2' })
    expect(await screen.findByText(SIGN_IN_COPY.unreachable)).toBeTruthy()
    expect(screen.getByText(STATUS_COPY.unreachable(RAVEN_SERVER.name))).toBeTruthy()
  })
})
