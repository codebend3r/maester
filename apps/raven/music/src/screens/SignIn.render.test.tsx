import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { Home } from '@raven/core'
import type * as Native from '@raven/native'
import { AUTH_OUTCOMES, type AuthOutcome, RAVEN_SERVER } from '@raven/native/headless'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { Dimensions } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { SIGN_IN_COPY, STATUS_COPY } from '@raven/wren'
import { WREN_ROUTES } from '@/routes'
import { SignIn } from '@/screens/SignIn'
import { useWrenAccount } from '@/session'
import { useActiveServer } from '@/stores/activeServer'
import { PHONE_WINDOW } from '@/test/jestSetup'

const HOME: Home = { inProgress: [], shelves: [] }
const SESSION = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: 1,
  userId: 'u1',
  email: 'listener@example.com',
}

// An 11 inch iPad's window, held sideways.
const TABLET_WINDOW = { width: 1194, height: 834, scale: 2, fontScale: 1 } as const

// The router gives the app its safe area; a screen rendered alone is handed one with no notch.
const SAFE_METRICS = {
  frame: { x: 0, y: 0, width: PHONE_WINDOW.width, height: PHONE_WINDOW.height },
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
} as const

type SafeAreaProps = { children: ReactNode }

const SafeArea = ({ children }: SafeAreaProps) => (
  <SafeAreaProvider initialMetrics={SAFE_METRICS}>{children}</SafeAreaProvider>
)

const renderSignIn = () => render(<SignIn />, { wrapper: SafeArea })

type MockSignInProps = { email: string; password: string }

const mockReplace = jest.fn<(href: string) => void>()
const mockSignIn = jest.fn<(input: MockSignInProps) => Promise<AuthOutcome>>()
const getHome = jest.fn<() => Promise<Home>>()
const mockApi = { getHome }

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
  await fireEvent.changeText(screen.getByLabelText(SIGN_IN_COPY.email), email)
  await fireEvent.changeText(screen.getByLabelText(SIGN_IN_COPY.password), password)
  await fireEvent.press(screen.getByRole('button', { name: SIGN_IN_COPY.signIn }))
}

const signInAsListener = () => signInWith({ email: SESSION.email, password: 'hunter2' })

type WindowOf = typeof PHONE_WINDOW | typeof TABLET_WINDOW

const holdAs = (window: WindowOf) => act(() => Dimensions.set({ window, screen: window }))

describe('SignIn', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    useActiveServer.setState({ servers: [], activeId: null })
    useWrenAccount.setState({ session: null, signIn: mockSignIn })
    mockSignIn.mockResolvedValue({ kind: AUTH_OUTCOMES.ok, session: SESSION })
    getHome.mockResolvedValue(HOME)
  })

  afterEach(() => holdAs(PHONE_WINDOW))

  it("signs in with the account's email and password, then opens the tabs on raven", async () => {
    await renderSignIn()
    expect(screen.getByRole('header', { name: SIGN_IN_COPY.welcome })).toBeTruthy()
    expect(screen.getByText(STATUS_COPY.connected(RAVEN_SERVER.name))).toBeTruthy()
    expect(screen.getByText(SIGN_IN_COPY.family)).toBeTruthy()
    await signInWith({ email: ' listener@example.com ', password: 'hunter2' })

    expect(mockSignIn).toHaveBeenCalledWith({ email: SESSION.email, password: 'hunter2' })
    expect(mockReplace).toHaveBeenCalledWith(WREN_ROUTES.home)
    expect(useActiveServer.getState()).toMatchObject({
      servers: [{ id: RAVEN_SERVER.id }],
      activeId: RAVEN_SERVER.id,
    })
  })

  it("signs in from the password's return key with what was typed, before the state has it", async () => {
    await renderSignIn()
    await fireEvent.changeText(screen.getByLabelText(SIGN_IN_COPY.email), SESSION.email)
    await fireEvent(screen.getByLabelText(SIGN_IN_COPY.password), 'submitEditing', {
      nativeEvent: { text: 'hunter2' },
    })
    expect(mockSignIn).toHaveBeenCalledWith({ email: SESSION.email, password: 'hunter2' })
  })

  it('names the active server by its configured name', async () => {
    useActiveServer.setState({
      servers: [{ ...RAVEN_SERVER, name: 'home' }],
      activeId: RAVEN_SERVER.id,
    })
    await renderSignIn()
    expect(screen.getByText(STATUS_COPY.connected('home'))).toBeTruthy()
  })

  it('marks each empty field and says why above the button, before calling anyone', async () => {
    await renderSignIn()
    await signInWith({ email: '', password: '' })
    expect(await screen.findByText(SIGN_IN_COPY.badAccount)).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText(SIGN_IN_COPY.enterEmail)).toBeTruthy()
    expect(screen.getByText(SIGN_IN_COPY.enterPassword)).toBeTruthy()
    expect(mockSignIn).not.toHaveBeenCalled()

    await fireEvent.changeText(screen.getByLabelText(SIGN_IN_COPY.email), SESSION.email)
    expect(screen.queryByText(SIGN_IN_COPY.enterEmail)).toBeNull()
    expect(screen.getByText(SIGN_IN_COPY.enterPassword)).toBeTruthy()
  })

  it('says a wrong email or password in the banner alone', async () => {
    mockSignIn.mockResolvedValue({
      kind: AUTH_OUTCOMES.refused,
      message: 'Invalid login credentials',
      code: 'invalid_credentials',
    })
    await renderSignIn()
    await signInAsListener()
    expect(await screen.findByText(SIGN_IN_COPY.wrongAccount)).toBeTruthy()
    expect(screen.queryByText(SIGN_IN_COPY.enterEmail)).toBeNull()
    expect(screen.queryByText(SIGN_IN_COPY.enterPassword)).toBeNull()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it("shows the account service's words for any other refusal", async () => {
    mockSignIn.mockResolvedValue({
      kind: AUTH_OUTCOMES.refused,
      message: 'Email not confirmed',
      code: 'email_not_confirmed',
    })
    await renderSignIn()
    await signInAsListener()
    expect(await screen.findByText('Email not confirmed')).toBeTruthy()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it("says so when raven can't be reached", async () => {
    mockSignIn.mockResolvedValue({ kind: AUTH_OUTCOMES.unreachable })
    await renderSignIn()
    await signInAsListener()
    expect(await screen.findByText(SIGN_IN_COPY.unreachable)).toBeTruthy()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('shows and hides the password', async () => {
    await renderSignIn()
    const password = screen.getByLabelText(SIGN_IN_COPY.password)
    expect(password.props.secureTextEntry).toBe(true)
    await fireEvent.press(screen.getByRole('button', { name: SIGN_IN_COPY.showPassword }))
    expect(screen.getByLabelText(SIGN_IN_COPY.password).props.secureTextEntry).toBe(false)
    await fireEvent.press(screen.getByRole('button', { name: SIGN_IN_COPY.hidePassword }))
    expect(screen.getByLabelText(SIGN_IN_COPY.password).props.secureTextEntry).toBe(true)
  })

  it("draws a tablet's form beside the brand's half, and signs in from it", async () => {
    await holdAs(TABLET_WINDOW)
    await renderSignIn()
    expect(screen.getByRole('header', { name: SIGN_IN_COPY.title })).toBeTruthy()
    expect(screen.getByText(SIGN_IN_COPY.tagline)).toBeTruthy()
    expect(screen.queryByText(SIGN_IN_COPY.welcome)).toBeNull()
    await signInAsListener()
    expect(mockReplace).toHaveBeenCalledWith(WREN_ROUTES.home)
  })
})
